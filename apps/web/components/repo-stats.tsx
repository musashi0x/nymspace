import type { ActivityPayload } from "@nymspace/github";

/**
 * The repository, as four tiles.
 *
 * Layout borrowed from bunui.xyz's bento row, and specifically its one good
 * responsive idea: the numbers never wrap. Three columns at every width, and
 * the type shrinks instead — `text-2xl` on a small phone, `text-3xl` past
 * 380px, `text-4xl` from `sm`. Letting a stat row reflow to one column per line
 * turns a glanceable summary into a list you have to read, and it is the first
 * thing that breaks when the label is longer than the number.
 *
 * `min-w-0` on every cell is what makes that safe: without it a grid track
 * refuses to shrink below its content and the row pushes the page wide.
 *
 * What is deliberately different from the original: every number here is read,
 * not declared. bunui's row renders `2 COMPONENTS` from `const COMPONENT_COUNT
 * = 1` — a constant sitting between two measured values, which is what makes a
 * constant read as measured. These four all come from the same GitHub payload
 * the calendar above is drawn from, and when that read fails the row does not
 * render at all rather than showing zeroes.
 */
export function RepoStats({ data }: { data: ActivityPayload }) {
  // A failed read is not a repository with no commits. The calendar already
  // says so loudly; this row simply declines to invent a number.
  if (data.error) return null;

  const stats = [
    { label: "Commits", value: data.totalCommits },
    { label: "Contributors", value: data.contributors.length },
    { label: "Stars", value: data.repo.stars },
  ];

  return (
    <section className="grid min-w-0 gap-3 sm:grid-cols-12 sm:gap-4">
      <a
        href={data.repo.url}
        target="_blank"
        rel="noreferrer"
        className="group flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border/60 bg-foreground p-4 text-background transition-opacity hover:opacity-90 sm:col-span-5 sm:p-6"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-mono text-sm sm:text-base">
            {data.repo.fullName}
          </span>
          <span className="truncate text-xs opacity-70">
            {data.repo.description ?? "No description"}
          </span>
        </span>
        <span
          aria-hidden
          className="shrink-0 text-sm transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        >
          ↗
        </span>
      </a>

      {/* grid-cols-3 at every width, never wrapping — see the note above. */}
      <div className="grid min-w-0 grid-cols-3 gap-3 sm:col-span-7 sm:gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex min-w-0 flex-col justify-between rounded-2xl border border-border/60 bg-card p-3 sm:p-6"
          >
            <p className="font-mono text-2xl tabular-nums min-[380px]:text-3xl sm:text-4xl">
              {stat.value.toLocaleString("en-US")}
            </p>
            <p className="mt-2 truncate text-[9px] uppercase tracking-[0.12em] text-muted-foreground min-[380px]:text-[10px] sm:text-[11px] sm:tracking-[0.18em]">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
