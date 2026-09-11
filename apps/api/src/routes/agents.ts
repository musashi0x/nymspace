import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import {
  AGENT_CONTEXT_KEY,
  agentEndpointKey,
  agentRegistrationKey,
  assembleManifest,
  encodeDnsName,
  REGISTRY_ROLE,
  setTextResourceAlternatives,
  verifyEnsip25,
} from "@nymspace/ens";
import { formatAmount, previewAgainstLimit, type PaymentRequest, type TokenSpec } from "@nymspace/privy";
import {
  ORGANIZATION_ID,
  REGISTRATION_CHAIN_ID,
  type Deps,
  type DepsEnv,
} from "../deps";
import {
  agentIdFor,
  assertLabelAvailable,
  LabelUnavailableError,
  PROVISIONING_PHASE,
  provisionAgent,
  type ProvisionContext,
} from "../provisioning";
import { errorFields } from "../log";
import {
  agentCreateSchema,
  agentNotFound,
  describeDenial,
  paymentSchema,
  permissionGrantSchema,
  permissionQuerySchema,
  readAt,
  recordWriteSchema,
  unknownToken,
  walletNotProvisioned,
} from "./shared";

/**
 * The agent routes from `docs/10_API_CONTRACT.md`.
 *
 * Handlers are inline and the routes are chained, which is Hono's own guidance
 * and is not merely stylistic: an extracted handler loses the path-parameter
 * type, and a route added with a statement rather than a chained call does not
 * reach `AppType`, so `apps/web` would stop seeing it.
 *
 * Two rules run through all of them.
 *
 * Every externally-derived payload carries the time it was read. A response
 * that mixes a stored slug with a live chain read and labels neither asks the
 * interface to guess which half is current, and `docs/09` forbids treating a
 * cache as truth.
 *
 * A denial is a described outcome, never a 500. An EAC revert and a Privy
 * policy rejection are both the control plane working; returning them as
 * server errors would render the product's central proof as a crash.
 */

