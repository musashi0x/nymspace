"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatToolCalls,
} from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { grantPermission } from "@/lib/api";
import { classify, type ConsoleError } from "@/lib/console/errors";
import { LOADING_COPY } from "@/lib/console/state";
import { Loading, Outcome, Provenance } from "./primitives";

/**
 * An approval gate, wearing a chat.
 *
 * The pattern is the familiar one — the agent narrates, its tool call appears
 * inline, and the destructive step stops and asks — but the thing being
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
 * ## Built from Astryx, including the parts that look bespoke
 *
 * `ChatMessageList`, `ChatMessage`, `ChatMessageBubble` and `ChatToolCalls` are
 * all shipped components — the transcript needs no raw layout, and the first
 * draft of this file that used raw elements for the bubble and the tool row was
 * drift, not a carve-out. `AGENTS.md` says the `Frame` exception does not
 * generalise, and it does not generalise to here.
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
  const [settled, setSettled] = useState<Settled | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    /*
      `align="top"`: the default pushes messages to the bottom of the container
      so a short conversation sits above a composer. There is no composer here
      — see `closing()` — so the spacer would open a gap under the header with
      nothing beneath it.
    */
    <ChatMessageList align="top" gap={6}>
      <ChatMessage sender="user">
        <ChatMessageBubble>Tighten this agent down before the demo.</ChatMessageBubble>
      </ChatMessage>

      <ChatMessage sender="assistant" metadata={<Provenance source={source} readAt={readAt} />}>
        <ChatMessageBubble variant="ghost" width="100%">
          <VStack gap={4} width="100%" className="min-w-0">
            <VStack maxWidth="42rem">
              <Text type="body" as="p">
                I read this agent&rsquo;s authority from the Permissioned
                Resolver. The controller {short(controller)} can write {held} of{" "}
                {cells.length} record keys on {ensName}. Removing one is a chain
                write and cannot be undone from this screen, so it needs your
                approval.
              </Text>
            </VStack>

            {/*
              One call, and its result is the cells themselves rather than a
              count. The sentence above is only worth trusting if the read
              behind it can be inspected.
            */}
            <ChatToolCalls
              calls={[
                {
                  key: "permissions",
                  name: "canSetText",
                  status: "complete",
                  target: `${cells.length} record keys on ${ensName}`,
                  node: source,
                  resultDetail: (
                    <CodeBlock
                      code={cells
                        .map(
                          (cell) =>
                            `${cell.allowed ? "allowed" : "denied "}  ${cell.key}`,
                        )
                        .join("\n")}
                      // "plaintext" rather than a language, and the label goes
                      // with it: these are two columns of cells, and syntax
                      // colouring would be highlighting nothing.
                      language="plaintext"
                      container="section"
                      size="sm"
                      isWrapped
                      width="100%"
                    />
                  ),
                },
              ]}
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
                  <VStack maxWidth="42rem">
                    <Text type="body" as="p">
                      {closing(settled.decision, revocable?.key)}
                    </Text>
                  </VStack>
                )}
              </>
            ) : null}
          </VStack>
        </ChatMessageBubble>
      </ChatMessage>
    </ChatMessageList>
  );
}

/**
 * The closing line, and the reason nothing follows it.
 *
 * `ChatComposer` exists and is deliberately not used. A composer under a
 * transcript promises a reply; nothing here can produce one, and an input that
 * swallowed a sentence and answered nothing would be the single dishonest
 * element on a screen whose whole argument is that what you see was read rather
 * than composed. So the transcript ends.
 */
function closing(decision: Settled["decision"], key?: string) {
  return decision === "approved"
    ? `The resolver is the record of what changed, not this page. Re-open the agent and ${key ?? "that key"} reads denied from chain.`
    : `Nothing was sent, so nothing changed. ${key ?? "The key"} is still allowed on chain and the agent can still write it.`;
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
 * A `Card` because this is a standalone widget inside the message rather than a
 * row in a list — `AGENTS.md`'s own division. Both answers are equally reachable
 * and neither is preselected, and the request body is shown on demand rather
 * than described, so approving means approving something you can read.
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
    <Card variant="yellow" width="100%">
      <VStack gap={3} width="100%" className="min-w-0">
        <Text type="supporting" size="sm">
          Needs approval
        </Text>

        <VStack maxWidth="42rem">
          <Text type="body" as="p">
            Revoke{" "}
            <Text type="code" size="sm" as="span">
              {recordKey}
            </Text>{" "}
            from the controller on {ensName}. The agent stops being able to
            write that record the moment this is mined, and only the
            organization can grant it back.
          </Text>
        </VStack>

        <HStack gap={2} justify="between" align="center" wrap="wrap">
          <Button
            variant="ghost"
            label={showRequest ? "Hide request" : "Show request"}
            onClick={() => setShowRequest((was) => !was)}
          />
          <HStack gap={2} align="center" wrap="wrap">
            {/*
              `destructive`, and Astryx's own guidance is why it is allowed
              here: the variant is not to be used for an irreversible action
              without a confirmation step. This card is that step.
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
          <CodeBlock
            code={`POST /v1/agents/{id}/permissions
{
  "controller": "${controller}",
  "recordKey": "${recordKey}",
  "grant": false
}`}
            language="json"
            container="section"
            size="sm"
            isWrapped
            width="100%"
          />
        ) : null}
      </VStack>
    </Card>
  );
}

function short(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
