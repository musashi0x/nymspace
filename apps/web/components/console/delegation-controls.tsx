"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { apiBaseUrl } from "@/lib/api";
import {
  WalletError,
  connect,
  hasProvider,
  sendPrepared,
  type PreparedTransaction,
} from "@/lib/wallet";
import { useOrganizationWallet } from "@/components/console/organization-wallet";

/**
 * Grant and revoke a controller's right to write one record key.
 *
 * Two paths to the same transaction, chosen by what is available:
 *
 *   wallet connected as the organization -> prepare, sign in the wallet,
 *                                           report the hash back to confirm
 *   otherwise                            -> the server-signed route, which
 *                                           answers 503 if it holds no key
 *
 * The wallet path is preferred when it is available because the organization
 * is a person, and a revocation that a human approved is a different fact from
 * one a server performed with a key it happens to hold. The server path stays
 * because the unattended flows and the existing scripts depend on it.
 */

type Outcome =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "ok"; message: string; txHash?: string }
  | { kind: "error"; message: string };

export function DelegationControls({
  agentId,
  controller,
  recordKeys,
  organization,
}: {
  agentId: string;
  controller: string;
  recordKeys: readonly string[];
  organization: string | undefined;
}) {
  const router = useRouter();
  const { account, isOrganization, refresh } = useOrganizationWallet(organization);
  const [outcome, setOutcome] = React.useState<Outcome>({ kind: "idle" });
  const [active, setActive] = React.useState<string>();

  const canUseWallet = !!account && isOrganization;

  async function run(recordKey: string, grant: boolean) {
    setActive(`${recordKey}:${grant}`);
    setOutcome({ kind: "busy", step: "Preparing" });

    try {
      if (canUseWallet) {
        await viaWallet(recordKey, grant);
      } else {
        await viaServer(recordKey, grant);
      }
      // The permission matrix is rendered on the server from live chain reads,
      // so re-fetching the route is what makes the change visible. Nothing is
      // mutated client-side, which is why the matrix cannot drift from chain.
      router.refresh();
    } catch (cause) {
      setOutcome({
        kind: "error",
        message:
          cause instanceof WalletError || cause instanceof Error
            ? cause.message
            : "The change did not complete.",
      });
    } finally {
      setActive(undefined);
    }
  }

  async function viaWallet(recordKey: string, grant: boolean) {
    const prepared = await post<{
      transaction: PreparedTransaction;
      expectedSigner: `0x${string}`;
    }>(`/v1/agents/${agentId}/permissions/prepare`, {
      controller,
      recordKey,
      grant,
    });

    setOutcome({ kind: "busy", step: "Waiting for your wallet" });
    const txHash = await sendPrepared({
      transaction: prepared.transaction,
      expectedSigner: prepared.expectedSigner,
    });

    setOutcome({ kind: "busy", step: "Waiting for the receipt" });
    const confirmed = await post<{ status: string }>(
      `/v1/agents/${agentId}/permissions/confirm`,
      { controller, recordKey, grant, txHash, signer: account },
    );

    setOutcome(
      confirmed.status === "confirmed"
        ? {
            kind: "ok",
            message: `${grant ? "Granted" : "Revoked"} ${recordKey}, signed by you.`,
            txHash,
          }
        : {
            kind: "error",
            message: `The transaction mined but reverted. ${recordKey} is unchanged.`,
          },
    );
  }

  async function viaServer(recordKey: string, grant: boolean) {
    setOutcome({ kind: "busy", step: "Signing on the server" });
    const result = await post<{ status?: string; error?: string }>(
      `/v1/agents/${agentId}/permissions`,
      { controller, recordKey, grant },
    );
    setOutcome(
      result.status === "confirmed"
        ? {
            kind: "ok",
            message: `${grant ? "Granted" : "Revoked"} ${recordKey}, signed by the server.`,
          }
        : {
            kind: "error",
            message: result.error ?? "The server could not complete the change.",
          },
    );
  }

  async function onConnect() {
    try {
      await connect();
      await refresh();
    } catch (cause) {
      setOutcome({
        kind: "error",
        message: cause instanceof WalletError ? cause.message : "Could not connect.",
      });
    }
  }

  return (
    <section style={BOX}>
      <header style={HEAD}>
        <strong style={{ fontSize: "0.8125rem" }}>Delegation</strong>
        <span style={NOTE}>{describeSigner(canUseWallet, account, organization)}</span>
      </header>

      {!canUseWallet && hasProvider() && (
        <p style={NOTE}>
          {account
            ? "Connected as another account. Switch to the organization to sign these yourself."
            : ""}
          {!account && (
            <button type="button" onClick={onConnect} style={LINK}>
              Connect the organization wallet
            </button>
          )}
        </p>
      )}

      <ul style={LIST}>
        {recordKeys.map((key) => (
          <li key={key} style={ROW}>
            <code style={MONO}>{key}</code>
            <span style={{ display: "inline-flex", gap: "0.5rem" }}>
              <button
                type="button"
                style={BTN}
                disabled={active !== undefined}
                onClick={() => void run(key, true)}
              >
                {active === `${key}:true` ? "…" : "Grant"}
              </button>
              <button
                type="button"
                style={BTN}
                disabled={active !== undefined}
                onClick={() => void run(key, false)}
              >
                {active === `${key}:false` ? "…" : "Revoke"}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {outcome.kind === "busy" && <p style={NOTE}>{outcome.step}…</p>}
      {outcome.kind === "ok" && (
        <p style={OK}>
          {outcome.message}
          {outcome.txHash && (
            <>
              {" "}
              <a
                href={`https://sepolia.etherscan.io/tx/${outcome.txHash}`}
                target="_blank"
                rel="noreferrer"
                style={LINKA}
              >
                {outcome.txHash.slice(0, 10)}…
              </a>
            </>
          )}
        </p>
      )}
      {outcome.kind === "error" && <p style={WARN}>{outcome.message}</p>}
    </section>
  );
}

function describeSigner(
  canUseWallet: boolean,
  account: string | undefined,
  organization: string | undefined,
) {
  if (canUseWallet) return "you will sign these in your wallet";
  if (!organization) return "organization address unknown";
  if (account) return "connected as another account — the server will sign";
  return "no wallet connected — the server will sign";
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    remedy?: string;
  };
  if (!res.ok) {
    throw new Error(
      [parsed.error ?? `Request failed (${res.status})`, parsed.remedy]
        .filter(Boolean)
        .join(" "),
    );
  }
  return parsed;
}

const BOX: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "0.75rem",
  padding: "1rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};
const HEAD: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "1rem",
};
const LIST: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};
const ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
};
const MONO: React.CSSProperties = {
  fontFamily: "var(--font-geist-mono)",
  fontSize: "0.75rem",
};
const BTN: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "999px",
  padding: "0.125rem 0.625rem",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.75rem",
};
const LINK: React.CSSProperties = {
  ...BTN,
  borderColor: "transparent",
  textDecoration: "underline",
  padding: 0,
};
const LINKA: React.CSSProperties = {
  fontFamily: "var(--font-geist-mono)",
  textDecoration: "underline",
};
const NOTE: React.CSSProperties = {
  color: "var(--muted-foreground)",
  fontSize: "0.75rem",
};
const OK: React.CSSProperties = { color: "var(--graph-accent-3)", fontSize: "0.75rem" };
const WARN: React.CSSProperties = { color: "var(--destructive)", fontSize: "0.75rem" };