export const agents = new Hono<DepsEnv>()
  //////////////////////////////////////////////////////////////////////////
  // The fleet, with all five integration states separately
  //////////////////////////////////////////////////////////////////////////
  .get("/", async (c) => {
    const { store } = c.var.deps;
    const list = await store.listAgents(ORGANIZATION_ID);

    return c.json({
      agents: list.map((agent) => ({
        id: agent.id,
        slug: agent.slug,
        ensName: agent.ensName,
        controllerAddress: agent.controllerAddress,
        erc8004AgentId: agent.erc8004AgentId ?? null,
        privyWalletId: agent.privyWalletId ?? null,
        // Five separate values, per docs/09's closing instruction and task 7.1.
        // Collapsing them would hide which integration is incomplete.
        status: agent.provisioning,
      })),
      // Local rows, so this is the store's own read rather than a chain read —
      // said explicitly so the console does not label it live.
      source: "store" as const,
      readAt: readAt(),
    });
  })

  //////////////////////////////////////////////////////////////////////////
  // Create — organization-signed, idempotent, and slower than a response
  //////////////////////////////////////////////////////////////////////////

  /**
   * Four transactions on Sepolia outlast any request a browser will hold open,
   * so this answers 202 with the agent id and keeps provisioning. The screen
   * follows `GET /:id/provisioning`, which reads the activity log rather than
   * a promise, so a reload or a restart does not lose the run.
   *
   * Idempotent: re-posting a label the organization already owns repairs
   * whatever is missing and spends nothing on what is not. That is a property
   * of `provisionAgent`, not of this handler, and it is why the retry after a
   * partial failure is the documented recovery rather than a support question.
   */
  .post("/", zValidator("json", agentCreateSchema), async (c) => {
    const deps = c.var.deps;
    const body = c.req.valid("json");
    const agentId = agentIdFor(body.label);
    const ensName = `${body.label}.${deps.parentName}`;

    // Read the owner before answering. Provisioning continues after the
    // response, so a stranger's label discovered in there would be a rejection
    // nobody is waiting on, reported after the caller was told 202.
    try {
      await assertLabelAvailable(deps, body.label);
    } catch (error) {
      if (error instanceof LabelUnavailableError) {
        return c.json(
          {
            status: "unavailable" as const,
            label: error.label,
            owner: error.owner,
            reason: `${ensName} is already owned by another account`,
            readAt: readAt(),
          },
          409,
        );
      }
      throw error;
    }

    // The row and its five tracks exist before the response, so the screen the
    // caller is about to poll has something to read on its first request.
    await deps.store.upsertAgent({
      id: agentId,
      organizationId: ORGANIZATION_ID,
      slug: body.label,
      ensName,
      controllerAddress: body.controller,
    });

    // Captured now, like `deps`: the run outlives this handler, and its lines
    // must carry the id of the request that started it.
    const log = c.var.log;

    void provisionAgent(provisionContext(deps), {
      label: body.label,
      name: body.name,
      description: body.description,
      role: body.role,
      controller: body.controller,
      endpoints: body.endpoints,
      delegate: body.delegate,
    }).catch(async (error: unknown) => {
      // A provisioning run that dies after the response would otherwise be
      // invisible: the tracks would sit at their initial values with nothing
      // saying why, and the screen would poll forever.
      //
      // Logged before either store write is attempted. When Postgres is what
      // failed, both writes below fail too, and this line is the only record.
      log.error("provisioning stopped", { agentId, ensName, ...errorFields(error) });

      // Each write keeps its own catch so one failing does not skip the other,
      // and each logs rather than discards: a failure to record a failure is
      // the one nobody would otherwise find.
      const unrecorded = (write: string) => (writeError: unknown) =>
        log.error("could not record provisioning failure", {
          agentId,
          write,
          ...errorFields(writeError),
        });

      await deps.store
        .setProvisioning(agentId, { ens: "failed" })
        .catch(unrecorded("setProvisioning"));
      await deps.store
        .recordEvent({
          organizationId: ORGANIZATION_ID,
          agentId,
          source: "ens",
          type: "ens.action.denied",
          status: "failed",
          occurredAt: readAt(),
          summary: `Provisioning ${ensName} stopped`,
          evidence: {
            source: "ens",
            txHash: `0x${"0".repeat(64)}`,
            contractAddress: deps.resolver,
          },
          metadata: {
            phase: PROVISIONING_PHASE,
            reason: error instanceof Error ? error.message.split("\n")[0]! : String(error),
          },
        })
        .catch(unrecorded("recordEvent"));
    });

    return c.json(
      {
        id: agentId,
        ensName,
        slug: body.label,
        status: "provisioning" as const,
        readAt: readAt(),
      },
      202,
    );
  })

  //////////////////////////////////////////////////////////////////////////
  // Provisioning progress — the five tracks, and the steps behind them
  //////////////////////////////////////////////////////////////////////////

  /**
   * The steps are the activity log, filtered to this agent. There is no
   * provisioning-run table and no stream held in a component: the events were
   * already being written with their transaction hashes, and reading them back
   * is what makes a reload mid-provision rebuild rather than restart.
   *
   * `complete` is false while the ENS track is still moving. The other four
   * tracks are not part of that answer — an agent with a verified binding and
   * no wallet is not failed, it is financially unprovisioned, and creation
   * never claimed to touch those.
   */
  .get("/:id/provisioning", async (c) => {
    const { store } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const events = await store.listActivity({
      organizationId: ORGANIZATION_ID,
      agentId: agent.id,
      limit: 100,
    });

    const steps = events
      // Both conditions. The type says what happened; the phase says it
      // happened during a provisioning run rather than during a later endpoint
      // update or a permission proof, which write the same two types.
      .filter(
        (event) =>
          PROVISIONING_TYPES.has(event.type) &&
          phaseOf(event.metadata) === PROVISIONING_PHASE,
      )
      // The log is newest first; a step list reads in the order it happened.
      .reverse()
      .map((event) => ({
        what: event.summary,
        status: event.status,
        // Narrowed rather than asserted: `ActivityEvidence` is a union per
        // source, and a provisioning step's evidence is always an ENS one.
        txHash: event.evidence.source === "ens" ? event.evidence.txHash : null,
        readBack: readBackOf(event.metadata),
        occurredAt: event.occurredAt,
      }));

    return c.json({
      id: agent.id,
      ensName: agent.ensName,
      tracks: agent.provisioning,
      steps,
      complete: agent.provisioning.ens === "active" || agent.provisioning.ens === "failed",
      source: "store" as const,
      readAt: readAt(),
    });
  })

  //////////////////////////////////////////////////////////////////////////
  // Live ENS state, assembled per request
  //////////////////////////////////////////////////////////////////////////
  .get("/:id/identity", async (c) => {
    const { store, ens, erc8004, config, registry } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const manifest = await assembleManifest({
      name: agent.ensName,
      ens,
      ensChainId: config.chainId,
      ...(agent.erc8004AgentId && {
        registration: { agentId: agent.erc8004AgentId, service: erc8004 },
      }),
    });

    const [owner, resolver] = await Promise.all([
      ens.findOwner(registry, agent.slug),
      ens.getResolver(registry, agent.slug),
    ]);

    return c.json({
      ensName: agent.ensName,
      // Said by the API, which read the agent, so the console never has to
      // split an ENS name to learn which agent it is looking at.
      label: agent.slug,
      chainId: config.chainId,
      owner,
      controller: agent.controllerAddress,
      registry,
      resolver,
      records: {
        context: manifest.context?.value ?? null,
        mcp: manifest.endpoints.mcp?.value ?? null,
        a2a: manifest.endpoints.a2a?.value ?? null,
      },
      recordKeys: {
        context: AGENT_CONTEXT_KEY,
        mcp: agentEndpointKey("mcp"),
        a2a: agentEndpointKey("a2a"),
      },
      ensip25: manifest.verification,
      registration: manifest.registration ?? null,
      // The manifest is assembled per request and never stored, so this is the
      // moment every field above was true — design.md D2.
      fetchedAt: manifest.assembledAt,
    });
  })

  //////////////////////////////////////////////////////////////////////////
  // The permission matrix, computed from chain cell by cell
  //////////////////////////////////////////////////////////////////////////
  .get("/:id/permissions", zValidator("query", permissionQuerySchema), async (c) => {
    const { store, ens, registry, organization } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const controller = c.req.valid("query").controller ?? agent.controllerAddress;

    const keys = [
      AGENT_CONTEXT_KEY,
      agentEndpointKey("mcp"),
      agentEndpointKey("a2a"),
      ...(agent.erc8004AgentId && agent.erc8004Registry
        ? [
            agentRegistrationKey({
              chainId: REGISTRATION_CHAIN_ID,
              registry: agent.erc8004Registry,
              agentId: agent.erc8004AgentId,
            }),
          ]
        : []),
    ];

    /**
     * One cell, one query, and the query evaluates the resolver's own fallback
     * chain — design.md D9. `canSetText` tries `resource(node, part)`, the
     * wildcard, and `resource(node, 0)`, which is what `onlyPartRoles` accepts.
     * Checking only the first would render a name-level grant as a denial: a UI
     * that lies in the safe-looking direction, which is worse than one that
     * lies loudly.
     */
    const recordPermissions: Record<string, boolean> = {};
    const queries: { cell: string; resources: string[] }[] = [];
    for (const key of keys) {
      recordPermissions[key] = await ens.canSetText(agent.ensName, key, controller);
      queries.push({
        cell: key,
        resources: setTextResourceAlternatives(agent.ensName, key).map(String),
      });
    }

    const tokenId = await ens.findTokenId(registry, agent.slug);
    const resource = await ens.registryResource(registry, tokenId);
    const registryRole = (role: bigint) =>
      ens.registryHasRoles({ registry, resource, roles: role, account: controller });

    /**
     * The positive control, in the same request — task 7.7.
     *
     * A wrong resource derivation and a genuine denial are the same value, so
     * every denied cell above is only meaningful if something in this request
     * came back allowed through the same code path. The organization holds
     * everything at root, so its answer proves the read works.
     */
    const control = {
      account: organization,
      key: agentEndpointKey("mcp"),
      allowed: await ens.canSetText(
        agent.ensName,
        agentEndpointKey("mcp"),
        organization,
      ),
    };

    return c.json({
      controller,
      recordPermissions,
      registryPermissions: {
        setResolver: await registryRole(REGISTRY_ROLE.SET_RESOLVER),
        setSubregistry: await registryRole(REGISTRY_ROLE.SET_SUBREGISTRY),
        unregister: await registryRole(REGISTRY_ROLE.UNREGISTER),
      },
      source: "ensv2" as const,
      control,
      queries,
      readAt: readAt(),
    });
  })

  //////////////////////////////////////////////////////////////////////////
  // Grant and revoke, organization-signed
  //////////////////////////////////////////////////////////////////////////
  .post("/:id/permissions", zValidator("json", permissionGrantSchema), async (c) => {
    const { store, ens, resolver } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const { controller, recordKey, grant } = c.req.valid("json");

    try {
      const hash = await ens.authorizeTextRole({
        dnsName: encodeDnsName(agent.ensName),
        key: recordKey,
        controller,
        authorized: grant,
      });
      const receipt = await ens.waitForReceipt(hash);

      await store.recordEvent({
        organizationId: ORGANIZATION_ID,
        agentId: agent.id,
        source: "ens",
        type: grant ? "ens.permission.granted" : "ens.permission.revoked",
        status: receipt.status === "success" ? "success" : "failed",
        occurredAt: readAt(),
        txHash: hash,
        summary: `${grant ? "Granted" : "Revoked"} SET_TEXT on ${recordKey} for ${controller}`,
        evidence: { source: "ens", txHash: hash, contractAddress: resolver },
      });

      return c.json({
        status: receipt.status === "success" ? ("confirmed" as const) : ("failed" as const),
        transaction: { hash },
        readAt: readAt(),
      });
    } catch (error) {
      // An organization that has lost grant authority is a described outcome,
      // not a server fault.
      return c.json(describeDenial(error, resolver));
    }
  })

  //////////////////////////////////////////////////////////////////////////
  // Server-signed controller writes — the permission proof
  //////////////////////////////////////////////////////////////////////////
  .post("/:id/records", zValidator("json", recordWriteSchema), async (c) => {
    const { store, ens, resolver } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const { key, value } = c.req.valid("json");
    const before = await ens.readText(agent.ensName, key);

    try {
      const hash = await ens.writeText({
        name: agent.ensName,
        key,
        value,
        // The controller, always. A write signed by the organization would
        // succeed for every key and prove nothing about delegation — this
        // route exists to show the controller's own reach.
        as: "controller",
      });
      await ens.waitForReceipt(hash);
      const after = await ens.readText(agent.ensName, key);

      await store.recordEvent({
        organizationId: ORGANIZATION_ID,
        agentId: agent.id,
        source: "ens",
        type: "ens.record.updated",
        status: "success",
        occurredAt: readAt(),
        actor: agent.controllerAddress,
        txHash: hash,
        summary: `Controller wrote ${key} on ${agent.ensName}`,
        evidence: { source: "ens", txHash: hash, contractAddress: resolver },
      });

      return c.json({
        status: "confirmed" as const,
        key,
        // Both values, so the proof screen shows what changed rather than
        // asserting that something did.
        before,
        after,
        transaction: { hash },
        actor: agent.controllerAddress,
        readAt: readAt(),
      });
    } catch (error) {
      const outcome = describeDenial(error, resolver);

      /**
       * A write that never reached the resolver leaves no mark on the log.
       *
       * The activity log is the agent's history, and `ens.action.denied` is a
       * claim about authority. Writing that row for a missing signing key would
       * put "Controller was denied agent-context" in a permanent record of
       * something the controller was never refused — a lie that outlives the
       * screen that showed it, and one a later audit has no way to unpick.
       */
      if (outcome.status === "not_configured") {
        return c.json({ ...outcome, key, before });
      }

      await store.recordEvent({
        organizationId: ORGANIZATION_ID,
        agentId: agent.id,
        source: "ens",
        type: "ens.action.denied",
        status: outcome.status,
        occurredAt: readAt(),
        actor: agent.controllerAddress,
        summary: `Controller was denied ${key} on ${agent.ensName}`,
        evidence: {
          source: "ens",
          txHash: `0x${"0".repeat(64)}`,
          contractAddress: resolver,
        },
        metadata: { key, before, reason: outcome.reason },
      });
      return c.json({ ...outcome, key, before });
    }
  })

  //////////////////////////////////////////////////////////////////////////
  // The runtime ENSIP 25 check
  //////////////////////////////////////////////////////////////////////////
  .post("/:id/verify", async (c) => {
    const { store, ens, erc8004 } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    if (!agent.erc8004AgentId || !agent.erc8004Registry) {
      // Not an error: an agent with no registration genuinely has nothing to
      // verify, and the seven-state model already has a name for that.
      return c.json({
        status: "registry_claim_missing" as const,
        ensName: agent.ensName,
        recordKey: null,
        readAt: readAt(),
      });
    }

    const result = await verifyEnsip25({
      ensName: agent.ensName,
      agentId: agent.erc8004AgentId,
      registry: agent.erc8004Registry,
      chainId: REGISTRATION_CHAIN_ID,
      erc8004,
      readText: (name, key) => ens.readText(name, key),
    });

    await store.setProvisioning(agent.id, { ensip25: result.status });
    return c.json({ ...result, recordKey: result.key ?? null });
  })

  //////////////////////////////////////////////////////////////////////////
  // Safe financial metadata only
  //////////////////////////////////////////////////////////////////////////
  .get("/:id/wallet", async (c) => {
    const { store, privy, privyOwner, paymentToken } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const ref = await store.getFinancialAuthority(agent.id);
    if (!ref) {
      return c.json({
        status: "no_wallet" as const,
        address: null,
        provider: "privy" as const,
        token: tokenPayload(paymentToken),
        signerMode: signerMode(privyOwner !== undefined),
        policy: null,
        readAt: readAt(),
      });
    }

    // The limit comes from the live policy, never a constant — task 5.9. Every
    // other field of the policy stays here: `docs/10` says not to return
    // configuration that could reveal credentials.
    const limit = ref.policyId
      ? await privy.getPolicyLimit(ref.policyId)
      : undefined;

    return c.json({
      status: "provisioned" as const,
      address: ref.walletAddress,
      provider: "privy" as const,
      token: tokenPayload(paymentToken),
      signerMode: signerMode(privyOwner !== undefined),
      policy: limit
        ? {
            label: limit.name,
            maxAmount: limit.maxAmount,
            // The limit's own denomination, which is not necessarily the
            // deployment's: a policy pinning a different contract than the one
            // configured is a misconfiguration the screen should show rather
            // than hide behind the token it expected.
            token: tokenPayload(limit.token),
            ruleName: limit.ruleName,
            status: "active" as const,
          }
        : null,
      readAt: readAt(),
    });
  })

  //////////////////////////////////////////////////////////////////////////
  // Preview — informational, and the payload says so
  //////////////////////////////////////////////////////////////////////////
  .post("/:id/payments/preview", zValidator("json", paymentSchema), async (c) => {
    const { store, privy, paymentToken } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const ref = await store.getFinancialAuthority(agent.id);
    if (!ref?.policyId) walletNotProvisioned(id);

    const { amount, recipient, token: requested } = c.req.valid("json");
    const token = resolveToken(requested, paymentToken);
    const limit = await privy.getPolicyLimit(ref.policyId);
    const preview = previewAgainstLimit(
      {
        amount,
        recipient,
        caip2: `eip155:${REGISTRATION_CHAIN_ID}`,
        ...(token && { token }),
      },
      limit,
    );

    /**
     * The policy pins the contract as well as the amount, so a request for a
     * token the policy does not name is outside the boundary however small it
     * is. Reporting it as allowed because the number is small would preview the
     * amount rule and ignore the rule that actually governs.
     */
    const tokenMatches =
      (token?.address.toLowerCase() ?? null) ===
      (limit.token?.address.toLowerCase() ?? null);

    return c.json({
      expected:
        tokenMatches && preview.withinLimit
          ? ("allowed" as const)
          : ("denied" as const),
      requestedAmount: preview.requestedAmount,
      limitAmount: preview.limitAmount,
      token: tokenPayload(token),
      limitToken: tokenPayload(limit.token),
      policySummary: { label: limit.name, ruleName: limit.ruleName },
      // Stated in the payload, not only in a comment. Privy enforces; this is a
      // guess shown before the operator commits, and task 5.12 tampers with it
      // precisely to prove it decides nothing.
      enforcement: "privy" as const,
      informational: true as const,
      readAt: readAt(),
    });
  })

  //////////////////////////////////////////////////////////////////////////
  // The payment itself — four typed outcomes, all of them HTTP 200
  //////////////////////////////////////////////////////////////////////////
  .post("/:id/payments", zValidator("json", paymentSchema), async (c) => {
    const { store, privy, privyOwner, paymentToken } = c.var.deps;
    const id = c.req.param("id");
    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const ref = await store.getFinancialAuthority(agent.id);
    if (!ref) walletNotProvisioned(id);

    const { amount, recipient, memo, token: requested } = c.req.valid("json");
    const token = resolveToken(requested, paymentToken);

    const result = await privy.sendPayment(ref.privyWalletId, {
      amount,
      recipient,
      caip2: `eip155:${REGISTRATION_CHAIN_ID}`,
      ...(token && { token }),
      ...(memo && { memo }),
    });

    /**
     * The request is recorded on the event, not just summarised in prose.
     *
     * An approval re-submits what was denied, and it reads it from here. An
     * approval whose amount comes back from the client is an approval of
     * whatever the client says it approved.
     */
    const event = await store.recordEvent({
      organizationId: ORGANIZATION_ID,
      agentId: agent.id,
      source: "privy",
      type:
        result.status === "executed"
          ? "privy.payment.executed"
          : result.status === "pending_approval"
            ? "privy.approval.requested"
            : "privy.payment.denied",
      status:
        result.status === "executed"
          ? "success"
          : result.status === "denied"
            ? "denied"
            : result.status === "pending_approval"
              ? "pending"
              : "failed",
      occurredAt: readAt(),
      ...(result.status === "executed" && {
        txHash: result.transactionHash as `0x${string}`,
      }),
      summary: `Payment of ${describeAmount(amount, token)} to ${recipient}: ${result.status}`,
      evidence:
        result.status === "executed"
          ? { source: "privy", txHash: result.transactionHash as `0x${string}` }
          : {
              source: "privy",
              requestId:
                ("requestId" in result && result.requestId) || ref.privyWalletId,
              policyDecision: result.status,
            },
      metadata: {
        amount,
        recipient,
        tokenAddress: token?.address ?? null,
        tokenSymbol: token?.symbol ?? "ETH",
        tokenDecimals: token?.decimals ?? 18,
        authority: "agent",
      },
    });

    /**
     * The affordance follows the configuration — design.md D6.
     *
     * With no owner key there is no higher authority, so a denial carries no
     * escalation and the console renders no button. `docs/08` forbids
     * simulating an approval path, and a flag someone forgets to turn off is
     * how that promise gets broken quietly.
     */
    const escalation =
      result.status === "denied" && privyOwner
        ? {
            requestId: event.id,
            authority: "organization owner" as const,
            /** Every word of this is true only because the route below exists. */
            detail:
              "The organization's own key is not bound by the agent's policy and can execute this request.",
          }
        : undefined;

    // 200 for every outcome. A denial is the control plane working, and an HTTP
    // error would put it on the same path as an outage — `docs/11`.
    return c.json({
      ...result,
      ...(escalation && { escalation }),
      readAt: readAt(),
    });
  })

  //////////////////////////////////////////////////////////////////////////
  // Escalation — a different authority, not a different code path
  //////////////////////////////////////////////////////////////////////////
  .post("/:id/payments/:requestId/approve", async (c) => {
    const { store, privyOwner, paymentToken } = c.var.deps;
    const id = c.req.param("id");
    const requestId = c.req.param("requestId");

    if (!privyOwner) noHigherAuthority();

    const agent = await store.getAgent(id);
    if (!agent) agentNotFound(id);

    const ref = await store.getFinancialAuthority(agent.id);
    if (!ref) walletNotProvisioned(id);

    const denial = await store.getEvent(requestId);
    if (!denial || denial.agentId !== agent.id || denial.status !== "denied") {
      notApprovable(requestId);
    }

    const request = deniedRequestFrom(denial.metadata, paymentToken);

    /**
     * The denial stays where it is.
     *
     * Resolving *it* to success would erase the proof — the timeline would show
     * a payment that was always fine. The approval is its own pending event,
     * resolved in place when the owner's key answers, and it names the denial it
     * answers.
     */
    const pending = await store.recordEvent({
      organizationId: ORGANIZATION_ID,
      agentId: agent.id,
      source: "privy",
      type: "privy.approval.requested",
      status: "pending",
      occurredAt: readAt(),
      externalId: denial.id,
      summary: `Owner approval requested for ${describeAmount(request.amount, request.token ?? null)} to ${request.recipient}`,
      evidence: {
        source: "privy",
        requestId: denial.id,
        policyDecision: "pending_approval",
      },
      metadata: {
        amount: request.amount,
        recipient: request.recipient,
        tokenAddress: request.token?.address ?? null,
        approves: denial.id,
        authority: "owner",
      },
    });

    const result = await privyOwner.sendPayment(ref.privyWalletId, request);

    await store.resolveEvent(pending.id, {
      status: result.status === "executed" ? "success" : "failed",
      summary:
        result.status === "executed"
          ? `Owner approved and executed ${describeAmount(request.amount, request.token ?? null)} to ${request.recipient}`
          : `Owner approval could not execute: ${"reason" in result ? result.reason : result.status}`,
      ...(result.status === "executed" && {
        txHash: result.transactionHash as `0x${string}`,
      }),
      evidence:
        result.status === "executed"
          ? { source: "privy", txHash: result.transactionHash as `0x${string}` }
          : {
              source: "privy",
              requestId: denial.id,
              policyDecision: result.status,
            },
    });

    return c.json({
      ...result,
      approvedRequestId: denial.id,
      authority: "organization owner" as const,
      readAt: readAt(),
    });
  });

