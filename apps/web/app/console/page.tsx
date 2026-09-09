import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { fetchAgents } from "@/lib/api";
import { EMPTY_STATES } from "@/lib/console/errors";
import { FleetTable, type FleetRow } from "@/components/console/fleet-table";
import { Empty, Frame, Provenance } from "@/components/console/primitives";

/**
 * Screen 1 — Fleet home.
 *
 * Server-rendered, uncached. Next 16 does not cache `fetch` by default and this
 * page deliberately does not opt in — provisioning state changes when a script
 * runs, and a console showing a cached fleet is a console lying about a system
 * that just changed underneath it.
 *
 * The five-state rule lives with the table that renders it; see
 * `components/console/fleet-table.tsx`.
 */
export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const fleet = await fetchAgents();
  const parent = process.env.NEXT_PUBLIC_PARENT_ENS_NAME ?? "nymspace.eth";
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111";

  return (
    <VStack as="main" gap={8} width="100%" className="min-w-0">
      <VStack as="header" gap={3} maxWidth="42rem">
        <Heading level={1}>
          <Text type="code" size="2xl">
            {parent}
          </Text>
        </Heading>
        <HStack gap={3} wrap="wrap" align="center">
          <Text type="supporting">
            {fleet.agents.length} agent{fleet.agents.length === 1 ? "" : "s"}
          </Text>
          <Text type="supporting" aria-hidden>
            ·
          </Text>
          <Text type="supporting">ENSv2 Sepolia ({chainId})</Text>
          <Provenance source={fleet.source} readAt={fleet.readAt} />
        </HStack>
        <Text type="supporting" as="p">
          Each agent owns a name under this namespace. Everything below is the
          store&rsquo;s own record of provisioning progress — identity,
          permission and policy answers are read from their own systems when you
          open an agent.
        </Text>
      </VStack>

      {fleet.agents.length === 0 ? (
        <Empty
          title={EMPTY_STATES.noAgents.title}
          detail={EMPTY_STATES.noAgents.detail}
          action={
            <Link href="/console/new">
              <Text type="body" size="sm">
                Create the first agent
              </Text>
            </Link>
          }
        />
      ) : (
        <Frame
          title="fleet"
          subtitle="Five integration states per agent, kept separate. A single ready badge would hide the one an operator needs."
        >
          <FleetTable agents={fleet.agents as unknown as FleetRow[]} />
        </Frame>
      )}
    </VStack>
  );
}
