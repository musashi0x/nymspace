import { isPublishableEndpoint, type Address, type Hex } from "@nymspace/core";
import {
  AGENT_CONTEXT_KEY,
  AGENT_SUBNAME_OWNER_ROLES,
  EnsService,
  RESOLVER_ROLE,
  agentEndpointKey,
  agentRegistrationKey,
  buildAgentContext,
  buildRegistrationFile,
  claimedEnsName,
  encodeAgentContext,
  encodeDnsName,
  textRecordResource,
  verifyEnsip25,
  type Erc8004Service,
} from "@nymspace/ens";
import type { Agent0Client } from "@nymspace/graph";
import type {
  EnsProvisioning,
  Erc8004Provisioning,
  GraphProvisioning,
  ProvisioningStatus,
  Store,
} from "@nymspace/store";

/**
 * One agent, provisioned onto ENSv2.
 *
 * This is `scripts/provision-fleet.ts`'s per-agent sequence with its hardcoded
 * fleet removed — design D7. The script was the only implementation, the route
 * needed the same steps, and re-typing them in a handler would have produced
 * two provisioning paths that diverge on the first fix. The script is the one
 * whose idempotency is already proved on Sepolia, so it is the one that moved.
 *
 * Every step reads chain state before it spends. That is not an optimisation:
 * a half-provisioned agent is the normal state to recover from, and the whole
 * reason `POST /v1/agents` can be re-sent is that nothing here writes what is
 * already written.
 *
 * The module orchestrates two systems, so it lives above both. `@nymspace/ens`
 * would have to depend on `@nymspace/store` to hold it, and the store is not an
 * authority for anything on chain — that dependency would point the wrong way.
 */

//////////////////////////////////////////////////////////////////////////////
// Shapes
//////////////////////////////////////////////////////////////////////////////

/** One year. `register` reverts with `CannotSetPastExpiry` on anything past. */
const EXPIRY_SECONDS = 365n * 24n * 60n * 60n;

/**
 * Stamped on every event this path writes.
 *
 * The event *types* are not enough to identify a provisioning step. A
 * controller updating its endpoint later writes `ens.record.updated`, and the
 * permission proof writes `ens.action.denied` every time it runs — both would
 * otherwise appear in the create screen's step list, describing a run that
 * finished days ago. The phase says which run an event belongs to; the types
 * only say what kind of thing happened.
 */
export const PROVISIONING_PHASE = "provisioning";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

/**
 * The endpoint protocols a caller may publish.
 *
 * `docs/03_UX_SPEC.md` also lists an optional web endpoint, and it is not here.
 * `agentEndpointKey` names two protocols, the manifest assembles two, and the
 * inspector renders two — publishing a third key from this one module would
 * write a record nothing in the product can read back. The type is derived from
 * the key function rather than restated, so the day the package names a third
 * protocol this list gains it and the compiler finds every caller.
 */
export const ENDPOINT_PROTOCOLS = ["mcp", "a2a"] as const;
export type EndpointProtocol = Parameters<typeof agentEndpointKey>[0];

export interface ProvisionTarget {
  label: string;
  /** Display name, for `agent-context`. */
  name: string;
  description: string;
  role: string;
  controller: Address;
  endpoints: Partial<Record<EndpointProtocol, string>>;
  /**
   * Whether the controller receives `SET_TEXT` on the endpoint keys.
   *
   * Off by default at the call site. A fleet needs at least one name whose
   * controller holds no grant, or `docs/13` E5 has nothing to check leakage
   * against.
   */
  delegate: boolean;
}

export interface ProvisionContext {
  ens: EnsService;
  store: Store;
  organizationId: string;
  /** `<parent>.eth`. */
  parentName: string;
  registry: Address;
  resolver: Address;
  organization: Address;
  /**
   * The ERC 8004 registry, on its own chain — Base Sepolia, design.md D14.
   *
   * Absent means the run ends at identity. `POST /v1/agents` passes it, so a
   * created agent is registered and bound in the same run.
   * `scripts/provision-fleet.ts` does not: the fleet's registrations belong to
   * `pnpm register:identity`, which also runs the proofs this module does not.
   */
  erc8004?: Erc8004Service;
  /**
   * Agent0, asked whether the registration is indexed yet. Absent, the
   * discovery track is left alone — still the truth, since nobody asked.
   */
  graph?: Pick<Agent0Client, "agentProfile">;
}

/**
 * What one step did, and what the chain said afterwards.
 *
 * `skipped` is reported rather than swallowed. Idempotency the operator cannot
 * see is indistinguishable from a silent no-op, and the screen prints these
 * rows as "already on chain, no spend" — design D2.
 *
 * `readBack` is the value re-read after the write. `docs/02` Flow 1 refuses to
 * call a step complete on a submitted transaction, so a step that writes and
 * cannot read its own effect back is not `ok`.
 */
