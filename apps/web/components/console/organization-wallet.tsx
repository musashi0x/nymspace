"use client";

import * as React from "react";
import {
  EXPECTED_CHAIN,
  WalletError,
  connect,
  currentAccount,
  currentChainId,
  hasProvider,
  watchWallet,
} from "@/lib/wallet";

/**
 * Connect the organization's wallet, and say plainly whether the connected
 * account is actually the organization.
 *
 * The mismatch case is the one worth designing for. A wallet connected as some
 * other account will produce a signature the resolver refuses, and the refusal
 * arrives after the user has approved a prompt and spent gas. Comparing two
 * strings before offering to sign costs nothing and says the same thing.
 */

export type WalletState = {
  account: `0x${string}` | undefined;
  chainId: number | undefined;
  isOrganization: boolean;
  ready: boolean;
};

export function useOrganizationWallet(organization: string | undefined) {
  const [account, setAccount] = React.useState<`0x${string}` | undefined>();
  const [chainId, setChainId] = React.useState<number | undefined>();
  const [ready, setReady] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setAccount(await currentAccount());
    setChainId(await currentChainId());
    setReady(true);
  }, []);

  React.useEffect(() => {
    void refresh();
    return watchWallet(() => void refresh());
  }, [refresh]);

  const isOrganization =
    !!account &&
    !!organization &&
    account.toLowerCase() === organization.toLowerCase();

  return { account, chainId, isOrganization, ready, refresh };
}

export function OrganizationWallet({
  organization,
}: {
  organization: string | undefined;
}) {
  const { account, chainId, isOrganization, ready, refresh } =
    useOrganizationWallet(organization);
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);

  async function onConnect() {
    setError(undefined);
    setBusy(true);
    try {
      await connect();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof WalletError ? cause.message : "Could not connect.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Render nothing decisive until the provider has been asked, so the UI does
  // not flash "no wallet" at someone who has one.
  if (!ready) return null;

  if (!hasProvider()) {
    return (
      <p style={NOTE}>
        No browser wallet detected. Organization actions can still be run
        server-side where a key is configured; connect a wallet to sign them
        yourself.
      </p>
    );
  }

  if (!account) {
    return (
      <span style={ROW}>
        <button type="button" onClick={onConnect} disabled={busy} style={BUTTON}>
          {busy ? "Connecting…" : "Connect wallet"}
        </button>
        {error && <span style={WARN}>{error}</span>}
      </span>
    );
  }

  const wrongChain = chainId !== undefined && chainId !== EXPECTED_CHAIN.id;

  return (
    <span style={ROW}>
      <code style={MONO}>{short(account)}</code>
      {!organization ? (
        <span style={NOTE}>organization address unknown</span>
      ) : isOrganization ? (
        <span style={OK}>organization</span>
      ) : (
        <span style={WARN}>
          not the organization ({short(organization)}) — switch accounts to sign
        </span>
      )}
      {wrongChain && (
        <span style={WARN}>wrong network — switch to {EXPECTED_CHAIN.name}</span>
      )}
      {error && <span style={WARN}>{error}</span>}
    </span>
  );
}

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Inline styles rather than classes: the console's own primitives are the
 * house style here, and this component sits in their header. Introducing a
 * fourth styling system for one status row would be worse than five style
 * objects.
 */
const ROW: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.75rem",
};
const MONO: React.CSSProperties = { fontFamily: "var(--font-geist-mono)" };
const NOTE: React.CSSProperties = { color: "var(--muted-foreground)", fontSize: "0.75rem" };
const OK: React.CSSProperties = { color: "var(--graph-accent-3)" };
const WARN: React.CSSProperties = { color: "var(--destructive)" };
const BUTTON: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "999px",
  padding: "0.25rem 0.75rem",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
};
