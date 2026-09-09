/**
 * Railway Infrastructure as Code — the whole deployed estate in one file.
 *
 * Three resources: a managed Postgres, the Hono API, and the Next web app.
 * Both apps deploy from the repo root rather than from `apps/*`, because
 * `rootDirectory` would hide `packages/*` and every service here imports from
 * them (CLAUDE.md, "Workspace packages ship TypeScript source"). Scoping is
 * done with `pnpm --filter` in the build and start commands instead.
 *
 * Config as Code (`railway.json` / `railway.toml`) is deprecated and stops
 * being read on 2026-12-01, so this file is the only deployment config in the
 * repo — a service cannot be managed by both systems.
 *
 *   railway link                # once, to a project
 *   railway config plan         # preview, mutates nothing
 *   railway config apply        # create/update after confirmation
 *
 * Secrets are `preserve()`: the value lives in Railway and is never written
 * here. Non-secret values (contract addresses, subgraph ids, chain ids) are
 * literals so a deploy is reviewable in a diff — the same reason
 * `packages/store/drizzle/` holds committed SQL. Everything below mirrors
 * `.env.example`; docs/19_ENV_AND_CONFIG.md is the contract, and
 * docs/22_DEPLOYMENT.md is the runbook.
 */
import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
} from "railway/iac";

const REPO = "musashi0x/nymspace";
const BRANCH = "main";

/**
 * Chain configuration and deployed contract addresses. Public by definition —
 * every one of them is readable onchain — so they are literals rather than
 * `preserve()`. Copied from `.env.example`, which carries the provenance
 * comments explaining why each address is the one it is.
 */
const chain = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",

  ENSV2_ROOT_REGISTRY_ADDRESS: "0x8115186e8f2e0b0281e86ab91f0f48ba90364354",
  ENSV2_ETH_REGISTRY_ADDRESS: "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2",
  ENSV2_ETH_REGISTRAR_ADDRESS: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
  ENSV2_UNIVERSAL_RESOLVER_ADDRESS: "0x4a1817d13e9cf196f471725176355c1234b63c70",
  ENSV2_VERIFIABLE_FACTORY_ADDRESS: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef",
  ENSV2_USER_REGISTRY_IMPL_ADDRESS: "0x624a25d67b59d587752ebec8dded8827dae52050",
  ENSV2_PERMISSIONED_RESOLVER_IMPL_ADDRESS:
    "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e",
  ENSV2_PAYMENT_TOKEN_ADDRESS: "0x768f42455a2d082e23ceef7d51e5787c82d67a39",
  ENSV2_PARENT_LABEL: "nymspace",

  ERC8004_IDENTITY_REGISTRY_ADDRESS:
    "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  ERC8004_REPUTATION_REGISTRY_ADDRESS:
    "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  /** No ValidationRegistry is deployed on either Sepolia. Absent, not zero. */
  ERC8004_VALIDATION_REGISTRY_ADDRESS: "",
  ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS:
    "0x8004A818BFB912233c491871b3d84c89A494BD9e",

  GRAPH_AGENT0_SEPOLIA_SUBGRAPH_ID:
    "6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT",
  GRAPH_AGENT0_BASE_SEPOLIA_SUBGRAPH_ID:
    "4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u",
  GRAPH_DEFAULT_NETWORK: "base-sepolia",
} as const;

/**
 * Outputs of `pnpm --filter @nymspace/ens spike`, `pnpm register:identity`, and
 * `pnpm provision:wallet`. Legitimately empty until those have run against the
 * deployed environment, which is why `serverEnv()` does not require them and
 * `requireDeployed()` checks them at the top of a route instead.
 */
const spikeOutputs = {
  ENSV2_PARENT_REGISTRY_ADDRESS: preserve(),
  ENSV2_PERMISSIONED_RESOLVER_ADDRESS: preserve(),
  ERC8004_RESEARCH_AGENT_ID: preserve(),
  DEMO_PAYMENT_RECIPIENT: preserve(),
} as const;

/** Keys, API tokens, and app secrets. Set on Railway, never in this file. */
const secrets = {
  SEPOLIA_RPC_URL: preserve(),
  ENSV2_ORGANIZATION_PRIVATE_KEY: preserve(),
  ENSV2_AGENT_CONTROLLER_PRIVATE_KEY: preserve(),
  GRAPH_API_KEY: preserve(),
  GEMINI_API_KEY: preserve(),
  PRIVY_APP_SECRET: preserve(),
  PRIVY_AUTHORIZATION_KEY_ID: preserve(),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: preserve(),
  PRIVY_POLICY_ID: preserve(),
  GITHUB_TOKEN: preserve(),
} as const;

/**
 * Amounts in wei, ordered allowed < policy limit < denied < wallet balance so
 * Gate C's denial cannot be explained by an empty wallet.
 */
