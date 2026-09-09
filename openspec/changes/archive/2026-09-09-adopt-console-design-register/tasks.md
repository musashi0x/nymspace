## 1. Theme — ships first, everything else consumes it

- [x] 1.1 Promote `apps/web/theme.template.ts` into an owned theme module at `apps/web/theme.ts`. Note: `scripts/check-theme-template.test.mjs` lives in the Astryx repository, not this one — nothing here enforces template freshness, and the file header now says so
- [x] 1.2 Set `typography.scale` to base 14 with ratio 1.2, matching the reference's 14/21
- [x] 1.3 Confirm `typography.code.family` is Geist Mono and give it a metric-similar fallback stack
- [x] 1.4 Set `radius.multiplier` to 0 for square corners across every component
- [x] 1.5 Map `--graph-accent` to Astryx `--color-accent`; declare `--graph-frame`, `--graph-muted`, and `--graph-faint` as `localTokens`. Leave `--color-data-*` untouched and reserved for charts (design.md Q3)
- [x] 1.6 Add tabular figures and letter-spacing through the theme's `components` block; neither has a token, and neither belongs in a screen
- [x] 1.7 Point the theme at the Geist Mono `next/font/google` variable already loaded in `app/layout.tsx`, and wrap the tree in `<Theme>` through a mount-gated bridge (design.md D8)
- [x] 1.8 Remove the `@astryxdesign/theme-neutral/theme.css` import from `app/globals.css`
- [x] 1.9 Build the theme, per `astryx theme build`, so tokens are static CSS rather than a hydration-time `<style>` tag

**Gate A — the theme is live.** `app/astryx-check/page.tsx` renders in the owned theme, mono text is Geist Mono and not a system fallback, corners are square. Check `app/page.tsx` too: the theme swap repaints the landing page, which nothing else in this change touches.

- **Lies by**: a passing build. A named font that never loads produces no error and no warning at runtime — the page just renders in the fallback. Verify the computed family in the browser, not the token value.

## 2. Frame

- [x] 2.1 Build `Frame` from Astryx `Stack`, `Text`, and `Divider` plus the positioned wrapper elements the notch requires
- [x] 2.2 Render the dashed border, four corner marks, and the bracketed uppercase title, left-anchored and truncating (design.md Q2)
- [x] 2.3 Take the surrounding surface as a prop, defaulting to the page body, and paint the corner marks and title with it (design.md D4, Q1)
- [x] 2.4 Associate the title with the framed region as a caption; hide the corner marks from assistive technology
- [x] 2.5 Assert no literal colour or pixel value appears in `Frame`'s styles
- [x] 2.6 Render an Astryx `Table` with sorting and selection inside `Frame` and confirm both still work
- [x] 2.7 Write the scoped carve-out into `apps/web/AGENTS.md`, naming `Frame` and its parts and stating the reason

**Gate B — Frame is correct on every surface. PASSED.** Extended `app/astryx-check/page.tsx` with a frame on the page body, one inside a Card, and one carrying a runtime-length title. Machine-checked in both modes rather than eyeballed: for all three, the title punch and all four corner marks equal the computed background of the element behind the frame. The striped case named here no longer exists — see D10, which reduced the surface set to opaque colours only.

- **Lies by**: testing on one surface. The reference hardcodes the page background because in MDX a figure only ever sits on the page. A console has three surfaces, and the bug is invisible on the default one.

## 3. Console vocabulary

- [x] 3.1 Replace `Panel` with `Frame`, re-exported from `primitives.tsx` so screens keep one import. The rename touched the four screen files early, ahead of section 4, because a half-renamed tree does not build
- [x] 3.2 Rewrite `Field` on Astryx components. Provenance is now a discriminated union rather than two optional props: passing `source` without `readAt` no longer compiles (D13)
- [x] 3.3 Rewrite `Badge` on Astryx `Badge`, mapping the four tones to theme roles
- [x] 3.4 Rewrite `Empty` so absence stays visually distinct from a zero
- [x] 3.5 Rewrite `Provenance` in the mono register with tabular figures. Also converted `Absent`, `Outcome`, and `Loading`, which the task list missed and Gate C would have failed on
- [x] 3.6 Convert the three `bg-muted/30` inner blocks to nested `Frame`s, each declaring its surface explicitly (design.md Q1)

## 4. Screens

- [x] 4.1 `app/console/page.tsx` — fleet, replacing raw layout divs with Astryx layout
- [x] 4.2 `app/console/agents/[id]/page.tsx` — inspector, the largest file at 331 lines
- [x] 4.3 `app/console/activity/page.tsx` — timeline
- [x] 4.4 `app/console/discover/page.tsx` and `components/console/discover-form.tsx`
- [x] 4.5 `components/console/permission-proof.tsx` and `components/console/task-request.tsx`
- [x] 4.6 Convert every *uniform* record collection to Astryx `Table` at compact density, `dividers="none"`, explicit column widths (design.md Q4). Fleet, activity and the authority matrix became tables; discovery results stayed framed cards, per D17
- [x] 4.7 Confirm no console screen sets a radius, a colour, or a spacing literal

**Gate C — the guideline holds. PASSED.** Scanned `apps/web/app/console/` and `apps/web/components/console/`, excluding `frame.tsx`: zero raw layout elements, zero arbitrary values, zero literal colours, zero inline styles, zero remaining shadcn imports. `pnpm typecheck`, `pnpm lint` and the web build all pass. Every screen verified in the browser against the live API.

- **Lies by**: a grep that passes. Utilities like `p-4` and `gap-3` are token-backed and legal; `p-[13px]` and `bg-[#fff]` are not. The check is for arbitrary values and raw elements, not for Tailwind itself.

## 5. Verification

- [x] 5.1 `pnpm typecheck`
- [x] 5.2 `pnpm lint` — was blocked and is not any more. Next 16 removed `next lint`, so the stale script read its own name as a project directory and nothing in the repo was linted. Fixed separately in `4350c75`, which also replaced this change's `useState`+`useEffect` mount gate with `useMounted` to satisfy `react-hooks/set-state-in-effect`. Passes
- [x] 5.3 `pnpm --filter @nymspace/web build`
- [x] 5.4 Visual pass across all four console screens in light and dark mode
- [x] 5.5 Visual pass on `app/page.tsx`. The theme swap left it alone after all — it renders from shadcn tokens, and only the console shell paints the Astryx body surface, so the landing page is unchanged in both modes
