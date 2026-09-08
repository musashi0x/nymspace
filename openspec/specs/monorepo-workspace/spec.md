# monorepo-workspace Specification

## Purpose

The repository's build and dependency topology — how applications and domain packages are separated, how tasks are orchestrated and cached, how configuration is shared and validated, and how server-only code is prevented from reaching the browser.

## Requirements

### Requirement: Workspace topology

The repository SHALL be a pnpm workspace containing applications under `apps/` and domain packages under `packages/`. Domain logic SHALL live in packages so that both scripts and HTTP route handlers consume one implementation.

#### Scenario: Workspace globs are declared

- **WHEN** `pnpm-workspace.yaml` is read
- **THEN** it MUST declare `apps/*` and `packages/*`, and MUST retain the existing `ignoredBuiltDependencies` entries

#### Scenario: Internal dependencies use the workspace protocol

- **WHEN** an application or package depends on another package in this repository
- **THEN** the dependency MUST be declared as `workspace:*` and MUST be resolved by package name, never by a relative path or a path alias

#### Scenario: No package is published

- **WHEN** any `package.json` in the workspace is inspected
- **THEN** it MUST be marked private, because nothing here is intended for a registry

### Requirement: The web application is the only server

The Next.js application SHALL provide the HTTP surface for the product. No second HTTP server or backend framework SHALL be introduced by this change.

#### Scenario: Server logic is reachable without a separate service

- **WHEN** a secret-bearing operation such as an ENS write, a Graph query, or a Privy payment is exposed
- **THEN** it MUST be served by a Next.js route handler that imports a domain package

#### Scenario: Packages remain process-agnostic

- **WHEN** a domain package is written
- **THEN** it MUST NOT depend on Next.js request or response types, so that a future standalone service could import it unchanged

### Requirement: Server-only code cannot reach the browser

Packages that read secrets or sign transactions SHALL be prevented at build time from being imported into client code.

#### Scenario: Entrypoints are guarded

- **WHEN** the entrypoint of a package that reads credentials is compiled
- **THEN** it MUST import `server-only`, so that importing it from a client component fails the build

#### Scenario: Pure helpers stay importable

- **WHEN** a helper needs no secrets, such as a type definition or an address encoder
- **THEN** it MUST be exported from a path that is not behind the `server-only` guard

#### Scenario: Only public variables cross the boundary

- **WHEN** a value is read in code that runs in the browser
- **THEN** it MUST come from the public environment surface, and a secret MUST NOT be readable from any client-reachable module

### Requirement: Environment configuration is validated and separated

Configuration SHALL be validated at startup and split into a server surface and a public surface. Missing required values SHALL fail immediately rather than at the moment of use.

#### Scenario: Startup fails fast

- **WHEN** a required variable is absent
- **THEN** the process MUST fail on load with a message naming the variable, and MUST NOT fail later inside a request

#### Scenario: The example file stays complete

- **WHEN** a new variable is added to the environment schema
- **THEN** `.env.example` MUST list it, so the documented surface and the validated surface agree

### Requirement: Task orchestration is cached correctly

Turborepo SHALL orchestrate `dev`, `build`, `typecheck`, `lint`, and `test`. Cache keys SHALL account for every environment variable that can change a task's output.

#### Scenario: Every variable is declared

- **WHEN** a task reads an environment variable
- **THEN** that variable MUST appear in `globalEnv` or in the task's `env`, because an undeclared variable is not hashed and would serve a stale result

#### Scenario: Changing a contract address invalidates the cache

- **WHEN** a contract address in the environment changes
- **THEN** the next build MUST be a cache miss, so that no artifact compiled against the previous address is served

#### Scenario: Long-running tasks are not cached

- **WHEN** the `dev` task runs
- **THEN** it MUST be marked persistent and uncached

#### Scenario: The declared set does not drift

- **WHEN** the environment declarations are checked
- **THEN** they MUST be reconciled against `.env.example`, and a variable present in one but not the other MUST be reported

### Requirement: Shared TypeScript configuration

A single base TypeScript configuration SHALL define compiler options, and each application and package SHALL extend it.

#### Scenario: Base config is extended, not copied

- **WHEN** an application or package configures TypeScript
- **THEN** it MUST extend `tsconfig.base.json` and MUST only override what is genuinely local to it

#### Scenario: Path aliases stay scoped

- **WHEN** a path alias such as `@/*` is defined
- **THEN** it MUST be scoped to the application that uses it, and MUST NOT be defined at the root where it would offer a second way to name a package

### Requirement: The move preserves history and leaves the tree clean

Relocating the existing application SHALL preserve file history, and SHALL leave no stale generated file behind.

#### Scenario: History follows the files

- **WHEN** the application is relocated
- **THEN** it MUST be moved with `git mv`, so that `git log --follow` still resolves the landing page's history

#### Scenario: The agent instructions file is not orphaned

- **WHEN** the Next.js application moves and `next dev` regenerates `AGENTS.md` relative to the package
- **THEN** the regenerated file MUST be committed at its new location and `CLAUDE.md`'s import MUST be updated in the same commit, leaving no stale copy at the root

#### Scenario: The application still works after the move

- **WHEN** the development server runs following the move
- **THEN** the landing page MUST render and the existing `/api/activity` route handler MUST return its JSON payload unchanged
