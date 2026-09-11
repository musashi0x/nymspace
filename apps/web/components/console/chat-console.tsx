"use client";

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

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(message: string) {
    const text = message.trim();
    if (!text || busy) return;

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
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        {turns.length === 0 && (
          <Opening suggestions={suggestions} onPick={(s) => void ask(s)} />
        )}

        {turns.map((turn, i) => (
          <TurnView key={i} turn={turn} onPick={(s) => void ask(s)} />
        ))}

        {busy && <Loading what={LOADING_COPY.ens} />}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
        className="sticky bottom-4 flex gap-2 rounded-xl border border-border bg-card p-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          placeholder="Ask about an agent, or the fleet"
          className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
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
      <p className="self-end rounded-2xl rounded-br-sm bg-muted px-3 py-2 text-sm">
        {turn.text}
      </p>
    );
  }

  if (turn.role === "problem") {
    return (
      <Outcome
        tone={turn.error.tone}
        title={turn.error.title}
        detail={turn.error.detail || undefined}
        action={turn.error.action}
      />
    );
  }

  if (turn.answer.kind === "unanswered") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4">
        <p className="text-sm leading-relaxed">{turn.answer.message}</p>
        <Suggestions items={turn.answer.suggestions} onPick={onPick} />
      </div>
    );
  }

  return <LensCard answer={turn.answer} />;
}

function Opening({
  suggestions,
  onPick,
}: {
  suggestions: readonly string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-5">
      <p className="text-sm leading-relaxed">
        Every answer here is assembled from a read performed when you ask —
        ENSv2 for records and authority, the ERC 8004 registry for the
        registration, both on their own chains. Nothing is generated, so
        nothing is guessed.
      </p>
      <Suggestions items={suggestions} onPick={onPick} />
    </div>
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
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onPick(item)}
          className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted"
        >
          {item}
        </button>
      ))}
    </div>
  );
}
