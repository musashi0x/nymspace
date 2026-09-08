import "server-only";

/**
 * The Agent0 client boundary. Guarded: it holds `GRAPH_API_KEY`, which
 * docs/19_ENV_AND_CONFIG.md classifies as a value that must not reach the
 * browser.
 *
 * Normalisation lives here rather than in the app so that the cases
 * docs/13_TEST_PLAN.md names — missing MCP endpoint, missing ENS claim, no
 * feedback, pending validation, revoked feedback — are decided in one place
 * and unit tested without an HTTP server.
 */

export * from "./client";
export * from "./types";
