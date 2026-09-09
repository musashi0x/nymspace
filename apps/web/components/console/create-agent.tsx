"use client";

import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import {
  Table,
  pixel,
  proportional,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createAgent, fetchProvisioning } from "@/lib/api";
import { track } from "./fleet-table";
import { Badge, Frame, Loading, Outcome } from "./primitives";

/**
 * Screen 0 — create an agent.
 *
 * The form is one submission and the steps arrive afterwards, because they
 * have to: four transactions on Sepolia outlast the request, so the route
 * answers 202 and this polls `GET /:id/provisioning`. That endpoint reads the
 * activity log rather than a stream, so reloading this page mid-provision
 * rebuilds the list instead of losing it.
 *
 * Nothing here signs anything. Every write in this product is organization- or
 * controller-signed on the server, and a wallet prompt at this one screen would
 * be a second write path contradicting all of them. What the controller may do
 * on its own is proved on the agent's own page, where a granted key succeeds
 * and a protected one reverts.
 */

type Progress = Awaited<ReturnType<typeof fetchProvisioning>>;

interface StepRow extends Record<string, unknown> {
  id: string;
  what: string;
  status: string;
  txHash: string | null;
  readBack: string | null;
}

/** How often to ask. Sepolia blocks are ~12s; polling faster only adds load. */
const POLL_MS = 4000;

const TRACKS = [
  { key: "ens", header: "identity" },
  { key: "erc8004", header: "registry" },
  { key: "ensip25", header: "verification" },
  { key: "graph", header: "discovery" },
  { key: "financial", header: "financial" },
] as const;

const STEP_COLUMNS: TableColumn<StepRow>[] = [
  {
    key: "what",
    header: "step",
    width: proportional(2),
    renderCell: (row) => <Text type="body" size="sm">{row.what}</Text>,
  },
  {
    key: "status",
    header: "result",
    width: pixel(110),
    renderCell: (row) => (
      <Badge
        tone={
          row.status === "success"
            ? "good"
            : row.status === "denied"
              ? "warn"
              : row.status === "failed"
                ? "bad"
                : "neutral"
        }
      >
        {row.status}
      </Badge>
    ),
  },
  {
    key: "readBack",
    header: "read back",
    width: proportional(1),
    // The whole point of the column. A row showing only a transaction hash
    // reports that something was sent; this reports what the chain said
    // afterwards, which is the only evidence the step actually took.
    renderCell: (row) =>
      row.readBack ? (
        <Text type="code" size="2xs" wordBreak="break-all">
          {row.readBack}
        </Text>
      ) : (
        <Text type="code" size="2xs" color="secondary">
          —
        </Text>
      ),
  },
  {
    key: "txHash",
    header: "transaction",
    width: proportional(1),
    renderCell: (row) =>
      row.txHash && !/^0x0+$/.test(row.txHash) ? (
        <Text type="code" size="2xs" color="secondary" wordBreak="break-all">
          {row.txHash}
        </Text>
      ) : (
        <Text type="code" size="2xs" color="secondary">
          no transaction
        </Text>
      ),
  },
];

