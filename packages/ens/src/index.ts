import "server-only";

/**
 * Every ENS read and write in the product passes through this package.
 *
 * Guarded: it reads the RPC URL and the deployed addresses from the server
 * environment, so importing it from a client component is a build error.
 * The pure helpers a client might want — the ERC 7930 encoder, the shared
 * types — live unguarded in `@nymspace/core`.
 */

export * from "./abis";
export * from "./chain";
export * from "./eac";
export * from "./ens-service";
export * from "./keys";
