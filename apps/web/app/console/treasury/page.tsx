import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { fetchTreasury } from "@/lib/api";
import {
  Empty,
  Frame,
  Outcome,
  Provenance,
} from "@/components/console/primitives";
import {
  TreasuryTable,
  type TreasuryRow,
} from "@/components/console/treasury-table";
import { EMPTY_STATES, classify } from "@/lib/console/errors";

/**
 * Treasury — what each agent may spend, and under whose key.
 *
 * The financial half of the same question the fleet screen asks about identity.
 * Until this page existed the answer lived in one frame on a single agent's
 * page, so an operator could learn one agent's spending limit but never compare
 * two, and nothing in the navigation suggested the product had a financial side
 * at all.
 *
 * Server-rendered and uncached, like every console screen. The policy limit is
 * read from Privy during the request — caching it would put a number on screen
 * that the control plane may already have changed.
 */
export const dynamic = "force-dynamic";

export default async function TreasuryPage() {
  const result = await fetchTreasury().then(
    (value) => ({ ok: true, value }) as const,
    (cause: unknown) => ({ ok: false, cause }) as const,
  );

  if (!result.ok) {
    const error = classify({
      error:
        result.cause instanceof Error
          ? result.cause.message
          : String(result.cause),
    });
    return (
      <VStack as="main" gap={8} width="100%" className="min-w-0">
        <Header />
        <Outcome
          tone={error.tone}
          title={error.title}
          detail={error.detail || undefined}
          action={error.action}
        />
      </VStack>
    );
  }

  const { agents, signerMode, policiesRead, source, readAt } = result.value;
  const rows = agents as unknown as TreasuryRow[];
  const provisioned = rows.filter(
    (row) => row.wallet.status === "provisioned",
  ).length;

  return (
    <VStack as="main" gap={8} width="100%" className="min-w-0">
      <Header />

      {rows.length === 0 ? (
        <Empty
          title={EMPTY_STATES.noAgents.title}
          detail={EMPTY_STATES.noAgents.detail}
          action={
            <Link href="/console/new">
              <Text type="body" size="sm">
                Create an agent
              </Text>
            </Link>
          }
        />
      ) : (
        <>
          <HStack gap={3} wrap="wrap" align="center">
            {/*
              A count of wallets, not a sum of limits. A limit is a
              per-transaction cap, so adding them would produce a number that
              reads as a balance and means nothing.
            */}
            <Text type="supporting">
              {provisioned} of {rows.length} agent
              {rows.length === 1 ? "" : "s"} hold a wallet
            </Text>
            <Text type="supporting" aria-hidden>
              ·
            </Text>
            <Text type="supporting">
              {policiesRead} polic{policiesRead === 1 ? "y" : "ies"} read
            </Text>
            <Provenance source={source} readAt={readAt} />
          </HStack>

          <Frame surface="body" title="wallets">
            <VStack gap={4} width="100%" className="min-w-0">
              <VStack maxWidth="42rem">
                <Text type="supporting" as="p">
                  The address is the coordination store&rsquo;s own reference.
                  The limit beside it was read from the live Privy policy during
                  this request, which is why only that column carries a read
                  time — an agent whose policy could not be read says so rather
                  than reporting no limit.
                </Text>
              </VStack>
              <TreasuryTable rows={rows} />
            </VStack>
          </Frame>

          <VStack maxWidth="42rem">
            <Text type="supporting" as="p">
              Signing: {signerMode}.
            </Text>
          </VStack>
        </>
      )}
    </VStack>
  );
}

function Header() {
  return (
    <VStack as="header" gap={3} maxWidth="42rem">
      <Heading level={1}>
        <Text type="code" size="2xl">
          Treasury
        </Text>
      </Heading>
      <Text type="supporting" as="p">
        What each agent may spend, and under whose key. The organization owns
        the wallets; an agent is a signer on one, capped by a policy Privy
        enforces on the signing path — not by anything on this screen.
      </Text>
    </VStack>
  );
}
