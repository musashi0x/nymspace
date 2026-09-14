"use client";

import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { Link as AstryxLink } from "@astryxdesign/core/Link";
import {
  Table,
  pixel,
  proportional,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { explorerTxUrl, publicEnv } from "@nymspace/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createAgent, fetchProvisioning, fetchSigners } from "@/lib/api";
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
type Step = Progress["steps"][number];

/**
 * What a row is doing right now.
 *
 * `done` is the only one backed by an event. The other three are this screen
 * reasoning about a write that has not happened, which is why none of them
 * renders a transaction, a read-back, or a result — a row may say it is
 * waiting, and may not say how it turned out.
 */
type RowState = "done" | "running" | "queued" | "unspent";

interface StepRow extends Record<string, unknown> {
  id: string;
  what: string;
  status: string;
  state: RowState;
  txHash: string | null;
  /** Null for the deployment's ENS chain; set for a registry step. */
  chainId: number | null;
  readBack: string | null;
}

/** The record keys `provisionAgent` writes, spelled the way `keys.ts` builds them. */
const ENDPOINT_KEY = {
  mcp: "agent-endpoint[mcp]",
  a2a: "agent-endpoint[a2a]",
} as const;

const CONTEXT_KEY = "agent-context";

/**
 * The ENSIP 25 key's fixed prefix. The rest embeds the id the registry mints,
 * so the plan cannot name the key in advance — only recognise it.
 */
const BINDING_KEY_PREFIX = "agent-registration[";

type PlanKind =
  | "register"
  | "resolver"
  | "record"
  | "grant"
  | "registry"
  | "binding"
  | "verify";

interface PlanRow {
  id: string;
  kind: PlanKind;
  /** The record key this row lands on, for the two kinds that have one. */
  key: string | null;
  what: string;
}

/**
 * The writes this submission asks for, listed before any of them happen.
 *
 * Without it the screen showed nothing for the ten-odd seconds between the
 * request and the first confirmation — a form that had visibly accepted
 * something and then reported no work at all. The plan is derived from the same
 * three inputs `provisionAgent` derives its own work from, so it is what was
 * asked for rather than a guess at what the server will do.
 *
 * It is never evidence. A planned row carries no transaction and no read-back
 * until an event arrives to fill it, because the whole argument of this screen
 * is that a step is only done when the chain has been read back afterwards.
 */
function planFor(input: {
  ensName: string;
  mcp: string;
  a2a: string;
  delegate: boolean;
}): PlanRow[] {
  const endpoints = (["mcp", "a2a"] as const).filter(
    (protocol) => input[protocol],
  );

  const rows: Omit<PlanRow, "id">[] = [
    { kind: "register", key: null, what: `Register ${input.ensName}` },
    { kind: "resolver", key: null, what: "Attach the permissioned resolver" },
    { kind: "record", key: CONTEXT_KEY, what: `Write ${CONTEXT_KEY}` },
    ...endpoints.map((protocol) => ({
      kind: "record" as const,
      key: ENDPOINT_KEY[protocol],
      what: `Write ${ENDPOINT_KEY[protocol]}`,
    })),
    ...(input.delegate
      ? endpoints.map((protocol) => ({
          kind: "grant" as const,
          key: ENDPOINT_KEY[protocol],
          what: `Grant SET_TEXT on ${ENDPOINT_KEY[protocol]}`,
        }))
      : []),
    // After identity, in the same run: `provisionAgent` registers only once
    // the name has been read back.
    { kind: "registry", key: null, what: "Register on ERC 8004" },
    { kind: "binding", key: null, what: "Write the ENSIP 25 record" },
    { kind: "verify", key: null, what: "Verify the ENSIP 25 binding" },
  ];

  return rows.map((row, index) => ({ ...row, id: `plan-${index}` }));
}

/**
 * Which planned write an event is.
 *
 * By type and record key, never by position: a run that finds a step already on
 * chain writes no event for it, so counting rows would slide every later event
 * onto the wrong plan row and report the wrong step as the one in flight.
 */
const KIND_OF: Record<string, PlanKind | undefined> = {
  "agent.created": "register",
  "ens.resolver.attached": "resolver",
  "ens.record.updated": "record",
  "ens.permission.granted": "grant",
  "ens.action.denied": "grant",
  "erc8004.registered": "registry",
  "ensip25.verified": "verify",
  "ensip25.failed": "verify",
};

/** The ENSIP 25 record is a record write like any other, told apart by key. */
function kindOf(step: Step): PlanKind | undefined {
  if (
    step.type === "ens.record.updated" &&
    step.key?.startsWith(BINDING_KEY_PREFIX)
  ) {
    return "binding";
  }
  return KIND_OF[step.type];
}

function matches(plan: PlanRow, step: Step): boolean {
  return (
    kindOf(step) === plan.kind &&
    (plan.key === null || plan.key === step.key)
  );
}

/**
 * The plan with the events that have arrived folded into it.
 *
 * Events that match nothing planned are appended rather than dropped — the
 * server is the authority on what it did, and a row this screen did not expect
 * is exactly the row worth seeing.
 *
 * With no plan — a run resumed from the query string, whose form this page
 * never held — the events are the whole list, which is what this screen showed
 * before there was a plan at all.
 */
function rowsFor(
  plan: PlanRow[] | null,
  steps: Step[],
  complete: boolean,
): StepRow[] {
  const arrived = (step: Step, id: string): StepRow => ({
    id,
    what: step.what,
    status: step.status,
    state: "done",
    txHash: step.txHash,
    chainId: step.chainId,
    readBack: step.readBack,
  });

  if (!plan) return steps.map((step, index) => arrived(step, `${index}`));

  const used = new Set<number>();
  const rows: StepRow[] = plan.map((row) => {
    const index = steps.findIndex(
      (step, at) => !used.has(at) && matches(row, step),
    );
    const step = index === -1 ? null : steps[index];
    if (!step) {
      return {
        id: row.id,
        what: row.what,
        status: "",
        // A finished run that never wrote this step spent nothing on it. Which
        // of the two reasons — already on chain, or never reached — is the
        // ENS track's answer, not this row's.
        state: complete ? "unspent" : "queued",
        txHash: null,
        chainId: null,
        readBack: null,
      };
    }
    used.add(index);
    return arrived(step, row.id);
  });

  // Exactly one row is in flight: the first the run has not accounted for yet.
  if (!complete) {
    const next = rows.findIndex((row) => row.state === "queued");
    if (next !== -1) rows[next] = { ...rows[next]!, state: "running" };
  }

  return [
    ...rows,
    ...steps
      .map((step, index) => ({ step, index }))
      .filter(({ index }) => !used.has(index))
      .map(({ step, index }) => arrived(step, `unplanned-${index}`)),
  ];
}

/**
 * The same shape `addressSchema` enforces in `apps/api/src/routes/shared.ts`.
 *
 * A backstop, not the primary defence: the field is normally filled from
 * `GET /v1/signers` and locked. It matters when that read fails and the operator
 * types the address, which is the one path where a truncated paste can reach
 * the route and come back as a ZodError the form would have to render.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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
    width: pixel(130),
    // A row that has not run reports where it is in the queue, and nothing
    // else. `neutral` for all three: none of them is news, and an amber row
    // for a write that simply has not started yet reads as a problem.
    renderCell: (row) => {
      if (row.state === "running") return <Badge>in flight</Badge>;
      if (row.state === "queued") return <Badge>queued</Badge>;
      if (row.state === "unspent") return <Badge>no transaction</Badge>;
      return (
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
      );
    },
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
    // Two chains in one list. ENS steps are on the chain this deployment is
    // configured for; registry steps carry their own chain id, because the
    // registration lives on `REGISTRATION_CHAIN_ID` and a link built from the
    // ENS chain would open somebody else's transaction.
    renderCell: (row) => {
      // A planned row has no transaction *yet*, which is not the same claim as
      // a run that sent none — so it says nothing rather than "no transaction".
      if (row.state !== "done")
        return (
          <Text type="code" size="2xs" color="secondary">
            —
          </Text>
        );
      const url =
        row.txHash && !/^0x0+$/.test(row.txHash)
          ? explorerTxUrl(row.chainId ?? publicEnv().chainId, row.txHash)
          : null;
      return row.txHash && !/^0x0+$/.test(row.txHash) ? (
        url ? (
          <AstryxLink href={url} isExternalLink type="code" size="2xs">
            {row.txHash}
          </AstryxLink>
        ) : (
          <Text type="code" size="2xs" color="secondary" wordBreak="break-all">
            {row.txHash}
          </Text>
        )
      ) : (
        <Text type="code" size="2xs" color="secondary">
          no transaction
        </Text>
      );
    },
  },
];

export function CreateAgent({ parentName }: { parentName: string }) {
  /**
   * Which run this screen is watching, in the URL.
   *
   * The steps are durable and the endpoint rebuilds them, but none of that
   * helps if a reload forgets which agent was being provisioned. Kept in the
   * query string rather than in state alone, so the tab can be closed, shared,
   * or refreshed mid-run and still show the same run.
   */
  const router = useRouter();
  const resumed = useSearchParams().get("agent");
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("");
  const [controller, setController] = useState("");
  /**
   * Where the controller address came from.
   *
   * Three states rather than a boolean because "not yet known" and "the API
   * could not say" render differently: the field is hidden while the read is in
   * flight, so a form that is about to fill itself in does not flash an input
   * the operator was never meant to touch.
   */
  const [controllerSource, setControllerSource] = useState<
    "loading" | "api" | "manual"
  >("loading");
  const [mcp, setMcp] = useState("");
  const [a2a, setA2a] = useState("");
  const [delegate, setDelegate] = useState(false);

  const [agentId, setAgentId] = useState<string | null>(resumed);
  /**
   * The writes this submission asked for, or null when the page never held the
   * form that asked — a resumed run, where the endpoints and the delegation are
   * the server's to report rather than this screen's to assume.
   */
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
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

  // Timers only; this effect sets no state of its own. The zero-delay one
  // covers the resumed case, where the run started in a previous page load and
  // waiting a full interval to show anything would look like a dead screen.
  useEffect(() => {
    if (!agentId || complete) return;
    const first = setTimeout(() => void poll(agentId), 0);
    const timer = setInterval(() => void poll(agentId), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [agentId, complete, poll]);

  /**
   * The controller address comes from the API rather than from the operator.
   *
   * Exactly one value works — the address of the key the server signs record
   * writes with — so a free-text field invites a mistake that does not surface
   * here. Provisioning grants the record keys to whatever is submitted, and the
   * write is signed by the server key regardless, so a wrong-but-well-formed
   * address produces an agent whose every permission reads as denied.
   *
   * So the field is not shown at all on the ordinary path. It is rendered only
   * when this read fails, because a create screen that cannot be filled in
   * because one request failed is worse than one that asks for an address the
   * operator can paste. `ADDRESS` still guards that path.
   */
  useEffect(() => {
    let live = true;
    void fetchSigners()
      .then((signers) => {
        if (!live) return;
        setController(signers.controller);
        setControllerSource("api");
      })
      .catch(() => {
        if (live) setControllerSource("manual");
      });
    return () => {
      live = false;
    };
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    setTaken(null);
    // Before the request, not after it: the point of the plan is the interval
    // where there is nothing else to show.
    setPlan(planFor({ ensName, mcp, a2a, delegate }));
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
        // Nothing was written, so there is no run to plan for.
        setPlan(null);
        return;
      }
      setAgentId(result.id);
      // Survives a reload from here on.
      router.replace(`/console/new?agent=${result.id}`, { scroll: false });
      await poll(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }

  const steps = rowsFor(plan, progress?.steps ?? [], complete);

  const ensName = label ? `${label}.${parentName}` : parentName;

  return (
    <VStack gap={6} width="100%" className="min-w-0">
      <Frame
        title="new agent"
        subtitle={`A subname under ${parentName}, its records, and — if you delegate — one grant per endpoint key. Then an ERC 8004 registration, bound back to the name. Signed by the organization.`}
      >
        <VStack gap={4}>
          {/*
            One grid, six fields, and every one of them carries a one-line
            description — including the ones whose label already says it. A row
            where only one side has helper text puts the two inputs at
            different heights, which is what this looked like first.

            Grid rather than a horizontal FormLayout: that one keeps its fields
            side by side at every width, and at 375px the form scrolled
            sideways. `minWidth` is what collapses this to a single column
            before that can happen.
          */}
          <Grid columns={{ minWidth: 260, max: 2 }} gap={3}>
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
              description="How the agent introduces itself"
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
              description="What this agent is for, in one line"
              placeholder="Reads discovery data and updates its own MCP endpoint"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="MCP endpoint"
              value={mcp}
              onChange={setMcp}
              isOptional
              description="Where the agent answers MCP"
              placeholder="https://…/mcp"
              isDisabled={agentId !== null}
            />
            <TextInput
              label="A2A endpoint"
              value={a2a}
              onChange={setA2a}
              isOptional
              description="A second protocol endpoint, if the agent serves one"
              placeholder="https://…/a2a"
              isDisabled={agentId !== null}
            />
          </Grid>

          {/*
            Only when the API could not supply it. Its own row: 42 hex
            characters do not fit half of one.
          */}
          {controllerSource === "manual" ? (
            <TextInput
              label="Controller address"
              value={controller}
              onChange={setController}
              isRequired
              description="The key the agent itself signs with"
              placeholder="0x…"
              isDisabled={agentId !== null}
            />
          ) : null}

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
              isDisabled={
                busy || agentId !== null || !label || !name || !ADDRESS.test(controller)
              }
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

      {plan || (agentId && progress) ? (
        <Frame
          title="provisioning"
          subtitle="Every write this submission asks for, in the order it happens. A row becomes a transaction and the read that followed it; one that ends with no transaction spent nothing, because it found its work already on chain."
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

            {/*
              Only once the run has answered. Before the first poll returns
              there is a plan and nothing else, and five tracks painted from
              defaults would be this screen reporting chain state it has not
              read.
            */}
            <HStack gap={3} wrap="wrap" align="center">
              {(progress ? TRACKS : []).map(({ key, header }) => {
                const value = progress!.tracks[key];
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
              Creation advances identity, then registers the agent on ERC 8004
              and verifies the binding. Indexing and the wallet are separate
              tracks with their own systems — an agent without them is
              unfinished, not broken.
            </Text>

            {complete && progress ? (
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
            ) : steps.some((row) => row.state === "done") ? (
              <Loading what="Waiting for the next confirmation" />
            ) : (
              <Loading what="Waiting for the first transaction" />
            )}
          </VStack>
        </Frame>
      ) : null}
    </VStack>
  );
}
