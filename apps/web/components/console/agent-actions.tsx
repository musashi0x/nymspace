"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { provisionAgentWallet, refreshAgent } from "@/lib/api";
import { Badge, Field, Loading, Outcome } from "./primitives";

/**
 * The Inspector's two operator actions.
 *
 * Everything else on that page is a read taken during the request. These are
 * the two things an operator can ask for from it: read the tracks that move on
 * their own again, and give the agent a wallet. Both end in `router.refresh()`,
 * because the sections around them are server-rendered from live reads and
 * should agree with what was just written rather than with the page load.
 */

interface StepView {
  what: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
}

/**
 * What each step did, in the words the server used.
 *
 * Four states from two booleans, and the fourth matters: a step that was not
 * attempted — gas on a deployment with no organization key — is neither a
 * failure nor a success, and drawing it red would send an operator to fix a
 * configuration choice.
 */
function stepBadge(step: StepView) {
  if (step.ok) {
    return step.skipped ? (
      <Badge>no spend</Badge>
    ) : (
      <Badge tone="good">done</Badge>
    );
  }
  return step.skipped ? (
    <Badge tone="warn">not done</Badge>
  ) : (
    <Badge tone="bad">failed</Badge>
  );
}

function Steps({ steps }: { steps: StepView[] }) {
  return (
    <VStack gap={1}>
      {steps.map((step, index) => (
        <Field
          key={`${index}-${step.what}`}
          label={step.what}
          mono={false}
          value={
            <HStack gap={2} align="center" wrap="wrap">
              {stepBadge(step)}
              <Text type="code" size="2xs" wordBreak="break-all">
                {step.detail}
              </Text>
            </HStack>
          }
        />
      ))}
    </VStack>
  );
}

/** Re-read ENSIP 25 and Agent0 for one agent. No transaction. */
export function RefreshTracks({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof refreshAgent>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await refreshAgent(agentId));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={3} paddingBlock={2}>
      <HStack gap={3} align="center" wrap="wrap">
        <Button
          variant="secondary"
          size="sm"
          label="Re-check verification and discovery"
          onClick={() => void run()}
          isDisabled={busy}
        />
        <Text type="supporting" size="sm">
          Reads the registry, ENS and Agent0 again. No transaction.
        </Text>
      </HStack>

      {busy ? <Loading what="Reading the registry, ENS and Agent0" /> : null}

      {error ? (
        <Outcome
          tone="fault"
          title="The re-check did not run"
          detail={error}
          action="A failure of this API, not a finding about the agent."
        />
      ) : null}

      {result ? (
        result.reason ? (
          <Outcome tone="waiting" title="Nothing to re-check" detail={result.reason} />
        ) : (
          <Steps steps={result.steps} />
        )
      ) : null}
    </VStack>
  );
}

/**
 * Give the agent a wallet under one policy, and gas.
 *
 * Two clicks, because it is the one control on the page that spends the
 * organization's money. The first says what it will do; the second does it.
 */
export function ProvisionWallet({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof provisionAgentWallet>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await provisionAgentWallet(agentId));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <VStack gap={3} paddingBlock={2}>
      <HStack gap={3} align="center" wrap="wrap">
        <Button
          variant={armed ? "primary" : "secondary"}
          size="sm"
          label={armed ? "Confirm: fund from the organization" : "Provision wallet"}
          onClick={() => void run()}
          isDisabled={busy}
        />
        <Text type="supporting" size="sm">
          {armed
            ? "Creates a Privy policy, a wallet under it, and tops up gas to 0.01 ETH on Base Sepolia from the organization."
            : "A Privy wallet capped by one policy. Nothing is spent until you confirm."}
        </Text>
      </HStack>

      {busy ? <Loading what="Creating the policy and the wallet" /> : null}

      {error ? (
        <Outcome
          tone="fault"
          title="Wallet provisioning did not run"
          detail={error}
          action="Nothing about the agent changed unless a step below says so."
        />
      ) : null}

      {result ? <Steps steps={result.steps} /> : null}
    </VStack>
  );
}
