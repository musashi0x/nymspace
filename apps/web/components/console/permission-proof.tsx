"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { writeRecord } from "@/lib/api";
import { classify } from "@/lib/console/errors";
import { LOADING_COPY, permissionStateFrom } from "@/lib/console/state";
import { Field, Loading, Outcome } from "./primitives";

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
    <VStack gap={4}>
      <HStack gap={2} wrap="wrap">
        <Button
          variant="primary"
          label="Write a permitted record"
          onClick={runPermitted}
          isDisabled={busy !== null}
        />
        <Button
          variant="secondary"
          label="Attempt a protected record"
          onClick={runProtected}
          isDisabled={busy !== null || !protectedKey}
        />
      </HStack>

      {busy ? <Loading what={busy} /> : null}

      {allowed ? <ProofResult label="Permitted write" result={allowed} /> : null}
      {denied ? <ProofResult label="Protected write" result={denied} /> : null}

      {allowed && denied ? (
        <Text type="supporting" as="p">
          Both writes were signed by the same controller key against the same
          resolver, within the same session. The only difference between them is
          which record was addressed.
        </Text>
      ) : null}
    </VStack>
  );
}

function ProofResult({ label, result }: { label: string; result: Result }) {
  const state = permissionStateFrom(result);

  if (state === "confirmed" && "after" in result) {
    // The four values are the evidence, so they are Fields rather than a
    // formatted blob: the same rows, the same rules, as everywhere else the
    // console shows something it read.
    return (
      <Outcome
        tone="allowed"
        title={`${label} — allowed by the Permissioned Resolver`}
        action={
          <VStack gap={0}>
            <Field label="Was" value={result.before || "(empty)"} />
            <Field label="Now" value={result.after} />
            <Field label="Transaction" value={result.transaction.hash} />
            <Field label="Actor" value={result.actor} />
          </VStack>
        }
      />
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
