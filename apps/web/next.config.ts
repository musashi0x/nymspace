import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

/**
 * The repository's `.env` lives at the root; Next only reads the one beside the
 * app it is building.
 *
 * Every other workspace bridges that with `--env-file-if-exists=../../.env`
 * (see `apps/api`'s dev script and every script in the root `package.json`).
 * Next cannot: its bin re-executes itself and carries the flag through
 * `NODE_OPTIONS`, where Node refuses it — `--env-file-if-exists= is not allowed
 * in NODE_OPTIONS`, and the dev server exits 9 before printing anything about
 * env at all.
 *
 * So it happens here, because this file is evaluated before Next compiles
 * anything, which is what `NEXT_PUBLIC_*` inlining requires. Miss that window
 * and the failure is specific and misleading: the server renders correctly,
 * because it reads `process.env` at request time, while the browser bundle has
 * `undefined` compiled into it. The page then 500s on hydration with
 * `MissingEnvError: NEXT_PUBLIC_APP_NAME` for a variable that is plainly set in
 * `.env` and plainly working server-side.
 *
 * Existing values win, so a real environment variable — Railway's, or one
 * exported in the shell — is never overwritten by the file.
 */
function loadRootEnv() {
  const path = resolve(import.meta.dirname, "..", "..", ".env");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // Absent is normal: Railway injects real variables and ships no `.env`.
    return;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at < 1) continue;
    const key = trimmed.slice(0, at).trim();
    // Verbatim, and only the first `=` splits — a private key or a connection
    // string carries more, and re-splitting them truncates a secret into
    // something that still looks like one.
    const value = trimmed.slice(at + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  /**
   * The workspace packages ship TypeScript source rather than build output, so
   * Next compiles them itself. A package missing from this list surfaces as a
   * parse error inside `node_modules`, not as a clear message — so all four are
   * listed from the start, including the ones that are still shells.
   */
  transpilePackages: [
    "@nymspace/core",
    "@nymspace/ens",
    "@nymspace/github",
    "@nymspace/graph",
    "@nymspace/privy",
  ],
};

export default nextConfig;
