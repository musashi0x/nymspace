"use client";

import { useSyncExternalStore } from "react";

// Never fires — the value is constant per environment, so there is nothing to
// subscribe to. Module scope keeps the reference stable across renders, which
// is what stops useSyncExternalStore from re-subscribing on every pass.
const subscribeToNothing = () => () => {};

/**
 * False on the server and through hydration, true on every render after.
 *
 * The `useState` + `useEffect(() => setMounted(true), [])` spelling of this
 * reads the same but schedules a second render pass, which React's
 * `react-hooks/set-state-in-effect` rule flags. `useSyncExternalStore` is given
 * separate server and client snapshots directly, so the two renders differ
 * without a setState round trip.
 *
 * This answers "has the client taken over yet", which is the gate you want when
 * the server cannot know something the browser can — a stored theme, a media
 * query, anything in `localStorage`. It is not a general "is this the browser"
 * check: it is deliberately false during hydration so the first client render
 * still matches the server's HTML.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}
