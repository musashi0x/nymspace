"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { grantPermission } from "@/lib/api";
import { classify, type ConsoleError } from "@/lib/console/errors";
import { LOADING_COPY } from "@/lib/console/state";
import { Loading, Outcome, Provenance } from "./primitives";

/**
 * An approval gate, wearing a chat.
 *
 * The pattern is the familiar one — the agent narrates, its tool calls appear
 * inline, and the destructive one stops and asks — but the thing being
 * approved here is not a description of an action. It is the action. The key
 * offered for revocation is one this controller actually holds on chain, read
 * when the page rendered, and approving sends the organization-signed write.
 *
 * That distinction is the entire reason to build it rather than mock it.
 * `docs/03` forbids simulating a path that is not implemented, and an approval
 * card that gates nothing is a screenshot: nobody can tell a real gate from a
 * drawn one unless the gate is capable of refusing.
 *
 * ## The agent does not speak
 *
 * There is no model behind this and the assistant's lines are not generated.
 * They are composed from the same permission read the authority matrix uses, so
 * the transcript can be wrong about which question you meant but never about an
 * answer it gives. A fluent sentence describing a permission nothing checked is
 * precisely the failure this console exists to argue against.
 *
 * ## Layout
 *
 * Astryx carries the structure. The transcript itself — the bubble, the tool
 * row, the bordered approval card — is raw layout under the same carve-out
 * `frame.tsx` documents: a chat log is a run of differently-shaped containers
 * with asymmetric corners and a bordered inset, and Astryx has no primitive for
 * it. Every value here is a token-backed utility; none is a literal colour or
 * pixel.
 */

type Settled = {
  decision: "approved" | "kept";
  detail: string;
  error?: ConsoleError;
};

export interface PermissionCell {
  key: string;
  allowed: boolean;
}

