"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useClipboard } from "@astryxdesign/core/hooks";
import { useEffect, useState } from "react";
import { fetchPermissions, fetchSigners } from "@/lib/api";
import { AuthorityMatrix, type AuthorityRow } from "./authority-matrix";
import { Absent, Badge, Outcome, Provenance } from "./primitives";
import { useVisitor } from "./visitor";

/**
 * The same matrix, asked about the reader.
 *
 * The table above this one says the agent controller may write two records and
 * nothing else. It is a server-rendered answer about an address the deployment
 * configured, which makes it a claim the reader is asked to accept. This one
 * asks the identical question — `hasRoles` on the resolver's own fallback chain
 * — about an address the reader connected themselves, and the answer is no to
 * everything.
 *
 * Two columns of the same read, differing only in the account, is the strongest
 * form the authority argument takes: it removes "the server decides what to
 * say" as an explanation, because the reader chose the subject.
 *
 * ## Why this reads and never writes
 *
 * A visitor holds no role, so the write would revert — which is a better proof
 * and needs a funded account, a signed transaction and a revert reason to
 * interpret. `docs/21` calls that shape a scope trap. The read costs nothing,
 * needs no faucet, and answers the same question.
 *
 * ## Why it runs in the browser
 *
 * The connected address exists only on the client, so this is the one read in
 * the console the server cannot perform. It still goes through `/v1/agents/:id/
 * permissions?controller=…`, the same route and the same contract calls the
 * server column used — not a second implementation that could disagree with it.
 */

type Outcome =
  | { ok: true; rows: AuthorityRow[]; controller: string; readAt: string }
  | { ok: false; detail: string };

/**
 * The answer, and the address it is an answer about.
 *
 * Carrying the address rather than a separate `reading` flag is what makes the
 * in-flight state derivable: an answer whose address is not the connected one
 * is by definition stale, so "reading" is `answer?.address !== address` and
 * there is no second value that can disagree with the first.
 *
 * It also removes the only `setState` that ran in the effect body, which
 * `react-hooks/set-state-in-effect` refuses — correctly, since a synchronous
 * set there re-renders before the browser has painted the previous one.
 */
interface Answer {
  address: string;
  outcome: Outcome;
}

