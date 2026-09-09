"use client";

import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { previewPayment, sendPayment } from "@/lib/api";
import { classify } from "@/lib/console/errors";
import { financialStateFrom, LOADING_COPY } from "@/lib/console/state";
import { Field, Frame, Loading, Outcome } from "./primitives";

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
    <VStack gap={4}>
      <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
        <TextInput label="Task" value={task} onChange={setTask} />
        {/*
          No `inputMode` — Astryx's TextInput does not expose it. The filter in
          onChange is what actually keeps this numeric, and it did before too:
          the attribute only ever picked the phone keyboard.
        */}
        <TextInput
          label="Budget (wei)"
          value={amount}
          onChange={(next) => setAmount(next.replace(/\D/g, ""))}
        />
      </Grid>

      <Text type="code" size="sm" color="secondary" hasTabularNumbers>
        {ensName} → {recipient} · {formatEth(amount || "0")} ETH
      </Text>

      <HStack gap={2} wrap="wrap">
        <Button
          variant="secondary"
          label="Preview policy"
          onClick={runPreview}
          isDisabled={busy !== null}
        />
        <Button
          variant="primary"
          label="Execute"
          onClick={execute}
          isDisabled={busy !== null}
        />
      </HStack>

      {busy ? <Loading what={busy} /> : null}

      {preview ? (
        <Frame
          title="privy policy"
          subtitle="Informational. Privy enforces the limit on the signing path — this preview cannot allow or block anything."
        >
          <Field label="Requested" value={`${formatEth(preview.requestedWei)} ETH`} />
          <Field
            label="Limit"
            value={`${formatEth(preview.limitWei)} ETH`}
            source="privy policy"
            readAt={new Date().toISOString()}
          />
          <Field label="Rule" value={preview.policySummary.ruleName} />
          <Field label="Expected" value={preview.expected} />
        </Frame>
      ) : null}

      {result ? <PaymentOutcome result={result} state={state} amount={amount} /> : null}
    </VStack>
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
      <Outcome
        tone="allowed"
        title="Payment executed"
        detail={result.transactionHash}
      />
    );
  }

  if (state === "denied") {
    const error = classify(result as { status?: string; reason?: string });
    return (
      // `proof`, not `fault`. This is the policy doing its job, and docs/03 is
      // explicit that a denial is not a generic red error.
      //
      // No "request higher authority" button. docs/03 and docs/08 both forbid
      // simulating an approval path that is not implemented, and a button that
      // does nothing is worse than an absent one — it claims a capability.
      <Outcome
        tone="proof"
        title="Payment blocked — no funds moved"
        detail={"reason" in result ? String(result.reason) : error.detail}
        action={
          <VStack gap={0}>
            <Field label="Requested" value={`${formatEth(amount)} ETH`} />
            <Field label="Policy" value="amount limit" />
            <Field label="Decision" value="denied" />
          </VStack>
        }
      />
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
