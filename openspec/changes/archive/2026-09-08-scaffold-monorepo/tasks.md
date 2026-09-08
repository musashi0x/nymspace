## 1. Workspace enablement

- [x] 1.1 Add `packages: ["apps/*", "packages/*"]` to `pnpm-workspace.yaml`, keeping the existing `ignoredBuiltDependencies` entries for `sharp` and `unrs-resolver`
- [x] 1.2 Rename the root package from `ens_project` to `nymspace`, mark it `"private": true`, and strip the application dependencies from it; they belong to `apps/web`
- [x] 1.3 Add `turbo` and `tsx` as root development dependencies
- [x] 1.4 Replace the root scripts with delegating ones: `dev`, `build`, `typecheck`, `lint`, `test` each invoking `turbo`

## 2. Move the application

- [x] 2.1 `git mv` the application into `apps/web`: `app/`, `components/`, `lib/`, `public/`, `next.config.ts`, `next-env.d.ts`, `components.json`, `postcss.config.mjs`. Use `git mv` so `git log --follow` still resolves the landing page
- [x] 2.2 Create `apps/web/package.json` named `@nymspace/web`, private, owning every application dependency currently at the root
- [x] 2.3 Verify the Tailwind v4 and shadcn setup resolves from the new location. `components.json` paths and the `@/*` alias are relative to the app, so they should survive the move untouched
- [x] 2.4 Run `pnpm install`, then `pnpm dev`, and confirm the landing page renders and `/api/activity` returns its JSON before committing anything
- [x] 2.5 Let `next dev` regenerate `AGENTS.md` at `apps/web/AGENTS.md`, delete the orphaned root copy, and update the `@AGENTS.md` import in `CLAUDE.md` to the new path
- [x] 2.6 Commit the move, the regenerated agent file, and the `CLAUDE.md` fix as one commit, per the note in `AGENTS.md` about keeping the tree clean
- [x] 2.7 Confirm `.githooks/pre-push` and the `hien-p` push identity still behave. They are git configuration and should be unaffected, but a failed push mid-restructure is an unpleasant surprise

## 3. Shared configuration

- [x] 3.1 Add `tsconfig.base.json` at the root carrying `strict`, `moduleResolution: "bundler"`, `isolatedModules`, and the other options currently in the root `tsconfig.json`
- [x] 3.2 Point `apps/web/tsconfig.json` at the base, keeping the Next plugin, the `@/*` alias, and the `.next` type includes local to the app
- [x] 3.3 Do not define any path alias at the root. Packages resolve each other by package name, so a root alias would create a second name for the same module
- [x] 3.4 Give each package a `tsconfig.json` extending the base with `noEmit`, since packages ship source rather than build output

## 4. Turborepo pipeline

- [x] 4.1 Add `turbo.json` with tasks `dev`, `build`, `typecheck`, `lint`, `test`
- [x] 4.2 Mark `dev` as `"cache": false, "persistent": true`
- [x] 4.3 Set `build` outputs to `.next/**` excluding `.next/cache/**`
- [x] 4.4 Declare **every** variable from `docs/19_ENV_AND_CONFIG.md` in `globalEnv` or in a task's `env`. Turborepo hashes only declared variables, so an undeclared contract address means editing it and receiving a build compiled against the old one, silently
- [x] 4.5 Add `.env.example` and `tsconfig.base.json` to `globalDependencies`
- [x] 4.6 Add a check that reconciles the variables declared in `turbo.json` against the keys in `.env.example` and reports anything present in one but not the other

## 5. Domain packages

- [x] 5.1 Create `@nymspace/core` with `src/index.ts` for pure exports — shared types and the ERC 7930 encoder — and `src/env.ts` exporting a validated `serverEnv` behind `server-only` plus a `publicEnv` that is safe to import anywhere
- [x] 5.2 Create `@nymspace/ens` with `import "server-only"` at its entrypoint, holding `EnsService`, pinned ABIs, chain configuration, and the EAC resource derivation
- [x] 5.3 Create `@nymspace/graph` with the same guard, as the Agent0 client boundary
- [x] 5.4 Create `@nymspace/privy` with the same guard, as the wallet and policy boundary
- [x] 5.5 Point each package's `exports` at `src/index.ts`. No `dist`, no build step, so nothing compiles inside the dev loop
- [x] 5.6 Keep packages free of Next.js request and response types, so a standalone service could import them unchanged if one is ever needed
- [x] 5.7 Add `transpilePackages` for all four packages in `apps/web/next.config.ts`, and verify with one trivial import from the app. A missing entry surfaces as a parse error inside `node_modules` rather than a clear message

## 6. Verification

- [x] 6.1 `pnpm typecheck` passes across every workspace member
- [x] 6.2 `pnpm dev` serves the landing page and `/api/activity` unchanged from before the move
- [x] 6.3 A route handler in `apps/web` can import `@nymspace/ens` and typecheck
- [x] 6.4 Importing `@nymspace/privy` from a client component fails the build, proving the `server-only` guard works. Do this once deliberately, then remove it
- [x] 6.5 Change one declared environment variable and confirm the next `turbo build` is a cache miss
- [x] 6.6 `git log --follow apps/web/app/page.tsx` shows history from before the move

## 7. Handoff

- [x] 7.1 Rewrite section 1 of the `ensv2-authority-spike` change to assume this workspace exists: the spike becomes `packages/ens/scripts/spike-ensv2.ts`, the typed chain config becomes part of `@nymspace/core` and `@nymspace/ens`, and `.env.example` is created here rather than there
- [x] 7.2 Resolve the open question on whether the ERC 7930 encoder belongs in `@nymspace/core` or `@nymspace/ens`. If nothing outside `ens` consumes it, move it and shrink `core`
- [x] 7.3 Choose a test runner so the `test` task means something, per `docs/13_TEST_PLAN.md`, which asks for unit, integration, and negative tests but names no runner
- [x] 7.4 If this scaffold exceeds half a day, stop and land what exists. The workspace is useful half-built; the Day 1 ENSv2 gate is not
