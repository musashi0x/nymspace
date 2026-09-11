"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import {
  ChatComposer,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
} from "@astryxdesign/core/Chat";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as React from "react";
import type { ConsoleAnswer, LensPlan, PlanStep } from "@nymspace/core";
import { LensCard } from "@/components/console/lens-card";
import { Loading, Outcome } from "@/components/console/primitives";
import { apiBaseUrl } from "@/lib/api";
import { classify, type ConsoleError } from "@/lib/console/errors";
import { LOADING_COPY } from "@/lib/console/state";

/**
 * Ask the console something; get back what it read.
 *
 * A chat shape, without a language model behind it. Each answer is assembled
 * server-side from live ENS, ERC 8004 and EAC reads and arrives as a structure
 * this file draws — so the console can be wrong about *which* question you
 * meant, but it cannot be wrong about an answer it gives, because it did not
 * write the answer. That trade is the point: fluency is worth nothing here and
 * a confidently wrong sentence about a permission is worth less than nothing.
 *
 * Which is why a question it cannot parse renders as its own thing rather than
 * an empty diagram. "I did not understand you" and "there is nothing there" are
 * different facts, and only one of them is about the fleet.
 *
 * ## Built from the same parts as every other screen
 *
 * `ChatMessageList`, `ChatMessage`, `ChatMessageBubble` and `ChatComposer` are
 * Astryx's own. This file arrived from another branch built from raw
 * `div`/`p`/`form`, which `AGENTS.md` names as drift; the composer in
 * particular was a hand-rolled input and button with no focus ring and no
 * status slot.
 */

/** What one plan step did when it was actually sent. */
interface StepOutcome {
  step: PlanStep;
  /** The contract refused, and for an `expectDenial` step that is the result. */
  denied: boolean;
  /** A transaction hash, a new value, whatever the route returned to show. */
  evidence?: string;
  error?: ConsoleError;
}

type Turn =
  | { role: "you"; text: string }
  /*
    A plan is its own turn, so it cannot arrive as a `console` answer. Stated
    in the type rather than checked at the bottom of the renderer: `ask` routes
    the two apart the moment the body lands, and a runtime guard for a case the
    type forbids is a branch nobody can ever reach or test.
  */
  | { role: "console"; answer: Exclude<ConsoleAnswer, LensPlan> }
  | { role: "plan"; plan: LensPlan; settled?: "ran" | "cancelled" }
  | { role: "ran"; plan: LensPlan; outcomes: StepOutcome[] }
  | { role: "problem"; error: ConsoleError };

