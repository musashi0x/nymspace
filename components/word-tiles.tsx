"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A short lowercase sentence laid out as adjacent solid-colour tiles packed
 * edge to edge into one seamless bar.
 *
 * Two deliberate mechanics:
 *
 * 1. The fly-in reveal is a pure CSS animation (see `word-tile-in` in
 *    globals.css), staggered with `animation-delay`. It is NOT driven from
 *    JS, because the resting state has to be the assembled, readable bar —
 *    otherwise the heading is invisible when the page is prerendered, when
 *    JS fails, or when it loads in a background tab where rAF is parked.
 * 2. The idle shuffle is a single rAF loop writing colours straight to the
 *    nodes, so it never re-renders the React tree. The browser parks rAF
 *    while the tab is hidden, which is what we want — but the timestamps are
 *    then stale on return, so they get rebased rather than firing every tile
 *    at once.
 */

export type Swatch = { bg: string; fg: string };

/** Saturated and slightly clashing on purpose. No muted filler.
 *  The first entry is the neutral one and is theme-aware: near-black on a
 *  light page, near-white on a dark one. A fixed near-black tile disappears
 *  into a dark background and breaks the seamless-bar read. */
const SWATCHES: Swatch[] = [
  { bg: "var(--tile-neutral-bg)", fg: "var(--tile-neutral-fg)" },
  { bg: "#ff2e20", fg: "#0a0a0a" },
  { bg: "#f0c2f7", fg: "#0a0a0a" },
  { bg: "#22e58b", fg: "#0a0a0a" },
  { bg: "#7c4dff", fg: "#ffffff" },
  { bg: "#ffe14d", fg: "#0a0a0a" },
  { bg: "#18b6ff", fg: "#0a0a0a" },
  { bg: "#ff7a1a", fg: "#0a0a0a" },
  { bg: "#ff4fa3", fg: "#0a0a0a" },
];

/** Fixed opening hand, so server and client first paint agree. */
const INITIAL = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const FLY_STAGGER = 120;
const FLY_MS = 720;
const COLOR_MS = 520;
const SHUFFLE_MIN = 1400;
const SHUFFLE_MAX = 3400;

const nextDelay = () =>
  SHUFFLE_MIN + Math.random() * (SHUFFLE_MAX - SHUFFLE_MIN);

function pickSwatch(exclude: (Swatch | undefined)[]): Swatch {
  const free = SWATCHES.filter((s) => !exclude.includes(s));
  const pool = free.length ? free : SWATCHES;
  return pool[(Math.random() * pool.length) | 0];
}

export function WordTiles({
  sentence,
  className,
  ...props
}: React.ComponentProps<"div"> & { sentence: string }) {
  const words = React.useMemo(
    () => sentence.trim().split(/\s+/).filter(Boolean),
    [sentence],
  );

  const tileRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const swatches = React.useRef<(Swatch | undefined)[]>([]);

  const reroll = React.useCallback((index: number) => {
    const el = tileRefs.current[index];
    if (!el) return;
    // Avoid this tile's colour and its immediate neighbours', so the bar never
    // shows two touching tiles in the same swatch.
    const swatch = pickSwatch([
      swatches.current[index],
      swatches.current[index - 1],
      swatches.current[index + 1],
    ]);
    swatches.current[index] = swatch;
    el.style.backgroundColor = swatch.bg;
    el.style.color = swatch.fg;
  }, []);

  React.useEffect(() => {
    // Reduced motion gets the assembled bar and no shuffling at all.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const count = words.length;
    const assembledAt = performance.now() + count * FLY_STAGGER + FLY_MS;
    const nextAt = Array.from({ length: count }, () => assembledAt + nextDelay());

    let raf = 0;
    const loop = () => {
      const now = performance.now();
      for (let i = 0; i < count; i++) {
        if (now < nextAt[i]) continue;
        // Stale by more than a full cycle means the tab was hidden and rAF was
        // parked; rebase instead of firing every tile the moment we return.
        if (now - nextAt[i] > SHUFFLE_MAX) {
          nextAt[i] = now + nextDelay();
        } else {
          reroll(i);
          nextAt[i] = now + nextDelay();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [words.length, reroll]);

  return (
    <div
      data-slot="word-tiles"
      aria-label={sentence}
      role="heading"
      aria-level={1}
      className={cn(
        // Rounded as one unit; the tiles are clipped by it.
        "inline-flex max-w-full overflow-hidden rounded-xl align-middle",
        "font-sans font-semibold tracking-tight",
        "text-[clamp(1.5rem,5.6vw,3.6rem)] leading-none",
        className,
      )}
      {...props}
    >
      {words.map((word, i) => {
        const initial = SWATCHES[INITIAL[i % INITIAL.length]];
        return (
          <span
            key={`${word}-${i}`}
            ref={(el) => {
              tileRefs.current[i] = el;
              if (!swatches.current[i]) swatches.current[i] = initial;
            }}
            onPointerEnter={() => reroll(i)}
            aria-hidden
            className="shrink-0 px-[0.34em] py-[0.3em]"
            style={
              {
                "--tile-index": i,
                backgroundColor: initial.bg,
                color: initial.fg,
                transition: `background-color ${COLOR_MS}ms ease, color ${COLOR_MS}ms ease`,
              } as React.CSSProperties
            }
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}
