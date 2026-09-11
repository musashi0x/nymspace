"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoudBurst } from "./engine";
import {
  FONT_CSS,
  FONT_WEIGHT,
  FPS,
  INK,
  INK_DARK,
  PAPER,
  PAPER_DARK,
  SENTENCES,
  TICKS,
} from "./params";

/**
 * The landing page's opening: one cycle of the burst loop, then the page.
 *
 * Three decisions worth knowing before editing this file.
 *
 * **It is server-rendered.** The overlay is in the HTML the server sends, so
 * the first paint is paper rather than the page with a curtain dropped over it
 * a moment later. That is the whole difference between a preloader and a
 * flash of content.
 *
 * **It can never trap the page.** A preloader is the one component that fails
 * closed into a blank screen: if the engine throws, the font never resolves,
 * or the bundle does not execute at all, the overlay would sit there forever
 * over a perfectly good page. So there are three independent exits — the
 * cycle ending, a hard timeout, and a CSS animation in `globals.css` that runs
 * with no JavaScript at all.
 *
 * **It plays on arrival, not on every render.** A module-level flag, not
 * storage: a full page load is an arrival and gets the animation, a
 * client-side navigation back from `/console` is not and does not. Reloading
 * the tab arrives again, which is what someone showing the site to a room
 * expects.
 */

/** Reset by a real page load; survives client-side navigation. */
let arrived = false;

/** One cycle, plus the fade. */
const CYCLE_MS = (TICKS / FPS) * 1000;
const FADE_MS = 420;

/** Long enough to load a font, short enough not to feel broken. */
const FONT_WAIT_MS = 350;

/**
 * The last exit, derived rather than typed.
 *
 * It has to outlast a full cycle plus the wait for a font, and undercut the
 * CSS failsafe, so that the ordinary case is JavaScript's and the CSS only
 * ever covers a dead bundle. Writing it as a number meant that lowering `FPS`
 * silently moved the cycle past it and the overlay was yanked mid-burst —
 * which is exactly what happened the first time this loop was slowed down.
 *
 * The remaining hand-kept invariant is the CSS delay in `globals.css`, which
 * must stay above this total.
 */
const HARD_STOP_MS = CYCLE_MS + FONT_WAIT_MS + 900;

/** Reduced motion gets the still frame, held long enough to read. */
const STILL_MS = 700;

export function LandingPreloader() {
  const [visible, setVisible] = useState(() => !arrived);
  const [leaving, setLeaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    arrived = true;
    setLeaving(true);
    window.setTimeout(() => setVisible(false), FADE_MS);
  }, []);

  useEffect(() => {
    if (!visible) return;
    arrived = true;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dark = document.documentElement.classList.contains("dark");
    const skin = dark
      ? { paper: PAPER_DARK, ink: INK_DARK }
      : { paper: PAPER, ink: INK };

    let engine: LoudBurst | null = null;
    let started = false;
    let ro: ResizeObserver | null = null;

    /**
     * Canvas wants a family name, not a custom property.
     *
     * `ctx.font = '600 40px var(--font-geist-sans)'` is an invalid font string:
     * the assignment is ignored, the context keeps 10px sans-serif, and every
     * `measureText` in the layout returns widths for a typeface that is not the
     * one being drawn. Resolving the variable through a probe element is what
     * keeps the measured layout and the painted glyphs the same font.
     */
    const resolveFamily = (): string => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden";
      probe.style.fontFamily = FONT_CSS;
      probe.textContent = "Ag";
      document.body.appendChild(probe);
      const fam = getComputedStyle(probe)
        .fontFamily.split(",")[0]
        .replace(/["']/g, "")
        .trim();
      probe.remove();
      return fam;
    };

    const startEngine = (family?: string) => {
      if (started || doneRef.current || !canvasRef.current) return;
      started = true;
      engine = new LoudBurst(canvas, {
        ...(family && { font: `"${family}", sans-serif` }),
        skin,
        // A different sentence per arrival. The jitter inside a sentence stays
        // seeded, so each one still plays identically to itself.
        sentence: Math.floor(Math.random() * SENTENCES.length),
        loop: false,
        onCycle: finish,
      });
      if (!engine.ok) {
        finish();
        return;
      }
      /**
       * The canvas is the viewport, and the viewport is not settled at mount.
       *
       * A ResizeObserver rather than a window listener: it fires once on
       * observe, which is what guarantees the bitmap matches the element even
       * when the first measurement was taken before layout — and it also
       * covers the mobile address bar collapsing mid-animation, which changes
       * the element's height without a resize event.
       */
      ro = new ResizeObserver(() => engine?.resize());
      ro.observe(canvas);

      if (reduced) {
        engine.renderStill();
        window.setTimeout(finish, STILL_MS);
        return;
      }
      engine.start();
    };

    const hasFontApi = "fonts" in document && !!document.fonts;
    const raf = requestAnimationFrame(() => {
      const family = hasFontApi ? resolveFamily() : "";
      if (hasFontApi && family) {
        // Whichever comes first: the font, or the patience for it. A webfont
        // that never arrives must not hold the page behind a blank sheet.
        const late = window.setTimeout(() => startEngine(family), FONT_WAIT_MS);
        const go = () => {
          window.clearTimeout(late);
          startEngine(family);
        };
        document.fonts.load(`${FONT_WEIGHT} 1em "${family}"`).then(go, go);
      } else {
        startEngine();
      }
    });

    const hardStop = window.setTimeout(finish, HARD_STOP_MS);

    // Anyone who touches anything has stopped waiting for the animation.
    const skip = () => finish();
    window.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("wheel", skip, { once: true, passive: true });

    // The overlay covers the viewport; a scroll underneath it would land the
    // reader somewhere they did not choose.
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hardStop);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("wheel", skip);
      root.style.overflow = prevOverflow;
      ro?.disconnect();
      engine?.destroy();
    };
  }, [visible, finish]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      data-preloader
      className={[
        "preloader-shell fixed inset-0 z-[100] bg-[#fdfdfd] dark:bg-[#0e0e0e]",
        "transition-opacity ease-out motion-reduce:transition-none",
        leaving ? "pointer-events-none opacity-0" : "opacity-100",
      ].join(" ")}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <canvas ref={canvasRef} aria-hidden className="h-full w-full" />
    </div>
  );
}
