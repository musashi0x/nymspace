import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Suspense } from "react";
import { CreateAgent } from "@/components/console/create-agent";

/**
 * Screen 0 — the front door.
 *
 * `docs/02_PRODUCT_FLOW.md`'s golden path starts here, and until this page
 * existed the only way to walk it was a terminal. The form is a client
 * component because provisioning outlives the request that starts it; the copy
 * around it is static, the shape `discover/page.tsx` already uses.
 *
 * The form is behind `Suspense` because it reads the resumed run id with
 * `useSearchParams()`, and a component that reads the query string cannot be
 * prerendered — search params are not known until the request. Without the
 * boundary `next build` fails the whole export on this page rather than
 * degrading it, so the boundary is what lets the static shell around the form
 * still be prerendered.
 */
export default function NewAgentPage() {
  const parent = process.env.NEXT_PUBLIC_PARENT_ENS_NAME ?? "nymspace.eth";

  return (
    <VStack as="main" gap={6} width="100%" className="min-w-0">
      <VStack as="header" gap={2} maxWidth="42rem">
        <Heading level={1}>
          <Text type="body" size="xl">
            New agent
          </Text>
        </Heading>
        <Text type="supporting" as="p">
          Registers a subname under {parent}, attaches the permissioned
          resolver, publishes the agent&rsquo;s records, and grants the
          controller only the keys you delegate. Every step reads the chain
          before it writes, so sending this twice repairs a half-finished agent
          rather than paying to create a second one.
        </Text>
      </VStack>
      <Suspense
        fallback={
          <Text type="supporting" as="p">
            Loading the provisioning form&hellip;
          </Text>
        }
      >
        <CreateAgent parentName={parent} />
      </Suspense>
    </VStack>
  );
}
