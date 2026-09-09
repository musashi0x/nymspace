## Context

Two guidelines arrived together and they overlap rather than compose. Both cover lists, tables, and metrics. Astryx ships `Table`, `List`, `ListItem`, `Item`, `ProgressBar`, `StatusDot`, and three dashboard templates. Markdown Graphs ships `GraphTable`, `GraphSheet`, `GraphSpec`, `GraphStat`, `GraphKpi`, `GraphMeter`, and `GraphRank`. Choosing both as implementations would mean two component systems, two token vocabularies, and two resets in one app.

They are also architecturally incompatible. Astryx renders custom elements (`astryx-table`), ships its own reset, and its rulebook forbids raw CSS values. Markdown Graphs is copied in through the shadcn registry as Tailwind-classed React source with its own `--graph-*` tokens. Its own `llms.txt` scopes it to prose: "at most two figures, with prose between them", for a refactor writeup, an incident, a PR. It has no interaction model at all — every figure takes static props.

So the resolution is a split by role, not by surface area. Astryx is the implementation. Markdown Graphs is the visual target. Nothing from its registry is installed.

The decisive fact, found by reading `r/graph-table.json`, is that the frame is not ASCII art. `graph-frame.tsx` renders a dashed CSS border, four absolutely-positioned `<span>` elements holding a `+`, and a `<figcaption>` at `top-0 left-1/2` translated up by half its height. The corner marks and the title each carry `bg-background`, which is how they appear to notch the border: they paint over it. Because the frame is a wrapper around `GraphBody`, arbitrary children go inside, and a fully interactive Astryx `Table` is a legal child.

The third fact is that the theme is dead. `apps/web/theme.template.ts` already configures Geist Mono and a custom scale across 328 lines. Nothing imports `myTheme`. No `<Theme>` exists in the tree. `globals.css:13` imports `@astryxdesign/theme-neutral/theme.css`, so `theme-neutral`'s tokens are what actually render. Every trait in the target register that a theme could carry is already written and has never applied once.

## Goals / Non-Goals

**Goals:**

- One component system. Every interactive surface is Astryx; nothing from the shadcn registry is copied in.
- The visual register survives the translation. Mono, tabular figures, dense rows, square corners, hairline rules, and the dashed frame with its bracketed title.
- Design decisions live in the theme and in `Frame`, not scattered across screen files. A screen should not be able to choose a radius.
- The rewrite preserves every product rule the current primitives encode, especially `Field`'s required `source` and `readAt`.
- The carve-out that makes `Frame` legal is written where the next agent reads it.

**Non-Goals:**

- Installing any Markdown Graphs component. Not `graph-table`, not `all.json`, not the skill.
- Reproducing the reference's chart figures — Rank, Bars, Spark, Activity, Heatmap. The console has no charts today. If it grows one, that is a separate decision against Astryx's `--color-data-*` roles.
- Restyling the landing page at `app/page.tsx`. It is pre-Astryx Tailwind, `AGENTS.md` already notes it as such, and it is not a console surface.
- A general theme-authoring workflow. One theme, owned, built.

## Decisions

**D1: Astryx implements, Markdown Graphs specifies the look.**
The two guidelines target the same components, so one has to lose the implementation role. Astryx wins it because it is already a dependency, already imported in `globals.css`, already mandated by `AGENTS.md`, and it is the only one of the two with sorting, selection, pagination, and an empty state. *Alternative considered:* install the shadcn registry for read-only surfaces and use Astryx for interactive ones. Rejected — the seam would fall inside a single screen, and two resets would fight over the same page.

**D2: The register is carried by the theme wherever a theme can carry it.**
`AGENTS.md` forbids overriding `--color-*` in `:root`, and Astryx's theme has the exact fields the target needs: `typography.scale` for 14/1.2, `typography.code.family` for Geist Mono, `radius.multiplier: 0` for square corners, `colors` for the accents, and `localTokens` for theme-local roles. Traits with no token — tabular figures and +0.02em tracking — go in the theme's `components` block, which emits scoped CSS per component, rather than into a screen. *Alternative considered:* a stylesheet of `--graph-*` variables next to `globals.css`. Rejected as exactly the `:root` override the rulebook names.