export function CreateAgent({ parentName }: { parentName: string }) {
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("");
  const [controller, setController] = useState("");
  const [mcp, setMcp] = useState("");
  const [a2a, setA2a] = useState("");
  const [delegate, setDelegate] = useState(false);

  const [agentId, setAgentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [taken, setTaken] = useState<{ owner: string; reason: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const complete = progress?.complete ?? false;

  const poll = useCallback(async (id: string) => {
    try {
      setProgress(await fetchProvisioning(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // The interval only. The first read happens where the run starts, so this
  // effect never sets state on its own.
  useEffect(() => {
    if (!agentId || complete) return;
    const timer = setInterval(() => void poll(agentId), POLL_MS);
    return () => clearInterval(timer);
  }, [agentId, complete, poll]);

  async function submit() {
    setBusy(true);
    setError(null);
    setTaken(null);
    try {
      const result = await createAgent({
        label,
        name,
        description,
        role,
        controller,
        endpoints: {
          ...(mcp ? { mcp } : {}),
          ...(a2a ? { a2a } : {}),
        },
        delegate,
      });

      if (result.status === "unavailable") {
        // Not a failure of this request. Someone owns the name, which is a
        // fact about the world rather than a fault in what was asked for.
        setTaken({ owner: result.owner, reason: result.reason });
        return;
      }
      setAgentId(result.id);
      await poll(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const steps: StepRow[] = (progress?.steps ?? []).map((step, index) => ({
    id: `${index}`,
    what: step.what,
    status: step.status,
    txHash: step.txHash,
    readBack: step.readBack,
  }));

  const ensName = label ? `${label}.${parentName}` : parentName;

  return (
    <VStack gap={6} width="100%" className="min-w-0">
      <Frame
        title="new agent"
        subtitle={`A subname under ${parentName}, its records, and — if you delegate — one grant per endpoint key. Signed by the organization.`}
      >
        <VStack gap={4}>
          <Grid columns={{ minWidth: 240, max: 2 }} gap={3}>
            <TextInput
              label="Label"
              value={label}
              onChange={setLabel}
              isRequired
              description={`Becomes ${ensName}`}
              placeholder="research"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="Display name"
              value={name}
              onChange={setName}
              isRequired
              placeholder="Research"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="Description"
              value={description}
              onChange={setDescription}
              isRequired
              description="Published in agent-context, written by the organization"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="Role"
              value={role}
              onChange={setRole}
              isRequired
              placeholder="Reads discovery data and updates its own MCP endpoint"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="Controller address"
              value={controller}
              onChange={setController}
              isRequired
              description="The key the agent itself signs with"
              placeholder="0x…"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="MCP endpoint"
              value={mcp}
              onChange={setMcp}
              isOptional
              placeholder="https://…/mcp"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="A2A endpoint"
              value={a2a}
              onChange={setA2a}
              isOptional
              isDisabled={agentId !== null}
            />
          </Grid>

          <CheckboxInput
            label="Let the controller update its own endpoint records"
            description="Grants SET_TEXT on the endpoint keys only. agent-context and the ENSIP 25 binding stay with the organization."
            value={delegate}
            onChange={setDelegate}
            isDisabled={agentId !== null}
          />

          <HStack gap={3} wrap="wrap" align="center">
            <Button
              variant="primary"
              label={agentId ? "Provisioning" : "Provision"}
              onClick={() => void submit()}
              isDisabled={busy || agentId !== null || !label || !name}
            />
            {busy ? <Loading what="Reading the parent registry" /> : null}
          </HStack>
        </VStack>
      </Frame>

      {taken ? (
        <Outcome
          tone="waiting"
          title="That name is already owned"
          detail={taken.owner}
          action={`${taken.reason}. Nothing was written — pick another label.`}
        />
      ) : null}

      {error ? (
        <Outcome tone="fault" title="The request did not complete" detail={error} />
      ) : null}

      {agentId && progress ? (
        <Frame
          title="provisioning"
          subtitle="Each row is a write and the read that followed it. Steps that found their work already on chain spend nothing and say so."
        >
          <VStack gap={4}>
            {steps.length === 0 ? (
              <Loading what="Waiting for the first transaction" />
            ) : (
              <Table
                data={steps}
                columns={STEP_COLUMNS}
                idKey="id"
                density="compact"
                dividers="none"
                verticalAlign="top"
              />
            )}

            <HStack gap={3} wrap="wrap" align="center">
              {TRACKS.map(({ key, header }) => {
                const value = progress.tracks[key];
                const t = track(key, value);
                return (
                  <HStack key={key} gap={1.5} align="center">
                    <Text type="supporting" size="2xs">
                      {header}
                    </Text>
                    <Badge tone={t.tone}>{t.text}</Badge>
                  </HStack>
                );
              })}
            </HStack>

            <Text type="supporting" as="p">
              Creation advances identity only. Registration, verification,
              indexing and the wallet are separate tracks with their own
              systems — an agent without them is unfinished, not broken.
            </Text>

            {complete ? (
              <Outcome
                tone={progress.tracks.ens === "active" ? "allowed" : "fault"}
                title={
                  progress.tracks.ens === "active"
                    ? "Identity provisioned"
                    : "Provisioning stopped"
                }
                detail={progress.ensName}
                action={
                  <Link href={`/console/agents/${agentId}`}>
                    <Text type="body" size="sm">
                      Inspect {progress.ensName}
                    </Text>
                  </Link>
                }
              />
            ) : (
              <Loading what="Waiting for the next confirmation" />
            )}
          </VStack>
        </Frame>
      ) : null}
    </VStack>
  );
}
