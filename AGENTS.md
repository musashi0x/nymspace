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
