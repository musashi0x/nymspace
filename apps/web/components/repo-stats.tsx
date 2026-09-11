"use client";

import * as React from "react";
import type { ActivityPayload } from "@nymspace/github";
import {
  TrafficTiles,
  type TrafficStatsValue,
} from "@/components/traffic-stats";

/**
 * The repository and its readership, as one row.
 *
 * Layout borrowed from bunui.xyz's bento row, and specifically its one good
 * responsive idea: the numbers never wrap. A fixed column count at every width
 * with the type shrinking — `text-2xl` on a small phone, `text-3xl` past 380px,
 * `text-4xl` from `sm`. Letting a stat row reflow to one line per stat turns a
 * glanceable summary into a list you have to read, and it is the first thing
 * that breaks when a label is longer than its number.
 *
 * `min-w-0` on every cell is what makes that safe: without it a grid track
 * refuses to shrink below its content and the row pushes the whole page wide.
 *
 * ## Every tile is read, none is declared
 *
 * bunui's row renders `2 COMPONENTS` from `const COMPONENT_COUNT = 1` — a
 * constant sitting between two measured values, which is exactly what makes a
 * constant read as measured. Here the first three come from the GitHub payload
 * the calendar above is drawn from, and the last two from a live count. When
 * either read fails those tiles do not render rather than showing zeroes.
 *
 * ## Why this is a client component
 *
 * Only for the two traffic tiles, which record a view when they mount. The
 * three GitHub numbers arrive as props already resolved on the server, so they
 * paint with the rest of the page and never flash.
 */
export function RepoStats({ data }: { data: ActivityPayload }) {
  const [traffic, setTraffic] = React.useState<TrafficStatsValue | null>(null);

  // A failed read is not a repository with no commits. The calendar already
  // says so loudly; this row simply declines to invent a number.
  if (data.error) return null;

  const tile =
    "flex min-w-0 flex-col justify-between rounded-2xl border border-border/60 bg-card p-3 sm:p-6";

  /*
   * No contributor count here.
   *
   * The panel directly above this row already ends with "2 people", beside the
   * avatars and the per-person commit bars it counted. Repeating the same
   * number two centimetres lower, in a tile the same size as the ones carrying
   * numbers you cannot get anywhere else, spends the row's most valuable slot
   * on something already answered — and invites the reader to check whether
   * the two agree, which is work with no payoff.
   *
   * Stars stays at zero. It is measured, and a real zero is a fact about the
   * repository; dropping a tile because its number is unflattering is curation,
   * not layout.
   */
  const github = [
    { label: "Commits", value: data.totalCommits },
    { label: "Stars", value: data.repo.stars },
  ];

  return (
    <section className="flex flex-col gap-3 sm:gap-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-12 sm:gap-4">
        {/*
          Accent by tone, not by inversion.

          This was `bg-foreground text-background`, which is a black card in
          light mode — bunui's look — and inverts to a white slab in dark mode,
          with white-on-white text inside it. An accent that flips with the
          theme is not an accent. `bg-muted` reads as a distinct surface in both
          because it is defined per theme, and the text token comes with it.
        */}
        <a
          href={data.repo.url}
          target="_blank"
          rel="noreferrer"
          className="group flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted p-4 transition-colors hover:bg-muted/70 sm:col-span-4 sm:p-6"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-mono text-sm">
              {data.repo.fullName}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {data.repo.description ?? "No description"}
            </span>
          </span>
          <span
            aria-hidden
            className="shrink-0 text-sm text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          >
            ↗
          </span>
        </a>

        {/*
          Four tiles, and never one per line. Two columns on a phone so each
          pair stays on one row, four from `sm` where there is width for them —
          a count that divides evenly, unlike the five this used to carry.
        */}
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:col-span-8 sm:grid-cols-4 sm:gap-4">
          {github.map((stat) => (
            <div key={stat.label} className={tile}>
              <p className="font-mono text-2xl tabular-nums min-[380px]:text-3xl sm:text-4xl">
                {stat.value.toLocaleString("en-US")}
              </p>
              <p className="mt-2 truncate text-[9px] uppercase tracking-[0.12em] text-muted-foreground min-[380px]:text-[10px] sm:text-[11px] sm:tracking-[0.18em]">
                {stat.label}
              </p>
            </div>
          ))}
          <TrafficTiles tileClassName={tile} onLoaded={setTraffic} />
        </div>
      </div>

      {/*
        The caveats belong next to the numbers, not in a tooltip. A visitor
        count with no start date reads as all-time, and a bot filter nobody can
        see the effect of is a claim rather than a measurement.
      */}
      {traffic?.since && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Visitors and views counted since {traffic.since.slice(0, 10)}
          {traffic.botViews > 0 && (
            <>
              , excluding {traffic.botViews.toLocaleString("en-US")} automated
              request{traffic.botViews === 1 ? "" : "s"}
            </>
          )}
          . A visitor is a browser that kept its cookie, so clearing cookies
          counts twice and a headless browser with a spoofed user agent counts
          as a person — a floor, not a headcount.
        </p>
      )}
    </section>
  );
}
