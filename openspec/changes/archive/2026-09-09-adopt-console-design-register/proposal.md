## Why

Two design guidelines now govern this project, and the codebase satisfies neither.

The first is Astryx, already a dependency. `apps/web/AGENTS.md` states the rules — no `<div>`, components do all layout, tokens for every value, brand belongs in the theme — and `app/globals.css` carries a comment saying "task #82: every new screen is built from `@astryxdesign/core`, not Tailwind utilities". Every console screen contradicts that comment. `components/console/primitives.tsx` builds `Panel` from a `<section>` with `rounded-xl border border-border bg-card/40`, and the four screens under `app/console/` are raw `<div>` flex stacks. Astryx is imported and unused.

The second is the visual register at `mdx-graphs.kshv.me`: Geist Mono at 14/21, tracking +0.02em, tabular figures, an accent trio, and a dashed frame with a bracketed title notched into its top edge. It is not a component library to install — it is a shadcn registry of static figures for MDX prose, with no sorting, selection, or pagination. Its components cannot back a live console. Its *look* can.

The theme that would carry that look already exists and is dead. `apps/web/theme.template.ts` is 328 lines, names Geist Mono as the code family, and sets a custom type scale. Nothing imports `myTheme`, no `<Theme>` wraps the tree, and `globals.css:13` imports `@astryxdesign/theme-neutral/theme.css` instead. The configuration is written and has never applied.

This change wires the theme, builds the one component Astryx has no equivalent for, and rewrites the console's shared vocabulary onto both.

## What Changes

- **A real theme, wired.** `theme.template.ts` becomes an owned theme module, imported and wrapped in `<Theme>` at the app root, replacing the `theme-neutral` CSS import. Its typography scale moves to base 14 to match the reference, `radius.multiplier` goes to 0 for square corners, and `localTokens` defines the frame and accent roles the Frame component consumes.
- **Geist Mono actually loads.** Astryx never loads font files — its own typography doc says so and warns at build time when a theme names a family it cannot verify. The font gets a `<link>` or `@font-face` in `app/layout.tsx` and a metric-similar fallback stack, or the register silently collapses to system mono.
- **A `Frame` component.** The reference frame is CSS, not ASCII art: a dashed border, four absolutely-positioned `+` spans, and a centered `<figcaption>` rendering `[ TITLE ]`, each painted the page background so it punches a gap in the border beneath it. It is a wrapper around arbitrary children, which is what makes this viable — an Astryx `Table` with sorting and selection sits inside it untouched.
- **The console's vocabulary, rebuilt.** `Panel`, `Field`, `Badge`, `Empty`, and `Provenance` in `components/console/primitives.tsx` are reimplemented on Astryx components inside `Frame`. `Panel` becomes `Frame`. `Field` keeps its required `source` and `readAt` props unchanged, because that rule is a product requirement and not a style.
- **Data display rules.** Tables are Astryx `Table` at `density="compact"` with `dividers="rows"`, never a card per row. Numeric columns carry tabular figures. Metrics are label-over-value rows in mono, not oversized display type.
- **A written carve-out.** `AGENTS.md`'s "no `<div>`" is stricter than Astryx's own `docs styling`, which sanctions Tailwind for "page layout, wrappers, and utility styling". `Frame` needs positioned spans and a `<figure>`. The exception is written down and scoped to `Frame`, or the next agent deletes it on sight.

## Capabilities

### New Capabilities

- `console-design-system`: how the console renders, as distinct from what it says. The theme contract and its token roles, font loading, the `Frame` primitive and its background-punch requirement, the data-display rules for tables, lists, and metrics, and the boundary that keeps a design decision out of a screen file.

## Impact

- **Not modified**: `agent-console`. That capability owns what the console asserts — chain-derived permission cells, labelled provenance, a denial rendered as a product state. This change owns how those assertions look. Keeping the seam there also avoids blocking on `implement-agent-fleet-mvp` reaching the archive, since `agent-console` does not yet exist in `openspec/specs/`.
- **Sequencing**: the theme ships before `Frame`, because `Frame` consumes tokens that do not exist until it does. `Frame` ships before the primitives rewrite. The four console screens follow the primitives, not the other way round.
- **New**: an owned theme module and its build output; `Frame` and its parts; a font declaration in `app/layout.tsx`.
- **Modified**: `app/globals.css` drops the `theme-neutral` import; `app/layout.tsx` gains `<Theme>` and the font; `components/console/primitives.tsx` is rewritten; `app/console/*` screens lose their raw layout divs; `AGENTS.md` gains the scoped carve-out.
- **Existing dependency**: `motion@^13.2.0` is already in `apps/web/package.json`, which is the only dependency the reference frame declares. Nothing new is installed.
- **Drift guard**: `theme.template.ts:72` names `scripts/check-theme-template.test.mjs`, a test that fails when the template drifts from `defineTheme`'s fields. Promoting the template to an owned theme must not break it.
- **Risk of doing nothing**: the console keeps accumulating screens in a system the guidelines forbid, and every one is rework.