export interface ProvisionStep {
  what: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
  txHash?: Hex;
  readBack?: string;
}

export interface ProvisionResult {
  agentId: string;
  ensName: string;
  steps: ProvisionStep[];
  /** Where the ENS track ended up. */
  ens: EnsProvisioning;
  /** Present when the run went on to register — {@link bindRegistration}. */
  registration?: RegistrationResult;
}

/**
 * The label is already owned by someone who is not us.
 *
 * Distinct from a revert: nothing was attempted. Two operators creating
 * `research` at once would otherwise have the second read see an owner, skip
 * registration, and write records to a name it does not control.
 */
export class LabelUnavailableError extends Error {
  constructor(
    readonly label: string,
    readonly owner: Address,
  ) {
    super(`${label} is already owned by ${owner}`);
    this.name = "LabelUnavailableError";
  }
}

//////////////////////////////////////////////////////////////////////////////
// Label rules
//////////////////////////////////////////////////////////////////////////////

/**
 * Lowercase, alphanumeric, internal hyphens. Checked here rather than only in
 * the route's schema so the script and the API cannot disagree about what a
 * name is.
 */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

export function isValidLabel(label: string): boolean {
  return LABEL.test(label);
}

export function agentIdFor(label: string): string {
  return `agent-${label}`;
}

