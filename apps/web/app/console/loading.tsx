import { Center } from "@astryxdesign/core/Center";
import { Spinner } from "@astryxdesign/core/Spinner";

/**
 * Route-level loading state for the fleet page.
 *
 * `fetchAgents` runs uncached on every load (deliberately — see the page's own
 * comment), so navigation here has no cached fallback to render instantly.
 */
export default function Loading() {
  return (
    <Center width="100%" minHeight="60vh">
      <Spinner size="lg" label="Reading fleet…" />
    </Center>
  );
}
