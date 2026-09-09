import Link from "next/link";
import { fetchActivity } from "@/lib/api";
import { Badge, Empty, Panel } from "@/components/console/primitives";

/**
 * The activity timeline — task 7.18.
 *
 * Sorted by when things happened rather than when they were written, so a slow
 * confirmation does not reorder the story. Denied and failed events are shown
 * like any other: in this product a denial is the evidence, and a timeline that
 * hides it is a timeline that only ever shows success.
 */
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  success: "good",
  denied: "warn",
  failed: "bad",
  pending: "neutral",
} as const;

export default async function ActivityPage() {
  const timeline = await fetchActivity({ limit: 100 });

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">Activity</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          One stream across ENS, ERC 8004, the Graph and Privy. Every event
          carries the evidence its source produces — a transaction hash, a
          subgraph and query time, or a provider request id.
        </p>
      </header>

      {timeline.events.length === 0 ? (
        <Empty
          title="Nothing has happened yet"
          detail="Provision the fleet to record the first events."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {timeline.events.map((event) => (
            <li key={event.id}>
              <Panel title={event.summary}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[event.status] ?? "neutral"}>
                    {event.status}
                  </Badge>
                  <Badge tone="neutral">{event.source}</Badge>
                  <Badge tone="neutral">{event.type}</Badge>
                  <span className="font-mono text-[0.65rem] text-muted-foreground">
                    {new Date(event.occurredAt).toLocaleString()}
                  </span>
                </div>
                <dl className="grid gap-1 font-mono text-[0.65rem] break-all text-muted-foreground">
                  {event.txHash ? <div>tx {event.txHash}</div> : null}
                  {event.actor ? <div>actor {event.actor}</div> : null}
                  {event.agentId ? (
                    <div>
                      agent{" "}
                      <Link
                        href={`/console/agents/${event.agentId}`}
                        className="underline underline-offset-2"
                      >
                        {event.agentId}
                      </Link>
                    </div>
                  ) : null}
                  <div>evidence {JSON.stringify(event.evidence)}</div>
                </dl>
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
