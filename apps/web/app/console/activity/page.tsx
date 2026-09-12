import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  ACTIVITY_SOURCES,
  ACTIVITY_STATUSES,
  fetchActivity,
  fetchActivitySummary,
} from "@/lib/api";
import { ActivityTable, type ActivityRow } from "@/components/console/activity-table";
import { OutcomeChart } from "@/components/console/outcome-chart";
import { Empty, Frame, Outcome } from "@/components/console/primitives";

/**
 * The activity timeline — task 7.18 — and the outcome summary above it.
 *
 * Sorted by when things happened rather than when they were written, so a slow
 * confirmation does not reorder the story. Denied and failed events are shown
 * like any other: in this product a denial is the evidence, and a timeline that
 * hides it is a timeline that only ever shows success.
 *
 * The filter lives in the URL and is applied by the API, never to the rows
 * already on the page: those are the newest hundred, so filtering them would
 * quietly answer a different question than the one asked. Only the table and
 * the chart are client components; both fetches stay here on the server.
 */
export const dynamic = "force-dynamic";

/**
 * A search parameter, kept only when it names a value the API accepts.
 *
 * Anything else is dropped rather than forwarded. Forwarded, it would come back
 * as a 400 from the API's validation and turn a hand-edited URL into an error
 * page; dropped, the page shows the unfiltered timeline and claims no filter.
 */
function pick<T extends string>(
  allowed: readonly T[],
  value: string | string[] | undefined,
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const source = pick(ACTIVITY_SOURCES, params.source);
  const status = pick(ACTIVITY_STATUSES, params.status);
  const filter = [source, status].filter(Boolean).join(" · ");

  const [timeline, summary] = await Promise.all([
    fetchActivity({ limit: 100, source, status }),
    // Settled rather than awaited raw: a summary that fails must not take the
    // timeline down with it.
    fetchActivitySummary().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    ),
  ]);

  const count = (key: "denied" | "failed") =>
    summary.ok ? summary.value.bySource.reduce((sum, row) => sum + row[key], 0) : 0;

  const logIsEmpty = !filter && timeline.events.length === 0;

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

      {logIsEmpty ? (
        <Empty
          title="Nothing has happened yet"
          detail="Provision the fleet to record the first events."
        />
      ) : (
        <>
          <Frame
            title="outcomes"
            subtitle={
              summary.ok
                ? `${summary.value.total} events across ${summary.value.bySource.length} sources: ${count("denied")} denied, ${count("failed")} failed. Counted over the whole log, not the rows below. Select a segment to filter the timeline.`
                : undefined
            }
          >
            {summary.ok ? (
              <OutcomeChart
                rows={summary.value.bySource}
                source={source}
                status={status}
              />
            ) : (
              <Outcome
                tone="fault"
                title="Could not read the outcome summary"
                detail={summary.message}
                action="The timeline below was read separately and is unaffected."
              />
            )}
          </Frame>

          <Frame
            title="timeline"
            subtitle={
              filter
                ? `${timeline.events.length} ${filter} events loaded, newest first. Filtered: the chart above still counts the whole log. Forty at a time — scroll to load the rest.`
                : `${timeline.events.length} events loaded, newest first. Forty at a time — scroll to load the rest. Expand a row for the evidence its source produced.`
            }
          >
            {timeline.events.length === 0 ? (
              <Empty
                title={`No ${filter} events`}
                detail="Nothing in the log matches this filter. Clear it to see every event."
              />
            ) : (
              <ActivityTable
                // A new filter is a new list: keyed, so the row window and the
                // expanded rows start over instead of carrying the last list's.
                key={filter}
                events={timeline.events as unknown as ActivityRow[]}
              />
            )}
          </Frame>
        </>
      )}
    </VStack>
  );
}
