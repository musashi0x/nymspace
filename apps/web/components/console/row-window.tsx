"use client";

import { useScrollOverflow } from "@astryxdesign/core/hooks";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The console's vocabulary for "a list longer than a screen".
 *
 * Separate from `primitives.tsx` for one reason: these need `"use client"`,
 * and `primitives.tsx` is imported by the server pages for `Frame`, `Empty`
 * and `Field`. Marking that file would pull the whole console's vocabulary —
 * and with it the screens that import it — across the client boundary to buy
 * one hook. The rule from `primitives.tsx` still holds: a screen file makes no
 * paging decision, it just renders what is here.
 *
 * See openspec/changes/polish-console-ui/design.md D1, D2, D6.
 */

/**
 * How many rows are on screen at once.
 *
 * One definition, imported by every table. Two tables agreeing on 40 by
 * coincidence is two constants that will disagree the first time one of them
 * is tuned.
 */
export const ROW_WINDOW = 40;

/**
 * A window over rows already in the client.
 *
 * The window is taken from the fetched array rather than from a second
 * request. `/v1/activity` takes a `limit` and no cursor, and the response is
 * capped at 100, so a cursor would add a second source of truth for "where am
 * I" in exchange for nothing an operator would notice. See design.md D1 for
 * the alternatives and why they lost.
 *
 * `sentinelRef` belongs on an element rendered *after* the table, never inside
 * it. `FleetTable` scrolls horizontally inside its own wrapper, and a sentinel
 * placed in that wrapper would report on the wrapper's scroll rather than on
 * the operator reaching the end of the list.
 */
export function useRowWindow<T>(rows: readonly T[]) {
  const [count, setCount] = useState(ROW_WINDOW);
  const sentinelRef = useRef<HTMLElement | null>(null);

  const loaded = rows.length;
  const shown = Math.min(count, loaded);
  const hasMore = shown < loaded;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel) return;

    // `rootMargin` extends the window slightly before the sentinel is actually
    // on screen, so the next rows are mounted by the time the operator gets
    // there rather than appearing under their eyes.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((prior) => prior + ROW_WINDOW);
        }
      },
      { rootMargin: "240px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  const visible = useMemo(() => rows.slice(0, shown), [rows, shown]);

  return { visible, hasMore, shown, loaded, sentinelRef };
}

/**
 * The sentinel, and what the window is showing.
 *
 * The count says shown out of *loaded*, never out of some total. `limit: 100`
 * means "at most 100", not "there are 100", and a console that renders the
 * fetch limit as a population count is inventing a number — the same class of
 * error as rendering an absent value as `0`, which `Absent` exists to prevent.
 */
export function RowWindowFooter({
  shown,
  loaded,
  hasMore,
  sentinelRef,
  noun,
}: {
  shown: number;
  loaded: number;
  hasMore: boolean;
  sentinelRef: React.Ref<HTMLElement>;
  /** What one row is, singular. "event", "agent". */
  noun: string;
}) {
  return (
    <VStack ref={sentinelRef} gap={0} paddingBlockStart={3} width="100%">
      {loaded > ROW_WINDOW ? (
        <HStack gap={2} align="center" wrap="wrap">
          <Text type="code" size="2xs" color="secondary" hasTabularNumbers>
            {shown} of {loaded} loaded {noun}
            {loaded === 1 ? "" : "s"} shown
          </Text>
          {hasMore ? (
            <Text type="supporting" size="2xs" color="secondary">
              · scroll for more
            </Text>
          ) : null}
        </HStack>
      ) : null}
    </VStack>
  );
}

/**
 * A region whose scrollbars are concealed and whose overflow still shows.
 *
 * Concealment alone loses two things, and both are restored here rather than
 * left to the caller. Keyboard reach comes free for an Astryx `Table` — its
 * scroll region is already focusable — which is why this component adds no
 * `tabIndex` of its own: a second focusable wrapper around a focusable region
 * is one extra tab stop that scrolls nothing.
 *
 * The other is the signal that content continues, which the bar used to carry.
 * `useScrollOverflow` drives it, and `scrollSelector` exists because the
 * element that actually scrolls is usually not ours — `Table` owns its
 * horizontal wrapper, and the hook has to measure that element rather than the
 * shell around it.
 */
export function ScrollRegion({
  children,
  scrollSelector,
  className,
}: {
  children: React.ReactNode;
  /**
   * The descendant that scrolls. Defaults to the shell itself.
   * `.astryx-table-scroll-wrapper` for an Astryx `Table`.
   */
  scrollSelector?: string;
  /** Additional utilities on the shell — `row-window` for a windowed table. */
  className?: string;
}) {
  const { scrollRef, overflowEnd } = useScrollOverflow();

  const shellRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node) {
        scrollRef(null);
        return;
      }
      // Ref callbacks fire bottom-up, so the table's own wrapper is mounted by
      // the time this runs.
      scrollRef(
        (scrollSelector && node.querySelector<HTMLElement>(scrollSelector)) ||
          node,
      );
    },
    [scrollRef, scrollSelector],
  );

  return (
    <VStack
      ref={shellRef}
      gap={0}
      width="100%"
      className={`scroll-shell scroll-quiet min-w-0${className ? ` ${className}` : ""}`}
      data-overflow-inline={overflowEnd ? "true" : "false"}
    >
      {children}
    </VStack>
  );
}
