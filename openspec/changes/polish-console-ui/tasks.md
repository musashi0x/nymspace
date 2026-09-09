## 1. Token-backed utilities in globals.css

- [x] 1.1 Add a `scroll-quiet` utility to `apps/web/app/globals.css` setting `scrollbar-width: none` and a `::-webkit-scrollbar { display: none }` rule, with a comment stating that `overflow: hidden` is the wrong fix and why (design D3). No literal colour, no pixel value that is not a token.
- [x] 1.2 Add `scroll-edge-right` / `scroll-edge-bottom` fade utilities painted from the frame/background tokens already declared in the theme, so a concealed edge signals continuing content. Reuse the token names the `frame-*` utilities use; declare no new `--color-*` at `:root`.
- [x] 1.3 Add a `row-enter` keyframe and utility: `transform`/`opacity` only, `animation-fill-mode: both`, delay `calc(var(--row-index) * 18ms)` with the stagger capped so a full 40-row window does not exceed the bound set in design D4.
- [x] 1.4 Add a `view-enter` keyframe and utility for the route cross-fade, same fill-mode contract.
- [x] 1.5 Extend the existing `@media (prefers-reduced-motion: reduce)` block to set `animation: none` for `row-enter` and `view-enter` alongside `word-tile-in`.

## 2. Shared primitives

- [ ] 2.1 Export `ROW_WINDOW = 40` from `apps/web/components/console/primitives.tsx` as the single definition of the window size.
- [ ] 2.2 Implement `useRowWindow(rows)` in the same file, returning `{ visible, hasMore, shown, loaded, sentinelRef }`, backed by an `IntersectionObserver` that extends the count by `ROW_WINDOW`. Disconnect the observer on unmount and when `hasMore` goes false.
- [ ] 2.3 Track each row's index *within its arriving batch* so `--row-index` resets per batch, and make `useRowWindow` expose that index for the row renderer.
- [ ] 2.4 Implement `RowWindowFooter` rendering the sentinel plus the shown/loaded count as Astryx `Text`, with copy that describes what was loaded and never asserts a total the server did not send.
- [ ] 2.5 Implement an `Evidence` primitive wrapping `CodeBlock` with `language="json"`, `container="section"`, `isWrapped`, `width="100%"`, and a `maxHeight`; do not nest it in a scroll container.
- [ ] 2.6 Guard serialization inside `Evidence`: `undefined`/`null` renders the existing `Absent` primitive; a `JSON.stringify` throw or an unrepresentable type renders a plaintext fallback plus a statement that it could not be serialized.
- [ ] 2.7 Add a `ScrollRegion` helper that applies `scroll-quiet`, wires `useScrollOverflow` to the edge-fade utilities, and sets `tabIndex={0}` with an accessible name only when the container can actually scroll.

## 3. Activity timeline

- [ ] 3.1 Rewrite `apps/web/components/console/activity-table.tsx` to feed `Table` from `useRowWindow(events).visible` and render `RowWindowFooter` as a sibling below the `Table`, never inside it (design D2).
- [ ] 3.2 Replace `<Field label="Evidence" value={JSON.stringify(row.evidence)} />` in the expanded row with the `Evidence` primitive.
- [ ] 3.3 Apply `row-enter` with the per-batch `--row-index` to arriving rows, leaving rows already on screen untouched.
- [ ] 3.4 Update `apps/web/app/console/activity/page.tsx`'s `Frame` subtitle so it describes the window rather than claiming all fetched events are on screen.

## 4. Fleet table

- [ ] 4.1 Feed `FleetTable`'s `Table` from `useRowWindow(agents).visible` and render `RowWindowFooter` below it, preserving the existing `useTableStickyColumns` plugin.
- [ ] 4.2 Wrap the table's existing horizontal scroll container in `ScrollRegion` so the bottom bar is concealed, the right/bottom edge fade appears, and keyboard scrolling still works with the sticky name column intact.
- [ ] 4.3 Update `apps/web/app/console/page.tsx`'s header count and `Frame` subtitle to match what the window shows.

## 5. Route transition

- [ ] 5.1 Add a client wrapper in `apps/web/app/console/layout.tsx` keyed on `usePathname()` that applies `view-enter` to `{children}`, keeping the server layout otherwise intact and the nav/header outside the animated region.
- [ ] 5.2 Confirm the console still server-renders — the wrapper must not force the whole layout client-side or break `export const dynamic = "force-dynamic"` on the pages beneath it.

## 6. Verification

- [ ] 6.1 `pnpm typecheck` and `pnpm lint` clean.
- [ ] 6.2 Grep the touched files for `style={{`, raw `<div>`/`<span>` layout, and literal hex/px values; the only permitted raw-element file remains `components/console/frame.tsx`.
- [ ] 6.3 With a populated store, load `/console/activity`: confirm exactly 40 rows mount, scrolling to the end appends the next 40, arriving rows animate and existing rows do not, and the count reads correctly at each step.
- [ ] 6.4 Expand an event: evidence renders as indented highlighted JSON, the copy button places the full payload on the clipboard, and long evidence scrolls inside its own bounded height.
- [ ] 6.5 Force an event with `undefined` evidence and one with a cyclic/BigInt payload; confirm `Absent` and the serialization fallback respectively, with no crash.
- [ ] 6.6 At the mobile breakpoint, confirm `FleetTable` scrolls horizontally with no painted bar, the edge fade appears and clears at the end, the sticky name column still pins, and the region is reachable and scrollable by keyboard alone.
- [ ] 6.7 With `prefers-reduced-motion: reduce` set, confirm no animation runs, all content is visible in its resting state, and window extension still works.
- [ ] 6.8 Disable JavaScript and load `/console/activity`: the first window of rows must be fully visible, not stuck at `opacity: 0`.
- [ ] 6.9 Check both themes and re-run the visual pass in a second engine (WebKit and Gecko) to confirm the scrollbar is concealed in each.
