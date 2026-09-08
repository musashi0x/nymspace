@apps/web/AGENTS.md

## Push access — hien-p only

This repo pushes to `https://github.com/musashi0x/nymspace` and **only the
`hien-p` GitHub account may push it**.

Several accounts are authenticated via `gh` on this machine and the globally
active one (`harrymove-ctrl`) has read-only access here. The rule is enforced in
config, not by convention:

- `user.name` / `user.email` are set locally to `hien-p` /
  `70145901+hien-p@users.noreply.github.com`
- `origin` is `https://hien-p@github.com/musashi0x/nymspace.git` — the `hien-p@`
  prefix makes the `gh` credential helper return hien-p's token
- `core.hooksPath` is `.githooks`; `.githooks/pre-push` blocks the push if the
  identity, the remote, or any outgoing commit's author is not hien-p

Do **not** work around a blocked push with `gh auth switch` — that changes the
active account for every other repo on the machine. Fix the local config
instead.

## Commit messages — no co-author trailer

Do not add `Co-Authored-By: Claude ...` to commits in this repo. It makes
GitHub render every commit as "hien-p and claude committed". The author and
committer fields are already correct; the trailer was the only cause, and the
four commits that carried it were rewritten and force-pushed on 2026-09-08.
