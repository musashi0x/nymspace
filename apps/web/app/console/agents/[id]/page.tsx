import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { notFound } from "next/navigation";
import { agentMcpEndpoint, isPublishableEndpoint } from "@nymspace/core";
import { fetchIdentity, fetchPermissions, fetchWallet } from "@/lib/api";
import { EMPTY_STATES } from "@/lib/console/errors";
import {
  identityStateFrom,
  VERIFICATION_LABELS,
  type VerificationState,
} from "@/lib/console/state";
import { AuthorityMatrix } from "@/components/console/authority-matrix";
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

  /*
    The MCP endpoint the permission proof may write, derived on the server.
    `AGENT_MCP_BASE_URL` is not a public variable, and only an https value can
    be published, so a local origin yields no endpoint rather than one the API
    would refuse.
  */
  const mcpBase = process.env.AGENT_MCP_BASE_URL;
  const derived = mcpBase ? agentMcpEndpoint(mcpBase, identity.label) : null;
  const mcpEndpoint = derived && isPublishableEndpoint(derived) ? derived : null;

  return (
    <VStack as="main" gap={8} width="100%" className="min-w-0">
      <VStack as="header" gap={2}>
        <Link href="/console">
          <Text type="code" size="xsm" color="secondary">
            ← FLEET
          </Text>
        </Link>
        <Heading level={1}>
          <Text type="code" size="2xl">
            {identity.ensName}
          </Text>
        </Heading>
        <HStack gap={2} wrap="wrap">
          <Badge tone={state === "active" ? "good" : state === "rpc_error" ? "neutral" : "warn"}>
            {state}
          </Badge>
          <Badge tone={verdict.tone}>{verdict.label}</Badge>
        </HStack>
      </VStack>

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
            <AuthorityMatrix
              recordPermissions={permissions.recordPermissions}
              registryPermissions={permissions.registryPermissions}
            />

            {/*
              Task 7.7. A wrong resource derivation and a genuine denial are the
              same value, so a table of "Denied" proves nothing on its own. This
              is the control that ran in the same request through the same code
              path and came back allowed.
            */}
            <Frame
              title="positive control"
              subtitle={
                permissions.control.allowed
                  ? "The read path works, so the denials above are answers rather than failures."
                  : "The control failed, so no denial on this page can be trusted — the read path itself is wrong."
              }
            >
              <Field label="Account" value={permissions.control.account} />
              <Field label="Capability" value={permissions.control.key} />
              <Field
                label="Result"
                value={
                  <Badge tone={permissions.control.allowed ? "good" : "bad"}>
                    {permissions.control.allowed ? "Allowed" : "Denied"}
                  </Badge>
                }
                mono={false}
              />
            </Frame>

            <Collapsible
              defaultIsOpen={false}
              trigger={
                <Text type="supporting">
                  Resources queried ({permissions.queries.length} cells,{" "}
                  {permissions.source})
                </Text>
              }
            >
              <VStack gap={2}>
                {permissions.queries.map((q) => (
                  <VStack key={q.cell} gap={0.5}>
                    <Text type="code" size="2xs" wordBreak="break-all">
                      {q.cell}
                    </Text>
                    <VStack gap={0} paddingInlineStart={3}>
                      {q.resources.map((r) => (
                        <Text
                          key={r}
                          type="code"
                          size="2xs"
                          color="secondary"
                          wordBreak="break-all"
                        >
                          {r}
                        </Text>
                      ))}
                    </VStack>
                  </VStack>
                ))}
              </VStack>
            </Collapsible>
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
          endpoint={mcpEndpoint}
        />
      </Frame>

      {/* ── Financial ──────────────────────────────────────────────────── */}
      <Frame
        id="task"
        title="Financial authority"
        subtitle="A Privy wallet whose signer is capped by one policy. The limit and the token are read from the live policy, never from a constant."
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
                <Field
                  label="Signer"
                  value={wallet.signerMode}
                  source="privy"
                  readAt={wallet.readAt}
                  mono={false}
                />
                <TaskRequest
                  agentId={id}
                  ensName={identity.ensName}
                  recipient={identity.owner}
                  limitAmount={wallet.policy.maxAmount}
                  token={wallet.policy.token}
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
    </VStack>
  );
}
