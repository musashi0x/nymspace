"use client";

import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { formatAmount, fromBaseUnits, toBaseUnits } from "@nymspace/core";
import { approvePayment, previewPayment, sendPayment } from "@/lib/api";
import { classify } from "@/lib/console/errors";
import { financialStateFrom, LOADING_COPY } from "@/lib/console/state";
import { Badge, Field, Frame, Loading, Outcome } from "./primitives";

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
 *
 * The budget is typed in the token's own units — `5`, not `5000000`. The
 * conversion is `@nymspace/core`'s, the same code the server uses, because a
 * browser that scaled by eighteen decimals against a six-decimal token would
 * submit an amount four orders of magnitude too small and get a hash back.
 */

type PaymentResult = Awaited<ReturnType<typeof sendPayment>>;
type Preview = Awaited<ReturnType<typeof previewPayment>>;

/**
 * The token as the API sends it — an unbranded address, because it arrived as
 * JSON. The formatting functions read only the symbol and the decimals.
 */
type PolicyToken = { address: string; symbol: string; decimals: number };

/**
 * The option value standing for the organization.
 *
 * A sentinel rather than its address, so every option in the selector is keyed
 * by something unique: the organization's address and an unprovisioned agent's
 * controller key are both real addresses that can collide with each other.
 */
const ORGANIZATION = "__organization__";

/**
 * Another agent in the fleet, as a destination this one can pay.
 *
 * `walletAddress` is absent until that agent is provisioned, and an agent
 * without one cannot be paid: every agent in a fleet shares the delegated
 * controller key, so sending to a controller sends to an address that is not
 * the agent's and is not even unique to it. Those are offered and disabled
 * rather than hidden, because "trader has no wallet yet" is the useful answer.
 */
export interface Peer {
  ensName: string;
  walletAddress?: string;
}

