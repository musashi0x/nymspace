"use client";

import * as React from "react";
import GitHubActivity, {
  type Contribution as UIContribution,
} from "@/components/ui/github-activity";
import type { ActivityPayload, Commit } from "@/lib/github";
import { cn } from "@/lib/utils";

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function CommitActivity({ data }: { data: ActivityPayload }) {
  const today = todayUTC();

  const latestActiveDay = React.useMemo(() => {
    const dates = Object.keys(data.commitsByDate).sort();
    return dates.at(-1) ?? today;
  }, [data.commitsByDate, today]);

  // Today by default when there is something to show, otherwise the last day we
  // actually shipped — an empty panel on first paint reads as "broken", not "quiet".
  const [selected, setSelected] = React.useState<string>(
    data.commitsByDate[today]?.length ? today : latestActiveDay,
  );

  const commits = data.commitsByDate[selected] ?? [];
  const contributions: UIContribution[] = data.contributions;

  const topContributors = data.contributors.slice(0, 3).map((c) => ({
    name: c.login,
    count: c.contributions,
    href: c.url,
    logo: (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={c.avatar} alt="" />
    ),
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-stretch gap-6">
        <div className="w-full">
          <GitHubActivity
            contributions={contributions}
            repos={topContributors}
            label="Top contributors:"
            accent="#39d353"
            cellSize={12}
            showMonths
            defaultOpen
            selectedDate={selected}
            onDaySelect={(day) => setSelected(day.date)}
            // dark:bg-card is required as well as bg-card: the component ships
            // `bg-white dark:bg-black`, and tailwind-merge treats the dark:
            // variant as a separate group, so bg-card alone leaves the card
            // pure black — darker than the page — in dark mode.
            className="border border-border/60 bg-card dark:bg-card"
          />
          <p className="mt-3 px-1 text-xs text-muted-foreground">
            {data.totalCommits} commit{data.totalCommits === 1 ? "" : "s"} on{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={`${data.repo.url}/commits/${data.repo.defaultBranch}`}
              target="_blank"
              rel="noreferrer"
            >
              {data.repo.fullName}
            </a>{" "}
            in the last {Math.round(data.windowDays / 7)} weeks. Click any square
            to read that day&rsquo;s commits.
          </p>
        </div>

        <DayPanel
          date={selected}
          commits={commits}
          isToday={selected === today}
          repoUrl={data.repo.url}
        />
      </div>

      <Contributors data={data} />
    </div>
  );
}

function DayPanel({
  date,
  commits,
  isToday,
  repoUrl,
}: {
  date: string;
  commits: Commit[];
  isToday: boolean;
  repoUrl: string;
}) {
  return (
    <section className="flex w-full min-w-0 flex-1 flex-col rounded-2xl border border-border/60 bg-card p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
        <h3 className="text-sm font-medium text-foreground">
          {DAY_FORMAT.format(new Date(`${date}T00:00:00Z`))}
          {isToday && (
            <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
              today
            </span>
          )}
        </h3>
        <span className="font-mono text-xs text-muted-foreground">
          {commits.length} commit{commits.length === 1 ? "" : "s"}
        </span>
      </header>

      {commits.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No commits on this day.
        </p>
      ) : (
        <ul className="max-h-[380px] divide-y divide-border/50 overflow-y-auto">
          {commits.map((commit) => (
            <li key={commit.sha} className="flex min-w-0 gap-3 py-3 pr-1">
              {commit.authorAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={commit.authorAvatar}
                  alt=""
                  className="mt-0.5 size-6 shrink-0 rounded-full"
                />
              ) : (
                <span className="mt-0.5 size-6 shrink-0 rounded-full bg-foreground/10" />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {commit.subject}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{commit.authorLogin ?? commit.authorName}</span>
                  <span aria-hidden>·</span>
                  <span className="font-mono">
                    {TIME_FORMAT.format(new Date(commit.date))} UTC
                  </span>
                  {commit.verified && (
                    <span className="rounded-full border border-emerald-500/40 px-1.5 py-px text-[10px] uppercase tracking-wide text-emerald-500">
                      verified
                    </span>
                  )}
                </p>
              </div>

              <a
                href={commit.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 self-start font-mono text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                title="Open this commit on GitHub"
              >
                {commit.shortSha}
              </a>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto border-t border-border/60 pt-3">
        <a
          href={`${repoUrl}/commits`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Verify every SHA on GitHub
        </a>
      </footer>
    </section>
  );
}

function Contributors({ data }: { data: ActivityPayload }) {
  if (!data.contributors.length) return null;
  const max = data.contributors[0].contributions;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Contributors</h3>
        <span className="font-mono text-xs text-muted-foreground">
          {data.contributors.length} people
        </span>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.contributors.map((person) => (
          <li key={person.login}>
            <a
              href={person.url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "flex items-center gap-3 rounded-xl border border-transparent p-2",
                "transition-colors hover:border-border/60 hover:bg-foreground/[0.03]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={person.avatar}
                alt=""
                className="size-8 shrink-0 rounded-full"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {person.login}
                </span>
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                  <span
                    className="block h-full rounded-full bg-[#39d353]"
                    style={{
                      width: `${Math.max(4, (person.contributions / max) * 100)}%`,
                    }}
                  />
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {person.contributions}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
