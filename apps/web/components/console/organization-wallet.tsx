"use client";

import * as React from "react";
import { Badge } from "@/components/console/primitives";
import {
  EXPECTED_CHAIN,
  WalletError,
  connect,
  currentAccount,
  currentChainId,
  ensureChain,
  hasProvider,
  watchWallet,
} from "@/lib/wallet";

/**
 * The organization's wallet, as a header control.
 *
 * The first version put every problem on one line as red prose — the address,
 * "not the organization (0x…) — switch accounts to sign", and "wrong network —
 * switch to Sepolia" all at once, wrapping into the nav. Three sentences of red
 * text is not a status; it reads as breakage, and it tells the operator to do
 * something instead of letting them do it.
 *
 * So: one compact pill. Address, plus a single badge for the one thing that is
 * currently wrong, with the fix as a button where a button can fix it. The
 * detail lives in a title attribute rather than on the line.
 */

export type WalletStatus =
  | "no_provider"
  | "disconnected"
  | "wrong_chain"
  | "wrong_account"
  | "ready";

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

  const status: WalletStatus = !hasProvider()
    ? "no_provider"
    : !account
      ? "disconnected"
      : chainId !== undefined && chainId !== EXPECTED_CHAIN.id
        ? "wrong_chain"
        : !isOrganization
          ? "wrong_account"
          : "ready";

  return { account, chainId, isOrganization, ready, status, refresh };
}

export function OrganizationWallet({
  organization,
}: {
  organization: string | undefined;
}) {
  const { account, ready, status, refresh } =
    useOrganizationWallet(organization);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  async function act(fn: () => Promise<unknown>) {
    setError(undefined);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (cause) {
      setError(cause instanceof WalletError ? cause.message : "Wallet error.");
    } finally {
      setBusy(false);
    }
  }

  // Nothing until the provider has been probed, so the control does not flash
  // "no wallet" at someone who has one.
  if (!ready) return null;

  if (status === "no_provider") {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Organization actions will be signed by the server where a key is configured."
      >
        no wallet
      </span>
    );
  }

  if (status === "disconnected") {
    return (
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void act(connect)}
          disabled={busy}
          className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect wallet"}
        </button>
        {error && <ErrorNote message={error} />}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <code
        className="font-mono text-xs text-muted-foreground"
        title={account}
      >
        {short(account!)}
      </code>

      {status === "ready" && <Badge tone="good">organization</Badge>}

      {status === "wrong_chain" && (
        <button
          type="button"
          onClick={() => void act(ensureChain)}
          disabled={busy}
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.7rem] text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
          title={`This wallet is on another network. Signing there would target a different deployment of the same addresses.`}
        >
          {busy ? "switching…" : `switch to ${EXPECTED_CHAIN.name}`}
        </button>
      )}

      {status === "wrong_account" && (
        <Badge tone="warn">
          <span
            title={`Connected as ${account}. Organization actions must be signed by ${organization}. Switch accounts in your wallet — this cannot be done from the page.`}
          >
            not the organization
          </span>
        </Badge>
      )}

      {error && <ErrorNote message={error} />}
    </span>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <span className="max-w-[16rem] truncate text-xs text-destructive" title={message}>
      {message}
    </span>
  );
}

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
