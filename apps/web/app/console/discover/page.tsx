import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { DiscoverForm } from "@/components/console/discover-form";

/**
 * Screen 3 — Discover.
 *
 * The form is a client component because the query is conversational and the
 * result arrives after a round trip the operator initiated; everything else on
 * this page is static copy. Nothing is prefetched: a discovery result rendered
 * before anyone asked would be a cached answer wearing a live one's clothes.
 */
export default function DiscoverPage() {
  return (
    <VStack as="main" gap={6} width="100%" className="min-w-0">
      <VStack as="header" gap={2} maxWidth="42rem">
        <Heading level={1}>Discover</Heading>
        <Text type="supporting" as="p">
          Live ERC 8004 registrations from the Agent0 subgraph. The filter runs
          on the server before a model sees anything, and the ranking&rsquo;s
          reason is checked field by field against the data it describes — a
          reason citing something the response never carried fails rather than
          renders.
        </Text>
      </VStack>
      <DiscoverForm />
    </VStack>
  );
}
