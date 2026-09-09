import type { Address, Hex } from "@nymspace/core";
import {
  AGENT_CONTEXT_KEY,
  AGENT_SUBNAME_OWNER_ROLES,
  EnsService,
  RESOLVER_ROLE,
  agentEndpointKey,
  buildAgentContext,
  encodeAgentContext,
  encodeDnsName,
  textRecordResource,
} from "@nymspace/ens";
import type { EnsProvisioning, Store } from "@nymspace/store";

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
  /** Where the ENS track ended up. Nothing else is touched here. */
  ens: EnsProvisioning;
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
      // The attachment happened in the registration transaction; the read above
      // is the confirmation, and it is the registration that is the evidence.
      txHash: steps.find((s) => s.what === `register ${ensName}`)?.txHash ?? ZERO_HASH,
      contractAddress: registry,
    },
  });

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
  await store.setProvisioning(agentId, { ens: ensTrack });

  return { agentId, ensName, steps, ens: ensTrack };
}
