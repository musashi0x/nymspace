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

- [ ] 2.1 Build `Frame` from Astryx `Stack`, `Text`, and `Divider` plus the positioned wrapper elements the notch requires
- [ ] 2.2 Render the dashed border, four corner marks, and the bracketed uppercase title, left-anchored and truncating (design.md Q2)
- [ ] 2.3 Take the surrounding surface as a prop, defaulting to the page body, and paint the corner marks and title with it (design.md D4, Q1)
- [ ] 2.4 Associate the title with the framed region as a caption; hide the corner marks from assistive technology
- [ ] 2.5 Assert no literal colour or pixel value appears in `Frame`'s styles
- [ ] 2.6 Render an Astryx `Table` with sorting and selection inside `Frame` and confirm both still work
- [ ] 2.7 Write the scoped carve-out into `apps/web/AGENTS.md`, naming `Frame` and its parts and stating the reason

**Gate B — Frame is correct on every surface.** Place one `Frame` on the page body, one inside a card, and one in a striped region. The border must not show through any title or corner mark.

- **Lies by**: testing on one surface. The reference hardcodes the page background because in MDX a figure only ever sits on the page. A console has three surfaces, and the bug is invisible on the default one.

## 3. Console vocabulary

- [ ] 3.1 Rewrite `Panel` as `Frame` in `components/console/primitives.tsx`
- [ ] 3.2 Rewrite `Field` on Astryx components, keeping `source` and `readAt` required
- [ ] 3.3 Rewrite `Badge` on Astryx `Badge`, mapping the four tones to theme roles
- [ ] 3.4 Rewrite `Empty` so absence stays visually distinct from a zero
- [ ] 3.5 Rewrite `Provenance` in the mono register with tabular figures
- [ ] 3.6 Convert the three `bg-muted/30` inner blocks to nested `Frame`s, each declaring its surface explicitly (design.md Q1)

## 4. Screens

- [ ] 4.1 `app/console/page.tsx` — fleet, replacing raw layout divs with Astryx layout
- [ ] 4.2 `app/console/agents/[id]/page.tsx` — inspector, the largest file at 331 lines
- [ ] 4.3 `app/console/activity/page.tsx` — timeline
- [ ] 4.4 `app/console/discover/page.tsx` and `components/console/discover-form.tsx`
- [ ] 4.5 `components/console/permission-proof.tsx` and `components/console/task-request.tsx`
- [ ] 4.6 Convert every record collection to Astryx `Table` at compact density, `dividers="none"`, explicit column widths (design.md Q4)
- [ ] 4.7 Confirm no console screen sets a radius, a colour, or a spacing literal

**Gate C — the guideline holds.** No `<div>` outside `Frame`'s documented parts. No raw hex or pixel value in `apps/web/app/console/` or `apps/web/components/console/`. Every table is rows at compact density. Every chain-derived value still carries its source and read time.

- **Lies by**: a grep that passes. Utilities like `p-4` and `gap-3` are token-backed and legal; `p-[13px]` and `bg-[#fff]` are not. The check is for arbitrary values and raw elements, not for Tailwind itself.

## 5. Verification

- [ ] 5.1 `pnpm typecheck`
- [ ] 5.2 `pnpm lint`
- [ ] 5.3 `pnpm --filter @nymspace/web build`
- [ ] 5.4 Visual pass across all four console screens in light and dark mode
- [ ] 5.5 Visual pass on `app/page.tsx`, which the theme swap changes without this change touching it
