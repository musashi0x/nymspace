"use client";

import * as React from "react";
import { apiBaseUrl } from "@/lib/api";

/**
 * Readership, as two tiles inside the repo stat row.
 *
 * The least verifiable numbers on a page whose argument is that displayed
 * values are checkable. Commit counts can be diffed against GitHub; a
 * permission answer can be re-read from the resolver. Nobody can check a
 * visitor count from outside, so the design compensates:
 *
 *   - automated requests are excluded, and the count of them is stated under
 *     the row, because a filter whose effect is invisible is a claim rather
 *     than a measurement;
 *   - the start date is stated, because a bare total reads as all-time;
 *   - a failed read renders nothing at all. `views: 0` and "we could not reach
 *     the API" are different facts, and the zero is the one that looks like
 *     data.
 *
 * Recorded from the browser rather than during the server render, which is what
 * keeps the number honest: `page.tsx` is ISR-cached for sixty seconds, so a
 * server-side write would count one view per cache miss instead of one per
 * reader. It also keeps Postgres off the landing page's render path, so the
 * page still renders when the database is down.
 */

interface Stats {
  views: number;
  visitors: number;
  botViews: number;
  since: string | null;
}

export function TrafficTiles({
  tileClassName,
  onLoaded,
}: {
  tileClassName: string;
  onLoaded?: (stats: Stats) => void;
}) {
  /**
   * The in-flight POST, held across mounts.
   *
   * Strict mode runs mount, cleanup, mount. A plain `recorded` boolean makes
   * the second mount skip subscribing as well as fetching, so the result lands
   * nowhere and the tiles sit at "—"; an AbortController in cleanup kills the
   * only request the guard will ever allow. Holding the promise separates the
   * two: `??=` fires it once, every mount attaches its own handlers.
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
        if (!active) return;
        setStats(next);
        onLoaded?.(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
    // `onLoaded` is a render-stable callback from the parent; re-running this
    // on its identity would record a second view per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null;

  return (
    <>
      <Tile
        className={tileClassName}
        label="Visitors"
        value={stats?.visitors}
      />
      <Tile className={tileClassName} label="Views" value={stats?.views} />
    </>
  );
}

function Tile({
  className,
  label,
  value,
}: {
  className: string;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className={className}>
      <p className="font-mono text-2xl tabular-nums min-[380px]:text-3xl sm:text-4xl">
        {/* An em dash while in flight. A zero here would be a measurement. */}
        {value === undefined ? "—" : value.toLocaleString("en-US")}
      </p>
      <p className="mt-2 truncate text-[9px] uppercase tracking-[0.12em] text-muted-foreground min-[380px]:text-[10px] sm:text-[11px] sm:tracking-[0.18em]">
        {label}
      </p>
    </div>
  );
}

export type { Stats as TrafficStatsValue };
