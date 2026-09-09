import { DiscoverForm } from "@/components/console/discover-form";

/**
 * Screen 3 — Discover.
 *
 * The form is a client component because the query is conversational and the
 * result arrives after a round trip the operator initiated; everything else on
 * this page is static copy. Nothing is prefetched: a discovery result rendered
 * before anyone asked would be a cached answer wearing a live one's clothes.
 */
export default function DiscoverPage() {
  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">Discover</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Live ERC 8004 registrations from the Agent0 subgraph. The filter runs
          on the server before a model sees anything, and the ranking&rsquo;s
          reason is checked field by field against the data it describes — a
          reason citing something the response never carried fails rather than
          renders.
        </p>
      </header>
      <DiscoverForm />
    </main>
  );
}
