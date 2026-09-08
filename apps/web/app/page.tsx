import { CommitActivity } from "@/components/commit-activity";
import { ThemeToggle } from "@/components/theme-toggle";
import { WordTiles } from "@/components/word-tiles";
import { getActivity, REVALIDATE_SECONDS } from "@nymspace/github";

/**
 * The raw payload moved to the API when `getActivity` moved into a package.
 * The page still server-renders from the package directly, so this link is the
 * only place the browser needs to know where the API lives.
 */
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3112";

export const revalidate = 60;

export default async function Home() {
  const data = await getActivity();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-20 px-6 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          nymspace
        </p>
        <ThemeToggle />
      </div>

      <header className="flex flex-col gap-8">
        <WordTiles sentence="ens is the identity layer" />

        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          I would make ENS the identity layer, then choose partners that
          naturally become the data and execution layers.
        </p>
      </header>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Build log</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every square below is real commit data read live from the GitHub API
            at request time — not a screenshot, not a seeded number. Click a day
            to read that day&rsquo;s commits, then open any SHA to check it
            yourself. The raw payload is at{" "}
            <a
              href={`${apiBaseUrl}/v1/activity`}
              className="font-mono underline underline-offset-2 hover:text-foreground"
            >
              /v1/activity
            </a>
            .
          </p>
        </div>

        {data.error ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">
              Commit data unavailable
            </p>
            <p>{data.error.message}</p>
            {data.error.kind === "rate_limited" && (
              <p className="mt-2">
                The unauthenticated API allows 60 requests per hour. Set{" "}
                <code className="font-mono text-xs">GITHUB_TOKEN</code> in{" "}
                <code className="font-mono text-xs">.env.local</code> to raise
                the limit to 5,000/hr, then reload.
              </p>
            )}
          </div>
        ) : (
          <CommitActivity data={data} />
        )}

        {data.truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the most recent {data.totalCommits} commits. Older history
            exists beyond this window.
          </p>
        )}
      </section>

      <footer className="flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground">
        <p>
          Tracking{" "}
          <a
            href={data.repo.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline underline-offset-2 hover:text-foreground"
          >
            {data.repo.fullName}
          </a>
          {" · "}
          data fetched {new Date(data.fetchedAt).toISOString().slice(0, 19)}Z
          {" · "}
          auto-refreshes every {REVALIDATE_SECONDS}s
        </p>
        <p>
          New commits appear here on their own — the page re-reads GitHub on the
          next request after {REVALIDATE_SECONDS}s. No redeploy, no manual step.
        </p>
      </footer>
    </main>
  );
}
