/**
 * Gate E — Acceptance.
 *
 * Run: pnpm verify:acceptance
 * Emits: evidence/gate-e-<n>.json, one per run
 *
 * Chains Gates A through D end to end and requires **three consecutive** clean
 * runs. Consecutive is the whole control: three attempts of which two succeeded
 * is a flow that works on stage only if the judge waits, so a failed run resets
 * the count to zero rather than being re-attempted into the tally.
 *
 * The five proofs the chain has to cover, from `docs/13`:
 *
 *   allowed ENS write      Gate A assertion 2
 *   denied ENS write       Gate A assertions 3, 4 and 9 (E6)
 *   live Graph discovery   Gate B
 *   allowed payment        Gate C assertion 3
 *   denied payment         Gate C assertion 2
 *
 * Timings are recorded per gate, which is task 8.8's other half: the thing
 * worth knowing before a demo is not that it works but how long the audience
 * spends watching it work.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_DIR = resolve(ROOT, "evidence");

const REQUIRED_CLEAN_RUNS = 3;

interface Step {
  name: string;
  /** Argv for pnpm. */
  args: string[];
  /** Where the step writes its own evidence, when it does. */
  evidence?: string;
  /**
   * Setup rather than proof. A failure still stops the run — a gate that cannot
   * be set up cannot be trusted — but it is reported as setup so a funding
   * problem is not mistaken for a policy problem.
   */
  setup?: boolean;
}

const CHAIN: Step[] = [
  {
    name: "top up the agent wallet",
    args: ["provision:wallet"],
    setup: true,
  },
  {
    name: "Gate A — identity",
    args: ["--filter", "@nymspace/ens", "verify:identity"],
    evidence: "packages/ens/evidence/gate-a.json",
  },
  {
    name: "Gate B — discovery",
    args: ["--filter", "@nymspace/graph", "verify:discovery"],
    evidence: "packages/graph/evidence/gate-b.json",
  },
  {
    name: "Gate C — financial",
    args: ["--filter", "@nymspace/privy", "verify:policy"],
    evidence: "packages/privy/evidence/gate-c.json",
  },
  {
    name: "Gate D — authority is contract-derived",
    args: ["test:matrix-live"],
    evidence: "evidence/gate-d.json",
  },
];

interface StepResult {
  name: string;
  passed: boolean;
  durationMs: number;
  setup: boolean;
  assertions?: { n: number; name: string; passed: boolean }[];
  failure?: string;
}

function runStep(step: Step): StepResult {
  const startedAt = Date.now();
  let passed = true;
  let failure: string | undefined;

  try {
    execFileSync("pnpm", step.args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: process.env,
    });
  } catch (error) {
    passed = false;
    const shell = error as { stdout?: string; stderr?: string; message?: string };
    // The gate's own failing lines, not the shell's exit code. A runner that
    // reports "exit status 1" makes the reader open four files to find out
    // which assertion moved.
    const output = `${shell.stdout ?? ""}${shell.stderr ?? ""}`;
    const failing = output
      .split("\n")
      .filter((line) => line.startsWith("FAIL"))
      .join("; ");
    failure = failing || (shell.message ?? "unknown failure");
  }

  const durationMs = Date.now() - startedAt;
  const result: StepResult = { name: step.name, passed, durationMs, setup: step.setup ?? false };
  if (failure) result.failure = failure;

  if (step.evidence && existsSync(resolve(ROOT, step.evidence))) {
    try {
      const body = JSON.parse(readFileSync(resolve(ROOT, step.evidence), "utf8")) as {
        go?: boolean;
        assertions?: { n: number; name: string; passed: boolean }[];
      };
      result.assertions = body.assertions?.map((a) => ({
        n: a.n,
        name: a.name,
        passed: a.passed,
      }));
      // The evidence file is the authority on whether the gate passed. An exit
      // code can be zero for a gate that wrote a failing artifact, and the
      // artifact is what gets committed.
      if (body.go === false) {
        result.passed = false;
        result.failure ??= "the gate wrote go: false";
      }
    } catch {
      // A missing or malformed artifact does not flip a passing gate to
      // failing; the exit code already spoke.
    }
  }

  return result;
}

function main(): void {
  console.log(`Gate E — acceptance, ${REQUIRED_CLEAN_RUNS} consecutive clean runs required\n`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  let consecutive = 0;
  let attempt = 0;

  while (consecutive < REQUIRED_CLEAN_RUNS) {
    attempt += 1;
    const runStartedAt = Date.now();
    console.log(
      `── run ${attempt} (clean streak ${consecutive}/${REQUIRED_CLEAN_RUNS}) ──`,
    );

    const steps: StepResult[] = [];
    let clean = true;

    for (const step of CHAIN) {
      const result = runStep(step);
      steps.push(result);
      console.log(
        `  ${result.passed ? "ok  " : "FAIL"}  ${result.name.padEnd(42)} ${(result.durationMs / 1000).toFixed(1)}s${
          result.failure ? ` — ${result.failure.slice(0, 120)}` : ""
        }`,
      );
      if (!result.passed) {
        clean = false;
        // Stop the run at the first failure. Continuing would produce evidence
        // from a chain whose earlier state is already wrong.
        break;
      }
    }

    const durationMs = Date.now() - runStartedAt;

    if (clean) {
      consecutive += 1;
    } else {
      // The control. A failed run resets the streak rather than being retried
      // into the tally — three attempts of which two succeeded is not three
      // consecutive clean runs, and the difference is whether the demo works
      // when nobody is willing to wait.
      consecutive = 0;
    }

    writeFileSync(
      resolve(EVIDENCE_DIR, `gate-e-${attempt}.json`),
      `${JSON.stringify(
        {
          ranAt: new Date(runStartedAt).toISOString(),
          gate: "E",
          attempt,
          clean,
          consecutiveAfter: consecutive,
          durationMs,
          steps,
        },
        null,
        2,
      )}\n`,
    );

    console.log(
      `  run ${attempt}: ${clean ? "clean" : "FAILED — streak reset to 0"} in ${(durationMs / 1000).toFixed(1)}s\n`,
    );

    if (!clean && attempt >= REQUIRED_CLEAN_RUNS * 2) {
      console.log(
        `Gate E: FAIL — ${attempt} attempts without ${REQUIRED_CLEAN_RUNS} consecutive clean runs.\n` +
          "Cut from section 9 in order until three consecutive runs pass. Cutting scope to reach\n" +
          "three clean runs is the correct trade; recording on two of three is not.",
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `Gate E: PASS — ${REQUIRED_CLEAN_RUNS} consecutive clean runs in ${attempt} attempt${attempt === 1 ? "" : "s"}.`,
  );
  console.log(`evidence: ${EVIDENCE_DIR}/gate-e-*.json`);
}

main();
