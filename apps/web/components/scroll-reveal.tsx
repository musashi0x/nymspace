"use client";

import * as React from "react";
import {
  VOID,
  clamp,
  curtainSheet,
  glide,
  irisSheet,
  wipeSheet,
  type Sheet,
} from "@/components/scroll-mask";

/**
 * The same mask, opened over real content instead of a photograph.
 *
 * `ScrollMask` reveals an image: it pins a full-screen stage and buys itself a
 * scroll runway to animate across, which is what a hero does. Applied to the
 * console that cost 2.7 viewports of runway and put the fleet table two screens
 * below the fold — the mask was the page, and the page was underneath it.
 *
 * This inverts that. The children stay in normal flow and keep their own
 * height, so nothing is pushed anywhere; only a mask sits over them, and the
 * scroll that opens it is scroll the page already had. The fleet table is the
 * thing being revealed rather than the thing waiting behind the reveal.
 *
 * ## Why it does not start closed
 *
 * A console that renders blank until someone scrolls is a console that looks
 * broken to anyone who does not. `from` is the fraction already open on
 * arrival — enough to read what the screen is — and the rest opens across
 * `distance`. The effect is an entrance, not a gate.
 *
 * ## Reduced motion
 *
 * `prefers-reduced-motion` skips the mask entirely rather than shortening it.
 * A mask is the animation; there is no calmer version of one, and a reader who
 * asked for less motion should get the content, not a slower curtain.
 */

export interface ScrollRevealProps {
  variant?: "iris" | "wipe" | "curtain";
  /** Fraction already open before any scrolling. */
  from?: number;
  /** Scroll distance the rest of the reveal spans, in viewport heights. */
  distance?: number;
  /** Edge softness, as a percentage of the box. */
  feather?: number;
  /** Sweep direction for the wipe variant, in degrees. */
  angle?: number;
  originX?: number;
  originY?: number;
  children: React.ReactNode;
  className?: string;
}

export function ScrollReveal({
  variant = "curtain",
  from = 0.32,
  distance = 0.6,
  feather = 18,
  angle = 108,
  originX = 50,
  originY = 42,
  children,
  className,
}: ScrollRevealProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef(0);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = host.ownerDocument.defaultView;
    if (!view) return;

    if (view.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      host.style.removeProperty("mask-image");
      host.style.removeProperty("-webkit-mask-image");
      return;
    }

    const paint = () => {
      /*
        A scroll-driven reveal on a page that cannot scroll must be open.

        The console fits its viewport whenever the fleet is short — three agents
        is 863px against an 863px window — so `scrollY` is pinned at 0 and the
        mask stops at `from` forever. Half a table, permanently, with no way for
        a reader to discover the other half. The reveal is an entrance for a
        page long enough to have one; where there is no runway there is nothing
        to reveal.
      */
      const runway =
        host.ownerDocument.documentElement.scrollHeight - view.innerHeight;
      if (runway < 40) {
        host.style.removeProperty("mask-image");
        host.style.removeProperty("-webkit-mask-image");
        return;
      }

      const span = Math.max(1, Math.min(runway, view.innerHeight * Math.max(0.15, distance)));
      const scrolled = clamp(view.scrollY / span, 0, 1);
      const open = clamp(from, 0, 1) + (1 - clamp(from, 0, 1)) * glide(scrolled);

      // Fully open means no mask at all. Leaving a 100%-open gradient in place
      // keeps the element on its own composited layer for the rest of the
      // session, which costs memory and blurs text on some GPUs.
      if (open >= 0.999) {
        host.style.removeProperty("mask-image");
        host.style.removeProperty("-webkit-mask-image");
        return;
      }

      let sheet: Sheet;
      if (variant === "wipe") sheet = wipeSheet(open, feather, angle);
      else if (variant === "iris")
        sheet = irisSheet(open, feather, originX, originY);
      else sheet = curtainSheet(open, feather);
      if (sheet === VOID) sheet = { ...VOID };

      for (const prefix of ["-webkit-mask", "mask"]) {
        host.style.setProperty(`${prefix}-image`, sheet.image);
        host.style.setProperty(`${prefix}-size`, sheet.size);
        host.style.setProperty(`${prefix}-position`, sheet.position);
        host.style.setProperty(`${prefix}-repeat`, "no-repeat");
      }
    };

    const wake = () => {
      if (frame.current) return;
      frame.current = view.requestAnimationFrame(() => {
        frame.current = 0;
        paint();
      });
    };

    paint();
    view.addEventListener("scroll", wake, { passive: true });
    view.addEventListener("resize", wake);

    return () => {
      if (frame.current) view.cancelAnimationFrame(frame.current);
      frame.current = 0;
      view.removeEventListener("scroll", wake);
      view.removeEventListener("resize", wake);
    };
  }, [variant, from, distance, feather, angle, originX, originY]);

  return (
    <div ref={hostRef} className={className}>
      {children}
    </div>
  );
}

export default ScrollReveal;