const demo = {
  DEMO_ALLOWED_PAYMENT_AMOUNT: "100000000000000",
  DEMO_DENIED_PAYMENT_AMOUNT: "10000000000000000",
  /** Native ETH on Base Sepolia — deliberately empty, no token faucet. */
  DEMO_PAYMENT_TOKEN_ADDRESS: "",
} as const;

/** The commit feed on the landing page. The token only lifts the rate limit. */
const githubActivity = {
  GITHUB_OWNER: "musashi0x",
  GITHUB_REPO: "nymspace",
  GITHUB_BRANCH: "",
} as const;

export default defineRailway(() => {
  const db = postgres("postgres");

  const api = service("api", {
    source: github(REPO, { branch: BRANCH }),
    /**
     * No build step. The API runs TypeScript source through `tsx`, which is why
     * `tsx` is a production dependency of `@nymspace/api` rather than a dev one
     * — Railpack prunes dev dependencies out of the runtime image.
     */
    build: "pnpm install --frozen-lockfile",
    start: "pnpm --filter @nymspace/api start",
    /**
     * Drizzle records what it has applied, so this is idempotent. It runs on
     * the private network with the service's variables, which is the only
     * window where `DATABASE_URL` resolves — the build has no private network.
     */
    preDeploy: "pnpm --filter @nymspace/store db:migrate",
    /** `/health` binds no dependencies, so it reports this process only. */
    healthcheck: "/health",
    healthcheckTimeout: 120,
    env: {
      NODE_ENV: "production",
      RAILPACK_NODE_VERSION: "22",
      DATABASE_URL: db.env.DATABASE_URL,
      /**
       * Parsed as a comma-separated CORS allowlist by `apiConfig()`. Railway
       * resolves the reference at runtime; the generated domain does not exist
       * until `railway domain --service web` has been run, so the first deploy
       * of this service comes up with an unresolved origin and needs one
       * redeploy afterwards. docs/22_DEPLOYMENT.md sequences it.
       */
      WEB_ORIGIN: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
      /**
       * Yes, a `NEXT_PUBLIC_` variable on a server that ships no client
       * bundle. `privyCredentials()` reads this one straight off
       * `process.env` (packages/privy/src/wallet.ts:39) because Privy's app id
       * identifies the app to both halves, and it asserts the full credential
       * set together so a financial route cannot discover a missing secret
       * mid-request. Leave it off `api` and every wallet route answers 500
       * with `Privy is not configured; missing: NEXT_PUBLIC_PRIVY_APP_ID`,
       * which reads like a frontend problem and is not one.
       */
      NEXT_PUBLIC_PRIVY_APP_ID: preserve(),
      ...chain,
      ...spikeOutputs,
      ...secrets,
      ...demo,
      ...githubActivity,
    },
  });

  const web = service("web", {
    source: github(REPO, { branch: BRANCH }),
    build: "pnpm --filter @nymspace/web build",
    start: "pnpm --filter @nymspace/web start",
    /**
     * No healthcheck path. `/` server-renders the commit feed from
     * `@nymspace/github`, so a healthcheck against it would fail the deploy
     * when GitHub rate-limits rather than when the app is unhealthy. Railway
     * still gates the release on the process binding its port.
     */
    env: {
      NODE_ENV: "production",
      RAILPACK_NODE_VERSION: "22",

      /**
       * Inlined into the client bundle at build time, so a change here needs a
       * rebuild rather than a restart. `NEXT_PUBLIC_API_URL` is the one that
       * bites: it is baked, so the api domain must exist before the web build
       * that is meant to use it.
       */
      NEXT_PUBLIC_APP_NAME: "Nymspace",
      NEXT_PUBLIC_PARENT_ENS_NAME: "nymspace.eth",
      NEXT_PUBLIC_CHAIN_ID: "11155111",
      NEXT_PUBLIC_SEPOLIA_RPC_URL: preserve(),
      NEXT_PUBLIC_PRIVY_APP_ID: preserve(),
      NEXT_PUBLIC_API_URL: "https://${{api.RAILWAY_PUBLIC_DOMAIN}}",

      /**
       * Not CORS here — `app/layout.tsx` reuses `WEB_ORIGIN` as Next's
       * `metadataBase`, which is what turns the relative `opengraph-image`
       * path into an absolute URL. Without it the deployed pages advertise
       * `http://localhost:3111` as their canonical origin, which is invisible
       * on screen and wrong in every share card and crawler. Read during
       * `next build`, so changing it needs a rebuild rather than a restart.
       */
      WEB_ORIGIN: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",

      /**
       * The web app server-renders through the same guarded packages the API
       * uses, so it needs the server surface too — `serverEnv()` validates
       * during `next build`, not at first request.
       */
      ...chain,
      ...spikeOutputs,
      ...secrets,
      ...demo,
      ...githubActivity,
    },
  });

  return project("nymspace", {
    resources: [db, api, web],
  });
});
