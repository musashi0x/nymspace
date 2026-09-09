import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { PermissionCheck, PermissionScope } from "@nymspace/core";

/**
 * One cell of the permission matrix.
 *
 * Three things this deliberately does not do:
 *
 * - It never renders a bare checkmark. A permission can be satisfied at four
 *   different EAC scopes and the difference matters: "this controller may edit
 *   this one key" and "this controller may edit every key on this name" both
 *   read as allowed, and only one of them is the product's claim.
 * - It never renders `unknown` as denied. A failed read and an enforced
 *   boundary are different facts.
 * - It flags a wildcard grant instead of quietly showing it as allowed. The
 *   spike forbids granting `resource(0, part)`, so observing one is a finding.
 */

const SCOPE_COPY: Record<PermissionScope, { label: string; detail: string }> = {
  record: {
    label: "this key",
    detail: "Granted on this record key, on this name only.",
  },
  name: {
    label: "every key on this name",
    detail:
      "A name-wide grant. Authorises keys that have no per-key grant of their own.",
  },
  wildcard: {
    label: "every name",
    detail:
      "A wildcard grant at resource(0, key): authorises this key on every name this resolver serves. The authority model forbids this — treat it as a finding.",
  },
  root: {
    label: "root authority",
    detail:
      "Held at ROOT_RESOURCE and OR'd in by hasRoles, which is how the organization retains authority over subnames.",
  },
};

export function PermissionCell({ check }: { check: PermissionCheck }) {
  if (check.state === "unknown") {
    return (
      <HStack gap={2} vAlign="center">
        <Badge variant="neutral" label="Unknown" />
        <Text type="body" size="sm" color="secondary">
          {check.unavailableReason ?? "Not read."}
        </Text>
      </HStack>
    );
  }

  if (check.state === "denied") {
    return <Badge variant="neutral" label="Denied" />;
  }

  const scope = check.scope ?? "record";
  const copy = SCOPE_COPY[scope];
  const isWildcard = scope === "wildcard";

  return (
    <HStack gap={2} vAlign="center">
      <Badge
        variant={isWildcard ? "error" : "success"}
        label={isWildcard ? "Allowed — wildcard" : "Allowed"}
      />
      <Text
        type="body"
        size="sm"
        color={isWildcard ? "accent" : "secondary"}
      >
        {isWildcard ? copy.detail : copy.label}
      </Text>
    </HStack>
  );
}
