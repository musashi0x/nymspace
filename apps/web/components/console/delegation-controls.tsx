"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Loading, Outcome } from "@/components/console/primitives";
import { classify, type ConsoleError } from "@/lib/console/errors";
import { LOADING_COPY } from "@/lib/console/state";
import { useOrganizationWallet } from "@/components/console/organization-wallet";
import { apiBaseUrl } from "@/lib/api";
import {
  EXPECTED_CHAIN,
  WalletError,
  connect,
  ensureChain,
  sendPrepared,
  type PreparedTransaction,
} from "@/lib/wallet";

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
 * The wallet path is preferred where possible because the organization is a
 * person: a revocation someone approved is a different fact from one a server
 * performed with a key it happens to hold.
 *
 * The panel says which path a click will take *before* it is clicked, and
 * where the blocker is fixable from here (connect, switch network) it offers
 * the fix rather than describing it. Switching accounts is the one case it
 * cannot fix — MetaMask has no API for it — so that one is stated plainly.
 */

type Result =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "ok"; message: string; txHash?: string }
  /**
   * Classified, not raw.
   *
   * This panel writes to ENSv2, so its most likely failure is an EAC denial —
   * the control plane refusing an unauthorized write, which is the product's
   * central proof rather than a fault. Rendering that in the same red box as an
   * RPC timeout would tell the operator the system broke at the moment it
   * worked, so the copy and tone both come from `classify` (`docs/03`).
   */
  | { kind: "problem"; error: ConsoleError };

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
  const { account, status, refresh } = useOrganizationWallet(organization);
  const [result, setResult] = React.useState<Result>({ kind: "idle" });
  const [active, setActive] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);

  const signer: "wallet" | "server" = status === "ready" ? "wallet" : "server";

  async function run(recordKey: string, grant: boolean) {
    setActive(`${recordKey}:${grant}`);
    setResult({ kind: "busy", step: LOADING_COPY.ens });
    try {
      if (signer === "wallet") await viaWallet(recordKey, grant);
      else await viaServer(recordKey, grant);
      // The matrix above is rendered server-side from live chain reads, so
      // re-fetching the route is what makes a change visible. Nothing is
      // mutated client-side, which is why the matrix cannot drift from chain.
      router.refresh();
    } catch (cause) {
      setResult(toResult(cause));
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

    setResult({ kind: "busy", step: "Waiting for your wallet" });
    const txHash = await sendPrepared({
      transaction: prepared.transaction,
      expectedSigner: prepared.expectedSigner,
    });

    setResult({ kind: "busy", step: LOADING_COPY.transaction });
    const confirmed = await post<{ status: string }>(
      `/v1/agents/${agentId}/permissions/confirm`,
      { controller, recordKey, grant, txHash, signer: account },
    );

    setResult(
      confirmed.status === "confirmed"
        ? {
            kind: "ok",
            message: `${grant ? "Granted" : "Revoked"} ${recordKey} — you signed it.`,
            txHash,
          }
        : {
            kind: "problem",
            error: {
              ...classify({ status: confirmed.status, source: "ensv2" }),
              detail: `The transaction mined but did not take effect. ${recordKey} is unchanged.`,
            },
          },
    );
  }

  async function viaServer(recordKey: string, grant: boolean) {
    setResult({ kind: "busy", step: LOADING_COPY.ens });
    const response = await post<{ status?: string; source?: string }>(
      `/v1/agents/${agentId}/permissions`,
      { controller, recordKey, grant },
    );
    setResult(
      response.status === "confirmed"
        ? {
            kind: "ok",
            message: `${grant ? "Granted" : "Revoked"} ${recordKey} — the server signed it.`,
          }
        : {
            kind: "problem",
            error: classify({
              status: response.status,
              source: response.source,
            }),
          },
    );
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (cause) {
      setResult(toResult(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Delegation</span>
        <SignerNote
          status={status}
          organization={organization}
          busy={busy}
          onConnect={() => void act(connect)}
          onSwitch={() => void act(ensureChain)}
        />
      </header>

      <ul className="flex flex-col divide-y divide-border/40">
        {recordKeys.map((key) => (
          <li
            key={key}
            className="flex flex-wrap items-center justify-between gap-3 py-2"
          >
            <code className="font-mono text-xs break-all">{key}</code>
            <span className="flex shrink-0 gap-2">
              <ActionButton
                label="Grant"
                busy={active === `${key}:true`}
                disabled={active !== undefined}
                onClick={() => void run(key, true)}
              />
              <ActionButton
                label="Revoke"
                busy={active === `${key}:false`}
                disabled={active !== undefined}
                onClick={() => void run(key, false)}
              />
            </span>
          </li>
        ))}
      </ul>

      <ResultView result={result} />
    </div>
  );
}

function SignerNote({
  status,
  organization,
  busy,
  onConnect,
  onSwitch,
}: {
  status: ReturnType<typeof useOrganizationWallet>["status"];
  organization: string | undefined;
  busy: boolean;
  onConnect: () => void;
  onSwitch: () => void;
}) {
  if (status === "ready") {
    return <Badge tone="good">you will sign these</Badge>;
  }

  if (status === "disconnected") {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        the server will sign
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="rounded-full border border-border px-2 py-0.5 text-[0.7rem] transition-colors hover:bg-muted disabled:opacity-50"
        >
          connect to sign yourself
        </button>
      </span>
    );
  }

  if (status === "wrong_chain") {
    return (
      <button
        type="button"
        onClick={onSwitch}
        disabled={busy}
        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.7rem] text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
      >
        {busy ? "switching…" : `switch to ${EXPECTED_CHAIN.name} to sign`}
      </button>
    );
  }

  if (status === "wrong_account") {
    return (
      <span
        className="text-xs text-muted-foreground"
        title={`Organization actions must be signed by ${organization}. Switch accounts in your wallet — a page cannot do it for you.`}
      >
        the server will sign — connected as another account
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">the server will sign</span>;
}

function ActionButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-border px-3 py-0.5 text-xs transition-colors hover:bg-muted disabled:opacity-40"
    >
      {busy ? "…" : label}
    </button>
  );
}

/**
 * Turn anything thrown into a classified result.
 *
 * A rejection in the wallet is not a failure — the operator changed their mind,
 * and the panel should go quiet rather than show them a red box for doing so.
 * Everything else is classified on the API's own structured fields where they
 * exist, and only falls back to message text when they do not.
 */
function toResult(cause: unknown): Result {
  if (cause instanceof WalletError && cause.kind === "rejected") {
    return { kind: "idle" };
  }
  if (cause instanceof ApiError) {
    return { kind: "problem", error: classify(cause.body) };
  }
  return {
    kind: "problem",
    error: classify({ error: cause instanceof Error ? cause.message : "" }),
  };
}

function ResultView({ result }: { result: Result }) {
  if (result.kind === "idle") return null;

  if (result.kind === "busy") return <Loading what={result.step} />;

  if (result.kind === "ok") {
    return (
      <p className="text-xs text-emerald-600 dark:text-emerald-400">
        {result.message}
        {result.txHash && (
          <>
            {" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${result.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline underline-offset-2"
            >
              {result.txHash.slice(0, 10)}…
            </a>
          </>
        )}
      </p>
    );
  }

  return (
    <Outcome
      tone={result.error.tone}
      title={result.error.title}
      detail={result.error.detail || undefined}
      action={result.error.action}
    />
  );
}

/**
 * Carries the API's parsed body, not just a message.
 *
 * `classify` keys on `status` and `source` because the API already decoded the
 * revert and named the policy. Throwing a bare `Error` would discard that and
 * force a second classifier here, working from prose, free to disagree with the
 * first — which is how an EAC denial ends up rendered as a generic fault.
 */
class ApiError extends Error {
  constructor(
    readonly body: {
      status?: string;
      source?: string;
      reason?: string;
      error?: string;
      remedy?: string;
    },
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as T & {
    status?: string;
    source?: string;
    reason?: string;
    error?: string;
    remedy?: string;
  };
  if (!res.ok) {
    throw new ApiError(
      parsed,
      [parsed.error ?? `Request failed (${res.status})`, parsed.remedy]
        .filter(Boolean)
        .join(" "),
    );
  }
  return parsed;
}
