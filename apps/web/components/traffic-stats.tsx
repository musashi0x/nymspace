"use client";

import * as React from "react";
import { apiBaseUrl } from "@/lib/api";

/**
 * Readership of this page, recorded by this page.
 *
 * The card is the least verifiable thing on a site whose argument is that
 * displayed values are checkable. Commit activity can be diffed against
 * GitHub; a permission answer can be re-read from the resolver. Nobody can
 * check a visitor count from outside, so the design compensates by being
 * explicit about what the number is not:
 *
 *   - automated requests are excluded, and the count of them is shown, because
 *     a filter whose effect is invisible is a claim rather than a measurement;
 *   - the start date is shown, because a bare total reads as all-time;
 *   - a failed read renders nothing at all.
 *
 * That last one matters most. `views: 0` and "we could not reach the API" are
 * different facts, and the zero is the one that looks like data. The landing
 * page already refuses to render a fabricated commit count for the same
 * reason.
 *
 * The view is recorded from the browser rather than during the server render,
 * which is what keeps this honest at all: `page.tsx` is ISR-cached for sixty
 * seconds, so a server-side write would count one view per cache miss instead
 * of one per reader — undercounting by however many people arrive inside the
 * window. It also keeps Postgres off the landing page's render path, so the
 * page still renders when the database is down.
 */

interface Stats {
  views: number;
  visitors: number;
  botViews: number;
  since: string | null;
}

export function TrafficStats() {
  /**
   * The in-flight POST, held across mounts.
   *
   * Strict mode runs mount, cleanup, mount. Two obvious shapes both fail here,
   * and both fail silently:
   *
   *   a `recorded` boolean alone — the second mount skips the fetch, which is
   *   right, but also skips subscribing to it, so the resolved stats land
   *   nowhere and the card sits at "—";
   *
   *   an AbortController aborted in cleanup — that kills the *only* request the
   *   guard will ever allow, and the fetch dies with ERR_ABORTED.
   *
   * Holding the promise separates the two concerns: `??=` fires it exactly
   * once, and every mount attaches its own handlers to whatever is already
   * running. Firing once is what keeps the count honest; subscribing every time
   * is what makes it appear.
   */
  const request = React.useRef<Promise<Stats> | null>(null);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    request.current ??= fetch(`${apiBaseUrl}/v1/traffic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The visitor cookie is set by the API on another origin in development
      // (3112 vs 3111). Without this it is neither sent nor stored, and every
      // request looks like a new visitor.
      credentials: "include",
      body: JSON.stringify({ path: window.location.pathname }),
    }).then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<Stats>;
    });

    request.current
      .then((next) => {
        if (active) setStats(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, []);

  if (failed) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Readership
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Visitors" value={stats?.visitors} />
        <Stat label="Views" value={stats?.views} />
        <Stat label="Excluded as bots" value={stats?.botViews} muted />
      </div>

      <p className="text-xs text-muted-foreground">
        {stats?.since ? (
          <>
            Counted since {stats.since.slice(0, 10)}. A visitor is a browser
            that kept its cookie, so clearing cookies counts twice and a
            headless browser with a spoofed user agent is counted as a person —
            treat this as a floor, not a headcount.
          </>
        ) : (
          <>Counting starts with the first recorded view.</>
        )}
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number | undefined;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 p-4">
      <span
        className={`font-mono text-2xl tabular-nums ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {/* An em dash while in flight. A zero here would be a measurement. */}
        {value === undefined ? "—" : value.toLocaleString()}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