export function ChatConsole({ suggestions }: { suggestions: readonly string[] }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  /**
   * The re-entrancy guard, in a ref rather than in `busy`.
   *
   * `busy` is read from the render closure and the composer's disabled state
   * only lands after a re-render, so a fast second submit would see `false`
   * and fire a second read. Harmless here — nothing in `/v1/chat` writes — but
   * it would interleave two answers into the transcript out of order.
   */
  const asking = React.useRef(false);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(message: string) {
    const text = message.trim();
    if (!text || asking.current) return;

    asking.current = true;
    setDraft("");
    setTurns((prev) => [...prev, { role: "you", text }]);
    setBusy(true);

    try {
      const res = await fetch(`${apiBaseUrl}/v1/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const body = (await res.json().catch(() => ({}))) as ConsoleAnswer & {
        error?: string;
        remedy?: string;
        status?: string;
        source?: string;
      };

      if (!res.ok) {
        /*
          The fields classify needs, named rather than the whole body.

          `LensAnswer` also has a `detail` — a list of rows for the diagram —
          and classify's `detail` is a sentence. Passing the body whole would
          have handed one to the other the moment classify learned to read it.
        */
        setTurns((prev) => [
          ...prev,
          {
            role: "problem",
            error: classify({
              status: body.status,
              source: body.source,
              error: body.error,
            }),
          },
        ]);
        return;
      }
      setTurns((prev) => [
        ...prev,
        body.kind === "plan"
          ? { role: "plan", plan: body }
          : { role: "console", answer: body },
      ]);
    } catch (cause) {
      setTurns((prev) => [
        ...prev,
        {
          role: "problem",
          error: classify({
            error: cause instanceof Error ? cause.message : "",
          }),
        },
      ]);
    } finally {
      asking.current = false;
      setBusy(false);
    }
  }

  /**
   * Run an approved plan, one step at a time, in order.
   *
   * Sequential on purpose. The steps of a plan depend on each other — a grant
   * before the write it permits, a preview before the payment it judges — and
   * firing them together would race a permission against the write that needs
   * it. Slower, and the only ordering that makes the results mean anything.
   *
   * It does not stop on a denial, because a denied step is often the point: the
   * payment plan previews and then deliberately attempts. It stops on nothing
   * at all, in fact — every step's outcome is recorded and shown, and the
   * operator reads the sequence rather than being told a verdict.
   */
  async function run(plan: LensPlan) {
    if (asking.current) return;
    asking.current = true;
    setBusy(true);
    setTurns((prev) =>
      prev.map((t) =>
        t.role === "plan" && t.plan === plan ? { ...t, settled: "ran" } : t,
      ),
    );

    const outcomes: StepOutcome[] = [];
    for (const step of plan.steps) {
      try {
        const res = await fetch(`${apiBaseUrl}${step.path}`, {
          method: step.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(step.body),
        });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        outcomes.push(readOutcome(step, res.ok, body));
      } catch (cause) {
        outcomes.push({
          step,
          denied: false,
          error: classify({
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        });
      }
    }

    setTurns((prev) => [...prev, { role: "ran", plan, outcomes }]);
    asking.current = false;
    setBusy(false);
  }

  function cancel(plan: LensPlan) {
    setTurns((prev) =>
      prev.map((t) =>
        t.role === "plan" && t.plan === plan ? { ...t, settled: "cancelled" } : t,
      ),
    );
  }

  return (
    <VStack gap={4} width="100%" className="min-w-0">
      {/*
        `align="top"`: the default fills spare height with a spacer so a short
        conversation sits against the composer. Inside a Frame that opens a gap
        under the title with nothing in it.
      */}
      <ChatMessageList align="top" gap={6} isStreaming={busy}>
        {turns.length === 0 ? (
          <ChatMessage sender="assistant">
            <ChatMessageBubble variant="ghost" width="100%">
              <Opening suggestions={suggestions} onPick={(s) => void ask(s)} />
            </ChatMessageBubble>
          </ChatMessage>
        ) : null}

        {turns.map((turn, i) => (
          <TurnView
            key={i}
            turn={turn}
            onPick={(s) => void ask(s)}
            onRun={(plan) => void run(plan)}
            onCancel={cancel}
          />
        ))}

        {busy ? (
          <ChatMessage sender="assistant">
            <ChatMessageBubble variant="ghost" width="100%">
              <Loading what={LOADING_COPY.ens} />
            </ChatMessageBubble>
          </ChatMessage>
        ) : null}
      </ChatMessageList>

      <div ref={endRef} />

      {/*
        No stop button: `isStopShown` is for generation that can be interrupted
        part-way, and a read either returns or fails. Offering to stop one would
        imply a partial answer exists to keep.
      */}
      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSubmit={(value) => void ask(value)}
        isDisabled={busy}
        placeholder="Ask about an agent, or the fleet"
        elevation="none"
      />
    </VStack>
  );
}

/**
 * What a route's answer means for the step that asked.
 *
 * `denied` is read from `status`, never from the HTTP code: the API answers a
 * refusal with 200 on purpose — `docs/11` — because a denial is the control
 * plane working and an error status would file it with the outages. So an `ok`
 * response can still be a refusal, and that is the interesting case rather
 * than an edge one.
 */
function readOutcome(
  step: PlanStep,
  ok: boolean,
  body: Record<string, unknown>,
): StepOutcome {
  const status = typeof body["status"] === "string" ? body["status"] : undefined;
  const denied = status === "denied";

  /*
    A connect answers 200 for every outcome, so its status is read here rather
    than falling through to "done". Without this an unreachable endpoint would
    render as a completed step — the exact overclaim connect exists to remove.
  */
  if (step.path === "/v1/mcp/connect" && status) {
    return readConnectOutcome(step, status, body);
  }

  if (denied) {
    return {
      step,
      denied: true,
      evidence: typeof body["reason"] === "string" ? body["reason"] : undefined,
    };
  }

  if (!ok || status === "failed" || status === "not_configured") {
    return {
      step,
      denied: false,
      error: classify({
        status,
        source: typeof body["source"] === "string" ? body["source"] : undefined,
        reason: typeof body["reason"] === "string" ? body["reason"] : undefined,
        detail: typeof body["detail"] === "string" ? body["detail"] : undefined,
        error: typeof body["error"] === "string" ? body["error"] : undefined,
      }),
    };
  }

  // The evidence each route actually returns, in the order it is worth seeing.
  const tx = body["transaction"];
  const hash =
    tx && typeof tx === "object" && "hash" in tx ? String(tx.hash) : undefined;
  const evidence =
    hash ??
    (typeof body["after"] === "string" ? body["after"] : undefined) ??
    (typeof body["expected"] === "string"
      ? `preview: ${body["expected"]}`
      : undefined) ??
    (typeof body["id"] === "string" ? String(body["id"]) : undefined);

  return { step, denied: false, evidence };
}

/** Titles for connect's failures, which are findings about the endpoint. */
const CONNECT_FINDINGS: Record<string, string> = {
  no_endpoint: "No MCP endpoint is published, so nothing was dialled",
  unreachable: "The endpoint was unreachable",
  timeout: "The endpoint timed out",
  not_mcp: "The endpoint answered, but not as an MCP server",
};

function readConnectOutcome(
  step: PlanStep,
  status: string,
  body: Record<string, unknown>,
): StepOutcome {
  if (status === "connected") {
    const tools = Array.isArray(body["tools"]) ? body["tools"].length : 0;
    const server =
      body["server"] && typeof body["server"] === "object" && "name" in body["server"]
        ? String(body["server"].name ?? "unnamed")
        : "unnamed";
    return {
      step,
      denied: false,
      evidence: `connected — ${server} (self-reported), ${tools} tool${tools === 1 ? "" : "s"}${body["toolsTruncated"] ? ", listing truncated" : ""}`,
    };
  }

  // The guard refusing is the control working: drawn as proof, not as a fault.
  if (status === "blocked") {
    return {
      step,
      denied: false,
      error: {
        ...classify({}),
        tone: "proof",
        title: "Blocked by the outbound guard — nothing was sent",
        detail: typeof body["rule"] === "string" ? body["rule"] : "",
        action: undefined,
      },
    };
  }

  const where =
    typeof body["stage"] === "string"
      ? ` at ${body["stage"]}`
      : typeof body["httpStatus"] === "number"
        ? ` (HTTP ${body["httpStatus"]})`
        : "";
  return {
    step,
    denied: false,
    error: {
      ...classify({}),
      tone: "waiting",
      title: `${CONNECT_FINDINGS[status] ?? `Connect ended as ${status}`}${where}`,
      detail: typeof body["detail"] === "string" ? body["detail"] : "",
      action: "A finding about the endpoint, not a failure of this console.",
    },
  };
}

function TurnView({
  turn,
  onPick,
  onRun,
  onCancel,
}: {
  turn: Turn;
  onPick: (s: string) => void;
  onRun: (plan: LensPlan) => void;
  onCancel: (plan: LensPlan) => void;
}) {
  if (turn.role === "plan") {
    return (
      <ChatMessage sender="assistant">
        <ChatMessageBubble variant="ghost" width="100%">
          <PlanCard
            plan={turn.plan}
            settled={turn.settled}
            onRun={() => onRun(turn.plan)}
            onCancel={() => onCancel(turn.plan)}
          />
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  if (turn.role === "ran") {
    return (
      <ChatMessage sender="assistant">
        <ChatMessageBubble variant="ghost" width="100%">
          <Outcomes plan={turn.plan} outcomes={turn.outcomes} />
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  return <ReadTurn turn={turn} onPick={onPick} />;
}

/**
 * The turns that are a read rather than a write.
 *
 * Named as its own type so `ReadTurn` narrows: with the full union it still
 * held the two plan shapes after the role checks, and reaching for `.answer`
 * was a type error rather than an impossible branch.
 */
type ReadableTurn = Extract<Turn, { role: "you" | "console" | "problem" }>;

function ReadTurn({
  turn,
  onPick,
}: {
  turn: ReadableTurn;
  onPick: (s: string) => void;
}) {
  if (turn.role === "you") {
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble>{turn.text}</ChatMessageBubble>
      </ChatMessage>
    );
  }

  /*
    Every console answer rides in a ghost bubble at full width.

    Ghost so the diagram is not a card inside a card, and `width="100%"` so it
    spans the message column rather than the bubble's default cap — Astryx's
    own recipe for custom in-message content.
  */
  if (turn.role === "problem") {
    return (
      <ChatMessage sender="assistant">
        <ChatMessageBubble variant="ghost" width="100%">
          <Outcome
            tone={turn.error.tone}
            title={turn.error.title}
            detail={turn.error.detail || undefined}
            action={turn.error.action}
          />
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  if (turn.answer.kind === "unanswered") {
    return (
      <ChatMessage sender="assistant">
        <ChatMessageBubble variant="ghost" width="100%">
          <VStack gap={3} width="100%" className="min-w-0">
            <VStack maxWidth="42rem">
              <Text type="body" as="p">
                {turn.answer.message}
              </Text>
            </VStack>
            <Suggestions items={turn.answer.suggestions} onPick={onPick} />
          </VStack>
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  return (
    <ChatMessage sender="assistant">
      <ChatMessageBubble variant="ghost" width="100%">
        <LensCard answer={turn.answer} />
      </ChatMessageBubble>
    </ChatMessage>
  );
}

/**
 * A plan, and the two answers to it.
 *
 * Nothing here has happened. The card exists so that the moment a write occurs
 * is a moment the operator chose, and so the thing they are choosing is legible
 * before they choose it: every step names its endpoint, its body and the key
 * that signs it, and a step expected to be refused says so in advance rather
 * than after.
 */
function PlanCard({
  plan,
  settled,
  onRun,
  onCancel,
}: {
  plan: LensPlan;
  settled?: "ran" | "cancelled";
  onRun: () => void;
  onCancel: () => void;
}) {
  return (
    <Card variant={settled ? "muted" : "yellow"} width="100%">
      <VStack gap={3} width="100%" className="min-w-0">
        <Text type="supporting" size="sm">
          {settled === "ran"
            ? "Ran"
            : settled === "cancelled"
              ? "Cancelled — nothing was sent"
              : "Plan · nothing has been sent yet"}
        </Text>

        <VStack maxWidth="42rem" gap={2}>
          <Text type="body" as="p">
            {plan.title}
          </Text>
          <Text type="supporting" as="p">
            {plan.summary}
          </Text>
        </VStack>

        <VStack gap={2} width="100%" className="min-w-0">
          {plan.steps.map((step, i) => (
            <StepRow key={i} index={i + 1} step={step} />
          ))}
        </VStack>

        {!settled ? (
          <HStack gap={2} align="center" wrap="wrap">
            <Button variant="primary" label="Run it" onClick={onRun} />
            <Button variant="secondary" label="Cancel" onClick={onCancel} />
          </HStack>
        ) : null}
      </VStack>
    </Card>
  );
}

function StepRow({ index, step }: { index: number; step: PlanStep }) {
  const [open, setOpen] = React.useState(false);
  return (
    <VStack gap={1} width="100%" className="min-w-0">
      <HStack gap={2} align="center" wrap="wrap">
        <Text type="code" size="sm" color="secondary">
          {index}.
        </Text>
        <Text type="body" size="sm">
          {step.title}
        </Text>
        <Text type="code" size="sm" color="secondary">
          {step.actor === "none" ? "unsigned — no key is used" : `signed by ${step.actor}`}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          label={open ? "Hide request" : "Show request"}
          onClick={() => setOpen((was) => !was)}
        />
      </HStack>

      {/*
        Stated before the step runs, not explained after it fails. An operator
        approving a write needs to know which refusal is the intended result.
      */}
      {step.expectDenial ? (
        <VStack maxWidth="42rem">
          <Text type="supporting" size="sm">
            Expected to be refused — {step.expectDenial}
          </Text>
        </VStack>
      ) : null}

      {open ? (
        <CodeBlock
          code={`${step.method} ${step.path}\n${JSON.stringify(step.body, null, 2)}`}
          language="json"
          container="section"
          size="sm"
          isWrapped
          width="100%"
        />
      ) : null}
    </VStack>
  );
}

/**
 * What the plan actually did, step by step.
 *
 * A refusal on a step that expected one is rendered as the proof it is, and a
 * refusal on a step that did not is rendered as a surprise. The two must not
 * look alike: one says the boundary held where it was supposed to, the other
 * says authority is not what the plan believed.
 */
function Outcomes({
  plan,
  outcomes,
}: {
  plan: LensPlan;
  outcomes: StepOutcome[];
}) {
  return (
    <VStack gap={3} width="100%" className="min-w-0">
      {outcomes.map((outcome, i) => (
        <VStack key={i} gap={1} width="100%" className="min-w-0">
          <HStack gap={2} align="center" wrap="wrap">
            <Text type="code" size="sm" color="secondary">
              {i + 1}.
            </Text>
            <Text type="body" size="sm">
              {outcome.step.title}
            </Text>
            <Text type="code" size="sm" color="secondary">
              {outcome.denied
                ? outcome.step.expectDenial
                  ? "refused — as expected"
                  : "refused — not expected"
                : outcome.error
                  ? "did not complete"
                  : "done"}
            </Text>
          </HStack>

          {outcome.evidence ? (
            <Text type="code" size="sm" color="secondary" wordBreak="break-all">
              {outcome.evidence}
            </Text>
          ) : null}

          {outcome.error ? (
            <Outcome
              tone={outcome.error.tone}
              title={outcome.error.title}
              detail={outcome.error.detail || undefined}
              action={outcome.error.action}
            />
          ) : null}
        </VStack>
      ))}

      <VStack maxWidth="42rem">
        <Text type="supporting" as="p">
          {plan.closing}
        </Text>
      </VStack>
    </VStack>
  );
}

function Opening({
  suggestions,
  onPick,
}: {
  suggestions: readonly string[];
  onPick: (s: string) => void;
}) {
  return (
    <VStack gap={3} width="100%" className="min-w-0">
      <VStack maxWidth="42rem">
        <Text type="body" as="p">
          Ask a question and the answer is drawn from what was read to answer
          it, with the rows underneath. Try one of these.
        </Text>
      </VStack>
      <Suggestions items={suggestions} onPick={onPick} />
    </VStack>
  );
}

function Suggestions({
  items,
  onPick,
}: {
  items: readonly string[];
  onPick: (s: string) => void;
}) {
  return (
    <HStack gap={2} wrap="wrap">
      {items.map((item) => (
        <Button
          key={item}
          variant="secondary"
          size="sm"
          label={item}
          onClick={() => onPick(item)}
        />
      ))}
    </HStack>
  );
}
