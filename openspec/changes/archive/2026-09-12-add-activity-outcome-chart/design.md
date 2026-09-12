## Context

`/console/activity` is a server component that calls `fetchActivity({ limit: 100 })` and hands the rows to `ActivityTable`, a client component that windows them forty at a time. The API route (`apps/api/src/routes/activity.ts`) filters by agent, source, type and status, capped at 500. The log is `activity_events`, with an index on `(source, type, status)`.

Local data on 2026-09-12: 103 events, five agents, five sources, two active days (90 events on 2026-09-09, 13 on 2026-09-11). By source and status:

```text
source    success  denied  failed
privy        41      18      —
ens          26       4      —
graph         5       —      3
erc8004       3       —      —
mcp           1       —      2
```

A time series over that is two spikes and a gap. Outcome by source reads cleanly even on a sparse log, and it foregrounds denials, which is what the page's own comments call the evidence.

Astryx ships no chart component. Its own `dashboard` and `dashboard-alert-rail` templates draw charts with `recharts` and colour them with `var(--color-*)` strings passed straight into `fill`/`stroke`.

## Goals / Non-Goals

**Goals:**

- Show outcome by source over the whole log, counted on the server.
- Let the chart filter the timeline, with the filter in the URL and applied on the server.
- Give keyboard users the same filters without relying on the chart.
- Colour status exactly as the timeline's badges do, in both themes.

**Non-Goals:**

- A time-series chart. It becomes worth drawing when the log spans more than a handful of days.
- Per-agent summaries on the agent inspector. The endpoint takes no filter in this change; adding `agent` later is additive.
- Filtering by `type` or `agent` from the chart. The URL carries only what the chart can set.
- Chart unit tests in `apps/web`, which has no test suite. The chart is verified in the browser.

## Decisions

### D1 — Counts come from the server, over the whole log

`store.summarizeActivity({ organizationId })` runs one `select source, status, count(*) … group by source, status`, pivots it into one row per source, omits sources with no events, and orders by total descending. The route returns:

```text
{
  bySource: [{ source: "privy", success: 41, denied: 18, failed: 0, pending: 0, total: 59 }, …],
  total: 103,
  readAt: "…"
}
```

Pivoting on the server means the client receives exactly the rows the chart draws and does no arithmetic that could disagree with the database.

*Alternative rejected:* counting the rows the page already loaded. The page loads 100 of 103 events, so the chart would undercount from the first day and never say so. That breaks `agent-console`'s "never fabricates state" and `console-data-browsing`'s rule that a list must not imply a total the server did not send.

`readAt` is carried for parity with `/v1/activity`, even though the store is not an external source: the two responses sit side by side on one screen.

### D2 — The filter lives in the URL and is applied by the server

Selecting a segment calls `router.push("?source=privy&status=denied", { scroll: false })`. `page.tsx` reads `searchParams`, validates both against the permitted sets, and passes them to `fetchActivity`. The timeline is always a server read of the filtered log, never a client-side filter over the hundred rows already on the page.

An unrecognised value is dropped before the fetch: the page renders the unfiltered timeline and does not display the value as an active filter. Passing it through would make the API's zod validation return a 400 and turn a hand-edited URL into an error page.

Next 16 changed `searchParams` (it is a promise in the App Router), and `apps/web/AGENTS.md` requires reading the bundled docs in `node_modules/next/dist/docs/` before touching it. That read is task 3.1, not an assumption made here.

*Alternative rejected:* React state in the chart component. It could only filter loaded rows (see D1), it would not survive a reload, and it could not be shared as a link.

### D3 — The chart ignores its own filter

The summary is always fetched unfiltered. With a filter active, the selected segment keeps its full token colour and every other segment switches to its `-muted` variant. Selecting the selected segment again clears the filter.

*Alternative rejected:* a chart that reflects the filter. Selecting Privy-denied would collapse it to one bar, and the context that made the segment interesting would vanish at the moment it is selected.

### D4 — A keyboard path beside the chart, not inside it

Recharts 3 enables `accessibilityLayer` by default: `role="application"`, `tabIndex={0}`, and ArrowLeft/ArrowRight move the tooltip between categories. No key activates a bar's `onClick`. A keyboard user can read the chart but not filter with it.

So the outcomes panel carries explicit controls — a source picker, a status picker, and a clear action, built from Astryx components (confirmed with `astryx component <Name>` at implementation) — which write the same URL as a segment click. The chart is the pointer shortcut; the controls are the path that always works. The chart also carries an accessible label stating the counts, and the panel's subtitle states the totals in text.

### D5 — `recharts`, pinned, with its peer declared