export function ApprovalChat({
  agentId,
  ensName,
  controller,
  cells,
  source,
  readAt,
}: {
  agentId: string;
  ensName: string;
  controller: string;
  cells: PermissionCell[];
  source: string;
  readAt: string;
}) {
  const reduced = useReducedMotion();
  const [settled, setSettled] = useState<Settled | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  /**
   * The one destructive action on offer: revoking a key the controller holds.
   *
   * Taken from the live read rather than hardcoded, so an agent that holds
   * nothing produces no card at all. An approval prompt for a write that would
   * be a no-op is theatre, and it would still be theatre if the write went
   * through.
   */
  const revocable = cells.find((cell) => cell.allowed);
  const held = cells.filter((cell) => cell.allowed).length;

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [settled, busy]);

  async function decide(approve: boolean) {
    if (!revocable || busy) return;

    if (!approve) {
      setSettled({
        decision: "kept",
        detail: `left ${revocable.key} in place — nothing was sent`,
      });
      return;
    }

    setBusy(LOADING_COPY.transaction);
    try {
      const result = await grantPermission(agentId, {
        controller,
        recordKey: revocable.key,
        grant: false,
      });

      if (result.status === "confirmed" && "transaction" in result) {
        setSettled({ decision: "approved", detail: result.transaction.hash });
        return;
      }

      /**
       * Everything else is classified rather than retold.
       *
       * A genuine EAC refusal, an absent signing key and an RPC that never
       * answered all arrive through `describeDenial` wearing `source: "ensv2"`,
       * and they are three different facts about this agent's authority. The
       * taxonomy is the only thing keeping them apart.
       */
      setSettled({
        decision: "approved",
        detail: "the write did not complete",
        error: classify(
          result as { status?: string; source?: string; reason?: string },
        ),
      });
    } catch (cause) {
      setSettled({
        decision: "approved",
        detail: "the write did not complete",
        error: classify({
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <VStack gap={6} width="100%" className="min-w-0">
      <Bubble>Tighten this agent down before the demo.</Bubble>

      <VStack gap={3} width="100%" className="min-w-0">
        <Text type="body" as="p" className="max-w-prose">
          I read this agent&rsquo;s authority from the Permissioned Resolver.
          The controller {short(controller)} can write {held} of {cells.length}{" "}
          record keys on {ensName}. Removing one is a chain write and cannot be
          undone from this screen, so it needs your approval.
        </Text>

        <ToolRow
          name="Read permission matrix"
          detail={`${cells.length} cells · canSetText through the resolver's fallback chain`}
          source={source}
          readAt={readAt}
          body={cells
            .map((cell) => `${cell.allowed ? "allowed" : "denied "}  ${cell.key}`)
            .join("\n")}
        />

        {!revocable ? (
          <Step
            label="Nothing to do"
            detail="the controller holds no record keys, so there is nothing to revoke"
          />
        ) : null}

        {revocable && !settled ? (
          <ApprovalCard
            recordKey={revocable.key}
            ensName={ensName}
            controller={controller}
            busy={busy !== null}
            onDecide={decide}
          />
        ) : null}

        {busy ? <Loading what={busy} /> : null}

        {settled ? (
          <>
            <Step
              label={settled.decision === "approved" ? "Approved" : "Skipped"}
              detail={settled.detail}
            />
            {settled.error ? (
              <Outcome
                tone={settled.error.tone}
                title={settled.error.title}
                detail={settled.error.detail || undefined}
                action={settled.error.action}
              />
            ) : (
              <Text type="body" as="p" className="max-w-prose">
                {reduced ? (
                  closing(settled.decision, revocable?.key)
                ) : (
                  <Words text={closing(settled.decision, revocable?.key)} />
                )}
              </Text>
            )}
          </>
        ) : null}
      </VStack>

      <div ref={end} />
    </VStack>
  );
}

/**
 * The closing line, and the reason nothing follows it.
 *
 * A composer under a transcript promises a reply. Nothing here can produce one,
 * and an input that swallowed a sentence and answered nothing would be the
 * single dishonest element on a screen whose whole argument is that what you
 * see was read rather than composed. So the transcript ends.
 */
function closing(decision: Settled["decision"], key?: string) {
  return decision === "approved"
    ? `The resolver is the record of what changed, not this page. Re-open the agent and ${key ?? "that key"} reads denied from chain.`
    : `Nothing was sent, so nothing changed. ${key ?? "The key"} is still allowed on chain and the agent can still write it.`;
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm surface-card px-4 py-3">
      <Text type="body">{children}</Text>
    </div>
  );
}

/**
 * One tool call, collapsed to a line.
 *
 * Collapsed but never summarised: opening it shows the cells themselves rather
 * than a count, because the sentence above is only worth trusting if the read
 * behind it can be inspected.
 */
function ToolRow({
  name,
  detail,
  source,
  readAt,
  body,
}: {
  name: string;
  detail: string;
  source: string;
  readAt: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <VStack gap={2} width="100%" className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg surface-card px-2 py-1.5 text-left"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <Text type="body" size="sm" textWrap="nowrap">
          {name}
        </Text>
        <span className="min-w-0 flex-1 truncate">
          <Text type="supporting" size="sm" textWrap="nowrap">
            {detail}
          </Text>
        </span>
        <span className="shrink-0">
          <Provenance source={source} readAt={readAt} />
        </span>
      </button>
      {open ? (
        <div className="overflow-x-auto rounded-lg surface-card px-3 py-2.5">
          <Text type="code" size="sm" color="secondary" className="whitespace-pre">
            {body}
          </Text>
        </div>
      ) : null}
    </VStack>
  );
}

/** A step that is over — the register the transcript uses for settled facts. */
function Step({ label, detail }: { label: string; detail: string }) {
  return (
    <HStack gap={2} align="center" wrap="wrap">
      <Text type="supporting" size="sm">
        {label}
      </Text>
      <Text type="supporting" size="sm" aria-hidden>
        ·
      </Text>
      <Text type="code" size="sm" color="secondary" wordBreak="break-all">
        {detail}
      </Text>
    </HStack>
  );
}

/**
 * The gate.
 *
 * Both answers are equally reachable and neither is preselected. The request
 * body is shown on demand rather than described, so approving means approving
 * something you can read rather than a sentence about it.
 */
function ApprovalCard({
  recordKey,
  ensName,
  controller,
  busy,
  onDecide,
}: {
  recordKey: string;
  ensName: string;
  controller: string;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const [showRequest, setShowRequest] = useState(false);

  return (
    <VStack
      gap={3}
      padding={4}
      width="100%"
      className="min-w-0 rounded-2xl border border-dashed surface-card"
    >
      <HStack gap={2} align="center">
        <Text type="supporting" size="sm">
          Needs approval
        </Text>
      </HStack>

      <Text type="body" as="p" className="max-w-prose">
        Revoke{" "}
        <Text type="code" size="sm" as="span">
          {recordKey}
        </Text>{" "}
        from the controller on {ensName}. The agent stops being able to write
        that record the moment this is mined, and only the organization can
        grant it back.
      </Text>

      <HStack gap={2} justify="between" align="center" wrap="wrap">
        <Button
          variant="ghost"
          label={showRequest ? "Hide request" : "Show request"}
          onClick={() => setShowRequest((was) => !was)}
        />
        <HStack gap={2} align="center" wrap="wrap">
          {/*
            `destructive`, and Astryx's own guidance is the reason it is
            allowed here: the variant is not to be used for an irreversible
            action without a confirmation step. This card is that step.
          */}
          <Button
            variant="destructive"
            label={busy ? "Sending…" : "Revoke it"}
            onClick={() => onDecide(true)}
            isDisabled={busy}
          />
          <Button
            variant="secondary"
            label="Keep it"
            onClick={() => onDecide(false)}
            isDisabled={busy}
          />
        </HStack>
      </HStack>

      {showRequest ? (
        <div className="w-full min-w-0 overflow-x-auto rounded-lg surface-body px-3 py-2.5">
          <Text type="code" size="sm" color="secondary" className="whitespace-pre">
            {`POST /v1/agents/{id}/permissions
{
  "controller": "${controller}",
  "recordKey": "${recordKey}",
  "grant": false
}`}
          </Text>
        </div>
      ) : null}
    </VStack>
  );
}

/**
 * Word-by-word reveal.
 *
 * Purely cosmetic: the string is complete before the first word appears, so
 * this animates text rather than streaming it. Reduced motion skips it at the
 * call site rather than shortening the duration — the point of that setting is
 * no movement, not less of it.
 */
function Words({ text }: { text: string }) {
  const words = text.match(/\S+\s*/g) ?? [];
  return (
    <>
      {words.map((word, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.24, delay: index * 0.012 }}
          className="inline-block whitespace-pre-wrap"
        >
          {word}
        </motion.span>
      ))}
    </>
  );
}

function short(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
