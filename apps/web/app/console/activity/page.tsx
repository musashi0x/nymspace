import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { fetchActivity } from "@/lib/api";
import { ActivityTable, type ActivityRow } from "@/components/console/activity-table";
import { Empty, Frame } from "@/components/console/primitives";

/**
 * The activity timeline — task 7.18.
 *
 * Sorted by when things happened rather than when they were written, so a slow
 * confirmation does not reorder the story. Denied and failed events are shown
 * like any other: in this product a denial is the evidence, and a timeline that
 * hides it is a timeline that only ever shows success.
 *
 * The fetch stays here on the server; only the table is a client component,
 * because expanding a row to read its evidence needs state.
 */
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const timeline = await fetchActivity({ limit: 100 });

  return (
    <VStack as="main" gap={6} width="100%" className="min-w-0">
      <VStack as="header" gap={2} maxWidth="42rem">
        <Heading level={1}>Activity</Heading>
        <Text type="supporting" as="p">
          One stream across ENS, ERC 8004, the Graph and Privy. Every event
          carries the evidence its source produces — a transaction hash, a
          subgraph and query time, or a provider request id.
        </Text>
      </VStack>

      {timeline.events.length === 0 ? (
        <Empty
          title="Nothing has happened yet"
          detail="Provision the fleet to record the first events."
        />
      ) : (
        <Frame
          title="timeline"
          subtitle={`${timeline.events.length} events loaded, newest first. Forty at a time — scroll to load the rest. Expand a row for the evidence its source produced.`}
        >
          <ActivityTable events={timeline.events as unknown as ActivityRow[]} />
        </Frame>
      )}
    </VStack>
  );
}
