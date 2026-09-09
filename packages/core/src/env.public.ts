import { optional, requireAll, requireInt } from "./env.shared";

/**
 * The public environment surface. Every value here is `NEXT_PUBLIC_` prefixed
 * and safe to read in the browser, so this module carries no `server-only`
 * guard. A secret must never be added here.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time only for statically
 * analysable member expressions, so each one is written out in full below
 * rather than read through a variable key.
 */
const source = {
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_PARENT_ENS_NAME: process.env.NEXT_PUBLIC_PARENT_ENS_NAME,
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
};

export interface PublicEnv {
  appName: string;
  parentEnsName: string;
  chainId: number;
  sepoliaRpcUrl?: string;
  privyAppId?: string;
}

let cached: PublicEnv | undefined;

/**
 * Validated public configuration. Throws on first read when a required value
 * is absent, naming the variable.
 */
export function publicEnv(): PublicEnv {
  if (cached) return cached;

  const required = requireAll(source, [
    "NEXT_PUBLIC_APP_NAME",
    "NEXT_PUBLIC_PARENT_ENS_NAME",
  ] as const);

  cached = {
    appName: required.NEXT_PUBLIC_APP_NAME,
    parentEnsName: required.NEXT_PUBLIC_PARENT_ENS_NAME,
    chainId: requireInt(source, "NEXT_PUBLIC_CHAIN_ID"),
    sepoliaRpcUrl: optional(source, "NEXT_PUBLIC_SEPOLIA_RPC_URL"),
    privyAppId: optional(source, "NEXT_PUBLIC_PRIVY_APP_ID"),
  };
  return cached;
}
