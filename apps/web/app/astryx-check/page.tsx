"use client";

import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/VStack";

/**
 * Astryx smoke test (task #82).
 *
 * This route exists to prove the design system is wired: if the reset, the
 * core stylesheet and the theme are all reaching the browser, the button below
 * is themed rather than a bare native control, and the stack applies its own
 * spacing. Astryx components own all layout — there is deliberately no <div>
 * and no Tailwind utility class in this file.
 */
export default function AstryxCheck() {
  return (
    <VStack gap={4} padding={6} hAlign="start">
      <Button variant="primary" size="md" label="Primary" />
      <Button variant="secondary" size="md" label="Secondary" />
      <Button variant="ghost" size="md" label="Ghost" />
      <Button variant="destructive" size="md" label="Destructive" />
    </VStack>
  );
}
