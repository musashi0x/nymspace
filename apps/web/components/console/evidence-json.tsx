"use client";

import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How tall evidence gets before it scrolls inside itself.
 *
 * `CodeBlock` handles its own overflow and Astryx is explicit that it should
 * not be nested in a scroll container, so this is a prop rather than a wrapper.
 */
const EVIDENCE_MAX_HEIGHT = "20rem";

/** How long the copied acknowledgement stays up. */
const COPIED_MS = 1600;

/**
 * The evidence block, copied by clicking it.
 *
 * `hasCopyButton` is off. `CodeBlock` puts its own button at the right edge of
 * the block, and this block lives inside the activity table's horizontal scroll
 * wrapper — so that button sat past the edge of the screen and had to be
 * dragged into view. The whole block is the target instead, which is a bigger
 * one and is always where the operator is already looking.
 *
 * Its own file because it holds state, and `primitives.tsx` carries no
 * `"use client"`: server components import `Field` from there, and a hook in
 * that module would make it client-only for all of them.
 */
export function EvidenceJson({ label, json }: { label: string; json: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    /**
     * A selection wins over the click.
     *
     * Dragging across three of these lines ends in a click, and copying the
     * whole document at that point would replace the exact thing the operator
     * had just chosen by hand — silently, since the clipboard gives no sign it
     * was overwritten.
     */
    if ((window.getSelection()?.toString().length ?? 0) > 0) return;

    void navigator.clipboard
      .writeText(json)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      })
      // Nothing is said on failure beyond not claiming success: the clipboard
      // rejects on a denied permission or an insecure origin, and an
      // acknowledgement for a copy that did not happen is worse than silence.
      .catch(() => undefined);
  }, [json]);

  return (
    <VStack
      gap={2}
      paddingBlock={2}
      className="frame-rule-below last:bg-none evidence-pane cursor-pointer"
      role="button"
      tabIndex={0}
      aria-label={`Copy ${label.toLowerCase()} as JSON`}
      onClick={copy}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Space scrolls the page otherwise, and this block is tall enough that
        // the operator would lose their place to acknowledge a copy.
        event.preventDefault();
        copy();
      }}
    >
      <Text type="supporting" size="sm">
        {copied ? `${label} · copied` : label}
      </Text>
      <CodeBlock
        code={json}
        language="json"
        container="section"
        size="sm"
        isWrapped
        width="100%"
        hasCopyButton={false}
        maxHeight={EVIDENCE_MAX_HEIGHT}
      />
    </VStack>
  );
}
