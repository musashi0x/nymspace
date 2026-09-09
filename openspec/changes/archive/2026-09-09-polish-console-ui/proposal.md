## Why

The console renders every row it fetches in one shot — 100 activity events, the whole fleet — inside frames that scroll with the browser's own bars painting hard grey tracks over the dashed `Frame` edge. Nothing moves between states: a page swap is a hard cut, and the newest event appears with no signal that it is new. And the one field carrying the product's actual claim, an activity event's evidence, reaches the screen as `JSON.stringify(row.evidence)` — a single unbroken line, untruncated, unhighlighted, and impossible to copy without selecting it by hand. `docs/09` argues its whole length that provenance is the point; the console currently renders that provenance as the least readable string on the page.

## What Changes

- **Windowed browsing.** Tables render at most 40 rows at a time and extend by 40 as the operator reaches the end of the list, rather than mounting every fetched row at once. Applies to the activity timeline and the fleet table. The fetch itself is unchanged — the window is taken from data already in the client, so there is no new API surface and no store query change.
- **Concealed scroll affordances.** Scroll containers inside the console keep their scrolling and lose their painted bars on the right and bottom edges, in every engine. Keyboard scrolling, wheel, trackpad and the scroll position itself are untouched; only the chrome goes.
- **Motion on entry and on change.** Rows entering a window animate in; a screen transition and a filter or window change cross-fade rather than cutting. Every animation is defeated by `prefers-reduced-motion`, and no animated element starts invisible — the resting state is the readable one, so a page with dead JavaScript still reads.
- **Evidence as a first-class value.** Structured evidence renders as pretty-printed, syntax-highlighted JSON with a copy control, replacing the single-line `JSON.stringify`. A value the operator cannot read or lift out is evidence in name only.
- **Wider Astryx coverage.** The above is built from `@astryxdesign/core` — `CodeBlock`, `useClipboard`, `useScrollOverflow`, `Pagination` where a count belongs — rather than hand-written equivalents, extending the existing rule that Astryx backs every console surface.

## Capabilities

### New Capabilities

- `console-data-browsing`: how the console presents a set of rows larger than a screen — the 40-row window, how it extends, what an operator is told about what they are not seeing, and how structured evidence is rendered and copied.

### Modified Capabilities

- `console-design-system`: adds two rendering requirements the spec does not carry today — scroll affordances are concealed without disabling scrolling, and state changes are animated under a reduced-motion contract with a readable resting state. Extends the existing "one component system" requirement to name the copy and code-display components.

## Impact

- `apps/web/components/console/activity-table.tsx` — windowed rows, evidence rendered through `CodeBlock`.
- `apps/web/components/console/fleet-table.tsx` — windowed rows.
- `apps/web/components/console/primitives.tsx` — new shared window and evidence primitives, so a screen file holds no paging or motion decision.
- `apps/web/app/globals.css` — scrollbar-concealment and motion utilities, token-backed, alongside the existing `frame-*` utilities.
- `apps/web/app/console/activity/page.tsx`, `apps/web/app/console/page.tsx` — subtitle copy stating what the window shows.
- No change to `apps/api`, `@nymspace/store`, or any spec under `api-server`. The window is client-side over the existing response.
- Dependencies unchanged: everything used ships in `@astryxdesign/core` v0.5.4.
