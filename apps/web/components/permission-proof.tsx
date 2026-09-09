"use client";

import * as React from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { AgentCapability, ProofOutcome, ProofResponse } from "@nymspace/core";
import { apiBaseUrl } from "@/lib/api";

/**
 * The permission proof (UX spec, "Test Permission interaction").
 *
 * Two steps, run as the agent controller:
 *   A. write the delegated MCP endpoint  -> expected to succeed
 *   B. write the protected ENSIP 25 binding -> expected to be refused by EAC
 *
 * Step B's refusal is the product claim, so it is rendered as a calm,
 * informational result — "Blocked by ENSv2 authority" — and not as a red error.
 * A refusal here is the system working.
 *
 * The third outcome matters as much as the other two. A denial only counts when
 * the contract's own decoded error says so; an RPC timeout or an unfunded
 * signer is `inconclusive` and is shown as such. The spike found a real
 * false-positive of exactly this kind, where a catch-all made a transport
 * failure indistinguishable from an enforced boundary, so an inconclusive run
 * must never be presented as proof.
 */

type Step = {
  key: string;
  title: string;
  capability: AgentCapability;
  expectation: "allowed" | "denied";
  description: string;
};

const STEPS: Step[] = [
  {
    key: "a",
    title: "Write the delegated MCP endpoint",
    capability: "record:agent-endpoint[mcp]",
    expectation: "allowed",
    description:
      "The controller holds ROLE_SET_TEXT on exactly this record key, so the resolver should accept the write.",
  },
  {
    key: "b",
    title: "Write the protected ENSIP 25 binding",
    capability: "record:agent-registration",
    expectation: "denied",
    description:
      "The controller holds no role on this key. The organization kept it, so the contract should refuse.",
  },
];

type RunState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; outcome: ProofOutcome }
  | { phase: "failed"; reason: string };

export function PermissionProof({
  name,
  enabled,
}: {
  name: string;
  enabled: boolean;
}) {
  const [runs, setRuns] = React.useState<Record<string, RunState>>({});

  async function run(step: Step) {
    setRuns((r) => ({ ...r, [step.key]: { phase: "running" } }));
    try {
      const res = await fetch(
        `${apiBaseUrl}/v1/agents/${encodeURIComponent(name)}/proof`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            capability: step.capability,
            actor: "controller",
          }),
        },
      );
      if (!res.ok) {
        setRuns((r) => ({
          ...r,
          [step.key]: {
            phase: "failed",
            reason: `The API answered ${res.status}. Nothing was proved either way.`,
          },
        }));
        return;
      }
      const body = (await res.json()) as ProofResponse;
      setRuns((r) => ({
        ...r,
        [step.key]: { phase: "done", outcome: body.outcome },
      }));
    } catch (cause) {
      setRuns((r) => ({
        ...r,
        [step.key]: {
          phase: "failed",
          reason:
            cause instanceof Error && cause.message
              ? `The request did not complete (${cause.message}). Nothing was proved either way.`
              : "The request did not complete. Nothing was proved either way.",
        },
      }));
    }
  }

  return (
    <Card elevation="none">
      <VStack gap={4} padding={5}>
        <VStack gap={1}>
          <Text type="large" as="p">
            Permission proof
          </Text>
          <Text type="body" size="sm" color="secondary">
            Runs two real writes as the agent controller. One should land; one
            should be refused by the contract.
          </Text>
        </VStack>
        <Divider />

        {!enabled && (
          <Banner
            status="info"
            container="card"
            title="Disabled until the chain-backed endpoints are wired"
            description="Running it now would prove nothing, so it does not offer to."
          />
        )}

        <VStack gap={5}>
          {STEPS.map((step) => {
            const state = runs[step.key] ?? { phase: "idle" };
            return (
              <VStack key={step.key} gap={3}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="body" size="sm" weight="medium">
                    {step.title}
                  </Text>
                  <Badge
                    variant="neutral"
                    label={
                      step.expectation === "allowed"
                        ? "expect: allowed"
                        : "expect: refused"
                    }
                  />
                </HStack>
                <Text type="body" size="sm" color="secondary">
                  {step.description}
                </Text>
                <HStack gap={3} vAlign="center">
                  <Button
                    variant="secondary"
                    size="sm"
                    label={
                      step.expectation === "allowed"
                        ? "Run permitted write"
                        : "Run protected write"
                    }
                    isDisabled={!enabled || state.phase === "running"}
                    isLoading={state.phase === "running"}
                    onClick={() => void run(step)}
                  />
                </HStack>
                <Outcome state={state} />
                <Divider />
              </VStack>
            );
          })}
        </VStack>
      </VStack>
    </Card>
  );
}

function Outcome({ state }: { state: RunState }) {
  if (state.phase === "idle" || state.phase === "running") return null;

  if (state.phase === "failed") {
    return (
      <Banner
        status="warning"
        container="card"
        title="Inconclusive"
        description={state.reason}
      />
    );
  }

  const { outcome } = state;

  if (outcome.result === "allowed") {
    return (
      <Banner
        status="success"
        container="card"
        title="Allowed by the Permissioned Resolver"
        description={`Mined in block ${outcome.blockNumber}, tx ${outcome.txHash}. Read back: ${outcome.readBack}`}
      />
    );
  }

  if (outcome.result === "denied_by_eac") {
    // Deliberately `info`, not `error`. The contract refusing an unauthorised
    // write is the feature working, and colouring it red would tell the viewer
    // the opposite of what happened.
    return (
      <Banner
        status="info"
        container="card"
        title="Blocked by ENSv2 authority"
        description={`The contract refused with ${outcome.decodedError}${
          outcome.simulated
            ? ", observed in simulation rather than a mined revert."
            : ", from a mined reverted transaction."
        }`}
      />
    );
  }

  return (
    <Banner
      status="warning"
      container="card"
      title="Inconclusive"
      description={`${outcome.reason}. This is not a permission verdict: the call never reached the point where EAC would decide.`}
    />
  );
}
