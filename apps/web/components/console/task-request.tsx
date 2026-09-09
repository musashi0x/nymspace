"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { previewPayment, sendPayment } from "@/lib/api";
import { classify } from "@/lib/console/errors";
import { financialStateFrom, LOADING_COPY } from "@/lib/console/state";
import { Loading, Outcome } from "./primitives";

/**
 * Screens 4 and 5 — the task request and the policy denial.
 *
 * One component, because they are one flow: the denial is not an error page the
 * operator is thrown to, it is the outcome of the request they just made, and
 * separating them would frame it as a failure.
 *
 * The preview says out loud that it decides nothing. Task 5.12 tampers with the
 * displayed limit and submits anyway, and Privy still refuses — so the honest
 * label for this number is "what we expect", and calling it anything stronger
 * would invite the reader to trust the browser over the provider.
 */

type PaymentResult = Awaited<ReturnType<typeof sendPayment>>;
type Preview = Awaited<ReturnType<typeof previewPayment>>;

function formatEth(wei: string): string {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function TaskRequest({
  agentId,
  ensName,
  recipient,
  suggestedAmountWei,
}: {
  agentId: string;
  ensName: string;
  recipient: string;
  suggestedAmountWei: string;
}) {
  const [task, setTask] = useState("Review ENSv2 adoption");
  const [amount, setAmount] = useState(suggestedAmountWei);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<PaymentResult | null>(null);

  async function runPreview() {
    setBusy(LOADING_COPY.policy);
    setResult(null);
    try {
      setPreview(await previewPayment(agentId, { amount, recipient, memo: task }));
    } finally {
      setBusy(null);
    }
  }

  async function execute() {
    setBusy(LOADING_COPY.transaction);
    try {
      setResult(await sendPayment(agentId, { amount, recipient, memo: task }));
    } catch (error) {
      setResult({
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      } as PaymentResult);
    } finally {
      setBusy(null);
    }
  }

  const state = result ? financialStateFrom(result) : "idle";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Task</span>
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Budget (wei)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring"
          />
        </label>
      </div>

      <p className="font-mono text-[0.7rem] text-muted-foreground">
        {ensName} → {recipient} · {formatEth(amount || "0")} ETH
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={runPreview} disabled={busy !== null}>
          Preview policy
        </Button>
        <Button onClick={execute} disabled={busy !== null}>
          Execute
        </Button>
      </div>

      {busy ? <Loading what={busy} /> : null}

      {preview ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">Privy policy</p>
          <dl className="grid gap-1 font-mono text-[0.7rem] text-muted-foreground">
            <div>requested: {formatEth(preview.requestedWei)} ETH</div>
            <div>limit: {formatEth(preview.limitWei)} ETH (read from the live policy)</div>
            <div>rule: {preview.policySummary.ruleName}</div>
            <div>expected: {preview.expected}</div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Informational. Privy enforces the limit on the signing path — this
            preview cannot allow or block anything.
          </p>
        </div>
      ) : null}

      {result ? <PaymentOutcome result={result} state={state} amount={amount} /> : null}
    </div>
  );
}

function PaymentOutcome({
  result,
  state,
  amount,
}: {
  result: PaymentResult;
  state: ReturnType<typeof financialStateFrom>;
  amount: string;
}) {
  if (state === "executed" && "transactionHash" in result) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
        <p className="text-sm font-medium">Payment executed</p>
        <p className="font-mono text-[0.7rem] break-all text-muted-foreground">
          {result.transactionHash}
        </p>
      </div>
    );
  }

  if (state === "denied") {
    const error = classify(result as { status?: string; reason?: string });
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
        <p className="text-sm font-medium">Payment blocked</p>
        <dl className="grid gap-1 font-mono text-[0.7rem] text-muted-foreground">
          <div>requested: {formatEth(amount)} ETH</div>
          <div>policy: amount limit</div>
          <div>decision: denied</div>
        </dl>
        <p className="text-sm">No funds moved.</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {"reason" in result ? String(result.reason) : error.detail}
        </p>
        {/*
          No "request higher authority" button. docs/03 and docs/08 both forbid
          simulating an approval path that is not implemented, and a button that
          does nothing is worse than an absent one — it claims a capability.
        */}
      </div>
    );
  }

  const error = classify(result as { status?: string; reason?: string });
  return (
    <Outcome
      tone={error.tone}
      title={error.title}
      detail={"reason" in result ? String(result.reason) : undefined}
      action={error.action}
    />
  );
}