//////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////

/**
 * The token a request is denominated in, or a 400.
 *
 * The rule is D4: absent means the configured token, a match means the
 * configured token, and anything else is refused. Silently reinterpreting an
 * unrecognised token as a native transfer is what turned `pay 5 USDC` into
 * five wei of ETH, with a transaction hash and a success on screen.
 */
function resolveToken(
  requested: string | undefined,
  configured: TokenSpec | null,
): TokenSpec | null {
  if (!requested) return configured;
  if (
    !configured ||
    requested.toLowerCase() !== configured.address.toLowerCase()
  ) {
    unknownToken(requested, configured?.address ?? null);
  }
  return configured;
}

/** What a response may say about a token. Address, symbol, decimals. */
function tokenPayload(token: TokenSpec | null): {
  address: string;
  symbol: string;
  decimals: number;
} | null {
  if (!token) return null;
  return {
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
  };
}

/**
 * Which key signs the agent's payments, and whether a second one exists.
 *
 * `docs/08` lists signer mode among the things the interface should show. It is
 * derived from the configuration for the same reason the escalation is: a
 * screen that claims an owner path while none is configured is the simulated
 * approval the doc forbids, one indirection removed.
 */
function signerMode(hasOwner: boolean): string {
  return hasOwner
    ? "agent key, capped by policy; organization owner key can escalate"
    : "agent key, capped by policy";
}

