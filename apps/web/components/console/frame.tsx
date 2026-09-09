import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * The console's framed surface.
 *
 * A dashed edge, four corner marks, and a bracketed title that appears notched
 * into the top edge. The register is `mdx-graphs.kshv.me`; the implementation
 * is Astryx, and nothing from that registry is installed. See
 * `openspec/changes/adopt-console-design-register/design.md` D1.
 *
 * This is the one component in the console permitted raw layout elements. The
 * notch cannot be built from `VStack` alone: it needs absolutely positioned
 * children that paint over the edge, and Astryx has no primitive that does
 * that. `AGENTS.md` records the carve-out by name. Everything else here is a
 * component or a token-backed utility, and no value in this file is a literal
 * colour or pixel.
 */

/**
 * Which surface this frame sits on.
 *
 * The corner marks and the title paint this colour to erase the edge beneath
 * them, so it has to match what is actually behind the frame. The reference
 * hardcodes the page background because in prose a figure only ever sits on
 * the page; a console has more than one surface, and the failure is invisible
 * on the default one. Only opaque surfaces are offered, and the utility that
 * punches the edge is the same one that paints the surface, so the two cannot
 * drift apart — see globals.css.
 */
type FrameSurface = "body" | "card";

const SURFACE: Record<FrameSurface, string> = {
  body: "surface-body",
  card: "surface-card",
};

/**
 * The corner marks are decoration. They carry no information the title and the
 * edge do not already carry, so they are hidden from assistive technology and
 * from the pointer.
 */
function Corners({ punch }: { punch: string }) {
  const corner = cn(
    "pointer-events-none absolute z-10 flex size-4 select-none items-center justify-center",
    "font-mono text-sm leading-none frame-ink",
    punch,
  );

  return (
    <>
      <span aria-hidden className={cn(corner, "top-0 left-0 -translate-x-1/2 -translate-y-1/2")}>+</span>
      <span aria-hidden className={cn(corner, "top-0 right-0 translate-x-1/2 -translate-y-1/2")}>+</span>
      <span aria-hidden className={cn(corner, "bottom-0 left-0 -translate-x-1/2 translate-y-1/2")}>+</span>
      <span aria-hidden className={cn(corner, "bottom-0 right-0 translate-x-1/2 translate-y-1/2")}>+</span>
    </>
  );
}

export function Frame({
  id,
  title,
  subtitle,
  surface = "body",
  children,
  className,
}: {
  /** An anchor target, so a fleet card can link straight to a section. */
  id?: string;
  title: string;
  subtitle?: string;
  surface?: FrameSurface;
  children: ReactNode;
  className?: string;
}) {
  const punch = SURFACE[surface];

  return (
    <VStack
      as="figure"
      id={id}
      gap={0}
      // `w-full` because a <figure> inside a flex parent with `align-items:
      // start` shrinks to its content, which silently produced a 131px-wide
      // frame around a short title during Gate B.
      // `min-w-0` alongside `w-full`: a flex item defaults to `min-width:
      // auto`, so a wide child — a table with seven columns, say — pushes the
      // frame past its container instead of scrolling inside it. Found when
      // the fleet table dragged the frame's right edge off screen.
      className={cn("frame-edge relative w-full min-w-0", className)}
    >
      {/*
        Left-anchored rather than centred, which is where this departs from the
        reference. The reference centres a `whitespace-nowrap` caption because
        its titles are short static labels; the console passes runtime strings
        such as an activity event's summary, and a centred nowrap caption
        overflows both edges of its own frame. See design.md Q2.

        The figcaption is the positioned box and paints nothing — it only
        constrains the width between the two top corner marks. The span inside
        it shrinks to its content and carries the punch, so the edge is erased
        under the title and nowhere else.
      */}
      <figcaption className="absolute top-0 right-4 left-4 z-10 flex -translate-y-1/2">
        <span className={cn("flex min-w-0 items-baseline gap-2 px-2", punch)}>
          <Text type="label" color="accent" maxLines={1}>
            [ {title} ]
          </Text>
        </span>
      </figcaption>

      <Corners punch={punch} />

      <VStack gap={4} paddingInline={5} paddingBlock={6} width="100%" className="min-w-0 max-w-full">
        {subtitle ? (
          <Text type="supporting" as="p">
            {subtitle}
          </Text>
        ) : null}
        {children}
      </VStack>
    </VStack>
  );
}
