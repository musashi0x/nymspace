import type { Address, ChainId } from "@nymspace/core";
import { agentRegistrationKey } from "./keys";
import type { Erc8004Service } from "./erc8004";

/**
 * ENSIP 25 runtime verification, in the registry-to-ENS direction.
 *
 * The direction matters and is not symmetric. The question is "does the ENS
 * name confirm the claim this registry entry makes", so the registry's claim is
 * read first and the ENS record second. Starting from ENS would answer a
 * different and weaker question — an ENS record can name any agent id, and one
 * that names an agent which never claimed the name back is not a binding.
 *
 * Seven states, per `docs/06`, which says in as many words not to collapse
 * failures into `unverified`. The reason is operational: `registry_claim_missing`
 * says the agent never claimed the name, `ens_record_missing` says the claim
 * exists but ENS does not confirm it, `mismatch` says both exist and disagree,
 * and `rpc_error` says nothing about the agent at all. Collapsed, an operator
 * cannot tell "this agent is lying" from "our node timed out".
 *
 * The spike proved three distinct mis-encodings of the key each fail as an
 * empty read, which makes `ens_record_missing` the state a bug in our own key
 * construction lands in. That is why the console must present it as a reading
 * rather than a settled fact about the agent, and why {@link verifyEnsip25}
 * returns the key it used — so a wrong answer can be diagnosed without a
 * debugger.
 */

export type Ensip25Status =
  | "unchecked"
  | "checking"
  | "verified"
  | "registry_claim_missing"
  | "ens_record_missing"
  | "mismatch"
  | "rpc_error";

export interface Ensip25Result {
  status: Ensip25Status;
  /** The key that was read. Present whenever it could be constructed. */
  key?: string;
  /** The ENS name the registry entry claims, when it claims one. */
  claimedEnsName?: string;
  /** The name that was verified against. */
  expectedEnsName: string;
  agentId: string;
  registry: Address;
  chainId: ChainId;
  /**
   * Not decoration. ENSIP 25's own security note is that a name transfer can
   * leave a stale attestation behind, so a verification result is only true as
   * of the moment it was read — and task 8.2's I4 requires re-verifying after
   * an ownership change rather than reusing a cached result.
   */
  readAt: string;
  /** Present only for `rpc_error`, so a failure can be attributed. */
  error?: string;
}

export interface VerifyEnsip25Params {
  /** The name being verified. */
  ensName: string;
  agentId: string | number | bigint;
  registry: Address;
  chainId: ChainId;
  erc8004: Pick<Erc8004Service, "claimsEnsName">;
  readText: (name: string, key: string) => Promise<string>;
}

/**
 * Verify that a registry entry and an ENS name confirm each other.
 *
 * Both reads are wrapped, because the one thing worse than an unverified agent
 * is an agent reported unverified for a reason that had nothing to do with it.
 * An RPC failure at either step produces `rpc_error` carrying the message,
 * never a negative verdict.
 */
export async function verifyEnsip25(
  params: VerifyEnsip25Params,
): Promise<Ensip25Result> {
  const { ensName, registry, chainId } = params;
  const readAt = () => new Date().toISOString();

  const base = {
    expectedEnsName: ensName,
    agentId: String(params.agentId),
    registry,
    chainId,
  };

  // Step 1 — the registry's own claim. An agent that never claimed the name is
  // not a mismatch and not a missing record; it simply never made the claim,
  // and that is a different thing to tell an operator.
  let claim: { claims: boolean; claimed?: string };
  try {
    claim = await params.erc8004.claimsEnsName(params.agentId, ensName);
  } catch (error) {
    return {
      ...base,
      status: "rpc_error",
      readAt: readAt(),
      error: `reading the registry claim: ${messageOf(error)}`,
    };
  }

  if (!claim.claimed) {
    return { ...base, status: "registry_claim_missing", readAt: readAt() };
  }
  if (!claim.claims) {
    // Both sides exist and name different things. The most interesting state:
    // somebody claimed a name that is not this one.
    return {
      ...base,
      status: "mismatch",
      claimedEnsName: claim.claimed,
      readAt: readAt(),
    };
  }

  // Step 2 — the ENS side. The key construction can itself throw, on an agent
  // id that is not a number or a registry that is not an address, and that is a
  // configuration fault rather than a verdict about the agent.
  let key: string;
  try {
    key = agentRegistrationKey({ chainId, registry, agentId: params.agentId });
  } catch (error) {
    return {
      ...base,
      status: "rpc_error",
      claimedEnsName: claim.claimed,
      readAt: readAt(),
      error: `constructing the ENSIP 25 key: ${messageOf(error)}`,
    };
  }

  let value: string;
  try {
    value = await params.readText(ensName, key);
  } catch (error) {
    return {
      ...base,
      status: "rpc_error",
      key,
      claimedEnsName: claim.claimed,
      readAt: readAt(),
      error: `reading the ENS record: ${messageOf(error)}`,
    };
  }

  // ENSIP 25: clients MUST NOT depend on the value beyond it being non-empty.
  // So the check is emptiness and nothing more — reading meaning into "1" would
  // make our verifier disagree with every other one.
  return {
    ...base,
    status: value.length > 0 ? "verified" : "ens_record_missing",
    key,
    claimedEnsName: claim.claimed,
    readAt: readAt(),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

/**
 * Whether a status means "we learned something about the agent".
 *
 * `rpc_error` is the odd one out and this is where that is written down:
 * everything else is a finding, and `rpc_error` is the absence of one. A UI
 * that treats it as a finding tells the operator the agent failed when the
 * truth is that we failed.
 */
export function isFinding(status: Ensip25Status): boolean {
  return status !== "unchecked" && status !== "checking" && status !== "rpc_error";
}
