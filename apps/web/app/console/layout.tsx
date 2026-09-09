import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The console shell.
 *
 * Fleet, Discover and Activity, which is the navigation `docs/03` calls
 * mandatory plus the one it calls recommended. Settings is deliberately absent:
 * the spec allows it to be minimal, and an empty settings page is a promise the
 * product does not keep.
 *
 * `surface-body` paints the Astryx body token rather than leaving the shell on
 * the shadcn `--background` the landing page uses. Two token systems both claim
 * "the page background", and a Frame punches its edge with the Astryx one:
 * unreconciled, the punch is a visibly tinted lozenge behind every title.
 * Painting the shell here reconciles them inside the console without touching
 * the landing page.
 */

const NAV = [
  { href: "/console", label: "Fleet" },
  { href: "/console/new", label: "New agent" },
  { href: "/console/discover", label: "Discover" },
  { href: "/console/activity", label: "Activity" },
] as const;

export const metadata = {
  title: "Nymspace console",
  description:
    "Agent identity on ENSv2, discovery over live ERC 8004 data, and payments inside an enforced policy.",
};

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <VStack
      gap={8}
      paddingInline={6}
      paddingBlock={8}
      minHeight="100vh"
      maxWidth="72rem"
      width="100%"
      className="surface-body mx-auto min-w-0"
    >
      <HStack
        as="header"
        gap={6}
        justify="between"
        align="center"
        paddingBlockEnd={4}
        className="frame-rule-below"
      >
        <HStack gap={6} align="end">
          <Link href="/">
            <Text type="code" size="xsm" color="secondary">
              NYMSPACE
            </Text>
          </Link>
          <HStack as="nav" gap={4}>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                <Text type="body" size="sm" color="secondary">
                  {item.label}
                </Text>
              </Link>
            ))}
          </HStack>
        </HStack>
        <ThemeToggle />
      </HStack>
      {children}
    </VStack>
  );
}
