/**
 * Pure exports only — types, the ERC 7930 encoder, and the public environment
 * surface. Nothing here reads a secret, so this entrypoint carries no
 * `server-only` guard and is importable from client components.
 *
 * The server surface lives behind `@nymspace/core/env`.
 */

export * from "./types";
export * from "./erc7930";
export { publicEnv, type PublicEnv } from "./env.public";
export { MissingEnvError } from "./env.shared";
