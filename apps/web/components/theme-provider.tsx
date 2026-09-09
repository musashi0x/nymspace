"use client";

import { Theme } from "@astryxdesign/core/theme";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type * as React from "react";
import { useMounted } from "@/lib/use-mounted";
// The built theme object, not `theme.ts` itself: the source is the input to
// `astryx theme build`, and the generated module is what pairs with the static
// CSS imported in globals.css.
import { nymspaceTheme } from "@/nymspace";

/**
 * Two theme systems, one source of truth for the mode.
 *
 * Tailwind and shadcn read a `.dark` class; Astryx reads `data-theme` on
 * <html>, which its reset maps to `color-scheme` so `light-dark()` resolves.
 * next-themes writes both from one store when given both attribute names, and
 * it writes them in an inline script before first paint, which is the only
 * place a mode can be set without a flash.
 *
 * The mount gate below is not ceremony. <Theme> renders its own wrapper element
 * carrying `color-scheme` and `data-theme` derived from `mode`, and next-themes
 * resolves the stored mode synchronously on its first client render but not on
 * the server. Passing the resolved value straight through therefore produced a
 * real hydration error, not a warning:
 *
 *   data-theme={null} (server) vs data-theme="light" (client)
 *
 * and React does not patch attribute mismatches. Holding `mode` at undefined
 * until after mount makes the first client render match the server, and the
 * render that follows hydration corrects it. `suppressHydrationWarning` on
 * <html> does not reach this element, so the gate is the fix rather than a
 * workaround for a warning.
 *
 * Residual cost: for one frame, a viewer whose stored choice differs from their
 * OS preference sees Astryx components resolve against the OS. `<html>` itself
 * is already correct pre-paint from next-themes' script, so this is confined to
 * the tokens inside the wrapper, and `disableTransitionOnChange` keeps it from
 * animating.
 */
function AstryxBridge({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();

  const mode =
    mounted && (resolvedTheme === "dark" || resolvedTheme === "light")
      ? resolvedTheme
      : undefined;

  return (
    <Theme theme={nymspaceTheme} mode={mode}>
      {children}
    </Theme>
  );
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <AstryxBridge>{children}</AstryxBridge>
    </NextThemesProvider>
  );
}
