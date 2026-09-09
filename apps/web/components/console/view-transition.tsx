"use client";

import { VStack } from "@astryxdesign/core/VStack";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The cross-fade between console screens.
 *
 * `children` arrives as a prop from the server layout rather than being
 * imported here, so the screens underneath stay server components and keep
 * their `export const dynamic = "force-dynamic"`. This file is the only part
 * of the shell that crosses the client boundary, and all it reads is the path.
 *
 * Keyed on the pathname because that is what makes the animation run: a new
 * key remounts the wrapper, and a CSS animation runs on mount. Without it the
 * element persists across navigation and the fade happens once, on first load.
 *
 * React 19's View Transitions were the other candidate and lost: Next 16 still
 * exposes them as unstable, and this needs no flag and degrades to an instant
 * swap. See openspec/changes/polish-console-ui/design.md D4.
 */
export function ViewTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <VStack
      key={pathname}
      gap={0}
      width="100%"
      className="view-enter min-w-0"
    >
      {children}
    </VStack>
  );
}
