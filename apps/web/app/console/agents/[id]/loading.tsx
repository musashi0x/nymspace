import { Center } from "@astryxdesign/core/Center";
import { Spinner } from "@astryxdesign/core/Spinner";

/**
 * Route-level loading state for the agent inspector.
 *
 * The page fires three parallel reads (identity, permissions, wallet) before
 * anything can render, so a slow RPC left the route blank until they landed.
 * Unknown duration, no known layout to preserve — Astryx's own guidance is
 * Spinner over Skeleton for exactly this case.
 */
export default function Loading() {
  return (
    <Center width="100%" minHeight="60vh">
      <Spinner size="lg" label="Reading agent…" />
    </Center>
  );
}