/** `5000000` + USDC → `5 USDC`. Never a bare number in a summary. */
function describeAmount(amount: string, token: TokenSpec | null): string {
  return formatAmount(amount, token);
}

/**
 * The request that was denied, read back from the event that recorded it.
 *
 * Validated rather than trusted: the column is `jsonb`, so what comes out is
 * `unknown` however carefully it went in, and an approval built from a
 * malformed row would execute an amount nobody requested. The token is resolved
 * against the configured one for the same reason the payment route resolves it.
 */
function deniedRequestFrom(
  metadata: Record<string, unknown> | undefined,
  configured: TokenSpec | null,
): PaymentRequest {
  const amount = metadata?.["amount"];
  const recipient = metadata?.["recipient"];
  const tokenAddress = metadata?.["tokenAddress"];

  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new HTTPException(422, {
      message: "the recorded request carries no amount, so there is nothing to approve",
    });
  }
  if (typeof recipient !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw new HTTPException(422, {
      message: "the recorded request carries no recipient, so there is nothing to approve",
    });
  }

  const token =
    tokenAddress === null || tokenAddress === undefined
      ? null
      : resolveToken(String(tokenAddress), configured);

  return {
    amount,
    recipient,
    caip2: `eip155:${REGISTRATION_CHAIN_ID}`,
    ...(token && { token }),
  };
}

