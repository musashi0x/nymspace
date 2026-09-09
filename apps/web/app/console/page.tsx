import Link from "next/link";
import { fetchAgents } from "@/lib/api";
import { EMPTY_STATES } from "@/lib/console/errors";
import { Badge, Empty, Panel, Provenance } from "@/components/console/primitives";

/**
 * Screen 1 — Fleet home.
 *
 * Each card shows the five integration states separately, which is task 7.1 and
 * `docs/09`'s closing instruction. A single "ready" badge would be easier to
 * read and would hide exactly the thing an operator needs: which integration is
 * incomplete. An agent with a verified identity and no wallet is not broken, it
 * is financially unprovisioned, and only five values can say so.
 *
 * Server-rendered, uncached. Next 16 does not cache `fetch` by default and this
 * page deliberately does not opt in — provisioning state changes when a script
 * runs, and a console showing a cached fleet is a console lying about a system
 * that just changed underneath it.
 */
export const dynamic = "force-dynamic";

/** How each track reads to an operator, and whether it is good news. */
const TRACK_LABELS: Record<
  string,
  Record<string, { text: string; tone: "good" | "warn" | "bad" | "neutral" }>
> = {
  ens: {
    draft: { text: "not registered", tone: "neutral" },
    pending: { text: "registering", tone: "warn" },
    active: { text: "ENS active", tone: "good" },
    failed: { text: "ENS failed", tone: "bad" },
  },
  erc8004: {
    unregistered: { text: "no registration", tone: "neutral" },
    pending: { text: "registering", tone: "warn" },
    registered: { text: "ERC 8004 registered", tone: "good" },
    failed: { text: "registration failed", tone: "bad" },
  },
  ensip25: {
    unchecked: { text: "not checked", tone: "neutral" },
    checking: { text: "checking", tone: "warn" },
    verified: { text: "ENSIP 25 verified", tone: "good" },
    registry_claim_missing: { text: "no registry claim", tone: "warn" },
    ens_record_missing: { text: "no ENS record", tone: "warn" },
    mismatch: { text: "name mismatch", tone: "bad" },
    rpc_error: { text: "could not check", tone: "neutral" },
  },
  graph: {
    not_indexed: { text: "not indexed", tone: "neutral" },
    pending: { text: "indexing", tone: "warn" },
    indexed: { text: "discoverable", tone: "good" },
    provider_error: { text: "provider error", tone: "bad" },
  },
  financial: {
    no_wallet: { text: "no wallet", tone: "neutral" },
    wallet_created: { text: "wallet, no policy", tone: "warn" },
    policy_configured: { text: "policy configured", tone: "good" },
    financially_active: { text: "policy enforced", tone: "good" },
    failed: { text: "wallet failed", tone: "bad" },
  },
};

function track(kind: string, value: string) {
  return (
    TRACK_LABELS[kind]?.[value] ?? { text: value, tone: "neutral" as const }
  );
}

export default async function FleetPage() {
  const fleet = await fetchAgents();
  const parent = process.env.NEXT_PUBLIC_PARENT_ENS_NAME ?? "nymspace.eth";
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111";

  return (
    <main className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-mono text-2xl">{parent}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            {fleet.agents.length} agent{fleet.agents.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span>ENSv2 Sepolia ({chainId})</span>
          <Provenance source={fleet.source} readAt={fleet.readAt} />
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Each agent owns a name under this namespace. Everything below is the
          store&rsquo;s own record of provisioning progress — identity,
          permission and policy answers are read from their own systems when you
          open an agent.
        </p>
      </header>

      {fleet.agents.length === 0 ? (
        <Empty
          title={EMPTY_STATES.noAgents.title}
          detail={EMPTY_STATES.noAgents.detail}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {fleet.agents.map((agent) => (
            <Panel
              key={agent.id}
              title={agent.ensName}
              subtitle={`Controller ${agent.controllerAddress}`}
            >
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["ens", agent.status.ens],
                    ["erc8004", agent.status.erc8004],
                    ["ensip25", agent.status.ensip25],
                    ["graph", agent.status.graph],
                    ["financial", agent.status.financial],
                  ] as const
                ).map(([kind, value]) => {
                  const t = track(kind, value);
                  return (
                    <Badge key={kind} tone={t.tone}>
                      {t.text}
                    </Badge>
                  );
                })}
              </div>

              <div className="flex gap-3 text-sm">
                <Link
                  href={`/console/agents/${agent.id}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Inspect
                </Link>
                {agent.privyWalletId ? (
                  <Link
                    href={`/console/agents/${agent.id}#task`}
                    className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Request task
                  </Link>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </main>
  );
}
