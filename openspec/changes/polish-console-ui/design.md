## Context

The console's data screens are server-rendered and uncached (`export const dynamic = "force-dynamic"`), and each one hands its entire response to an Astryx `Table` in a single pass: `fetchActivity({ limit: 100 })` mounts 100 rows, `fetchAgents()` mounts the whole fleet. `FleetTable` already scrolls horizontally inside its own wrapper because seven columns do not fit a narrow viewport, so the console already owns at least one scroll container whose browser-painted bar cuts across the dashed `Frame` edge that `AGENTS.md` and `openspec/specs/console-design-system` spend their length protecting.

Three constraints shape everything below.

`AGENTS.md` forbids raw `<div>`/`<span>` layout, `style={{…}}`, and any literal colour or pixel value outside the one named `Frame` exception. New visual behaviour therefore lands as token-backed utilities in `app/globals.css` beside the existing `frame-*` and `word-tile-in` rules, not as inline styles.

The existing `word-tile-in` animation is the precedent for how this codebase does motion: a CSS keyframe with `animation-fill-mode: both`, whose **resting state is the readable one**, so the content survives a prerender, a dead-JS page, and a background tab where rAF is parked. Every animation added here follows that shape.

`docs/09` and the `Field` primitive's type union make provenance non-negotiable — a value read from outside the process cannot render without its read time. Evidence is the payload that provenance points at, and it currently renders as `JSON.stringify(row.evidence)`: one line, no wrapping, no copy, and `undefined` when the field is absent.

The paging mechanism and its data source were settled with the requester before this document: infinite scroll that appends, over a client-side window of the response already fetched.

## Goals / Non-Goals

**Goals:**

- One shared vocabulary for "a list longer than a screen" — a 40-row window that extends by 40 — so no screen file decides how many rows it shows.
- Scroll containers keep scrolling and lose their painted bars, without losing keyboard access or the fact that there is more content.
- Entry and change are animated, defeated by `prefers-reduced-motion`, and readable when no animation ever runs.
- Structured evidence is pretty-printed, highlighted, and copyable in one gesture.
- Every piece of the above is an `@astryxdesign/core` component or a token-backed utility.

**Non-Goals:**

- Server-side pagination. `/v1/activity` takes `limit` only; adding a cursor means a store query change, an `api-server` spec delta, and a second source of truth for "what page am I on". The response is capped at 100 (500 hard max) today, so a cursor buys nothing an operator would notice.
- Row virtualization. A 40-row window is the mitigation for mount cost; windowing and virtualizing the same list is two mechanisms for one problem.
- URL-addressable pages. Infinite append has no page number to put in a URL. If deep-linking to a position is wanted later it is a separate change with a different mechanism.
- Touching the landing page, which is still pre-Astryx Tailwind by documented exception.

## Decisions

### D1 — The window is client-side state over the fetched array, not a second fetch

`useRowWindow(rows)` returns `{ visible, hasMore, remaining, sentinelRef }`. It holds a count, starts at `ROW_WINDOW = 40`, and adds `ROW_WINDOW` when the sentinel enters the viewport. `visible` is `rows.slice(0, count)`, passed to `Table`'s `data`.

Why over the alternatives: a cursor API is Non-Goals above. Astryx's own `Pagination` was the other candidate and is rejected for the *primary* mechanism because the requester asked for scroll paging, and because numbered pages over a client-held array advertise a total the server never promised — `limit: 100` means "at most 100", not "there are 100". A count readout ("40 of 100 shown") is the honest version of that affordance and needs no component.

`ROW_WINDOW` is exported from one module. Two tables agreeing on 40 by coincidence is two constants that will disagree later.

### D2 — The sentinel sits below the Table, not inside it

An `IntersectionObserver` sentinel placed inside `Table`'s markup would observe the table's own horizontal scroll wrapper (`FleetTable` has one, via `useTableStickyColumns`) rather than the page. The sentinel is a sibling rendered after the `Table`, observing the default viewport root, so "the operator reached the end of the list" means the end of the list on screen.

Reduced motion does not disable extension — extension is navigation, not decoration. The animation on the arriving rows is what reduced motion turns off.

### D3 — Concealment is `scrollbar-width` plus the WebKit pseudo-element, never `overflow: hidden`

A `scroll-quiet` utility in `globals.css`:

```
scrollbar-width: none;        /* Firefox */
&::-webkit-scrollbar { display: none }  /* WebKit/Blink */
```

`overflow: hidden` was considered and is wrong: it removes the scrolling, not the bar, and turns a scrollable region into a truncated one.

Two consequences follow and are requirements rather than polish. A scroll container with no visible bar is invisible to a keyboard user, so any element carrying `scroll-quiet` that can actually scroll takes `tabIndex={0}` and an accessible name — this is the standard WCAG 2.1.1 treatment for scrollable regions and is *more* necessary once the bar is gone, not less. And a hidden bar removes the only signal that content continues, so `useScrollOverflow` drives a token-backed edge fade on the overflowing side. The fade replaces the information the bar carried; without it, concealment is just hiding data.

### D4 — Motion is CSS keyframes with a readable resting state, following `word-tile-in`

Three utilities, all `transform`/`opacity` only so they stay off the main thread:

- `row-enter` — rows animate in on mount, staggered by a `--row-index` custom property in the same shape `word-tile-in` uses `--tile-index`. The stagger step is small (≈18ms) and **capped**: 40 rows × 120ms would be a 4.8-second entrance, which is not motion, it is a wait. The index used for stagger is the row's position *within its arriving batch*, so batch two starts its stagger at zero rather than at 2.4 seconds.
- `view-enter` — a cross-fade on route change, applied by keying a wrapper on `usePathname()` in the console layout. The React 19 View Transitions route was considered and rejected: Next 16 still exposes it as unstable, and a keyed CSS fade needs no experimental flag and degrades to an instant swap.
- `@media (prefers-reduced-motion: reduce)` sets `animation: none` on all of them, exactly as the existing block does for `word-tile-in`.