//////////////////////////////////////////////////////////////////////////////
// Helpers
//////////////////////////////////////////////////////////////////////////////

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Equal but for `updatedAt`, so a re-run does not pay to rewrite a timestamp. */
function sameContext(before: string, next: string): boolean {
  try {
    const a = JSON.parse(before) as Record<string, unknown>;
    const b = JSON.parse(next) as Record<string, unknown>;
    delete a["updatedAt"];
    delete b["updatedAt"];
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

//////////////////////////////////////////////////////////////////////////////
// Availability
//////////////////////////////////////////////////////////////////////////////

/**
 * Read the label's owner, and refuse it if that owner is a stranger.
 *
 * Separate from `provisionAgent` because the route has to answer this one
 * synchronously. Provisioning continues after the response, so a check made
 * inside it would report a taken label into a promise nobody is holding, and
 * the caller would have been told 202 for a name it will never own.
 *
 * Returns the owner it read, so the caller that goes on to provision does not
 * pay for the read twice.
 */
export async function assertLabelAvailable(
  ctx: Pick<ProvisionContext, "ens" | "registry" | "organization">,
  label: string,
): Promise<Address> {
  const owner = await ctx.ens.findOwner(ctx.registry, label);
  if (
    !sameAddress(owner, ZERO_ADDRESS) &&
    !sameAddress(owner, ctx.organization)
  ) {
    throw new LabelUnavailableError(label, owner);
  }
  return owner;
}

//////////////////////////////////////////////////////////////////////////////
// The sequence
//////////////////////////////////////////////////////////////////////////////

export async function provisionAgent(
  ctx: ProvisionContext,
  target: ProvisionTarget,
): Promise<ProvisionResult> {
  const { ens, store, registry, resolver, organization } = ctx;
  const { label } = target;
  const ensName = `${label}.${ctx.parentName}`;
  const agentId = agentIdFor(label);
  const steps: ProvisionStep[] = [];

  const step = (entry: ProvisionStep): ProvisionStep => {
    steps.push(entry);
    return entry;
  };

  const now = () => new Date().toISOString();
  const evidence = (txHash: Hex) => ({
    source: "ens" as const,
    txHash,
    contractAddress: resolver,
  });

  //////////////////////////////////////////////////////////////////////////
  // The name
  //////////////////////////////////////////////////////////////////////////

  const existingOwner = await assertLabelAvailable(ctx, label);

  await store.upsertAgent({
    id: agentId,
    organizationId: ctx.organizationId,
    slug: label,
    ensName,
    controllerAddress: target.controller,
  });

  /*
    Pending for the length of the run, repairs included.

    The track is what `GET /:id/provisioning` answers `complete` from, and a
    second submission of an agent that is already active left it active — so
    the screen reported a finished run at the first poll and stopped asking,
    while this function was still writing. The end of this function sets it
    again from a full read-back; until then the honest answer is that the
    chain state is being re-derived and not yet known.
  */
  await store.setProvisioning(agentId, { ens: "pending" });

  if (sameAddress(existingOwner, ZERO_ADDRESS)) {
    const expiry = BigInt(Math.floor(Date.now() / 1000)) + EXPIRY_SECONDS;
    try {
      const hash = await ens.registerSubname({
        registry,
        label,
        owner: organization,
        // Zero: an agent name has no children, and wiring a subregistry it does
        // not need would be authority nobody asked for.
        subregistry: ZERO_ADDRESS,
        resolver,
        roleBitmap: AGENT_SUBNAME_OWNER_ROLES,
        expiry,
      });
      const receipt = await ens.waitForReceipt(hash);
      const ok = receipt.status === "success";
      step({ what: `register ${ensName}`, ok, skipped: false, detail: hash, txHash: hash });

      await store.recordEvent({
        organizationId: ctx.organizationId,
        agentId,
        source: "ens",
        type: "agent.created",
        status: ok ? "success" : "failed",
        occurredAt: now(),
        actor: organization,
        txHash: hash,
        summary: `Registered ${ensName}`,
        evidence: { source: "ens", txHash: hash, contractAddress: registry },
        // The read-back travels with the event rather than only in the return
        // value. A screen reloaded mid-provision rebuilds its step list from
        // the log, and a step that cannot show what the chain said afterwards
        // is back to reporting a submitted transaction as done — design D3.
        metadata: { phase: PROVISIONING_PHASE, readBack: organization },
      });
    } catch (error) {
      step({
        what: `register ${ensName}`,
        ok: false,
        skipped: false,
        detail: messageOf(error),
      });
      await store.setProvisioning(agentId, { ens: "failed" });
      return { agentId, ensName, steps, ens: "failed" };
    }
  } else {
    step({
      what: `register ${ensName}`,
      ok: true,
      skipped: true,
      detail: `already registered, owner ${existingOwner}`,
      readBack: existingOwner,
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // The resolver, read back
  //////////////////////////////////////////////////////////////////////////

  // A subname registered without a resolver resolves to nothing, and the
  // failure would not surface until a record read returned empty for a reason
  // that looked like a permission problem.
  const [owner, attached] = await Promise.all([
    ens.findOwner(registry, label),
    ens.getResolver(registry, label),
  ]);
  const resolverAttached = sameAddress(attached, resolver);

  step({
    what: `read back ${ensName}`,
    ok: sameAddress(owner, organization) && resolverAttached,
    skipped: false,
    detail: `owner ${owner}, resolver ${attached}${resolverAttached ? "" : " (MISMATCH)"}`,
    readBack: attached,
  });

  if (!resolverAttached) {
    await store.setProvisioning(agentId, { ens: "failed" });
    return { agentId, ensName, steps, ens: "failed" };
  }

  /**
   * Recorded only when this run did the registering.
   *
   * The resolver is attached by the registration transaction, so on a re-run
   * there is no new attachment to report — and the event would carry a zero
   * hash, because the transaction it points at belongs to a run that already
   * logged it. Found by re-posting a provisioned label: every step correctly
   * spent nothing, and the step list grew by one row saying "no transaction".
   */
  const registrationHash = steps.find(
    (s) => s.what === `register ${ensName}` && !s.skipped,
  )?.txHash;

  if (registrationHash) {
    await store.recordEvent({
      organizationId: ctx.organizationId,
      agentId,
      source: "ens",
      type: "ens.resolver.attached",
      status: "success",
      occurredAt: now(),
      summary: `${ensName} resolves through ${attached}`,
      metadata: { phase: PROVISIONING_PHASE, readBack: attached },
      evidence: {
        source: "ens",
        // The attachment happened in the registration transaction; the read
        // above is the confirmation, and the registration is the evidence.
        txHash: registrationHash,
        contractAddress: registry,
      },
    });
  }

  await store.setProvisioning(agentId, { ens: "pending" });

  //////////////////////////////////////////////////////////////////////////
  // The records — organization-signed, every one
  //////////////////////////////////////////////////////////////////////////

  /**
   * Keys are derived here, never accepted from the caller. A request naming a
   * raw key could name the ENSIP 25 binding, and `docs/02` Flow 4 is explicit
   * that the agent controller does not receive permission to rewrite it.
   */
  const endpointKeys = ENDPOINT_PROTOCOLS.filter(
    (protocol) => target.endpoints[protocol],
  ).map((protocol) => ({ protocol, key: agentEndpointKey(protocol) }));

  const context = encodeAgentContext(
    buildAgentContext({
      name: target.name,
      description: target.description,
      operator: ctx.parentName,
      role: target.role,
    }),
  );

  const records: { what: string; key: string; value: string }[] = [
    { what: "agent-context", key: AGENT_CONTEXT_KEY, value: context },
    ...endpointKeys.map(({ protocol, key }) => ({
      what: `agent-endpoint[${protocol}]`,
      key,
      value: target.endpoints[protocol]!,
    })),
  ];

  for (const record of records) {
    const before = await ens.readText(ensName, record.key);
    const unchanged =
      record.key === AGENT_CONTEXT_KEY
        ? sameContext(before, record.value)
        : before === record.value;

    if (unchanged) {
      step({
        what: record.what,
        ok: true,
        skipped: true,
        detail: "already current, not rewritten",
        readBack: before,
      });
      continue;
    }

    try {
      const hash = await ens.writeText({
        name: ensName,
        key: record.key,
        value: record.value,
        as: "organization",
      });
      const receipt = await ens.waitForReceipt(hash);
      const after = await ens.readText(ensName, record.key);

      step({
        what: record.what,
        ok: receipt.status === "success" && after === record.value,
        skipped: false,
        detail: hash,
        txHash: hash,
        readBack: after,
      });

      await store.recordEvent({
        organizationId: ctx.organizationId,
        agentId,
        source: "ens",
        type: "ens.record.updated",
        status: "success",
        occurredAt: now(),
        actor: organization,
        txHash: hash,
        summary: `Wrote ${record.key} on ${ensName}`,
        evidence: evidence(hash),
        metadata: { phase: PROVISIONING_PHASE, key: record.key, readBack: after },
      });
    } catch (error) {
      step({
        what: record.what,
        ok: false,
        skipped: false,
        detail: messageOf(error),
      });

      /*
        Logged, like every other outcome of this run.

        The failure used to live only in the returned `steps`, which nothing
        durable reads: `GET /:id/provisioning` rebuilds from the activity log,
        so a reload turned a record write that failed into a row that had never
        existed. The create screen then showed a step with no transaction,
        which is what a skipped step looks like — a failure rendered as
        "already on chain".
      */
      await store.recordEvent({
        organizationId: ctx.organizationId,
        agentId,
        source: "ens",
        type: "ens.record.updated",
        status: "failed",
        occurredAt: now(),
        actor: organization,
        txHash: ZERO_HASH,
        summary: `Writing ${record.key} on ${ensName} failed`,
        evidence: { source: "ens", txHash: ZERO_HASH, contractAddress: resolver },
        metadata: { phase: PROVISIONING_PHASE, key: record.key, reason: messageOf(error) },
      });
    }
  }

  //////////////////////////////////////////////////////////////////////////
  // The grants — one resource per key
  //////////////////////////////////////////////////////////////////////////

  /**
   * `authorizeTextRole` takes the key itself, so the grant lands on
   * `resource(node, partHash(key))` and reaches nothing else. A name-level
   * grant would let the controller rewrite the ENSIP 25 record, and that is the
   * one write this whole arrangement exists to refuse.
   *
   * `agent-context` is never in this list. It is the organization's description
   * of the agent, and an agent that can rewrite its own description has an
   * identity it authors alone.
   */
  const dnsName = encodeDnsName(ensName);

  if (target.delegate) {
    for (const { key } of endpointKeys) {
      const already = await ens.resolverHasRoles(
        textRecordResource(ensName, key),
        RESOLVER_ROLE.SET_TEXT,
        target.controller,
      );
      if (already) {
        step({
          what: `grant SET_TEXT on ${key}`,
          ok: true,
          skipped: true,
          detail: "already granted",
        });
        continue;
      }

      try {
        const hash = await ens.authorizeTextRole({
          dnsName,
          key,
          controller: target.controller,
          authorized: true,
        });
        const receipt = await ens.waitForReceipt(hash);
        const granted = await ens.canSetText(ensName, key, target.controller);

        step({
          what: `grant SET_TEXT on ${key}`,
          ok: receipt.status === "success" && granted,
          skipped: false,
          detail: hash,
          txHash: hash,
          readBack: granted ? "controller can write" : "controller still cannot write",
        });

        await store.recordEvent({
          organizationId: ctx.organizationId,
          agentId,
          source: "ens",
          type: "ens.permission.granted",
          status: "success",
          occurredAt: now(),
          actor: organization,
          txHash: hash,
          summary: `Granted SET_TEXT on ${key} to ${target.controller}`,
          evidence: evidence(hash),
          metadata: {
            phase: PROVISIONING_PHASE,
            key,
            readBack: granted ? "controller can write" : "controller still cannot write",
          },
        });
      } catch (error) {
        step({
          what: `grant SET_TEXT on ${key}`,
          ok: false,
          skipped: false,
          detail: messageOf(error),
        });
        await store.recordEvent({
          organizationId: ctx.organizationId,
          agentId,
          source: "ens",
          type: "ens.action.denied",
          status: "denied",
          occurredAt: now(),
          actor: organization,
          summary: `Grant of SET_TEXT on ${key} was refused`,
          evidence: { source: "ens", txHash: ZERO_HASH, contractAddress: resolver },
          metadata: { phase: PROVISIONING_PHASE, key, reason: messageOf(error) },
        });
      }
    }
  }

  //////////////////////////////////////////////////////////////////////////
  // Complete only on a full read-back
  //////////////////////////////////////////////////////////////////////////

  /**
   * Four facts, all re-read from chain. The last is the one worth spelling out:
   * an agent whose controller can write everything is provisioned in the sense
   * that nothing errored, and is exactly the state this product exists to
   * prevent.
   */
  const [finalOwner, finalResolver, canWriteGranted, canWriteProtected] =
    await Promise.all([
      ens.findOwner(registry, label),
      ens.getResolver(registry, label),
      target.delegate && endpointKeys[0]
        ? ens.canSetText(ensName, endpointKeys[0].key, target.controller)
        : Promise.resolve(true),
      ens.canSetText(ensName, AGENT_CONTEXT_KEY, target.controller),
    ]);

  const confirmed =
    sameAddress(finalOwner, organization) &&
    sameAddress(finalResolver, resolver) &&
    canWriteGranted &&
    !canWriteProtected;

  step({
    what: `read-back ${label}`,
    ok: confirmed,
    skipped: false,
    detail: confirmed
      ? "name, resolver, grants and absence of protected authority all confirmed"
      : `owner ${sameAddress(finalOwner, organization)}, resolver ${sameAddress(finalResolver, resolver)}, granted ${canWriteGranted}, protected-reachable ${canWriteProtected}`,
    readBack: finalResolver,
  });

  const ensTrack: EnsProvisioning = confirmed ? "active" : "failed";

  /*
    Registration follows identity in the same run, when there is a registry to
    register with, and only on a confirmed identity: the registration file
    claims the name, and claiming one whose read-back failed publishes a claim
    nobody can confirm.

    The registry track goes pending in the same write that settles identity.
    As two writes there is a moment where identity reads settled and
    registration has not started, and `GET /:id/provisioning` would call that
    moment complete and stop the screen polling.
  */
  const { erc8004 } = ctx;
  if (!confirmed || !erc8004) {
    await store.setProvisioning(agentId, { ens: ensTrack });
    return { agentId, ensName, steps, ens: ensTrack };
  }

  await store.setProvisioning(agentId, { ens: ensTrack, erc8004: "pending" });

  const registration = await bindRegistration(
    { ...ctx, erc8004 },
    {
      agentId,
      ensName,
      name: target.name,
      // Worded the way `register:identity` words it, so a file published from
      // either path names its operator the same way.
      description: `${target.description} Operated by ${ctx.parentName}.`,
      endpoints: target.endpoints,
    },
  );
  steps.push(...registration.steps);

  return { agentId, ensName, steps, ens: ensTrack, registration };
}

//////////////////////////////////////////////////////////////////////////////
// The registration — ERC 8004, bound back to the name by ENSIP 25
//////////////////////////////////////////////////////////////////////////////

/**
 * The identity half of the context, plus the registry. The ENS parent's
 * `registry` and `parentName` play no part in this.
 */
export type RegistrationContext = Pick<
  ProvisionContext,
  "ens" | "store" | "organizationId" | "resolver" | "organization" | "graph"
> & { erc8004: Erc8004Service };

export interface RegistrationTarget {
  /** The store id, `agent-<label>` — not the id the registry mints. */
  agentId: string;
  ensName: string;
  /** Published in the registration file exactly as given. */
  name: string;
  description: string;
  endpoints: Partial<Record<EndpointProtocol, string>>;
}

export interface RegistrationResult {
  steps: ProvisionStep[];
  erc8004: Erc8004Provisioning;
  ensip25: ProvisioningStatus["ensip25"];
  /** The id the registry minted, once there is one. */
  erc8004AgentId?: string;
  /** The ENSIP 25 key, once the id it is built from is known. */
  key?: string;
  /** The organization's write of that key, when this run made it. */
  bindingTxHash?: Hex;
}

/**
 * Register an agent on ERC 8004 and bind the registration back to its name.
 *
 * Steps 3.8, 3.9, 3.11 and 3.13 of `scripts/register-identity.ts`, moved here
 * for the reason `provisionAgent` moved out of its script: the route needed
 * the same steps, and two copies diverge on the first fix. The script keeps
 * what is proof rather than provisioning — the controller's revert on the key,
 * and the indexing check.
 *
 * Idempotent like the rest of this module, with one difference: the registry
 * has no name-to-id lookup, so "already registered" is the store's answer
 * rather than the chain's. A store that lost the id registers again, which is
 * what `REGISTER_AGENT_ID` on the script exists to prevent.
 *
 * Failures land on the track they belong to and are returned, not thrown. The
 * route calling this has already answered 202, and its fallback marks the ENS
 * track failed — true of an exception from the ENS half, false of one from
 * here.
 */
export async function bindRegistration(
  ctx: RegistrationContext,
  target: RegistrationTarget,
): Promise<RegistrationResult> {
  const { ens, erc8004, store } = ctx;
  const { agentId, ensName } = target;
  const steps: ProvisionStep[] = [];

  const step = (entry: ProvisionStep): ProvisionStep => {
    steps.push(entry);
    return entry;
  };

  const now = () => new Date().toISOString();
  const registryEvidence = (txHash: Hex) => ({
    source: "erc8004" as const,
    txHash,
    contractAddress: erc8004.registry,
    chainId: erc8004.chainId,
  });

  const existing = await store.getAgent(agentId);
  if (!existing) {
    throw new Error(`${agentId} is not in the store. Provision its name first.`);
  }
  const ensip25Before = existing.provisioning.ensip25;

  await store.setProvisioning(agentId, { erc8004: "pending" });

  //////////////////////////////////////////////////////////////////////////
  // Register — skipped when the store already holds an id
  //////////////////////////////////////////////////////////////////////////

  /*
    Only https endpoints go into the file. It is published to Agent0's index,
    where a localhost URL is advertised to everyone and answers nobody — the
    rule `publishableAgentMcpEndpoint` applies to the ENS record. Left out
    rather than refused, and named in the step, so the registration says less
    instead of saying something false.
  */
  const publishable = (protocol: EndpointProtocol): string | undefined => {
    const value = target.endpoints[protocol];
    return value && isPublishableEndpoint(value) ? value : undefined;
  };
  const withheld = ENDPOINT_PROTOCOLS.filter(
    (protocol) => target.endpoints[protocol] && !publishable(protocol),
  );

  const registerWhat = `register ${ensName} on ERC 8004`;
  let erc8004AgentId: string;
  let registrationTxHash: Hex | undefined;

  if (existing.erc8004AgentId) {
    erc8004AgentId = existing.erc8004AgentId;
    step({
      what: registerWhat,
      ok: true,
      skipped: true,
      detail: `already registered as agent ${erc8004AgentId}`,
      readBack: erc8004AgentId,
    });
  } else {
    try {
      const registration = await erc8004.register({
        file: buildRegistrationFile({
          name: target.name,
          description: target.description,
          ensName,
          mcpEndpoint: publishable("mcp"),
          a2aEndpoint: publishable("a2a"),
          // Only what is true. No trust scheme is implemented, so none is named.
          supportedTrusts: [],
        }),
        as: "organization",
      });
      erc8004AgentId = registration.agentId;
      registrationTxHash = registration.transactionHash;

      // Before anything else. An id the chain minted and the store never
      // heard of is exactly the double registration the skip above relies on
      // never happening.
      await store.upsertAgent({
        id: existing.id,
        organizationId: existing.organizationId,
        slug: existing.slug,
        ensName: existing.ensName,
        controllerAddress: existing.controllerAddress,
        erc8004AgentId,
        erc8004Registry: erc8004.registry,
      });

      step({
        what: registerWhat,
        ok: true,
        skipped: false,
        detail:
          withheld.length > 0
            ? `agent ${erc8004AgentId}; ${withheld.join(", ")} not https, left out of the file`
            : `agent ${erc8004AgentId}`,
        txHash: registrationTxHash,
        readBack: erc8004AgentId,
      });

      await store.recordEvent({
        organizationId: ctx.organizationId,
        agentId,
        source: "erc8004",
        type: "erc8004.registered",
        status: "success",
        occurredAt: now(),
        actor: ctx.organization,
        txHash: registrationTxHash,
        externalId: `${erc8004.chainId}:${erc8004AgentId}`,
        summary: `Registered ${ensName} as ERC 8004 agent ${erc8004AgentId}`,
        evidence: registryEvidence(registrationTxHash),
        metadata: {
          phase: PROVISIONING_PHASE,
          readBack: erc8004AgentId,
          ...(withheld.length > 0 && { withheld }),
        },
      });
    } catch (error) {
      // `Erc8004Service.register` can throw after its transaction mined — no
      // `Registered` event, or a URI still unreadable. Its message names the
      // hash or the id, and this detail carries it, so the registration can
      // be adopted with `REGISTER_AGENT_ID` rather than paid for twice.
      step({ what: registerWhat, ok: false, skipped: false, detail: messageOf(error) });
      await store.recordEvent({
        organizationId: ctx.organizationId,
        agentId,
        source: "erc8004",
        type: "erc8004.registered",
        status: "failed",
        occurredAt: now(),
        actor: ctx.organization,
        txHash: ZERO_HASH,
        summary: `Registering ${ensName} on ERC 8004 failed`,
        evidence: registryEvidence(ZERO_HASH),
        metadata: { phase: PROVISIONING_PHASE, reason: messageOf(error) },
      });
      await store.setProvisioning(agentId, { erc8004: "failed" });
      return { steps, erc8004: "failed", ensip25: ensip25Before };
    }
  }

  //////////////////////////////////////////////////////////////////////////
  // Read the claim back before binding anything to it
  //////////////////////////////////////////////////////////////////////////

  /*
    Before the ENS write, not after it. A stored id naming somebody else's
    registration would otherwise get an ENSIP 25 record pointing at it, and
    verification would then fail for a reason that looks nothing like its
    cause.
  */
  const claimWhat = `read back ERC 8004 agent ${erc8004AgentId}`;
  let claim: string | undefined;
  try {
    const file = await erc8004.registrationFile(erc8004AgentId);
    claim = file ? claimedEnsName(file) : undefined;
  } catch (error) {
    step({
      what: claimWhat,
      ok: false,
      skipped: false,
      detail: `could not read the registration: ${messageOf(error)}`,
    });
    await store.setProvisioning(agentId, { erc8004: "failed" });
    return { steps, erc8004: "failed", ensip25: ensip25Before, erc8004AgentId };
  }

  const claims = claim?.toLowerCase() === ensName.toLowerCase();
  step({
    what: claimWhat,
    ok: claims,
    skipped: false,
    detail: claim
      ? `services[ens] = ${claim}`
      : "the registration file carries no ens service entry",
    ...(claim && { readBack: claim }),
  });

  if (!claims) {
    await store.setProvisioning(agentId, { erc8004: "failed" });
    return { steps, erc8004: "failed", ensip25: ensip25Before, erc8004AgentId };
  }

  /*
    Verification opens in the same write that closes registration.

    Written apart, the two left a poll reading registration done and
    verification untouched — which {@link isSettled} calls finished. The
    create screen stopped there, with the ENSIP 25 write still twenty seconds
    from landing, and showed its last two rows as "no transaction" for work
    the server went on to do.
  */
  await store.setProvisioning(agentId, {
    erc8004: "registered",
    ensip25: "checking",
  });

  //////////////////////////////////////////////////////////////////////////
  // The ENSIP 25 record — organization-signed, like every record here
  //////////////////////////////////////////////////////////////////////////

  const key = agentRegistrationKey({
    chainId: erc8004.chainId,
    registry: erc8004.registry,
    agentId: erc8004AgentId,
  });
  const bindWhat = `write ${key}`;
  let bindingTxHash: Hex | undefined;

  try {
    const before = await ens.readText(ensName, key);
    if (before.length > 0) {
      step({
        what: bindWhat,
        ok: true,
        skipped: true,
        detail: "already set, not rewritten",
        readBack: before,
      });
    } else {
      const hash = await ens.writeText({
        name: ensName,
        key,
        // ENSIP 25: clients MUST NOT depend on the value beyond it being
        // non-empty. "1" is the published convention and carries no meaning.
        value: "1",
        as: "organization",
      });
      const receipt = await ens.waitForReceipt(hash);
      const after = await ens.readText(ensName, key);
      bindingTxHash = hash;

      step({
        what: bindWhat,
        ok: receipt.status === "success" && after === "1",
        skipped: false,
        detail: hash,
        txHash: hash,
        readBack: after,
      });

      await store.recordEvent({
        organizationId: ctx.organizationId,
        agentId,
        source: "ens",
        type: "ens.record.updated",
        status: "success",
        occurredAt: now(),
        actor: ctx.organization,
        txHash: hash,
        summary: `Wrote the ENSIP 25 registration record on ${ensName}`,
        evidence: { source: "ens", txHash: hash, contractAddress: ctx.resolver },
        metadata: { phase: PROVISIONING_PHASE, key, readBack: after },
      });
    }
  } catch (error) {
    // Not an early return. The registration stands; what did not happen is
    // the ENS half of the binding, and the verification below reports exactly
    // that — or reports that it could not read, which is also true.
    step({ what: bindWhat, ok: false, skipped: false, detail: messageOf(error) });
    await store.recordEvent({
      organizationId: ctx.organizationId,
      agentId,
      source: "ens",
      type: "ens.record.updated",
      status: "failed",
      occurredAt: now(),
      actor: ctx.organization,
      txHash: ZERO_HASH,
      summary: `Writing the ENSIP 25 registration record on ${ensName} failed`,
      evidence: { source: "ens", txHash: ZERO_HASH, contractAddress: ctx.resolver },
      metadata: { phase: PROVISIONING_PHASE, key, reason: messageOf(error) },
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // Verify, from the registry's side — never assumed from the writes above
  //////////////////////////////////////////////////////////////////////////

  const verification = await verifyEnsip25({
    ensName,
    agentId: erc8004AgentId,
    registry: erc8004.registry,
    chainId: erc8004.chainId,
    erc8004,
    readText: (name, k) => ens.readText(name, k),
  });
  const verified = verification.status === "verified";

  step({
    what: `verify ENSIP 25 for ${ensName}`,
    ok: verified,
    skipped: false,
    detail: `${verification.status}, read at ${verification.readAt}${verification.error ? ` — ${verification.error}` : ""}`,
    readBack: verification.status,
  });

  await store.recordEvent({
    organizationId: ctx.organizationId,
    agentId,
    source: "erc8004",
    type: verified ? "ensip25.verified" : "ensip25.failed",
    status: verified ? "success" : "failed",
    occurredAt: verification.readAt,
    summary: verified
      ? `${ensName} and agent ${erc8004AgentId} confirm each other`
      : `${ensName} and agent ${erc8004AgentId} do not confirm each other: ${verification.status}`,
    // A read has no transaction of its own. The evidence is the registration
    // it read against, or zero when this run found it already made — which
    // the create screen renders as "no transaction", true of a read.
    evidence: registryEvidence(registrationTxHash ?? ZERO_HASH),
    metadata: { phase: PROVISIONING_PHASE, readBack: verification.status },
  });

  //////////////////////////////////////////////////////////////////////////
  // Discovery — asked, never assumed
  //////////////////////////////////////////////////////////////////////////

  if (ctx.graph) {
    const indexing = await checkIndexing(
      { store, graph: ctx.graph, organizationId: ctx.organizationId },
      { agentId, erc8004AgentId, chainId: erc8004.chainId },
    );
    step(indexing.step);
  }

  // Last, so verification reads `checking` until the run has nothing left to
  // do — the indexing question included — and the screen keeps polling.
  await store.setProvisioning(agentId, { ensip25: verification.status });

  return {
    steps,
    erc8004: "registered",
    ensip25: verification.status,
    erc8004AgentId,
    key,
    ...(bindingTxHash && { bindingTxHash }),
  };
}

//////////////////////////////////////////////////////////////////////////////
// When a run is over
//////////////////////////////////////////////////////////////////////////////

/**
 * Whether a provisioning run has stopped moving — what
 * `GET /:id/provisioning` answers `complete` from, and so where the create
 * screen stops polling.
 *
 * Identity settled, and neither track the run goes on to still in flight.
 * That only holds if every hand-off between tracks happens inside one write:
 * `provisionAgent` makes identity active and registration pending together,
 * and `bindRegistration` makes registration done and verification checking
 * together. A hand-off split across two writes is a poll that sees a finished
 * run in the gap.
 */
export function isSettled(tracks: {
  ens: string;
  erc8004: string;
  ensip25: string;
}): boolean {
  return (
    (tracks.ens === "active" || tracks.ens === "failed") &&
    tracks.erc8004 !== "pending" &&
    tracks.ensip25 !== "checking"
  );
}

//////////////////////////////////////////////////////////////////////////////
// Discovery — is the registration indexed yet?
//////////////////////////////////////////////////////////////////////////////

export interface IndexingContext {
  store: Store;
  graph: Pick<Agent0Client, "agentProfile">;
  organizationId: string;
}

/**
 * Ask Agent0 whether a registration is indexed, and move the discovery track
 * to the answer.
 *
 * Step 4.6 of `scripts/register-identity.ts`, shared for the reason
 * {@link bindRegistration} is. The track used to move only there, so every
 * agent created in the console read `not indexed` while the subgraph was
 * already returning it — a status that moves in one place stops describing the
 * system everywhere else.
 *
 * `pending` is an answer rather than a failure: indexing lags a registration
 * by minutes, and `POST /:id/refresh` asks again. A provider outage is
 * `provider_error`, never `not_indexed`, because not knowing is not an absence.
 */
export async function checkIndexing(
  ctx: IndexingContext,
  target: { agentId: string; erc8004AgentId: string; chainId: number },
): Promise<{ step: ProvisionStep; graph: GraphProvisioning }> {
  const { store } = ctx;
  const key = `${target.chainId}:${target.erc8004AgentId}`;
  const what = `index ${key} on Agent0`;
  const before = (await store.getAgent(target.agentId))?.provisioning.graph;

  let indexed: Awaited<ReturnType<IndexingContext["graph"]["agentProfile"]>>;
  try {
    indexed = await ctx.graph.agentProfile(key);
  } catch (error) {
    await store.setProvisioning(target.agentId, { graph: "provider_error" });
    return {
      step: {
        what,
        ok: false,
        skipped: false,
        detail: `could not ask the subgraph: ${messageOf(error)}`,
      },
      graph: "provider_error",
    };
  }

  const graph: GraphProvisioning = indexed ? "indexed" : "pending";
  await store.setProvisioning(target.agentId, { graph });

  // On the transition only. A refresh that finds it indexed again learned
  // nothing new, and a row per click would bury the one that mattered.
  if (indexed && before !== "indexed") {
    await store.recordEvent({
      organizationId: ctx.organizationId,
      agentId: target.agentId,
      source: "graph",
      type: "graph.indexed",
      status: "success",
      occurredAt: indexed.provenance.queriedAt,
      summary: `${key} is indexed and claims ${indexed.claimedEnsName ?? "no name"}`,
      evidence: {
        source: "graph",
        chainId: indexed.provenance.chainId,
        subgraphId: indexed.provenance.subgraphId,
        queriedAt: indexed.provenance.queriedAt,
        graphEntityId: key,
      },
    });
  }

  return {
    step: {
      what,
      ok: true,
      skipped: false,
      detail: indexed
        ? `returns ${indexed.claimedEnsName ?? "no ENS claim"}, discoverable`
        : "not indexed yet; indexing lags the registration",
      readBack: graph,
    },
    graph,
  };
}
