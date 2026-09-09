# 22. Deployment — Railway

The deployed estate is three resources in one Railway project: a managed
Postgres, `apps/api`, and `apps/web`. It is described in `.railway/railway.ts`
and applied by the Railway CLI, so a deploy is a reviewable diff rather than a
sequence of dashboard clicks.

`docs/19_ENV_AND_CONFIG.md` is the contract for what each variable means. This
document is the runbook for putting them somewhere.

## Why Infrastructure as Code and not `railway.json`

Config as Code (`railway.json` / `railway.toml`) is deprecated and stops being
read on **2026-12-01**. A service cannot be managed by both systems, so the repo
carries exactly one deployment config: `.railway/railway.ts`.

```bash
railway login
railway link                 # once, to the project
railway config plan          # preview; reads Railway state, mutates nothing
railway config apply         # applies after confirmation
```

`plan` is safe to run at any time. Variable values are redacted in its output
unless you pass `--show-values`.

## Both services deploy from the repo root

Neither service sets `rootDirectory`. Railway's isolated-monorepo pattern would
hide `packages/*`, and every service here imports from them — the workspace
packages ship TypeScript source with no build step, so the build genuinely needs
the whole tree. Scoping is done with `pnpm --filter` in the build and start
commands instead.

| Service | Build | Start |
| --- | --- | --- |
| `api` | `pnpm install --frozen-lockfile` | `pnpm --filter @nymspace/api start` |
| `web` | `pnpm --filter @nymspace/web build` | `pnpm --filter @nymspace/web start` |

The API has no build step at all. It runs TypeScript source through `tsx`, which
is why `tsx` is a **production** dependency of `@nymspace/api` and
`@nymspace/store` rather than a dev one — Railpack prunes dev dependencies out
of the runtime image, and a pruned `tsx` is a start command that cannot run.

## First deploy, in order

The order matters because two variables are resolved at different times.

1. **Apply the configuration.**

   ```bash
   railway config apply
   ```

   This creates `postgres`, `api`, and `web`. Secrets are declared as
   `preserve()`, so they are created empty rather than being written into the
   repo.

2. **Set the secrets.** One `--set` per value, per service. Both services need
   them: the web app server-renders through the same guarded packages the API
   uses, so `serverEnv()` validates during `next build`, not at first request.

   ```bash
   railway variables --service api --set SEPOLIA_RPC_URL=... --set GRAPH_API_KEY=...
   railway variables --service web --set SEPOLIA_RPC_URL=... --set GRAPH_API_KEY=...
   ```

   The full list is in `.railway/railway.ts` under `secrets` and `spikeOutputs`.
   Everything else — contract addresses, subgraph ids, chain ids, demo amounts —
   is already a literal in that file, because all of it is public and a deploy
   that changes one should show up in a diff.

3. **Generate the public domains.**

   ```bash
   railway domain --service api
   railway domain --service web
   ```

4. **Redeploy `web`.** `NEXT_PUBLIC_API_URL` is inlined into the client bundle
   by `next build`, so the api domain has to exist *before* the build that is
   meant to use it. The first web build ran without one and fell back to
   `http://localhost:3112`.

   ```bash
   railway redeploy --service web --yes
   ```

5. **Run the onchain bootstrap** against the deployed environment, then write
   its outputs back as variables: `ENSV2_PARENT_REGISTRY_ADDRESS` and
   `ENSV2_PERMISSIONED_RESOLVER_ADDRESS` from `pnpm --filter @nymspace/ens
   spike`, `ERC8004_RESEARCH_AGENT_ID` from `pnpm register:identity`, and
   `DEMO_PAYMENT_RECIPIENT` from `pnpm provision:wallet`. They are
   `preserve()`d rather than literal for the same reason `serverEnv()` does not
   require them: the spike deploys the values, so requiring them up front would
   stop it bootstrapping its own outputs.

## Migrations run as the pre-deploy command

```
preDeploy: "pnpm --filter @nymspace/store db:migrate"
```

That script calls the same `migrate()` the tests and the server call, so the
migration that runs on a laptop is the migration that runs in production.
Drizzle records what it has applied, so it is idempotent, and a failure stops
the deployment rather than releasing a process onto a schema it does not match.

The pre-deploy command is the earliest point where this can run: it gets the
service's variables *and* the private network. The build has neither, so
`DATABASE_URL` does not resolve during a build. Nothing in the build path needs
it — `apps/web` does not depend on `@nymspace/store` — but adding a dependency
that reads the database at build time would break the deploy, not the tests.