`animation-fill-mode: both` on every one of them. A row whose animation never runs must be visible, not stuck at `opacity: 0` — that is the failure mode this codebase already wrote a comment about.

### D5 — Evidence renders through `CodeBlock`, and absence stays absent

`Evidence` primitive: `JSON.stringify(value, null, 2)` into `<CodeBlock language="json" container="section" isWrapped maxHeight={…} width="100%" />`. `container="section"` because the block sits inside a `Frame`-rendered expanded row and a card border inside a dashed frame is two edges arguing. `maxHeight` rather than an outer scroll wrapper — Astryx's own guidance is not to nest a code block in a scrollable container, and it handles the overflow natively.

Two cases the current call gets wrong and this one must not:

- `JSON.stringify(undefined)` returns `undefined` (the value, not the string), and rendering it yields an empty cell that reads as "the evidence is empty" rather than "there is no evidence". Absent evidence renders `Absent`, which is the console's single documented way to say "there is nothing here" and is the italic that cannot be mistaken for a value.
- `JSON.stringify` throws on a cycle and silently drops a `BigInt`. Serialization is guarded, and a payload that cannot be serialized renders as plaintext with a note rather than crashing the row — an event whose evidence is unusual is exactly the event worth seeing.

Copy comes free with `CodeBlock`'s built-in button, which is built on `useClipboard`. Hand-rolling a copy button next to a `<pre>` would be a second implementation of a hook that already exists.

### D6 — The primitives file absorbs all of it

`useRowWindow`, `RowWindowFooter` (the "40 of 100 shown" count and the sentinel), and `Evidence` live in `components/console/primitives.tsx` alongside `Field`, `Absent`, and `Badge`. That file's docstring already states its purpose — the console's shared vocabulary, with the rules in the components rather than in the screens. A screen file that decides its own page size is the drift this placement prevents.

## Risks / Trade-offs

- **Hidden scrollbars reduce discoverability of overflow** → D3's edge fade plus `tabIndex` restores both signals. This is the risk that would make the change a net loss if skipped, so it is spec'd, not left to implementation taste.
- **A 40-row stagger animation janks on a slow machine** → `transform`/`opacity` only, ≈18ms step, per-batch index reset, and a hard cap on total stagger duration. Reduced motion removes it entirely.
- **Infinite append grows the DOM without bound as the operator scrolls** → bounded by the fetch: 100 activity events is at most three extensions. If the fetch limit rises, virtualization becomes a real conversation; today it would be premature.
- **`CodeBlock` pulls a syntax highlighter into the activity route's client bundle** → it is already a workspace dependency at v0.5.4 and only loads on the route that expands rows. Accepted.
- **`scrollbar-width: none` is unsupported on very old WebKit** → the pseudo-element rule covers WebKit/Blink and the property covers Gecko; between them there is no supported engine left uncovered. An engine that honours neither shows a scrollbar, which is the pre-change behaviour.
- **The count readout can only ever describe what was fetched** → the copy says what is shown out of what was loaded, not out of what exists. Claiming a total the server never sent is the same class of error as rendering an absent value as `0`.

## Migration Plan

No data migration, no API change, no schema change — nothing to roll forward or back but the web app. Ship in one deploy; rollback is a revert of `apps/web`. `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @nymspace/api test` gate it; visual verification is the console at `/console` and `/console/activity` with a populated store, checked in both themes and at the mobile breakpoint where `FleetTable`'s horizontal scroll is actually exercised.

## Open Questions

- Does the fleet table need the window at all today? It is capped by real agent count, not by a limit, and 40 agents is not a near-term number. Windowing it is cheap and consistent, and the alternative is two tables that behave differently — resolved in favour of applying it to both, noted here because a reviewer will ask.
- Whether the discover results list (framed cards, deliberately not rows) should also window. Left out of scope: its result set is capped by the `limit` the form sends and its cards are non-uniform by design.

## Implementation notes

Two decisions changed shape when they met the code. Both are recorded here rather than left to the commit log, because the next reader of this document will otherwise look for something that is not there.

**D6 split in two.** `useRowWindow`, `RowWindowFooter` and `ScrollRegion` live in `components/console/row-window.tsx`, not in `primitives.tsx`. They need `"use client"`, and `primitives.tsx` is imported by the server pages for `Frame`, `Field` and `Empty` — marking it would pull the console's whole vocabulary, and the screens importing it, across the client boundary to buy one hook. `Evidence` needs no hook and stayed in `primitives.tsx`. The rule D6 was protecting is unchanged: no screen file decides its own page size.

**D4's stagger is a selector, not a custom property.** Astryx's `Table` exposes no per-row `className` in data-driven mode, so `--row-index` cannot be set on a `<tr>`. The stagger is `.row-window tbody tr:nth-child(40n + k)` instead, which reaches the same place from the other side: the modulo is the window, so what the selector matches is position within the arriving batch, and the reset-per-batch requirement is satisfied by the selector rather than by anything tracking batches. The "existing rows do not re-animate" requirement also falls out for free — a CSS animation runs on mount, and the tables key their rows by id, so appending a batch mounts only the new `<tr>` elements. The first ten of each batch step by 18ms and the rest share a 180ms tail; forty sequential steps would be a wait rather than an entrance.

`ScrollRegion` adds no `tabIndex`. Astryx's table scroll region already carries `tabIndex=0`, `role="group"` and an accessible name, verified in the browser, so the wrapper would only add a tab stop that scrolls nothing. The requirement stands; it is met by the component underneath rather than by this one.
