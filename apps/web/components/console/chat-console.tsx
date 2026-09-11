"use client";

import { Button } from "@astryxdesign/core/Button";
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
import type { ConsoleAnswer } from "@nymspace/core";
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

type Turn =
  | { role: "you"; text: string }
  | { role: "console"; answer: ConsoleAnswer }
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
      setTurns((prev) => [...prev, { role: "console", answer: body }]);
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
          <TurnView key={i} turn={turn} onPick={(s) => void ask(s)} />
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

function TurnView({
  turn,
  onPick,
}: {
  turn: Turn;
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
