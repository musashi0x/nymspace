@apps/web/AGENTS.md

## Push access — hien-p only

This repo pushes to `https://github.com/musashi0x/nymspace` and **only the
`hien-p` GitHub account may push it**.

Several accounts are authenticated via `gh` on this machine and the globally
active one (`harrymove-ctrl`) has read-only access here. Two pieces of local
config keep pushes on the right account:

- `user.name` / `user.email` are set locally to `hien-p` /
  `70145901+hien-p@users.noreply.github.com`
- `origin` is `git@github.com-personal:musashi0x/nymspace.git`. That host is an
  alias in `~/.ssh/config` pointing at `github.com` with
  `IdentityFile ~/.ssh/id_ed25519_personal`, so the push authenticates as
  hien-p over SSH and never consults the `gh` credential helper at all

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

Do not add `Co-Authored-By: Claude ...` to commits in this repo. It makes
GitHub render every commit as "hien-p and claude committed". The author and
committer fields are already correct; the trailer was the only cause, and the
four commits that carried it were rewritten and force-pushed on 2026-09-08.
