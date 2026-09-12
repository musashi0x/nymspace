import Link from "next/link";
import { CommitActivity } from "@/components/commit-activity";
import { LandingPreloader } from "@/components/preloader/landing-preloader";
import { ThemeToggle } from "@/components/theme-toggle";
import { RepoStats } from "@/components/repo-stats";
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

  /*
   * `max-w-6xl`, because the commit calendar is what sets the floor.
   *
   * At `5xl` the page gave the grid 790px and the grid wants 792 — 53 week
   * columns plus the weekday labels. Two pixels, and the consequence is not two
   * pixels: the component switches out of its centred layout, left-aligns, and
   * scrolls itself to the newest week, so a year of history reads as something
   * cut off at the edge. Prose keeps its own `max-w-2xl` below, so widening the
   * frame does not lengthen a single line of reading.
   */
  return (
    <>
      {/*
        Rendered by the server page rather than mounted from an effect, so the
        overlay is in the first HTML the browser paints. Mounting it later
        would show the page and then cover it, which is a flash rather than a
        preloader. It removes itself after one cycle — and, with no JavaScript
        at all, after the failsafe animation in globals.css.
      */}
      <LandingPreloader />
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-20 px-6 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          nymspace
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/console"
            className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Console
          </Link>
          <ThemeToggle />
        </div>
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
            {/*
              No `.env.local` here. This panel renders wherever the read
              failed, and on the deployed site it was telling a visitor to edit
              a file on a machine they do not have — an instruction addressed to
              whoever runs the deployment, shown to everybody else.

              The arithmetic is worth stating plainly, because it is the whole
              explanation: a refresh costs a repository read plus up to five
              pages of commits, and the page refreshes on its revalidate
              interval, so unauthenticated it exceeds the hourly allowance
              within minutes of any deploy. It is not a traffic problem, and
              waiting does not fix it.
            */}
            {data.error.kind === "rate_limited" && (
              <p className="mt-2">
                Unauthenticated, GitHub allows 60 requests an hour, and one
                refresh of this page costs up to six. Setting{" "}
                <code className="font-mono text-xs">GITHUB_TOKEN</code> on the
                environment that serves this page raises the allowance to
                5,000/hr.
              </p>
            )}
          </div>
        ) : (
          <CommitActivity data={data} />
        )}

        <RepoStats data={data} />

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
    </>
  );
}