`drizzle-kit push` stays forbidden here for the reason it is forbidden locally:
it reshapes tables with no reviewable diff.

## Ports

Railway assigns a port per deployment and injects it as `PORT`. `apiConfig()`
reads `API_PORT` first and falls back to `PORT`, so a developer's `.env` keeps
deciding locally and the platform decides in production. **Do not set
`API_PORT` on Railway** — it would win over the injected value and the service
would never receive traffic. `next start` reads `PORT` on its own.

## Cross-service references

Two variables point at the other service's generated domain:

- `api.WEB_ORIGIN` → `https://${{web.RAILWAY_PUBLIC_DOMAIN}}`, parsed by
  `apiConfig()` as a comma-separated CORS allowlist. Add a custom domain here as
  a second entry once one exists.
- `web.NEXT_PUBLIC_API_URL` → `https://${{api.RAILWAY_PUBLIC_DOMAIN}}`.
- `web.WEB_ORIGIN` → `https://${{web.RAILWAY_PUBLIC_DOMAIN}}`, its own origin.
  The web app does not do CORS; `app/layout.tsx` reuses this variable as Next's
  `metadataBase`. Leave it unset and every deployed page advertises
  `http://localhost:3111` as its canonical origin — wrong in share cards and to
  crawlers, and invisible on screen. It is read during `next build`, so it needs
  a rebuild rather than a restart.

`DATABASE_URL` references the Postgres service directly and resolves to the
private network (`postgres.railway.internal`), which is not billed as egress and
needs no TLS configuration.

## Healthchecks

`api` is gated on `/health`, which is the one route that binds no dependencies —
a liveness check that needs an RPC and a database is reporting their health
rather than its own.

`web` has no healthcheck path. Its `/` server-renders the commit feed from
`@nymspace/github`, so a healthcheck there would fail the deploy when GitHub
rate-limits rather than when the app is unhealthy. Railway still gates the
release on the process binding its port.

## The generated domain can be a dead edge record

Observed on the first deploy of `api`, and worth recognising because every
symptom points somewhere else. The service was healthy — `listening on
http://localhost:8080`, Railway's own healthcheck getting `200` from `/health` —
while every external request returned Railway's edge 404:

```
{"status":"error","code":404,"message":"Application not found"}
```

That is the edge saying it does not know the host at all. A host it knows but
cannot reach answers `502 Application failed to respond` instead, so a 404 here
means the domain record, not the container.

`railway domain list --service api --json` showed `targetPort: null`. The likely
cause is specific to this service: the first container Railway ever ran for
`api` was the pre-deploy migration, which binds no port, so no port was ever
detected. `web` has no pre-deploy command and was unaffected.

Pinning the port on the existing record was **not** enough — `railway domain
update ... --port 8080` reported `targetPort=8080` and the edge kept 404ing
across two redeploys. Deleting the record and generating a new one fixed it:

```bash
railway domain delete <old-domain> --service api --yes
railway domain --service api --port 8080
```

The replacement gets a new random suffix, so `${{api.RAILWAY_PUBLIC_DOMAIN}}`
re-resolves on its own but `web` must be redeployed — its `NEXT_PUBLIC_API_URL`
is baked into the bundle and still points at the deleted host.

The blast radius reaches the browser, which is why this is worth naming. The web
app's server component calls the API, `requestFailed()` in `apps/web/lib/api.ts`
throws on the 404, and the visitor gets a 500 page plus a console message
reading `Minified React error #441` — the production wrapper for "an error
occurred in the Server Components render". Three symptoms, one dead domain.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `This module cannot be imported from a Client Component module` | A start or pre-deploy command lost `--conditions=react-server`. `pnpm conditions:check` catches it before it ships. |
| `tsx: not found` at start | `tsx` slipped back into `devDependencies`; Railpack prunes those. |
| Browser calls the API and gets a CORS error | `WEB_ORIGIN` is stale — the web domain changed, or the api service has not redeployed since it was generated. |
| Frontend calls `localhost:3112` in production | The web bundle was built before the api domain existed. Redeploy `web`. |
| `Missing required environment variable` during `next build` | A server-surface variable was set on `api` only. Both services need the `serverEnv()` required set. |
| Deploy hangs, then fails the healthcheck | The process is not listening on `PORT` — usually `API_PORT` set on Railway. |
| `Application not found` from the edge while the container logs a healthy `/health` | Dead domain record. See the section above: delete it and generate a new one with an explicit `--port`. |
| `Minified React error #441` in the browser | Generic wrapper for a Server Component throw. Read the web service's own logs for the real error and its digest. |
