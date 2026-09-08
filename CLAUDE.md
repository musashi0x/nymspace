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
