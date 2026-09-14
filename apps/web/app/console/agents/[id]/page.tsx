import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { notFound } from "next/navigation";
import { agentMcpEndpoint, formatAmount, isPublishableEndpoint } from "@nymspace/core";
import {
  fetchActivity,
  fetchIdentity,
  fetchPermissions,
  fetchTreasury,
  fetchWallet,
} from "@/lib/api";
import { EMPTY_STATES } from "@/lib/console/errors";
import {
  identityStateFrom,
  VERIFICATION_LABELS,
  type VerificationState,
} from "@/lib/console/state";
import { PAGE, summarise } from "@/lib/console/agent-history";
import { AgentHistory } from "@/components/console/agent-history";
import { AuthorityMatrix } from "@/components/console/authority-matrix";
import { ConnectFromClaude } from "@/components/console/connect-from-claude";
import { McpConnect } from "@/components/console/mcp-connect";
import { PermissionProof } from "@/components/console/permission-proof";
import { TaskRequest } from "@/components/console/task-request";
import { ProvisionWallet, RefreshTracks } from "@/components/console/agent-actions";
import { VisitorAuthority } from "@/components/console/visitor-authority";
import { GraphCheck, GraphTree } from "@/components/console/graphs";
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

/**
 * What this agent has, and therefore what this screen can offer.
 *
 * Derived from the same three reads the sections below render — `identity`,
 * its `ensip25` branch, and `wallet` — rather than from a provisioning column
 * in the store. `CLAUDE.md` is explicit that the store is not the authority
 * for any of this, and a checklist that agreed with the store while disagreeing
 * with the chain would be worse than no checklist: it would be a confident
 * summary of a screen that says otherwise four frames down.
 *
 * The notes say what is missing rather than how to fix it. Provisioning happens
 * on its own routes with its own confirmations; a line of instructions here
 * would be a fifth place describing that flow, and the first to go stale.
 */
function provisioning(
  identity: Awaited<ReturnType<typeof fetchIdentity>>,
  /* Nullable, because the page tolerates a failed wallet read rather than
     404ing on it — an unreachable Privy must cost the wallet rows, not the
     identity above them. An unknown wallet reads the same as an absent one
     here, which is the honest collapse: neither is a wallet you can spend
     from, and the section below states the difference in full. */
  wallet: Awaited<ReturnType<typeof fetchWallet>> | null,
) {
  const registered = Boolean(identity.registration);
  const provisioned = wallet?.status === "provisioned" && Boolean(wallet.address);

  return [
    {
      label: "ENS name, with a resolver",
      done: true,
      note: `${identity.ensName} resolves through ${identity.resolver}`,
    },
    {
      label: identity.recordKeys.context,
      done: Boolean(identity.records.context),
      note: identity.records.context
        ? undefined
        : "No agent-context written, so the manifest has nothing to describe.",
    },
    {
      label: identity.recordKeys.mcp,
      done: Boolean(identity.records.mcp),
      /*
        Named as the reason the two connect controls are absent, because that
        is the question this list exists to answer. A reader who scrolls past
        an empty manifest and then finds no "Connect" button has been left to
        infer the link; stating it costs one clause.
      */
      note: identity.records.mcp
        ? undefined
        : "No endpoint published, so there is nothing to connect to or dial from Claude.",
    },
    {
      label: "ERC 8004 registration",
      done: registered,
      note: registered
        ? undefined
        : "No registry entry, so ENSIP 25 has no claim to confirm and no protected record to attempt.",
    },
    {
      label: "Agent wallet",
      done: provisioned,
      note: provisioned
        ? undefined
        : "No Privy wallet, so this agent cannot hold or send anything.",
    },
    {
      label: "Spend policy",
      done: Boolean(wallet?.policy),
      note: wallet?.policy
        ? undefined
        : "No policy, so there is no limit to enforce and no payment form to show.",
    },
  ];
}

