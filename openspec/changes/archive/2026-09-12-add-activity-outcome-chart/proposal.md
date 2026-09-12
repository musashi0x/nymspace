## Why

The activity timeline answers "what happened next" and nothing else. It is a table of the newest hundred events, and the one question an operator or a demo audience asks first — what is the fleet actually doing, and how much of it was stopped — can only be answered by reading rows.

That question is the product's claim. The code says it in three places: a denial is the evidence, not the exception. The local log today holds 103 events across five sources, and 22 of them are denials (18 from Privy, 4 from ENS). Nothing on the page says so. A chart of outcome by source makes the claim visible in one glance, and gives the table a way in: select the denied Privy segment and read the eighteen events behind it.

The obvious version is wrong in a way worth naming. The page loads `limit: 100` and the log holds 103, so a chart counted from the loaded rows would undercount on day one and say nothing about it — the fabricated-state failure `agent-console` forbids. The counts have to come from the server, over the whole log.

## What Changes

- **A summary endpoint.** `GET /v1/activity/summary` returns event counts grouped by source and status over every event in the organization, with `readAt`. It is chained onto the existing activity route, so it is part of `AppType`.
- **A store aggregate.** `@nymspace/store` gains `summarizeActivity()`, a `group by source, status` over `activity_events`. No new column, no migration, `ALLOWED_COLUMNS` untouched.
- **An outcomes panel on `/console/activity`.** Above the timeline, a horizontal stacked bar per source with one segment per status, drawn with `recharts`.
- **The chart filters the timeline through the URL.** Selecting a segment sets `?source=&status=`; the page re-fetches the timeline on the server with that filter. The filtered view survives a reload and can be shared as a link. The chart itself always shows the whole log, with the selected segment emphasised and the rest muted.
- **A keyboard path that does not depend on the chart.** Recharts' accessibility layer moves a tooltip on arrow keys but never activates a segment, so explicit filter controls sit beside the chart and write the same URL state.
- **Status colours are the badge colours.** Segments use the same Astryx status tokens the timeline's `Badge` uses, so a denied bar and a denied badge are one colour in both themes.
- **Dependencies.** `apps/web` adds `recharts@^3.10.1` and an explicit `react-is@^19`.
- **Drift fix.** `fetchActivity`'s hand-written `source` union in `apps/web/lib/api.ts` omits `mcp`, which the API accepts. The filter type is derived from the API's own request type instead, so it cannot drift again.

## Capabilities

### New Capabilities

None. Every requirement lands in an existing capability.

### Modified Capabilities

- `agent-console`: the activity timeline opens on an outcome summary counted over the whole log, and the summary filters the timeline through URL state, with a keyboard path and an honest statement of the active filter.
- `api-server`: the product contract gains an activity summary computed over every event rather than over a page.
- `console-design-system`: charts, which Astryx ships no component for, are drawn with one library and coloured only with theme tokens, status encoded with the status tokens.

## Impact

- **API**: `apps/api/src/routes/activity.ts` (new chained route), route tests against `app.ts`.
- **Store**: `packages/store/src/store.ts` and `types.ts` (`summarizeActivity`, `ActivitySummary`), a store test against the real Postgres.
- **Web**: `app/console/activity/page.tsx` (reads `searchParams`, two reads in parallel), a new `components/console/outcome-chart.tsx` client component, `lib/api.ts`, `loading.tsx`.
- **Dependencies**: `recharts` brings `@reduxjs/toolkit`, `immer`, `victory-vendor` (d3) into the client bundle. Only `/console/activity` imports it, so Next scopes the cost to that route.
- **Docs**: `docs/10_API_CONTRACT.md` gains the summary endpoint; `docs/03_UX_SPEC.md`'s Activity section gains the outcome summary.
- **Unaffected**: no schema change, no migration, no environment variable, so `pnpm env:check` and `conditions:check` are untouched.
