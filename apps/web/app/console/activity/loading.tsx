import { Center } from "@astryxdesign/core/Center";
import { Spinner } from "@astryxdesign/core/Spinner";

/**
 * Route-level loading state for the activity timeline.
 *
 * `fetchActivity` and `fetchActivitySummary` run uncached on every load, same
 * reasoning as the fleet page's own loading state — this one just names what
 * it's reading. A filter change navigates, so it passes through here too.
 */
export default function Loading() {
  return (
    <Center width="100%" minHeight="60vh">
      <Spinner size="lg" label="Reading activity and outcome counts…" />
    </Center>
  );
}
