"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
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
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();

  const value: Visitor = {
    configured: true,
    ready,
    address: authenticated ? wallets[0]?.address : undefined,
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
      {/*
        Truncated, and never the only place the address appears — the matrix
        below prints it in full beside the answers it produced, because a
        shortened address in a header is an identity hint and not evidence.
      */}
      <Text type="code" size="2xs" color="secondary">
        {visitor.address.slice(0, 6)}…{visitor.address.slice(-4)}
      </Text>
      <Button
        size="sm"
        variant="ghost"
        label="Disconnect"
        onClick={visitor.disconnect}
      />
    </HStack>
  );
}
