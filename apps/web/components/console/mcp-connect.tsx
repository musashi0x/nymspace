"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Item } from "@astryxdesign/core/Item";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useState, type ReactNode } from "react";
import { connectMcp, type ConnectTarget } from "@/lib/api";
import { Absent, Badge, Field, Loading, Outcome } from "./primitives";

/**
 * Connect — does this agent's MCP endpoint answer, and what does it offer?
 *
 * The API performs a handshake and a tool listing against the endpoint the
 * agent published, and never calls a tool. This renders what came back without
 * upgrading or softening it:
 *
 * - a served tool list is remote text, rendered as text and nothing else;
 * - the server's reported name is its own claim, labelled self-reported and
 *   kept away from the treatment ENSIP 25 verification gets;
 * - a failure is a finding about the endpoint, drawn as a warning with the
 *   stage or rule it failed at, and kept visibly apart from a failure of this
 *   API, which is the only thing drawn as a fault.
 */

type ConnectResult = Awaited<ReturnType<typeof connectMcp>>;
type Connected = Extract<ConnectResult, { status: "connected" }>;

export function McpConnect({ target }: { target: ConnectTarget }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await connectMcp(target));
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
          label={result ? "Connect again" : "Connect"}
          onClick={() => void run()}
          isDisabled={busy}
        />
        <Text type="supporting" size="sm">
          Handshake and tool list only. No tool on the server is called.
        </Text>
      </HStack>

      {busy ? <Loading what="Connecting over MCP" /> : null}

      {error ? (
        <Outcome
          tone="fault"
          title="Nymspace could not run the connect"
          detail={error}
          action="A failure of this API, not a finding about the agent's endpoint."
        />
      ) : null}

      {result ? <ConnectOutcomeView result={result} /> : null}
    </VStack>
  );
}

const SOURCE_LABEL = {
  ens: "ENS record",
  graph: "Agent0 registration",
} as const;

const RULE_COPY = {
  "https-only": "The endpoint is not https.",
  "private-address": "It resolves to an internal address.",
  redirect: "It answered with a redirect, and a redirect is a target nobody checked.",
} as const;

const FINDING =
  "A finding about this endpoint at the time shown. Nymspace answered; the endpoint did not.";

function ConnectOutcomeView({ result }: { result: ConnectResult }) {
  const endpoint = (
    <Field
      label="MCP endpoint"
      value={result.endpoint ?? <Absent what="nothing published, so nothing was dialled" />}
      source={SOURCE_LABEL[result.endpointSource]}
      readAt={result.readAt}
    />
  );

  switch (result.status) {
    case "connected":
      return <ConnectedView result={result} endpoint={endpoint} />;

    case "no_endpoint":
      return endpoint;

    case "blocked":
      return (
        <VStack gap={2}>
          <Outcome
            tone="proof"
            title="Blocked by the outbound guard — nothing was sent"
            detail={result.rule}
            action={RULE_COPY[result.rule]}
          />
          {endpoint}
        </VStack>
      );

    case "unreachable":
    case "timeout":
      return (
        <VStack gap={2}>
          <Outcome
            tone="waiting"
            title={`${result.status === "timeout" ? "Timed out" : "Unreachable"} at ${result.stage}`}
            detail={result.detail}
            action={FINDING}
          />
          {endpoint}
        </VStack>
      );

    case "not_mcp":
      return (
        <VStack gap={2}>
          <Outcome
            tone="waiting"
            title="Answered, but not as an MCP server"
            detail={
              result.httpStatus !== undefined
                ? `HTTP ${result.httpStatus} — ${result.detail}`
                : result.detail
            }
            action={FINDING}
          />
          {endpoint}
        </VStack>
      );
  }
}

const IDENTITY = {
  matches: { tone: "neutral", label: "name matches", text: "matches" },
  differs: { tone: "warn", label: "name differs", text: "differs from" },
  not_reported: { tone: "neutral", label: "no name reported", text: "could not be compared with" },
} as const;

function ConnectedView({
  result,
  endpoint,
}: {
  result: Connected;
  endpoint: ReactNode;
}) {
  const fromServer = { source: "MCP handshake", readAt: result.readAt };

  return (
    <VStack gap={2}>
      <Outcome tone="allowed" title="The endpoint completed an MCP handshake" />
      {endpoint}
      <Field
        label="Protocol version"
        value={result.protocolVersion ?? <Absent what="the server did not report one" />}
        {...fromServer}
      />
      <Field
        label="Reported server name"
        value={result.server.name ?? <Absent what="the server reported no name" />}
        {...fromServer}
      />

      {/*
        Neutral even when the names match. The server can send any name it
        likes, so a match is a consistency check; the green treatment belongs
        to ENSIP 25, which reads the other side before it says anything.
      */}
      {result.identity ? (
        <HStack gap={2} align="center" wrap="wrap">
          <Badge tone={IDENTITY[result.identity.result].tone}>
            self-reported · {IDENTITY[result.identity.result].label}
          </Badge>
          <Text type="supporting" size="sm">
            The reported name {IDENTITY[result.identity.result].text}{" "}
            {result.identity.expected}. A consistency check, not verification.
          </Text>
        </HStack>
      ) : null}

      <ToolList tools={result.tools} truncated={result.toolsTruncated} />

      {result.claim ? <ClaimView claim={result.claim} /> : null}
    </VStack>
  );
}

function ToolList({
  tools,
  truncated,
}: {
  tools: Connected["tools"];
  truncated: boolean;
}) {
  if (tools.length === 0) {
    return <Field label="Tools" value={<Absent what="the server listed no tools" />} />;
  }

  return (
    <VStack gap={1}>
      <Text type="supporting" size="sm">
        Tools, as the server lists them
        {truncated ? " — the listing stopped at the page cap" : ""}
      </Text>
      {tools.map((tool, i) => (
        <Item
          key={`${i}-${tool.name}`}
          density="compact"
          align="start"
          label={
            <Text type="code" size="sm" wordBreak="break-all">
              {tool.name}
            </Text>
          }
          description={tool.description ?? undefined}
          descriptionLines={3}
          endContent={
            tool.inputs.length > 0 ? (
              <Text type="code" size="2xs" color="secondary">
                {tool.inputs.join(", ")}
              </Text>
            ) : undefined
          }
        />
      ))}
    </VStack>
  );
}

/**
 * The registration's claim against the served list, as the API computed it.
 *
 * Nothing is compared here: the console draws. `missing` is absent when the
 * listing was truncated, and that is rendered as "cannot tell" rather than as
 * "none", because half a list cannot prove a tool is not served.
 */
function ClaimView({ claim }: { claim: NonNullable<Connected["claim"]> }) {
  return (
    <VStack gap={1}>
      <Text type="supporting" size="sm">
        Against the Agent0 registration, which claims {claim.claimed.length} tools
      </Text>
      <Field
        label="Claimed, not served"
        value={
          claim.missing === undefined ? (
            <Absent what="cannot tell, the listing was truncated" />
          ) : claim.missing.length > 0 ? (
            claim.missing.join(", ")
          ) : (
            "none — every claimed tool is served"
          )
        }
      />
      <Field
        label="Served, not claimed"
        value={claim.unclaimed.length > 0 ? claim.unclaimed.join(", ") : "none"}
      />
    </VStack>
  );
}
