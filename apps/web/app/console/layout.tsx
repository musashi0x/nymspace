import Link from "next/link";
import { OrganizationWallet } from "@/components/console/organization-wallet";
import { ThemeToggle } from "@/components/theme-toggle";
import { publicEnv } from "@nymspace/core";

/**
 * The console shell.
 *
 * Fleet, Discover and Activity, which is the navigation `docs/03` calls
 * mandatory plus the one it calls recommended. Settings is deliberately absent:
 * the spec allows it to be minimal, and an empty settings page is a promise the
 * product does not keep.
 */
export const metadata = {
  title: "Nymspace console",
  description:
    "Agent identity on ENSv2, discovery over live ERC 8004 data, and payments inside an enforced policy.",
};

const NAV = [
  { href: "/console", label: "Fleet" },
  { href: "/console/discover", label: "Discover" },
  { href: "/console/activity", label: "Activity" },
] as const;

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-8">
      {/* wrap, not overflow: the wallet control grows when it has something to
          say, and on a narrow viewport it belongs on its own line rather than
          crushing the nav. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
        <div className="flex shrink-0 items-baseline gap-6">
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            nymspace
          </Link>
          <nav className="flex gap-4">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex min-w-0 items-center gap-4">
          {/* The organization's own signer. Agent writes stay server-signed. */}
          <OrganizationWallet organization={publicEnv().organizationAddress} />
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
