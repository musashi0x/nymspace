## 1. Store aggregate

- [x] 1.1 Add `ActivitySummary` to `packages/store/src/types.ts`: per-source counts for `pending`, `success`, `denied`, `failed`, a per-source `total`, and an overall `total`
- [x] 1.2 Implement `store.summarizeActivity({ organizationId })` as one `group by source, status` query, pivoted to one row per source, omitting sources with no events, ordered by total descending
- [x] 1.3 Store test against the real Postgres: seed a mix of sources and statuses and assert the pivot; seed more than 500 events and assert the overall total equals `count(*)`
- [x] 1.4 Confirm `schema.test.ts` still passes untouched: no column added, `ALLOWED_COLUMNS` unchanged

## 2. API route

- [x] 2.1 Chain `.get("/summary", …)` onto the activity route in `apps/api/src/routes/activity.ts`, returning `{ bySource, total, readAt }` from `c.var.deps.store`
- [x] 2.2 Route test through `app.ts`'s fetch handler with a fake store: response shape, `readAt` present, denied and failed counts preserved
- [x] 2.3 Document `GET /api/activity/summary` in `docs/10_API_CONTRACT.md` beside `GET /api/activity`

## 3. Web client and dependencies

- [x] 3.1 Read the Next 16 `searchParams` guide in `apps/web/node_modules/next/dist/docs/` before editing `page.tsx`, per `apps/web/AGENTS.md`
- [x] 3.2 `pnpm --filter @nymspace/web add recharts@^3.10.1 react-is@^19`, and confirm the install prints no unmet-peer warning for `recharts`
- [x] 3.3 Derive `fetchActivity`'s filter type in `apps/web/lib/api.ts` from `InferRequestType<typeof api.v1.activity.$get>["query"]`, so `mcp` is accepted and the union cannot drift again
- [x] 3.4 Add `fetchActivitySummary()` to `apps/web/lib/api.ts` through the typed client

## 4. Outcome chart

- [x] 4.1 Create `apps/web/components/console/outcome-chart.tsx` (`"use client"`): `BarChart layout="vertical"` with the `responsive` prop, a fixed height derived from the row count, one `Bar` per status sharing a `stackId`, and each source's total as a label
- [x] 4.2 Fill each status from its token (`--color-success`, `--color-warning`, `--color-error`, and the neutral pair chosen from `astryx docs tokens` for `pending`); show `pending` in the legend only when non-zero
- [x] 4.3 Segment click pushes `?source=&status=` with `scroll: false`; clicking the selected segment clears the filter
- [x] 4.4 With a filter active, draw the selected segment in its full token and every other segment in its `-muted` token
- [x] 4.5 Add the keyboard path: source picker, status picker and clear action from Astryx components (checked with `astryx component <Name>`), writing the same URL as a click
- [x] 4.6 Give the chart an accessible label stating the counts, and disable animation under reduced motion
- [x] 4.7 Self-check against `apps/web/AGENTS.md`: no `<div>` wrapper, no `style={{…}}`, no literal colour; geometry numbers live as named constants
- [x] 4.8 Load the recharts bars lazily (`next/dynamic`, `ssr: false`) from `outcome-chart.tsx`, keep the legend and controls in the first load, reserve the chart height, and re-measure `/console/activity`'s first load against 6.2's figures
  - 2026-09-12: first load 270,267 B gzip (17 chunks): −100,738 B (−27%) against the static import, +26,367 B (+11%) against the pre-change baseline. No first-load chunk contains recharts; it ships as one lazy chunk of 101,837 B gzip. In the browser the click filter still works, and cumulative layout shift is 0 as the bars arrive

## 5. Activity page

- [x] 5.1 In `apps/web/app/console/activity/page.tsx`, read `searchParams`, keep `source` and `status` only when they are in the permitted sets, and drop anything else
- [x] 5.2 Run `fetchActivity(filter)` and `fetchActivitySummary()` in one `Promise.all`; render an `outcomes` `Frame` above the `timeline` `Frame`
- [x] 5.3 When a filter is active, the timeline subtitle names it and describes the loaded count as filtered events
- [x] 5.4 A filter matching no events renders an empty state naming the filter, distinct from "Nothing has happened yet"
- [x] 5.5 A failed summary renders a stated error inside the `outcomes` `Frame` while the timeline still renders
- [x] 5.6 Update `loading.tsx` so its label names both reads

## 6. Verification

- [ ] 6.1 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check` all pass
  - 2026-09-12: typecheck, lint and test pass (store 44, api 155). `pnpm check` fails in `conditions:check` on `@nymspace/api`'s `build` and `start:dist` scripts, both from commit 0c4b75e and untouched here. Spun off as its own task; this box closes when that lands
- [x] 6.2 Record `/console/activity`'s first-load JS size from `next build` before and after the change
  - 2026-09-12: Turbopack prints no size column, so measured from `.next/diagnostics/route-bundle-stats.json`, gzip -9 per first-load chunk. Before 243,900 B gzip (15 chunks), after 371,005 B (17 chunks): +127,105 B, +52%. Other routes grew 0.1–2.4 KB raw each, from the shared `lib/api.ts` chunk. No build warnings for recharts or react-is
- [x] 6.3 In the browser: the chart's counts match the database, selecting Privy-denied shows exactly those rows, a reload keeps the filter, and clearing restores the full timeline
- [ ] 6.4 In the browser: every filter can be set and cleared from the keyboard alone, the chart is correct in light and dark themes, and it renders at rest under reduced motion
  - 2026-09-12: light and dark verified. Arrow keys on the status control set the filter. Enter and Space on "Clear filter" did not activate it in the test harness, but they also failed on the known-good theme toggle, so that is the harness's synthetic keypress, not the button. Clearing by pointer works. Still open: clearing by real keyboard, and reduced motion (relies on recharts' default `isAnimationActive="auto"`, not observed)
- [x] 6.5 Add the outcome summary to the Activity section of `docs/03_UX_SPEC.md`
