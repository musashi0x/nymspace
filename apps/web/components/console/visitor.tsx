"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { useClipboard } from "@astryxdesign/core/hooks";
import { publicEnv } from "@nymspace/core";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The visitor, and what ENSv2 lets them do.
 *
 * Everything else in this console is signed by a key the visitor never sees, so
 * a denial on screen is the server reporting a denial — believable, and not the
 * same thing as verifiable. `docs/01`'s first success metric is that every
 * displayed permission is contract derived, and this is the one place a reader
 * can check that claim against an address they control rather than one the
 * deployment configured.
 *
 * ## Why the read is the whole feature
 *
 * A connected visitor holds no role on `nymspace.eth`, so the interesting
 * answer is already available without spending anything: `hasRoles` against
 * their address returns false for every capability, and the same request
 * returns true for the organization. No transaction, no gas, no faucet — the
 * authority boundary is a read, and making the visitor the subject of that read
 * is what turns it from an assertion into a check.
 *
 * Attempting the write instead would be stronger still and costs a funded
 * account plus a revert to interpret, which is `docs/21`'s scope-trap shape.
 * The matrix is the honest ninety percent.
 *
 * ## Degrading without the app id
 *
 * `privyAppId` is `optional()` in `env.public.ts` — the landing page, CI and
 * every clone without credentials must render. So the provider is conditional
 * and {@link useVisitor} answers `configured: false` rather than throwing,
 * because a console that white-screens when a sponsor variable is unset is
 * worse than one that quietly has no connect button.
 */

interface Visitor {
  /** Whether this deployment has a Privy app id at all. */
  configured: boolean;
  ready: boolean;
  address: string | undefined;
  connect: () => void;
  disconnect: () => void;
}

const UNCONFIGURED: Visitor = {
  configured: false,
  ready: true,
  address: undefined,
  connect: () => {},
  disconnect: () => {},
};

const VisitorContext = createContext<Visitor>(UNCONFIGURED);

export function useVisitor(): Visitor {
  return useContext(VisitorContext);
}

/**
 * Wraps the console when an app id exists, and is a pass-through when it does
 * not.
 *
 * Two components rather than one branch inside a single one: `usePrivy` may
 * only be called under a mounted `PrivyProvider`, and a hook called
 * conditionally is the rules-of-hooks violation React cannot recover from.
 */
export function VisitorProvider({ children }: { children: ReactNode }) {
  const appId = publicEnv().privyAppId;
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        /*
          Wallet first, because the subject of the read is an address. An email
          login mints an embedded wallet and would work identically, but the
          point lands hardest when the reader recognises the address as one they
          already had.
        */
        loginMethods: ["wallet", "email"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();

  /*
    `user.wallet` first, `wallets[0]` second.

    They resolve at different times. `useWallets` builds its list from live
    connectors, which on a reload is empty for a moment while they reconnect,
    whereas `user.wallet` comes straight from the restored session. Reading only
    the list meant that after every reload the header showed "Connect" to
    someone who was still signed in — a false claim about their state, and the
    one thing this header exists to report.
  */
  const address = authenticated
    ? (user?.wallet?.address ?? wallets[0]?.address)
    : undefined;

  const value: Visitor = {
    configured: true,
    ready,
    address,
    connect: login,
    disconnect: logout,
  };

  return <VisitorContext value={value}>{children}</VisitorContext>;
}

/**
 * The header control.
 *
 * Renders nothing at all when unconfigured — an always-disabled button is a
 * promise the deployment cannot keep, and reads as broken rather than as absent.
 */
export function ConnectVisitor() {
  const visitor = useVisitor();
  if (!visitor.configured) return null;

  if (!visitor.ready) {
    return (
      <Text type="code" size="2xs" color="secondary">
        …
      </Text>
    );
  }

  if (!visitor.address) {
    return (
      <Button
        size="sm"
        variant="secondary"
        label="Connect"
        onClick={visitor.connect}
      />
    );
  }

  return (
    <HStack gap={2} align="center">
      <AddressChip address={visitor.address} />
      <Button
        size="sm"
        variant="ghost"
        label="Disconnect"
        onClick={visitor.disconnect}
      />
    </HStack>
  );
}

/**
 * The connected address, shortened, with the full one a click away.
 *
 * Bordered because it is a value and not a control, and the two sat side by
 * side as bare text before — a shortened hex string beside a ghost button reads
 * as two labels rather than as "here is who you are, and here is how to stop
 * being them". The border is what makes the address look deliberate rather than
 * like selected text.
 *
 * Copy rather than select: six characters and four are enough to recognise an
 * address and not enough to use one, so the shortened form is only ever a label
 * and the clipboard carries the whole thing.
 */
export function AddressChip({ address }: { address: string }) {
  // `useClipboard` owns the copied flag and its reset timer. Astryx's own note
  // on the hook is explicit that a second `useState` beside it is the mistake:
  // `isCopied` already resets itself, and a rapid re-copy restarts the window.
  const { copy, isCopied } = useClipboard({ announce: "Address copied" });

  return (
    <HStack
      gap={2}
      align="center"
      paddingInline={2}
      paddingBlock={1}
      className="rounded-lg border border-border"
    >
      {/*
        `sm`, not `2xs`. The table cells use `2xs` because density is the point
        there; in this header it resolved to eight pixels against the
        fourteen-pixel button beside it, and the address read as a caption under
        the control rather than as the thing the control acts on. `xsm` is ten,
        still short of it — `sm` is the first step that sits level.
      */}
      <Text type="code" size="sm" color="secondary">
        {address.slice(0, 6)}…{address.slice(-4)}
      </Text>
      <IconButton
        size="sm"
        variant="ghost"
        // The tooltip stays "Copy"; the icon flip is the confirmation. The
        // label moves, because that is what a screen reader reads back.
        tooltip="Copy address"
        label={isCopied ? "Address copied" : "Copy address"}
        icon={<Icon icon={isCopied ? "check" : "copy"} size="xsm" />}
        onClick={() => void copy(address)}
      />
    </HStack>
  );
}
