"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { writeRecord } from "@/lib/api";
import { classify } from "@/lib/console/errors";
import { LOADING_COPY, permissionStateFrom } from "@/lib/console/state";
import { Loading, Outcome } from "./primitives";

/**
 * The permission proof — tasks 7.9 and 7.10, and `docs/03`'s "best judge
 * moment".
 *
 * Two writes from the same key, seconds apart. The first updates a record the
 * controller was granted and shows the old value, the new value, the hash and
 * the actor. The second attempts a record it was never granted and shows the
 * contract's own refusal.
 *
 * The pairing is the argument. A denial on its own has many possible causes —
 * out of gas, a bad nonce, an empty balance — and they all render identically.
 * A denial immediately after a success, from the same signer against the same
 * resolver, has only one explanation left.
 */

type Result = Awaited<ReturnType<typeof writeRecord>>;

export function PermissionProof({
  agentId,
  permittedKey,
  protectedKey,
  currentValue,
}: {
  agentId: string;
  permittedKey: string;
  /** Absent when the agent has no ERC 8004 registration to protect. */
  protectedKey?: string;
  currentValue: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<Result | null>(null);
  const [denied, setDenied] = useState<Result | null>(null);

  async function runPermitted() {
    setBusy(LOADING_COPY.transaction);
    setAllowed(null);
    try {
      // A value that changes every run. Writing the value already there would
      // confirm on chain and read back identical, proving the read works and
      // nothing about the write.
      const base =
        currentValue?.split("?")[0] ?? "https://mcp.nymspace.example/research";
      setAllowed(
        await writeRecord(agentId, {
          key: permittedKey,
          value: `${base}?proof=${Date.now()}`,
        }),
      );
    } catch (error) {
      setAllowed({
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      } as Result);
    } finally {
      setBusy(null);
    }
  }

  async function runProtected() {
    if (!protectedKey) return;
    setBusy(LOADING_COPY.transaction);
    setDenied(null);
    try {
      setDenied(
        await writeRecord(agentId, {
          key: protectedKey,
          value: "the controller must not be able to write this",
        }),
      );
    } catch (error) {
      setDenied({
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      } as Result);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={runPermitted} disabled={busy !== null}>
          Write a permitted record
        </Button>
        <Button
          variant="outline"
          onClick={runProtected}
          disabled={busy !== null || !protectedKey}
        >
          Attempt a protected record
        </Button>
      </div>

      {busy ? <Loading what={busy} /> : null}

      {allowed ? <ProofResult label="Permitted write" result={allowed} /> : null}
      {denied ? <ProofResult label="Protected write" result={denied} /> : null}

      {allowed && denied ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Both writes were signed by the same controller key against the same
          resolver, within the same session. The only difference between them is
          which record was addressed.
        </p>
      ) : null}
    </div>
  );
}

function ProofResult({ label, result }: { label: string; result: Result }) {
  const state = permissionStateFrom(result);

  if (state === "confirmed" && "after" in result) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
        <p className="text-sm font-medium">
          {label} — allowed by the Permissioned Resolver
        </p>
        <dl className="grid gap-1 font-mono text-[0.7rem] break-all text-muted-foreground">
          <div>was: {result.before || "(empty)"}</div>
          <div>now: {result.after}</div>
          <div>tx: {result.transaction.hash}</div>
          <div>actor: {result.actor}</div>
        </dl>
      </div>
    );
  }

  const error = classify(
    result as { status?: string; source?: string; reason?: string },
  );
  return (
    <Outcome
      tone={error.tone}
      title={`${label} — ${error.title}`}
      detail={"reason" in result ? String(result.reason) : undefined}
      action={error.action}
    />
  );
}
