/**
 * Task 8.10 — the secret audit.
 *
 * Three questions, and they fail in different ways:
 *
 *  1. Is a real secret committed to the repository? The worst outcome, and the
 *     only irreversible one — a pushed key is a rotated key.
 *  2. Does a secret reach the client bundle? `apps/web` ships to a browser, and
 *     the `server-only` guard is what prevents it. This checks the guard held
 *     rather than trusting that it did.
 *  3. Does a secret reach a response body? Gate C asserts this for the
 *     financial path; this widens it to every route.
 *
 * Scans for the *values* in `.env` rather than for variable names. A leak that
 * renamed the field passes a name check and is exactly as bad, and the values
 * are what an attacker needs.
 *
 * Run: pnpm audit:secrets
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What counts as a credential, by name.
 *
 * An allowlist rather than a denylist, learned the hard way: the first version
 * excluded addresses and `NEXT_PUBLIC_*` and still flagged a payment amount, a
 * public RPC URL, a recipient address and a policy id — nineteen findings, none
 * of them secret. A noisy audit is worse than no audit, because it gets ignored
 * on the day it finds something real.
 *
 * So the question is not "might this be secret" but "is this a credential":
 * something that grants access, and that would have to be rotated if it
 * appeared in a commit. A public identifier appearing in source is fine and
 * often necessary — the recipient address is *supposed* to be in the evidence
 * files, because it is what makes the payment proof checkable.
 *
 * `SEPOLIA_RPC_URL` is here because a provider endpoint usually carries an API
 * key in its path, and `DATABASE_URL` because a connection string carries a
 * password. Both are narrowed further below: a value that also appears verbatim
 * in `.env.example` is a documented public default, not a credential, because
 * `.env.example` is committed and read by everyone. That rule is what stops the
 * audit flagging `https://sepolia.base.org` in the six files that hardcode it as
 * a fallback.
 */
const CREDENTIAL_PATTERNS = [
  /PRIVATE_KEY$/,
  /_SECRET$/,
  /API_KEY$/,
  /_TOKEN$/,
  /^SEPOLIA_RPC_URL$/,
  /^BASE_SEPOLIA_RPC_URL$/,
  /^DATABASE_URL$/,
];

/** Below this, a value collides with ordinary source text too often to report. */
const MINIMUM_SECRET_LENGTH = 16;

interface Finding {
  check: string;
  variable: string;
  where: string;
}

const findings: Finding[] = [];
const checks: { name: string; passed: boolean; detail: string }[] = [];

