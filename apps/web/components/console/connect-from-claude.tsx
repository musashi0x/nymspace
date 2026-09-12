"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { Absent } from "./primitives";

/**
 * Connect from Claude — what to run so a local Claude Code can use this
 * agent's MCP server, built from the endpoint the agent published.
 *
 * The URL is the live `agent-endpoint[mcp]` record, never the one this
 * deployment would derive from `AGENT_MCP_BASE_URL`. The record is the agent's
 * claim about where it answers; a snippet built from config would keep looking
 * right after the record stopped naming anything. The query string and
 * fragment are dropped because the permission proof writes `?proof=<ts>` to
 * force a changing value, and that stamp means nothing to a client.
 *
 * The record is written by the agent's controller, not by Nymspace, and this
 * renders a command someone will paste into a shell. So only an https URL is
 * accepted, and anything outside a conservative character set is
 * single-quoted — a path segment like `$(…)` survives URL parsing unencoded.
 *
 * Nothing here dials the endpoint. Whether it answers is the Connect button's
 * question; this only hands the operator what to run.
 */

export function ConnectFromClaude({
  ensName,
  label,
  endpoint,
}: {
  ensName: string;
  label: string;
  endpoint: string;
}) {
  const [open, setOpen] = useState(false);
  const url = clientUrl(endpoint);

  return (
    <VStack gap={3} paddingBlock={2}>
      <HStack gap={3} align="center" wrap="wrap">
        <Button
          variant="secondary"
          size="sm"
          label={open ? "Hide Claude setup" : "Connect from Claude"}
          onClick={() => setOpen(!open)}
        />
        <Text type="supporting" size="sm">
          Add this agent&apos;s MCP server to Claude Code on your computer.
        </Text>
      </HStack>

      {open ? (
        url ? (
          <ClaudeSetup ensName={ensName} label={label} url={url} />
        ) : (
          <Absent what="the published record is not an https URL, so there is nothing to add" />
        )
      ) : null}
    </VStack>
  );
}

function ClaudeSetup({
  ensName,
  label,
  url,
}: {
  ensName: string;
  label: string;
  url: string;
}) {
  const command = `claude mcp add --transport http --scope user ${quote(label)} ${quote(url)}`;
  const prompt = [
    `Add the MCP server for the agent ${ensName} to Claude Code.`,
    ``,
    `Its endpoint is ${url}, read from that name's agent-endpoint[mcp] ENS record.`,
    ``,
    `1. Run: ${command}`,
    `2. Run: claude mcp get ${quote(label)} and confirm it is configured.`,
    `3. A newly added server loads when a session starts, so tell me to restart Claude Code. In the new session, call its describe_agent tool and summarise what it reports.`,
    ``,
    `The server is read-only. The name it reports for itself is self-reported, not verified.`,
  ].join("\n");

  return (
    <VStack gap={2}>
      <Text type="supporting" size="sm">
        Run in a terminal. The user scope makes it available in every project.
      </Text>
      <CodeBlock code={command} language="bash" size="sm" width="100%" isWrapped />

      <Text type="supporting" size="sm">
        Or paste this prompt into Claude Code and let it do the setup.
      </Text>
      <CodeBlock
        code={prompt}
        language="plaintext"
        title="Prompt"
        size="sm"
        width="100%"
        isWrapped
      />
    </VStack>
  );
}

/** The record as a client should dial it, or null when it is not https. */
function clientUrl(record: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(record);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/** Bare when plainly safe in a POSIX shell, single-quoted otherwise. */
function quote(value: string): string {
  if (/^[A-Za-z0-9._~:/@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
