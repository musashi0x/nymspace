import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { fetchAgents, fetchPermissions } from "@/lib/api";
import { ApprovalChat } from "@/components/console/approval-chat";
import { Empty, Frame, Provenance } from "@/components/console/primitives";
import { EMPTY_STATES } from "@/lib/console/errors";

/**
 * Screen 6 — Approvals.
 *
 * A chat transcript whose one pending step is a real, destructive chain write:
 * revoking a record key the controller currently holds. The approval is not a
 * confirmation dialog bolted onto a finished action — nothing is sent until it
 * is answered, and answering "keep it" sends nothing at all.
 *
 * ## Why this screen exists next to the agent page
 *
 * The agent page already grants and revokes. What it does not do is put the
 * decision in the operator's hands *before* the request is built, which is the
 * shape agent products actually need: an agent proposes, a human gates the
 * destructive step, and the gate is the only thing between a proposal and a
 * transaction. Separating it also keeps the agent page honest — that page is a
 * read of current state, and a page that is mostly a read should not also be
 * where irreversible writes are easiest to trigger by accident.
 *
 * Server-rendered and uncached, like every console screen. The permission
 * matrix is a row of `canSetText` calls against the resolver, so a grant
 * revoked on chain a second ago is already absent from the transcript.
 */
export const dynamic = "force-dynamic";

export default async function ApprovalsPage({
  searchParams,
}: PageProps<"/console/approvals">) {
  const { agent: requested } = await searchParams;

  const fleet = await fetchAgents();
  const agents = fleet.agents;

  /**
   * Which agent this screen is about.
   *
   * `?agent=` when asked for, the first in the fleet otherwise. Falling back
   * rather than erroring, because a link into this screen without a query is
   * the common case and an empty page would read as "no agents" — a claim the
   * fleet read directly contradicts.
   */
  const chosen =
    (typeof requested === "string"
      ? agents.find((row) => row.id === requested)
      : undefined) ?? agents[0];

  if (!chosen) {
    return (
      <VStack as="main" gap={8} width="100%" className="min-w-0">
        <Header />
        <Empty
          title={EMPTY_STATES.noAgents.title}
          detail={EMPTY_STATES.noAgents.detail}
          action={
            <Link href="/console/new">
              <Text type="body" size="sm">
                Create an agent
              </Text>
            </Link>
          }
        />
      </VStack>
    );
  }

  const permissions = await fetchPermissions(chosen.id).catch(() => null);

  return (
    <VStack as="main" gap={8} width="100%" className="min-w-0">
      <Header />

      {agents.length > 1 ? (
        <HStack as="nav" gap={3} wrap="wrap" align="center">
          {agents.map((row) => (
            <Link key={row.id} href={`/console/approvals?agent=${row.id}`}>
              <Text
                type="code"
                size="sm"
                color={row.id === chosen.id ? "primary" : "secondary"}
              >
                {row.ensName}
              </Text>
            </Link>
          ))}
        </HStack>
      ) : null}

      <Frame surface="body" title={chosen.ensName}>
        {permissions ? (
          <ApprovalChat
            agentId={chosen.id}
            ensName={chosen.ensName}
            controller={permissions.controller}
            cells={Object.entries(permissions.recordPermissions).map(
              ([key, allowed]) => ({ key, allowed }),
            )}
            source={permissions.source}
            readAt={permissions.readAt}
          />
        ) : (
          /*
            The read failed, and the transcript is not shown at all.

            An approval card built on an unknown matrix would offer to revoke a
            key nobody confirmed the controller holds — the one failure mode
            that turns a safety feature into a way to send a pointless
            transaction.
          */
          <VStack gap={2} paddingBlock={4}>
            <Text type="body" as="p">
              Could not read this agent&rsquo;s permissions.
            </Text>
            <Text type="supporting" as="p" className="max-w-prose">
              Nothing is offered for approval while the matrix is unknown. The
              resolver may be unreachable, or this deployment may not have the
              ENSv2 addresses configured.
            </Text>
          </VStack>
        )}
      </Frame>

      <HStack gap={3} wrap="wrap" align="center">
        <Link href={`/console/agents/${chosen.id}`}>
          <Text type="body" size="sm" color="secondary">
            Open the full authority matrix →
          </Text>
        </Link>
        {permissions ? (
          <Provenance source={permissions.source} readAt={permissions.readAt} />
        ) : null}
      </HStack>
    </VStack>
  );
}

function Header() {
  return (
    <VStack as="header" gap={3} maxWidth="42rem">
      <Heading level={1}>
        <Text type="code" size="2xl">
          Approvals
        </Text>
      </Heading>
      <Text type="supporting" as="p">
        An agent proposes a destructive change; nothing reaches a chain until
        you answer. The keys below were read from the Permissioned Resolver when
        this page rendered, and approving sends the organization-signed
        revocation.
      </Text>
    </VStack>
  );
}
