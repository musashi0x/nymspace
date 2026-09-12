"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { useClipboard } from "@astryxdesign/core/hooks";

/**
 * A value with the whole of it one click from the clipboard.
 *
 * Its own module, and the reason is the boundary rather than the size.
 * `primitives.tsx` carries no `"use client"` and is imported by five server
 * components — `console/page.tsx`, the inspector, the activity and chat
 * screens. A hook in that file makes every one of them illegal, and the failure
 * is a runtime error about hooks in a Server Component rather than anything
 * naming the import that caused it. `authority-matrix.tsx` documents the mirror
 * of this hazard from the other side.
 *
 * So the clipboard lives here and `Field` renders it as a child, which is the
 * boundary React actually draws: a server component may render a client one and
 * pass it strings.
 *
 * ## The affordance
 *
 * Addresses on the inspector were selectable and nothing more, and a
 * forty-two character hex string that can only be selected is one the reader
 * must drag across accurately to check anywhere else — against Etherscan,
 * against their wallet, against the address in the console header. The whole
 * page argues its values are verifiable; getting one out of it was the step
 * that was missing.
 *
 * The button appears on hover and on focus, so a stack of addresses stays a
 * stack of addresses rather than a stack of buttons, while remaining reachable
 * from the keyboard — which `group-hover` alone would not give.
 */
export function CopyableValue({
  value,
  label,
  mono = true,
}: {
  value: string;
  /** The field's own label, so the announcement names what was copied. */
  label: string;
  mono?: boolean;
}) {
  const { copy, isCopied } = useClipboard({ announce: `${label} copied` });
  /*
    The label verbatim, never lower-cased. These are field names, and half of
    them are acronyms or record keys — `toLowerCase()` turned "ERC 8004 agent
    id" into "erc 8004 agent id" and would do the same to "MCP".
  */
  const action = `Copy ${label}`;

  return (
    <HStack gap={2} align="center" wrap="wrap" className="group">
      <Text
        type={mono ? "code" : "body"}
        hasTabularNumbers={mono}
        wordBreak="break-all"
      >
        {value}
      </Text>
      {/*
        An HStack rather than a span: `AGENTS.md` gives the raw-layout exception
        to `Frame` by name, and nothing here needs one.
      */}
      <HStack className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconButton
          size="sm"
          variant="ghost"
          // The tooltip stays "Copy"; the icon flip is the confirmation, and
          // the label moves because that is what a screen reader announces.
          tooltip={action}
          label={isCopied ? `${label} copied` : action}
          icon={<Icon icon={isCopied ? "check" : "copy"} size="xsm" />}
          onClick={() => void copy(value)}
        />
      </HStack>
    </HStack>
  );
}