export function TaskRequest({
  agentId,
  ensName,
  recipient,
  peers = [],
  limitAmount,
  token,
}: {
  agentId: string;
  ensName: string;
  /** The organization that owns this name — the fallback destination. */
  recipient: string;
  /**
   * The rest of the fleet. An agent paying another agent is the arrangement
   * worth showing; paying the organization that owns it is a self-send that
   * proves the cap and nothing else.
   */
  peers?: Peer[];
  /** The live policy limit, in base units. */
  limitAmount: string;
  /** What the policy is denominated in. `null` is native ETH. */
  token: PolicyToken | null;
}) {
  const symbol = token?.symbol ?? "ETH";

  const [task, setTask] = useState("Review ENSv2 adoption");
  /*
    Default to a peer where the fleet has one.

    Paying the organization that owns your name is a circle: the wallet is
    org-owned, so the funds arrive where they started and the only thing
    demonstrated is that the cap held. Paying *another agent* is the same proof
    plus the reason the proof matters — one autonomous party paying another
    under a limit a human set, which is what `docs/01`'s financial controller is
    for. The organization stays available as a destination, because a controlled
    address is the safe answer when no peer exists.
  */
  /*
    Keyed by ENS name, not by address.

    Two agents in this fleet share one delegated controller key, so addresses
    are not unique across the options — React saw two children with the same
    key, and worse, picking either peer would have sent to the identical
    address. The name is the identity; the address is resolved from it below.
  */
  const [payee, setPayee] = useState(
    () => peers.find((peer) => peer.walletAddress)?.ensName ?? ORGANIZATION,
  );
  const [budget, setBudget] = useState(() => fromBaseUnits(limitAmount, token));
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [approval, setApproval] = useState<Awaited<
    ReturnType<typeof approvePayment>
  > | null>(null);

  /**
   * An unparseable budget is a local error, not a request.
   *
   * Sending it would produce a 400 the operator reads as a policy problem, and
   * the one thing this screen must never blur is the line between "your input
   * was wrong" and "the boundary held".
   */
  let amount: string | null = null;
  let amountError: string | null = null;
  try {
    amount = toBaseUnits(budget || "0", token).toString();
  } catch (error) {
    amountError = error instanceof Error ? error.message : String(error);
  }

  function reset() {
    setResult(null);
    setApproval(null);
  }

  async function runPreview() {
    if (!amount) return;
    setBusy(LOADING_COPY.policy);
    reset();
    try {
      setPreview(
        await previewPayment(agentId, {
          amount,
          recipient: payeeAddress,
          ...(token && { token: token.address }),
          memo: task,
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function execute() {
    if (!amount) return;
    setBusy(LOADING_COPY.transaction);
    setApproval(null);
    try {
      setResult(
        await sendPayment(agentId, {
          amount,
          recipient: payeeAddress,
          ...(token && { token: token.address }),
          memo: task,
        }),
      );
    } catch (error) {
      setResult({
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      } as PaymentResult);
    } finally {
      setBusy(null);
    }
  }

  async function escalate(requestId: string) {
    setBusy(LOADING_COPY.transaction);
    try {
      setApproval(await approvePayment(agentId, requestId));
    } finally {
      setBusy(null);
    }
  }

  const state = result ? financialStateFrom(result) : "idle";
  const escalation =
    result && "escalation" in result ? result.escalation : undefined;

  /*
    Whether the amount currently typed is inside the policy.

    Computed here because both numbers are already on screen and the reader
    should not have to compare two base-unit integers by eye. It is a
    *prediction* and labelled as one everywhere it appears: task 5.12 tampers
    with the displayed limit and submits anyway, and Privy still refuses, so
    this is what the browser expects and never what decides.
  */
  const overLimit =
    amount !== null && BigInt(amount) > BigInt(limitAmount);

  /** The peer chosen, or `undefined` when the destination is the organization. */
  const chosen = peers.find((peer) => peer.ensName === payee);
  const payeeLabel = chosen?.ensName ?? null;
  /** Where the funds actually go. Only a provisioned peer has somewhere. */
  const payeeAddress = chosen?.walletAddress ?? recipient;

  return (
    /*
      `id="task"` because the treasury screen links here. Its "Request a task"
      action points at `/console/agents/:id#task`, which landed at the top of a
      long page until this existed — the one action on that table that did not
      arrive anywhere.
    */
    <VStack gap={4} id="task" className="scroll-mt-8">
      <Grid columns={{ minWidth: 220, max: 2 }} gap={3}>
        {/*
          "Note", not "Task". Nothing here dispatches work — the agent never
          receives this string and no job is created. It is a reason, recorded
          beside the outcome on the activity event, and calling it a task
          promised an execution that never happened.
        */}
        <TextInput label="Note" value={task} onChange={setTask} />
        {/*
          No `inputMode` — Astryx's TextInput does not expose it. The filter in
          onChange is what actually keeps this numeric, and it did before too:
          the attribute only ever picked the phone keyboard.
        */}
        <TextInput
          /*
            "Amount", not "Budget". A budget is a ceiling you spend within; this
            is the exact figure transferred. The ceiling is the policy cap shown
            below it, and two fields that both read as limits — one of them not
            one — is the confusion this screen exists to remove.
          */
          label={`Amount (${symbol})`}
          value={budget}
          onChange={(next) => setBudget(next.replace(/[^\d.]/g, ""))}
          {...(amountError && {
            status: { type: "error" as const, message: amountError },
          })}
        />
      </Grid>

      {/*
        The destination, chosen rather than assumed.

        Options are the rest of the fleet plus the organization. An agent's
        wallet address where it has one, because that is where the funds
        actually land — the controller key is its identity, not its account.
      */}
      <Selector
        label="Pay"
        value={payee}
        onChange={setPayee}
        options={[
          ...peers.map((peer) => ({
            value: peer.ensName,
            label: peer.ensName,
            description: peer.walletAddress
              ? "another agent in this fleet"
              : "no wallet yet — nothing to pay into",
            disabled: !peer.walletAddress,
          })),
          {
            value: ORGANIZATION,
            label: "the organization",
            description: "the account that owns this name",
          },
        ]}
      />


      {/*
        The cap, next to the field it caps.

        This screen is entirely about a limit and the limit was not on it — the
        budget merely defaulted to it, so an operator who typed over it had no
        reference and learned the boundary only from a refusal. Showing both,
        and which side of the line the current number falls on, turns the
        refusal from a surprise into something the reader chose.
      */}
      <HStack gap={3} wrap="wrap" align="center">
        <Text type="supporting">
          Policy cap {formatAmount(limitAmount, token)} per transaction
        </Text>
        {amount !== null ? (
          <Badge tone={overLimit ? "warn" : "good"}>
            {overLimit ? "over the cap" : "within the cap"}
          </Badge>
        ) : null}
        <Text type="supporting">
          {/*
            Never "will be allowed". The browser holds both numbers and can
            compare them; it cannot make the decision, and a confident verb here
            would invite trusting this page over the provider that does.
          */}
          {overLimit
            ? "Privy should refuse this, and no funds move if it does."
            : "Nothing here decides it — Privy is asked on the signing path."}
        </Text>
      </HStack>

      {/*
        Who pays whom, in words above the addresses.

        The arrow alone left the direction to be inferred from two hex strings,
        and the inference most readers make — that this pays the agent for the
        work described — is backwards: the funds leave the agent's own wallet
        and go to the organization that owns its name. That is the arrangement
        being demonstrated, an agent spending under a cap its owner set, and it
        only reads as one when the two roles are named.
      */}
      <VStack gap={1}>
        <Text type="supporting">
          {payeeLabel === null
            ? `${ensName} spends from its own wallet, back to the organization that owns its name.`
            : `${ensName} spends from its own wallet to pay ${payeeLabel}, under a cap the organization set.`}
        </Text>
        <Text type="code" size="sm" color="secondary" hasTabularNumbers>
          {ensName} → {payeeAddress} ·{" "}
          {amount ? formatAmount(amount, token) : `— ${symbol}`}
        </Text>
      </VStack>

      <HStack gap={2} wrap="wrap">
        <Button
          variant="secondary"
          label="Preview policy"
          onClick={runPreview}
          isDisabled={busy !== null || amount === null}
        />
        <Button
          /*
            Secondary once the amount is over the cap. A primary button is the
            interface saying "this is the thing to do", and the thing to do with
            an amount the policy will refuse is to send it deliberately, having
            read the badge — which is a demonstration, not the happy path.
          */
          variant={overLimit ? "secondary" : "primary"}
          label={overLimit ? "Execute anyway" : "Execute"}
          onClick={execute}
          isDisabled={busy !== null || amount === null}
        />
      </HStack>

      {busy ? <Loading what={busy} /> : null}

      {preview ? (
        <Frame
          title="privy policy"
          subtitle="Informational. Privy enforces the limit on the signing path — this preview cannot allow or block anything."
        >
          <Field
            label="Requested"
            value={formatAmount(preview.requestedAmount, preview.token)}
          />
          <Field
            label="Limit"
            value={formatAmount(preview.limitAmount, preview.limitToken)}
            source="privy policy"
            readAt={preview.readAt}
          />
          <Field label="Rule" value={preview.policySummary.ruleName} />
          <Field label="Expected" value={preview.expected} />
        </Frame>
      ) : null}

      {result ? (
        <PaymentOutcome
          result={result}
          state={state}
          amount={amount ?? "0"}
          token={token}
          {...(escalation &&
            !approval && {
              onEscalate: () => escalate(escalation.requestId),
              escalationLabel: escalation.authority,
            })}
        />
      ) : null}

      {approval ? <ApprovalOutcome approval={approval} token={token} /> : null}
    </VStack>
  );
}

function PaymentOutcome({
  result,
  state,
  amount,
  token,
  onEscalate,
  escalationLabel,
}: {
  result: PaymentResult;
  state: ReturnType<typeof financialStateFrom>;
  amount: string;
  token: PolicyToken | null;
  onEscalate?: () => void;
  escalationLabel?: string;
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
      // The approval button appears only when the API sent an escalation
      // reference, which it does only when an owner key is configured. docs/03
      // and docs/08 both forbid simulating an approval path — a button that
      // does nothing is worse than an absent one, because it claims a
      // capability.
      <Outcome
        tone="proof"
        title="Payment blocked — no funds moved"
        detail={"reason" in result ? String(result.reason) : error.detail}
        action={
          <VStack gap={2}>
            <VStack gap={0}>
              <Field label="Requested" value={formatAmount(amount, token)} />
              <Field label="Policy" value="amount limit on the agent's signer" />
              <Field label="Decision" value="denied" />
            </VStack>
            {onEscalate ? (
              <Button
                variant="secondary"
                label={`Request ${escalationLabel ?? "owner"} approval`}
                onClick={onEscalate}
              />
            ) : null}
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

/**
 * The same request, executed by a different authority.
 *
 * Shown beneath the denial rather than replacing it. The denial is the proof,
 * and a screen that swapped it for a success would be claiming the payment was
 * always fine.
 */
function ApprovalOutcome({
  approval,
  token,
}: {
  approval: Awaited<ReturnType<typeof approvePayment>>;
  token: PolicyToken | null;
}) {
  if (approval.status === "executed" && "transactionHash" in approval) {
    return (
      <Outcome
        tone="allowed"
        title={`Executed by the ${approval.authority}`}
        detail={approval.transactionHash}
        action={
          <VStack gap={0}>
            <Field label="Approved" value={approval.approvedRequestId} />
            <Field
              label="Authority"
              value="organization owner key — not bound by the agent's policy"
            />
            <Field label="Token" value={token?.symbol ?? "ETH"} />
          </VStack>
        }
      />
    );
  }

  const error = classify(approval as { status?: string; reason?: string });
  return (
    <Outcome
      tone={error.tone}
      title="The approval did not execute"
      detail={"reason" in approval ? String(approval.reason) : error.detail}
    />
  );
}
