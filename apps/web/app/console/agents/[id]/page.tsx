import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchIdentity, fetchPermissions, fetchWallet } from "@/lib/api";
import { EMPTY_STATES } from "@/lib/console/errors";
import {
  identityStateFrom,
  VERIFICATION_LABELS,
  type VerificationState,
} from "@/lib/console/state";
import { PermissionProof } from "@/components/console/permission-proof";
import { TaskRequest } from "@/components/console/task-request";
import {
  Absent,
  Badge,
  Empty,
  Field,
  Outcome,
  Frame,
} from "@/components/console/primitives";

/**
 * Screen 2 — the agent inspector.
 *
 * Five sections answering `docs/03`'s five questions: who is this agent, what
 * can it edit, can I trust the identity, how do I reach it, and what financial
 * authority does it have.
 *
 * Every value here was read during this request. Nothing is cached and nothing
 * is stored — the manifest is assembled per request (design.md D2) and the
 * permission matrix is a row of `hasRoles` calls (D9), so a grant revoked on
 * chain a second ago is already gone from this page.
 */
export const dynamic = "force-dynamic";

export default async function AgentPage({
  params,
}: PageProps<"/console/agents/[id]">) {
  const { id } = await params;

  const [identity, permissions, wallet] = await Promise.all([
    fetchIdentity(id).catch(() => null),
    fetchPermissions(id).catch(() => null),
    fetchWallet(id).catch(() => null),
  ]);

  if (!identity) notFound();

  const state = identityStateFrom(identity);
  const verification = identity.ensip25.status as VerificationState;
  const verdict = VERIFICATION_LABELS[verification];

  return (
    <main className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/console"
          className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← fleet
        </Link>
        <h1 className="font-mono text-2xl">{identity.ensName}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge tone={state === "active" ? "good" : state === "rpc_error" ? "neutral" : "warn"}>
            {state}
          </Badge>
          <Badge tone={verdict.tone}>{verdict.label}</Badge>
        </div>
      </header>

      {/* ── Identity ───────────────────────────────────────────────────── */}
      <Frame
        title="Identity"
        subtitle="Read from ENSv2 during this request. ENS is the source; nothing here is a stored profile."
      >
        <Field
          label="Owner"
          value={identity.owner}
          source={`chain ${identity.chainId}`}
          readAt={identity.fetchedAt}
        />
        {/*
          No `source`. The controller is held by the coordination store, and
          `CLAUDE.md` is explicit that the store is not an authority — dressing
          a stored value in provenance claims a read that never happened.
        */}
        <Field label="Controller" value={identity.controller} />
        <Field
          label="Registry"
          value={identity.registry}
          source={`chain ${identity.chainId}`}
          readAt={identity.fetchedAt}
        />
        <Field
          label="Resolver"
          value={identity.resolver}
          source={`chain ${identity.chainId}`}
          readAt={identity.fetchedAt}
        />
      </Frame>

      {/* ── Manifest ───────────────────────────────────────────────────── */}
      <Frame
        title="Agent manifest"
        subtitle="ENSIP 26 text records, assembled per request. There is no manifest object — change a record on chain and the next load differs, with no invalidation step."
      >
        <Field
          label={identity.recordKeys.context}
          value={identity.records.context ?? <Absent what="no agent-context written" />}
          source={`chain ${identity.chainId}`}
          readAt={identity.fetchedAt}
        />
        <Field
          label={identity.recordKeys.mcp}
          value={identity.records.mcp ?? <Absent what="no MCP endpoint published" />}
          source={`chain ${identity.chainId}`}
          readAt={identity.fetchedAt}
        />
        <Field
          label={identity.recordKeys.a2a}
          value={
            identity.records.a2a ?? (
              <Absent what="A2A stays unset until an endpoint exists" />
            )
          }
          source={`chain ${identity.chainId}`}
          readAt={identity.fetchedAt}
        />
      </Frame>

      {/* ── Verification ───────────────────────────────────────────────── */}
      <Frame
        title="ENSIP 25 verification"
        subtitle="Checked registry-to-ENS: the registration's claim first, then whether ENS confirms it."
      >
        <Outcome
          tone={
            verdict.tone === "good"
              ? "proof"
              : verdict.tone === "neutral"
                ? "waiting"
                : "fault"
          }
          title={verdict.label}
          detail={verdict.detail}
        />
        {identity.registration ? (
          <>
            <Field
              label="ERC 8004 agent id"
              value={identity.registration.agentId}
              source={`chain ${identity.registration.chainId}`}
              readAt={identity.fetchedAt}
            />
            <Field
              label="Registry"
              value={identity.registration.registry}
              source={`chain ${identity.registration.chainId}`}
              readAt={identity.fetchedAt}
            />
            <Field
              label="Name claimed by the registration"
              value={
                identity.registration.claimedEnsName ?? (
                  <Absent what="the registration claims no ENS name" />
                )
              }
              source={`chain ${identity.registration.chainId}`}
              readAt={identity.fetchedAt}
            />
          </>
        ) : (
          <Empty
            title="No ERC 8004 registration"
            detail="This agent has no registry entry, so there is no claim for ENS to confirm."
          />
        )}
      </Frame>

      {/* ── Authority ──────────────────────────────────────────────────── */}
      <Frame
        title="Authority"
        subtitle="Every cell is a hasRoles read against the resolver's own fallback chain. The intended policy is a table in the spec; this is what the contracts actually say."
      >
        {permissions ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 font-normal">Capability</th>
                    <th className="py-2 font-normal">Agent controller</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[0.75rem]">
                  {Object.entries(permissions.recordPermissions).map(([key, allowed]) => (
                    <tr key={key} className="border-b border-border/40">
                      <td className="py-2 pr-4 break-all">{key}</td>
                      <td className="py-2">
                        <Badge tone={allowed ? "good" : "bad"}>
                          {allowed ? "Allowed" : "Denied"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {Object.entries(permissions.registryPermissions).map(([key, allowed]) => (
                    <tr key={key} className="border-b border-border/40">
                      <td className="py-2 pr-4">{key} (registry)</td>
                      <td className="py-2">
                        <Badge tone={allowed ? "good" : "bad"}>
                          {allowed ? "Allowed" : "Denied"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/*
              Task 7.7. A wrong resource derivation and a genuine denial are the
              same value, so a table of "Denied" proves nothing on its own. This
              is the control that ran in the same request through the same code
              path and came back allowed.
            */}
            <Frame title="positive control">
              <p className="text-xs text-muted-foreground">
                Same request:{" "}
                <span className="font-mono">{permissions.control.account}</span>{" "}
                on <span className="font-mono">{permissions.control.key}</span> →{" "}
                <Badge tone={permissions.control.allowed ? "good" : "bad"}>
                  {permissions.control.allowed ? "Allowed" : "Denied"}
                </Badge>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {permissions.control.allowed
                  ? "The read path works, so the denials above are answers rather than failures."
                  : "The control failed, so no denial on this page can be trusted — the read path itself is wrong."}
              </p>
            </Frame>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Resources queried ({permissions.queries.length} cells,{" "}
                {permissions.source})
              </summary>
              <ul className="mt-2 flex flex-col gap-2 font-mono text-[0.65rem] break-all">
                {permissions.queries.map((q) => (
                  <li key={q.cell}>
                    {q.cell}
                    <ul className="ml-3 text-muted-foreground/70">
                      {q.resources.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <Outcome
            tone="fault"
            title="Sepolia RPC unavailable"
            detail="The permission matrix could not be read. Nothing about this agent's authority has been established either way."
          />
        )}
      </Frame>

      {/* ── Permission proof ───────────────────────────────────────────── */}
      <Frame
        title="Permission proof"
        subtitle="Two writes from the same controller key, seconds apart. One it was granted, one it never was."
      >
        <PermissionProof
          agentId={id}
          permittedKey={identity.recordKeys.mcp}
          // The ENSIP 25 key, when there is one. `key` exists only on the
          // branch of the union that reached the ENS side, so an agent with no
          // registration simply has no protected record to attempt — and the
          // button disables rather than inventing one.
          protectedKey={"key" in identity.ensip25 ? identity.ensip25.key : undefined}
          currentValue={identity.records.mcp}
        />
      </Frame>

      {/* ── Financial ──────────────────────────────────────────────────── */}
      <Frame
        id="task"
        title="Financial authority"
        subtitle="A Privy wallet under one amount policy. The limit is read from the live policy, never from a constant."
      >
        {wallet && wallet.status === "provisioned" && wallet.address ? (
          <>
            <Field
              label="Wallet"
              value={wallet.address}
              source="privy"
              readAt={wallet.readAt}
            />
            {wallet.policy ? (
              <>
                <Field
                  label="Policy"
                  value={`${wallet.policy.label} — ${wallet.policy.ruleName}`}
                  source="privy"
                  readAt={wallet.readAt}
                  mono={false}
                />
                <TaskRequest
                  agentId={id}
                  ensName={identity.ensName}
                  recipient={identity.owner}
                  suggestedAmountWei={wallet.policy.maxValueWei}
                />
              </>
            ) : (
              <Empty
                title="No policy configured"
                detail="The wallet exists but nothing constrains it, so there is no limit to show."
              />
            )}
          </>
        ) : (
          <Empty
            title={EMPTY_STATES.noWallet.title}
            detail={EMPTY_STATES.noWallet.detail}
          />
        )}
      </Frame>
    </main>
  );
}