`recharts@^3.10.1` supports React 19 in its peer range. It is the library Astryx's own dashboard templates use, so later charts on the fleet or agent pages share it instead of adding a second one.

It declares `react-is` as a peer. The only copy in the pnpm store today is `react-is@16.13.1`, pulled in transitively, and pnpm reports an unmet peer as a warning, not an error — the same shape as the eslint pin in `CLAUDE.md`, where the break only shows at runtime. `apps/web` therefore adds `react-is@^19` explicitly.

The chart is a `"use client"` component; the fetch stays in `page.tsx`, as `ActivityTable` already does. It uses the `responsive` prop with a fixed height derived from the number of source rows, so the panel reserves its space before the browser measures it and nothing below it moves. Animation is disabled when the operator requests reduced motion.

**The bars are lazily loaded.** Imported statically, recharts added 127,105 bytes gzipped to `/console/activity`'s first load, from 243,900 to 371,005 (+52%, measured from `.next/diagnostics/route-bundle-stats.json`). So the chart is split in three:

```text
outcome-status.ts   types, status → StatusDot variant, chart height        no recharts
outcome-chart.tsx   legend, filter controls, reserved-height slot          loads with the page
outcome-bars.tsx    BarChart, Cell, Tooltip                                next/dynamic, ssr: false
```

The controls stay in the first load, so the keyboard path works before the bars arrive. The slot's height comes from the same `chartHeight(rows)` the bars use, so their arrival moves nothing. While they load, the slot shows the console's `Loading` spinner, naming what it is drawing, and no skeleton bars, per `docs/03`'s rule against placeholders shaped like the answer. `ssr: false` gives nothing up: recharts measures its container in the browser and draws nothing on the server.

`next/dynamic` with `ssr: false` must sit in a client component. Called from `page.tsx`, a server component, it is an error. That is why the dynamic import lives in `outcome-chart.tsx`.

### D6 — Status is encoded with status tokens

| status  | segment fill            | muted fill                    | Badge tone |
|---------|-------------------------|-------------------------------|------------|
| success | `var(--color-success)`  | `var(--color-success-muted)`  | `good`     |
| denied  | `var(--color-warning)`  | `var(--color-warning-muted)`  | `warn`     |
| failed  | `var(--color-error)`    | `var(--color-error-muted)`    | `bad`      |
| pending | neutral token, chosen from `astryx docs tokens` at implementation | its muted pair | `neutral` |

`var()` references resolve in SVG `fill`, so a theme switch recolours the chart with no JavaScript and no `useTheme` call. The categorical `--color-data-*` palette is rejected because status carries meaning, and the timeline has already assigned it colours.

Recharts takes geometry — height, bar size, margins — as numbers. Those are chart configuration, not CSS: they live as named constants in the component, and no `style={{…}}` or literal colour appears. The wrapper around the chart is an Astryx layout component, not a `<div>`.

### D7 — The web client's filter type is derived, not restated

`lib/api.ts` currently restates the source union by hand and has already drifted: it omits `mcp`. The filter parameter becomes `InferRequestType<typeof api.v1.activity.$get>["query"]`, derived from the route's zod schema through the `hc` client, so the next source added to the API reaches the web client at typecheck. `fetchActivitySummary()` is added beside it.

## Risks / Trade-offs

- [Bundle weight: redux toolkit, immer and d3 arrive with recharts] → Measured at +127 KB gzipped on the route's first load, the chart is now lazily loaded (D5). First load is 270,267 bytes gzipped, +26 KB over the pre-change page, which is the controls, the legend and the summary wiring. Recharts ships separately as one 102 KB chunk fetched after the page renders.
- [Chart and table are two reads, and an event can land between them] → Both run in one `Promise.all` in the same server render, each carries `readAt`, and the panel's totals come from the summary alone. A one-event skew for one render is accepted.
- [Small sources are hard to see next to large ones: `mcp` has 3 events beside Privy's 59] → Every bar carries its count as a label, and the keyboard controls list every source regardless of bar width.
- [A filter that matches nothing reads as a broken page] → A filtered timeline with no rows gets its own empty state naming the filter, distinct from "nothing has happened yet".
- [The summary fails while the timeline succeeds] → The outcomes panel states the error and the timeline still renders, per `api-server`'s "an unreachable API degrades rather than crashes".
- [Recharts measures in the browser, so the server render has no bars] → The fixed height reserves the space; bars appear on hydration without shifting the table.

## Migration Plan

Additive. No schema change, no migration, no new environment variable. Rollback is reverting the change; the timeline's existing behaviour is untouched when no `searchParams` are present.

## Open Questions

- Which neutral token pair represents `pending`. No pending events exist today, so the choice is made against `astryx docs tokens` at implementation, and the legend shows `pending` only when a count is non-zero.