**D3: `Frame` is ours, and it consumes tokens rather than defining them.**
Astryx has no bracketed-frame equivalent — `Card` gives a header, not a notched edge. `Frame` is written from Astryx `Stack`, `Text`, and `Divider` plus positioned wrapper elements. It defines no color of its own; every value is a token the theme supplies. This is what makes the sequencing forced: the theme must ship first or `Frame` renders against variables that do not exist.

**D4: The background punch is a prop, not a constant.**
The reference hardcodes `bg-background` on the corner marks and the title because in MDX a figure always sits on the page. In a console, `Frame` will sit on a card, inside a striped section, and on the page body. If the punch color is baked in, the border shows through the title on any surface but one. `Frame` takes the surrounding surface as a prop with the page body as its default. This is the single most likely thing to be got wrong and the least likely to be noticed in review.

**D5: `Frame` gets a written carve-out from the no-`<div>` rule.**
Astryx's own `docs styling` lists Tailwind utilities as the sanctioned approach for "page layout, wrappers, and utility styling", and every component takes `xstyle` for StyleX overrides. `AGENTS.md` is stricter than that and admits no wrapper. Rather than quietly violating it, the exception is written into `AGENTS.md`, scoped to `Frame` and its parts by name, with the reason. An unwritten exception is indistinguishable from drift. *Alternative considered:* build `Frame` from `Stack` alone with no positioned elements. Rejected — the notch requires absolute positioning, and faking it with borders produces a different shape.

**D6: Tables are rows, never cards.**
`AGENTS.md` already says dense data is rows and `Card` is for standalone widgets, and the reference agrees. Astryx `Table` at `density="compact"` with `dividers="rows"` and `isStriped={false}` is the default shape. Columns get explicit `proportional()` or `pixel()` widths, because Astryx's own guidance is that omitting width skips the 120px minimum and text columns collapse on narrow viewports.

**D7: Provenance survives the restyle intact.**
`Field` currently requires `source` and `readAt` for anything read from outside the process, and its comment explains why: an unlabelled address invites the reader to assume it is current. The restyle keeps those props required. Mono and tabular figures help here rather than hurting — a column of addresses and read times is exactly the content the register is built for.

**D8: The Astryx mode bridge is mount-gated, because the alternative is a real hydration error.**
Found in implementation, not in review. Tailwind and shadcn read a `.dark` class; Astryx reads `data-theme` on `<html>`, which its reset maps to `color-scheme` so `light-dark()` resolves. `next-themes` writes both from one store when given `attribute={["class", "data-theme"]}`, pre-paint, which settles `<html>`. But `<Theme>` renders its own wrapper element carrying `color-scheme` and `data-theme` derived from its `mode` prop, and `next-themes` resolves the stored mode synchronously on its first client render and not on the server. Passing the resolved value straight through produced `data-theme={null}` on the server against `data-theme="light"` on the client — an error React does not patch, and one `suppressHydrationWarning` on `<html>` does not reach. Holding `mode` at `undefined` until after mount makes the first client render match the server. *Residual cost:* for one frame, a viewer whose stored choice differs from their OS preference sees Astryx components resolve against the OS; `<html>` is already correct pre-paint, so it is confined to tokens inside the wrapper, and `disableTransitionOnChange` keeps it from animating. *Alternative considered:* drop `<Theme>` entirely and set `data-astryx-theme` on `<html>` in the server layout, which `useTheme`'s no-provider path explicitly supports. Rejected because the built theme module never calls `registerTheme`, so programmatic token reads would silently fall back to defaults.