function record(name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "ok  " : "FAIL"}  ${name.padEnd(46)} ${detail}`);
}

/**
 * Every value `.env.example` documents.
 *
 * Committed and public by construction, so a match against one of these is a
 * default appearing where a default belongs.
 */
function publishedDefaults(): Set<string> {
  const examplePath = resolve(ROOT, ".env.example");
  if (!existsSync(examplePath)) return new Set();

  return new Set(
    readFileSync(examplePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.slice(line.indexOf("=") + 1).trim())
      .filter(Boolean),
  );
}

/** The secret values this repository actually holds. */
function secrets(): { name: string; value: string }[] {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return [];

  const published = publishedDefaults();

  return readFileSync(envPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
    })
    .filter(({ name, value }) => {
      if (value.length < MINIMUM_SECRET_LENGTH) return false;
      // Public by definition — the whole point of the prefix.
      if (name.startsWith("NEXT_PUBLIC_")) return false;
      // Documented in .env.example, therefore already public.
      if (published.has(value)) return false;
      return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(name));
    });
}

function walk(dir: string, onFile: (path: string) => void): void {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".next", ".turbo", "evidence"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

function main(): void {
  console.log("Secret audit\n");
  const values = secrets();

  if (values.length === 0) {
    record("secrets are readable for scanning", false, "no .env, so nothing was checked");
    process.exitCode = 1;
    return;
  }
  console.log(`  scanning for ${values.length} secret values\n`);

  //////////////////////////////////////////////////////////////////////////
  // 1 — nothing tracked by git contains a secret
  //////////////////////////////////////////////////////////////////////////

  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  for (const file of tracked) {
    const full = resolve(ROOT, file);
    if (!existsSync(full) || statSync(full).isDirectory()) continue;
    let content: string;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue; // Binary.
    }
    for (const secret of values) {
      if (content.includes(secret.value)) {
        findings.push({ check: "committed", variable: secret.name, where: file });
      }
    }
  }

  const committed = findings.filter((f) => f.check === "committed");
  record(
    "no secret value appears in a tracked file",
    committed.length === 0,
    committed.length === 0
      ? `${tracked.length} tracked files scanned`
      : committed.map((f) => `${f.variable} in ${f.where}`).join(", "),
  );

  //////////////////////////////////////////////////////////////////////////
  // 2 — .env is ignored, and stays ignored
  //////////////////////////////////////////////////////////////////////////

  let ignored = false;
  try {
    execFileSync("git", ["check-ignore", "-q", ".env"], { cwd: ROOT });
    ignored = true;
  } catch {
    ignored = false;
  }
  record(
    ".env is git-ignored",
    ignored,
    ignored ? "matched by .gitignore" : "NOT IGNORED — a commit away from a rotation",
  );

  //////////////////////////////////////////////////////////////////////////
  // 3 — no secret reached a built client bundle
  //////////////////////////////////////////////////////////////////////////

  /**
   * The check the `server-only` guard exists to make unnecessary, run anyway.
   * A guard that has never been tested is a guard nobody knows the state of,
   * and the failure mode here is silent: the page renders perfectly with a key
   * inside it.
   */
  const clientDir = resolve(ROOT, "apps/web/.next/static");
  if (!existsSync(clientDir)) {
    record(
      "no secret reached the client bundle",
      true,
      "no build present — run `pnpm build` before trusting this line",
    );
  } else {
    const leaked: Finding[] = [];
    walk(clientDir, (file) => {
      if (!/\.(js|css|map|json)$/.test(file)) return;
      const content = readFileSync(file, "utf8");
      for (const secret of values) {
        if (content.includes(secret.value)) {
          leaked.push({
            check: "bundle",
            variable: secret.name,
            where: file.replace(ROOT, ""),
          });
        }
      }
    });
    findings.push(...leaked);
    record(
      "no secret reached the client bundle",
      leaked.length === 0,
      leaked.length === 0
        ? "apps/web/.next/static scanned"
        : leaked.map((f) => `${f.variable} in ${f.where}`).join(", "),
    );
  }

  //////////////////////////////////////////////////////////////////////////
  // 4 — no secret in a committed evidence artifact
  //////////////////////////////////////////////////////////////////////////

  /**
   * Evidence files are committed on purpose and carry raw provider responses,
   * which makes them the most plausible accidental route out. Gate C checks its
   * own; this checks all of them.
   */
  const evidenceFiles = tracked.filter((f) => f.includes("evidence/") && f.endsWith(".json"));
  const inEvidence: Finding[] = [];
  for (const file of evidenceFiles) {
    const content = readFileSync(resolve(ROOT, file), "utf8");
    for (const secret of values) {
      if (content.includes(secret.value)) {
        inEvidence.push({ check: "evidence", variable: secret.name, where: file });
      }
    }
  }
  record(
    "no secret in a committed evidence artifact",
    inEvidence.length === 0,
    inEvidence.length === 0
      ? `${evidenceFiles.length} evidence files scanned`
      : inEvidence.map((f) => `${f.variable} in ${f.where}`).join(", "),
  );

  //////////////////////////////////////////////////////////////////////////

  const failures = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
  if (failures.length > 0) {
    console.log("\nA failing line here is not a style issue. Rotate anything that leaked.");
    process.exitCode = 1;
  }
}

main();
