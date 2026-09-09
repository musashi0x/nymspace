import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { AgentSnapshot, Ensip25Status } from "@nymspace/core";
import { PermissionCell } from "@/components/permission-cell";
import { PermissionProof } from "@/components/permission-proof";
import { fetchAgentSnapshot } from "@/lib/agent-snapshot";

export const dynamic = "force-dynamic";

/**
 * Screen 2, the Agent Inspector (docs/03_UX_SPEC.md).
 *
 * The point of the screen is that every value on it is a chain read with
 * provenance, and that the permission matrix is derived from live EAC state
 * rather than from the intended-policy table in the spec. Where a value has not
 * been read, it says so rather than defaulting to a plausible one.
 */
export default async function AgentInspector({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const result = await fetchAgentSnapshot(decoded);

  if (result.source === "error") {
    return (
      <VStack gap={5} padding={6} maxWidth="960px">
        <Text type="display-3" as="p">
          {decoded}
        </Text>
        <Banner
          status="error"
          container="card"
          title="This name could not be read"
          description={result.reason}
        />
      </VStack>
    );
  }

  const { snapshot } = result;

  return (
    <VStack gap={6} padding={6} maxWidth="960px">
      <VStack gap={2}>
        <Text type="display-3" as="p">
          {decoded}
        </Text>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge variant="neutral" label="Sepolia" />
          <Badge
            variant={result.source === "live" ? "success" : "warning"}
            label={result.source === "live" ? "Live" : "Not read"}
          />
          <Text type="body" size="sm" color="secondary">
            {result.source === "live"
              ? `Block ${snapshot.provenance.blockNumber} · read ${snapshot.provenance.readAt}`
              : "No block — nothing has been read from chain."}
          </Text>
        </HStack>
      </VStack>

      {result.source === "placeholder" && (
        <Banner
          status="warning"
          container="card"
          title="Not live: no chain reads have happened"
          description={`${result.reason} Every permission below reads Unknown for that reason — none of them is a claim about what the contract would allow.`}
        />
      )}

      <Identity snapshot={snapshot} />
      <Records snapshot={snapshot} />
      <Authority snapshot={snapshot} />
      <Ensip25 status={snapshot.ensip25} />
      <PermissionProof name={decoded} enabled={result.source === "live"} />
    </VStack>
  );
}

/** A chain-derived field. `null` renders as "Not read", never as blank. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <HStack gap={3} vAlign="start" wrap="wrap">
      <Text type="body" size="sm" color="secondary">
        {label}
      </Text>
      {value ? (
        <Text type="body" size="sm" wordBreak="break-all">
          {value}
        </Text>
      ) : (
        <Text type="body" size="sm" color="placeholder">
          Not read
        </Text>
      )}
    </HStack>
  );
}

function Identity({ snapshot }: { snapshot: AgentSnapshot }) {
  const { identity } = snapshot;
  return (
    <Card elevation="none">
      <VStack gap={4} padding={5}>
        <Text type="large" as="p">
          Identity
        </Text>
        <Divider />
        <VStack gap={3}>
          <Field label="Full name" value={identity.name} />
          <Field label="Parent namespace" value={identity.parent} />
          <Field label="Owner" value={identity.owner} />
          <Field label="Controller" value={identity.controller} />
          <Field label="Resolver" value={identity.resolver} />
          <Field label="Registry" value={identity.registry} />
        </VStack>
      </VStack>
    </Card>
  );
}

const RECORD_KEYS = [
  "agent-context",
  "agent-endpoint[mcp]",
  "agent-endpoint[a2a]",
  "agent-endpoint[web]",
] as const;

function Records({ snapshot }: { snapshot: AgentSnapshot }) {
  const { records } = snapshot;
  return (
    <Card elevation="none">
      <VStack gap={4} padding={5}>
        <VStack gap={1}>
          <Text type="large" as="p">
            Agent manifest
          </Text>
          <Text type="body" size="sm" color="secondary">
            Read from ENS text records. ENS is the source — this is not a stored
            profile.
          </Text>
        </VStack>
        <Divider />
        <VStack gap={3}>
          {RECORD_KEYS.map((key) => {
            const value = records.values[key];
            const failed = records.unreadable.includes(key);
            return (
              <HStack key={key} gap={3} vAlign="start" wrap="wrap">
                <Text type="body" size="sm" color="secondary">
                  {key}
                </Text>
                {failed ? (
                  <Badge variant="warning" label="Read failed" />
                ) : value ? (
                  <Text type="body" size="sm" wordBreak="break-all">
                    {value}
                  </Text>
                ) : (
                  <Text type="body" size="sm" color="placeholder">
                    Empty
                  </Text>
                )}
              </HStack>
            );
          })}
        </VStack>
      </VStack>
    </Card>
  );
}

function Authority({ snapshot }: { snapshot: AgentSnapshot }) {
  return (
    <Card elevation="none">
      <VStack gap={4} padding={5}>
        <VStack gap={1}>
          <Text type="large" as="p">
            Authority
          </Text>
          <Text type="body" size="sm" color="secondary">
            Derived from live EAC reads. The registry and the resolver are
            separate domains — registry ownership grants no resolver authority.
          </Text>
        </VStack>
        <Divider />

        <VStack gap={4}>
          <HStack gap={4} vAlign="center">
            <Text type="body" size="sm" color="secondary">
              Capability
            </Text>
            <Text type="body" size="sm" color="secondary">
              Agent controller
            </Text>
            <Text type="body" size="sm" color="secondary">
              Organization owner
            </Text>
          </HStack>
          <Divider />
          {snapshot.authority.map((row) => (
            <VStack key={row.capability} gap={2}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="body" size="sm">
                  {row.label}
                </Text>
                <Badge
                  variant={row.domain === "registry" ? "purple" : "teal"}
                  label={row.domain}
                />
              </HStack>
              <HStack gap={5} wrap="wrap">
                <PermissionCell check={row.controller} />
                <PermissionCell check={row.organization} />
              </HStack>
              <Divider />
            </VStack>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
}

function Ensip25({ status }: { status: Ensip25Status }) {
  const variant =
    status.status === "verified"
      ? "success"
      : status.status === "stale"
        ? "warning"
        : "neutral";

  return (
    <Card elevation="none">
      <VStack gap={4} padding={5}>
        <Text type="large" as="p">
          ENSIP 25 association
        </Text>
        <Divider />
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Badge
            variant={variant}
            label={
              status.status === "verified"
                ? "Verified"
                : status.status === "stale"
                  ? "Stale"
                  : status.status === "unverified"
                    ? "Unverified"
                    : "Unavailable"
            }
          />
          <Text type="body" size="sm" color="secondary">
            {status.status === "verified"
              ? `Registry ${status.registry} · agent ${status.agentId} · chain ${status.chainId} · checked ${status.checkedAt}`
              : status.reason}
          </Text>
        </HStack>
        <Text type="body" size="sm" color="secondary">
          Verified means a runtime check passed just now. It says the name and
          the registration point at each other — not that the agent is safe,
          capable, or well reviewed.
        </Text>
      </VStack>
    </Card>
  );
}
