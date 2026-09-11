import "server-only";

/**
 * The wallet and policy boundary.
 *
 * Guarded, and this is the package the guard exists for: it reads
 * `PRIVY_APP_SECRET` and `PRIVY_AUTHORIZATION_PRIVATE_KEY`, either of which
 * reaching a client bundle would be the worst outcome in this repository.
 */

export * from "./authorization";
export * from "./policy";
export * from "./token";
export * from "./wallet";