export function VisitorAuthority({ agentId }: { agentId: string }) {
  const visitor = useVisitor();
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  // Before every early return: this component has four of them, and a hook
  // called after one runs on some renders and not others.
  const { copy, isCopied } = useClipboard({ announce: "Address copied" });
  const address = visitor.address;

  useEffect(() => {
    if (!address) return;

    /*
      Guarded against the answer for a disconnected address landing after a
      reconnect as someone else. Without it, switching accounts mid-read paints
      the first account's permissions under the second account's address — the
      one failure mode that would make this table lie about exactly what it
      exists to prove.
    */
    let current = true;

    fetchPermissions(agentId, address).then(
      (read) => {
        if (!current) return;
        setAnswer({
          address,
          outcome: {
            ok: true,
            controller: read.controller,
            readAt: read.readAt,
            rows: [
              ...Object.entries(read.recordPermissions).map(
                ([capability, allowed]) => ({ capability, allowed }),
              ),
              ...Object.entries(read.registryPermissions).map(
                ([capability, allowed]) => ({
                  capability: `${capability} (registry)`,
                  allowed,
                }),
              ),
            ],
          },
        });
      },
      (cause: unknown) => {
        if (!current) return;
        setAnswer({
          address,
          outcome: {
            ok: false,
            detail: cause instanceof Error ? cause.message : String(cause),
          },
        });
      },
    );

    return () => {
      current = false;
    };
  }, [agentId, address]);

  if (!visitor.configured) return null;

  if (!address) {
    return (
      <VStack gap={3} maxWidth="42rem">
        <Text type="supporting" as="p">
          The column above is a read about an address this deployment
          configured. Connect a wallet and the same read runs against yours — no
          transaction, no gas, and no role, which is the answer worth seeing.
        </Text>
        <Absent what="no wallet connected" />
      </VStack>
    );
  }

  // Stale by construction: an answer about a different address is not an answer
  // about this one.
  if (answer?.address !== address) {
    return <Text type="supporting">Reading roles for {address}…</Text>;
  }

  if (!answer.outcome.ok) {
    return (
      <Outcome
        tone="fault"
        title="Could not read roles for the connected wallet"
        detail={answer.outcome.detail}
        action="This is the read failing, not a denial. A denial is an answer; this is the absence of one."
      />
    );
  }

  const read = answer.outcome;
  const anyAllowed = read.rows.some((row) => row.allowed);

  return (
    <VStack gap={4} width="100%" className="min-w-0">
      <VStack gap={1} maxWidth="42rem">
        <Text type="supporting" as="p">
          The same `hasRoles` read, against the wallet you connected.
        </Text>
        {/*
          In full, not truncated, and copyable. The header shows six characters
          and four, which is enough to recognise an address and not enough to
          verify one — and this table's entire claim is that the reader can
          check the subject of the read, which means taking the address
          somewhere else to compare it.
        */}
        <HStack gap={2} align="center" wrap="wrap">
          <Text type="code" size="sm" wordBreak="break-all">
            {read.controller}
          </Text>
          <IconButton
            size="sm"
            variant="ghost"
            tooltip="Copy address"
            label={isCopied ? "Address copied" : "Copy address"}
            icon={<Icon icon={isCopied ? "check" : "copy"} size="xsm" />}
            onClick={() => void copy(read.controller)}
          />
        </HStack>
      </VStack>

      <AuthorityMatrix rows={read.rows} header="you" />

      <VStack gap={2} maxWidth="42rem">
        <Text type="supporting" as="p">
          {anyAllowed
            ? /*
                Not expected, and said plainly rather than hidden. A connected
                wallet that does hold a role is a real finding about this
                namespace — most likely the reader connected the organization or
                the controller itself — and a component that only knows how to
                narrate "denied" would render that as a bug in itself.
              */
              "This wallet holds at least one role on this name. If that is unexpected, it is the same address as the organization or the agent controller."
            : "Every capability denied, and the column beside it allowed for the same capabilities in the same request. That difference is the authority boundary, computed by the resolver rather than by this page."}
        </Text>
        {/*
          Name the role, because the address alone does not explain the answer.

          A reader seeing forty-two hex characters and a column of Denied has to
          work out *why* — and the reason is not a property of the address, it
          is that this address is neither of the two the namespace grants to.
          Saying which of the three it is turns the table from a result into an
          explanation, and it costs one comparison against `/v1/signers`, which
          this page already knows.
        */}
        <Standing address={read.controller} />
        <Provenance source="ensv2" readAt={read.readAt} />
      </VStack>
    </VStack>
  );
}

/**
 * Which of this deployment's three roles the connected address holds.
 *
 * The organization owns `nymspace.eth`; the agent controller is the key it
 * delegated specific record permissions to; everyone else is a visitor. Those
 * are the only three standings that exist here, and which one a reader has is
 * the entire explanation for the column above.
 *
 * Read from `/v1/signers`, which is the deployment reporting its own configured
 * addresses — not a guess, and not a second copy of them compiled into the
 * browser where it could drift from what the API actually signs with.
 */
function Standing({ address }: { address: string }) {
  const [signers, setSigners] = useState<
    { organization: string; controller: string } | undefined
  >(undefined);

  useEffect(() => {
    let current = true;
    fetchSigners().then(
      (answer) => {
        if (current) setSigners(answer);
      },
      // Silent: this labels an answer the reader already has. A failed lookup
      // should remove the label, never replace the table with an error.
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  if (!signers) return null;

  const same = (other: string) =>
    other.toLowerCase() === address.toLowerCase();

  if (same(signers.organization)) {
    return (
      <HStack gap={2} align="center" wrap="wrap">
        <Badge tone="good">the organization</Badge>
        <Text type="supporting">
          This is the account that owns nymspace.eth, so it holds every role by
          definition.
        </Text>
      </HStack>
    );
  }

  if (same(signers.controller)) {
    return (
      <HStack gap={2} align="center" wrap="wrap">
        <Badge tone="warn">the agent controller</Badge>
        <Text type="supporting">
          The delegated key. Its permissions are the ones in the column above.
        </Text>
      </HStack>
    );
  }

  return (
    <HStack gap={2} align="center" wrap="wrap">
      <Badge tone="neutral">a visitor</Badge>
      <Text type="supporting">
        Neither the organization nor the delegated controller, which is why
        every answer is no.
      </Text>
    </HStack>
  );
}
