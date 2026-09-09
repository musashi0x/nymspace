@apps/web/AGENTS.md

## Push access — hien-p only

This repo pushes to `https://github.com/musashi0x/nymspace` and **only the
`hien-p` GitHub account may push it**.

Several accounts are authenticated via `gh` on this machine and the globally
active one (`harrymove-ctrl`) has read-only access here. What keeps pushes on
the right account is the remote:

- `origin` is `git@github.com-personal:musashi0x/nymspace.git`. That host is an
  alias in `~/.ssh/config` pointing at `github.com` with
  `IdentityFile ~/.ssh/id_ed25519_personal`, so the push authenticates as
  hien-p over SSH and never consults the `gh` credential helper at all

Commit authorship is separate from push access and is not pinned here. There is
no local `user.name` / `user.email` override, so commits are authored with the
machine's global identity. Commits up to `6c7dc06` were authored as `hien-p`
and are left that way.

Do **not** work around a blocked push with `gh auth switch` — that changes the
active account for every other repo on the machine. Fix the local config
instead.

**Nothing enforces this any more.** `core.hooksPath` is still `.githooks`, but
that directory was deleted and added to `.gitignore` in `68a6248`, so the
`pre-push` hook that used to check the identity, the remote, and every outgoing
commit's author no longer exists. A wrong-account push now fails only if GitHub
rejects it. Before pushing, check by hand:

```bash
git config user.email && git remote get-url origin && git log --format='%an <%ae>' @{u}..HEAD | sort -u
```

The deleted hook is recoverable with `git show 68a6248^:.githooks/pre-push`.
Restoring it means un-ignoring `.githooks/` as well, since a hook that is not
in the repo is not a rule.

## Commit messages — no co-author trailer

Do not add `Co-Authored-By: Codex ...` to commits in this repo. It makes
GitHub render every commit as "hien-p and Codex committed". The author and
committer fields are already correct; the trailer was the only cause, and the
four commits that carried it were rewritten and force-pushed on 2026-09-08.

## Diagrams — `diagram/`

Diagrams belong in `diagram/`, committed as a pair: `<name>.excalidraw` (the
editable source) and `<name>.png` (what READMEs and docs embed). Never
hand-write Excalidraw JSON — use the `excalidraw-diagram` skill, which owns the
layout methodology and renders its own output to check it.

Mermaid remains the default for figures inside `docs/*.md`: text diffs, renders
on GitHub, no toolchain. Reach for Excalidraw only when the diagram is an
explainer image whose layout carries the argument.

### Rendering

```bash
cd .claude/skills/excalidraw-diagram/references
uv run python render_excalidraw.py ../../../../diagram/<name>.excalidraw \
  --output ../../../../diagram/<name>.png
```

Rendering needs live network — the template pulls Excalidraw from esm.sh at
render time.

### Keep it legible

Readability is font size *relative to canvas width*, not the PNG's pixel count.
A 2660-px-wide canvas with 12px body text renders as a 10992px PNG that is
still unreadable, because anything viewing it fits it to a screen and the type
collapses. The first pass at these diagrams made exactly that mistake.

So: portrait, roughly 1300 logical px wide, body text at 15px, headers at 19,
titles at 32. Stack sections vertically rather than adding columns, and let a
sequence run down the page instead of across it, which also gives each step
real width for its label. Render and *look* at the result before calling it
done — the loop in `SKILL.md` is not optional, and clipped text inside a dark
evidence box is the failure it catches most often.

### The skill is not in this repo

`.claude/` is gitignored, so every clone installs it:

```bash
git clone https://github.com/coleam00/excalidraw-diagram-skill.git \
  .claude/skills/excalidraw-diagram
rm -rf .claude/skills/excalidraw-diagram/.git
cd .claude/skills/excalidraw-diagram/references
uv sync && uv run playwright install chromium
```

It ships with no LICENSE file, so it stays out of the tree rather than being
vendored.

### Two upstream fixes it needs

Both are in `references/render_template.html`, and without them every render
fails on a 30-second Playwright `wait_for_function` timeout that reads like a
local environment problem:

1. The import is unpinned, so esm.sh resolves `@excalidraw/excalidraw@0.18.1`,
   whose transitive `@braintree/sanitize-url@6.0.2` build returns 404
   (`could not resolve build entry`). Pin `@0.17.6`.
2. esm.sh serves the package through CJS interop, so `exportToSvg` hangs off the
   default export. A named `import { exportToSvg }` throws `does not provide an
   export named 'exportToSvg'`.

Replace the import line with:

```js
import ExcalidrawLib from "https://esm.sh/@excalidraw/excalidraw@0.17.6?bundle";
const { exportToSvg } = ExcalidrawLib;
```

<!-- ASTRYX:START -->
Astryx v0.1.0 · 90+ components
CLI: run every command as `pnpm dlx @astryxdesign/cli <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   90+ components by category
  template --list    page + block recipes
  docs <topic>       browser-support, cli-integrations, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