**D9: Geist Mono is already loaded; the theme points at its variable.**
`app/layout.tsx` loads Geist and Geist Mono through `next/font/google` and exposes them as CSS variables. Astryx never loads a font file, it only sets `--font-family-*`, so naming the family as `var(--font-geist-mono)` is the only way to name a webfont in the theme without loading it a second time. `next/font` writes its own adjusted fallback metrics into that variable, which makes the theme's `fallbacks` the second line of defence rather than the first. This retires the font-loading risk the proposal raised.

## Risks / Trade-offs

- **The theme swap is a whole-app visual change.** Replacing `theme-neutral` with an owned theme repaints the landing page too, which this change does not otherwise touch. Verify `app/page.tsx` and `app/astryx-check/page.tsx` after the swap, not just the console.
- **A named font that never loads fails quietly.** Astryx sets `--font-family-*` and nothing else; the browser falls back without an error. The check is visual, and the fallback stack must be metric-similar so the failure is survivable rather than invisible.
- **`scripts/check-theme-template.test.mjs` exists to catch template drift.** Promoting the template into an owned module has to leave that test meaningful, not merely passing.
- **Rewriting five primitives touches every console screen.** The four screens plus `discover-form`, `permission-proof`, and `task-request` all import from `primitives.tsx`. The blast radius is the whole console, which argues for doing it in one pass rather than screen by screen.
- **Square corners plus dashed frames is a strong look.** It is the point, but it is not reversible cheaply once seven files depend on it.

## Resolved Questions

**Q1: Which surface does `Frame` sit on? The page body, and the prop still earns its place.**
All eight `<Panel>` call sites render directly inside `<main className="flex flex-col gap-8">`. None is nested in a card. So the page-body default from D4 is correct and no current call site passes the prop. It is not dead weight, though: three inner blocks styled `rounded-lg border border-border bg-muted/30 p-3` (`agents/[id]/page.tsx:224`, `task-request.tsx:114`, `discover-form.tsx:174`) sit *inside* a `Panel` and are the natural nested frames. Those are exactly the callers that must declare their surface, and they are the ones a reviewer would never think to check.

**Q2: Centered or left title? Left, and truncating.**
The reference centers the title and sets `whitespace-nowrap`, which works because its titles are short static uppercase labels like `LATENCY` and `THIS WEEK`. The console's are not. `activity/page.tsx:45` renders `<Panel title={event.summary}>` with an arbitrary-length runtime string, and a centered nowrap caption overflows both edges of its own frame. Left-anchored with truncation degrades instead: a long title clips at the right and the frame stays intact. This also matches what these actually are. The console has panels, not figures.

**Q3: Accents map by role, not as a trio.**
The reference declares six colour roles, not three: `--graph-accent`, `-2`, `-3`, plus `--graph-frame`, `--graph-muted`, and `--graph-faint`. Its `-2` and `-3` exist only to serve `duo` and `multi` series palettes in chart figures, and the console has no series. So the mapping splits: `--graph-accent` maps to Astryx `--color-accent`, which already exists; `--graph-frame`, `--graph-muted`, and `--graph-faint` are structural chrome and go in the theme's `localTokens`; `--color-data-*` stays untouched and reserved for real charts, which is what that slot is for. Declaring a three-accent palette now would be inventing a series vocabulary for data that has no series.

**Q4: `dividers="none"`, with the dashed rule supplied by the theme.**
`graph-rule` is `repeating-linear-gradient(to right, var(--graph-frame) 0 2px, transparent 2px 7px)`: a 1px rule, 2px on and 5px off. Astryx's row divider is solid. Solid row rules inside a dashed frame read as two systems sharing a page. So Astryx `Table` renders at `dividers="none"` and the dashed rule arrives through the theme's `components` block keyed on the table's row class. One rule style throughout, and the decision stays in the theme rather than being re-chosen on every table.

## Open Questions

None outstanding. Reopen if the console grows a chart, which would force Q3's `--color-data-*` reservation into an actual palette decision.