/** No owner key, so there is nothing to escalate to. Not a 500. */
function noHigherAuthority(): never {
  throw new HTTPException(409, {
    message:
      "no owner signing key is configured, so no authority above the agent exists to approve this",
  });
}

/** The event named is not a denial of this agent's. */
function notApprovable(requestId: string): never {
  throw new HTTPException(404, {
    message: `no denied payment ${requestId} for this agent to approve`,
  });
}

/**
 * The event types a provisioning run writes.
 *
 * Named rather than inferred, so an unrelated event on the same agent — a
 * payment, a later record edit — does not appear in the create screen's step
 * list as though the run were still going.
 */
const PROVISIONING_TYPES: ReadonlySet<string> = new Set([
  "agent.created",
  "ens.resolver.attached",
  "ens.record.updated",
  "ens.permission.granted",
  "ens.action.denied",
]);

function phaseOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)["phase"];
  return typeof value === "string" ? value : null;
}

function readBackOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)["readBack"];
  return typeof value === "string" ? value : null;
}

function provisionContext(deps: Deps): ProvisionContext {
  return {
    ens: deps.ens,
    store: deps.store,
    organizationId: ORGANIZATION_ID,
    parentName: deps.parentName,
    registry: deps.registry,
    resolver: deps.resolver,
    organization: deps.organization,
  };
}