export default async function AgentPage({
  params,
}: PageProps<"/console/agents/[id]">) {
  const { id } = await params;

  const [identity, permissions, wallet, fleet, activity] = await Promise.all([
    fetchIdentity(id).catch(() => null),
    fetchPermissions(id).catch(() => null),
    fetchWallet(id).catch(() => null),
    /*
      The fleet with each agent's wallet, so a payment has somewhere to go that
      is not this agent's own owner.

      The treasury aggregate rather than `fetchAgents`, because the payee list
      needs the wallet address and the fleet route does not carry one. Paying an
      agent's controller key instead is not a fallback: every agent here shares
      one delegated key, so it is neither that agent's address nor unique to it.

      Tolerated as null — a failed read should cost the payee list, never the
      page.
    */
    fetchTreasury().catch(() => null),
    /*
      This agent's slice of the log, for the history section.

      Capped rather than unbounded, and `summarise` reports whether it hit the
      cap so the chart can say the counts are of a page. Tolerated as null on
      the same terms as the treasury read: the log is the store's record of
      what happened, not an authority over anything on this page, so losing it
      costs one section rather than the screen.
    */
    fetchActivity({ agent: id, limit: PAGE }).catch(() => null),
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

  const history = activity ? summarise(activity.events) : null;

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

      {/* ── What exists ────────────────────────────────────────────────── */}
      {/*
        Why this screen has the controls it has.

        Every action below is conditional on the thing it acts on existing —
        MCP connect needs a published endpoint, the protected-record attempt
        needs an ENSIP 25 key, the payment form needs a provisioned wallet with
        a policy. That is correct, and until now it was also silent: an agent
        with none of them rendered as a page of read-only facts with no
        explanation, which reads as a half-built screen rather than as a
        half-provisioned agent. The two look identical and mean opposite
        things.

        So the list is stated before the sections it governs, from the same
        reads those sections use. It is a report and not a form — the marks are
        characters, nothing here is clickable, and an agent is provisioned by
        the routes that provision it.
      */}
      <GraphCheck title="what this agent has" items={provisioning(identity, wallet)} />

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
        {/*
          Connect only where there is something to dial. With no record the
          Field above already shows the absence, and a button that could only
          ever answer "no_endpoint" would be an action with nothing behind it.
        */}
        {identity.records.mcp ? (
          <>
            <McpConnect target={{ kind: "fleet", agentId: id }} />
            <ConnectFromClaude
              source={{
                kind: "fleet",
                ensName: identity.ensName,
                label: identity.label,
              }}
              endpoint={identity.records.mcp}
            />
          </>
        ) : null}
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
        {/*
          Only with a registration: without one there is nothing to verify and
          nothing Agent0 could have indexed, and the empty state above already
          says so.
        */}
        {identity.registration ? <RefreshTracks agentId={id} /> : null}
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
              The same read, about whoever is looking.

              Everything above is answered for an address this deployment
              configured, which makes it believable rather than checkable. This
              runs the identical `hasRoles` query against a wallet the reader
              connected — no transaction, no gas — and the denials it returns
              are ones they chose the subject of.
            */}
            <Frame
              title="you"
              subtitle="The authority boundary, computed for an address you control rather than one this deployment configured."
            >
              <VisitorAuthority agentId={id} />
            </Frame>

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
              {/*
                The nesting drawn as nesting.

                It was an indented list, which is the same information and
                loses the one thing a reader needs from it: which resources
                belong to which cell, once a cell has five of them and the next
                begins. The branch characters make a run of long EAC resource
                strings scannable as a shape rather than as a paragraph of
                hex — and this is the panel that exists to let someone check a
                denial against the resource it was derived from, so being able
                to find the boundary is the whole point.
              */}
              <GraphTree
                title="resources"
                nodes={permissions.queries.map((q) => ({
                  label: q.cell,
                  children: q.resources.map((r) => ({ label: r })),
                }))}
              />
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
        subtitle="Two writes from the same controller key, seconds apart. It may change where this agent can be reached; it may not change what this agent is registered as."
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

      {/* ── History ────────────────────────────────────────────────────── */}
      <Frame
        title="History"
        subtitle="Every other section is state, true right now. This is the only one that is a record of use."
      >
        {history ? (
          <AgentHistory history={history} readAt={new Date().toISOString()} />
        ) : (
          <Outcome
            tone="fault"
            title="The activity log could not be read"
            detail="This is the store failing, not an agent that has done nothing. The two look identical on screen, which is why this says which it is."
          />
        )}
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
                {/*
                  The formatted limit, not the rule sentence. Privy names the
                  rule "Restrict native transfers to 1000000000000000 wei",
                  which is the confidently-wrong figure the token helpers exist
                  to prevent — eighteen decimals is not a detail the reader
                  should be made to carry, and the treasury screen prints the
                  same policy as 0.001 ETH two clicks away.
                */}
                <Field
                  label="Policy"
                  value={`${wallet.policy.label} — at most ${formatAmount(wallet.policy.maxAmount, wallet.policy.token)} per transaction`}
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
                  peers={(fleet?.agents ?? [])
                    .filter((peer) => peer.id !== id)
                    .map((peer) => ({
                      ensName: peer.ensName,
                      ...(peer.wallet.status === "provisioned" && {
                        walletAddress: peer.wallet.address,
                      }),
                    }))}
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
          <>
            <Empty
              title={EMPTY_STATES.noWallet.title}
              detail={EMPTY_STATES.noWallet.detail}
            />
            {/*
              Offered on a failed wallet read too. `provisionWallet` reuses the
              store's reference, so asking for a wallet that exists repairs it
              rather than creating a second one.
            */}
            <ProvisionWallet agentId={id} />
          </>
        )}
      </Frame>
    </VStack>
  );
}
