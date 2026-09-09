import { Badge as AstryxBadge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";

/**
 * The console's shared vocabulary, built from Astryx.
 *
 * Two of these carry rules rather than styles, and the rewrite onto Astryx
 * strengthened both rather than preserving them. `Field` cannot render a value
 * read from outside the process without saying which system and when — that is
 * now a type error rather than a convention — and `Absent` exists so "we have
 * nothing" has a single appearance that cannot be mistaken for a zero:
 * `docs/04` forbids inventing reputation, and the easiest way to invent it is
 * to render an absent number as 0.
 *
 * `Frame` is re-exported here so screens have one import for the console's
 * vocabulary. It lives in its own file because it is the one component with a
 * documented exception to the layout rules; see `AGENTS.md`.
 */
export { Frame } from "./frame";

/**
 * Where a value came from and when.
 *
 * Tabular figures are not decoration here. A column of read times with
 * proportional digits sits at a different offset on every row, which is the
 * specific illegibility the register exists to fix.
 */
export function Provenance({
  source,
  readAt,
}: {
  source: string;
  readAt?: string;
}) {
  return (
    <Text type="code" size="2xs" color="secondary" hasTabularNumbers textWrap="nowrap">
      {source}
      {readAt ? ` · ${new Date(readAt).toLocaleTimeString()}` : ""}
    </Text>
  );
}

/**
 * One labelled value, with its provenance.
 *
 * The union is the point. Passing `source` without `readAt` no longer
 * compiles, so a value read from outside this process cannot reach the screen
 * without saying when it was read. An address shown with no read time invites
 * the reader to assume it is current, which is the assumption `docs/09` spends
 * its whole length arguing against.
 *
 * A field with neither is an in-process value. The coordination store counts
 * as in-process on purpose: `CLAUDE.md` is explicit that it is not an
 * authority, and labelling a stored value with a `source` dresses it up as
 * provenance it does not have.
 */
type FieldProvenance =
  | { source: string; readAt: string }
  | { source?: never; readAt?: never };

export function Field({
  label,
  value,
  mono = true,
  ...provenance
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
} & FieldProvenance) {
  return (
    <VStack gap={1} paddingBlock={2} className="frame-rule-below last:bg-none">
      <HStack gap={4} justify="between" align="end">
        <Text type="supporting" size="sm">
          {label}
        </Text>
        {provenance.source ? (
          <Provenance source={provenance.source} readAt={provenance.readAt} />
        ) : null}
      </HStack>
      <Text
        type={mono ? "code" : "body"}
        hasTabularNumbers={mono}
        wordBreak="break-all"
      >
        {value}
      </Text>
    </VStack>
  );
}

/**
 * The one way to render "there is nothing here".
 *
 * Never a 0, never an empty string, never a dash that could be read as a
 * value. The italic is the whole signal: it is the only thing in the console
 * set in italic, so an absent value never looks like a short one.
 */
export function Absent({ what }: { what: string }) {
  return (
    <Text type="body" color="secondary" className="italic">
      not set — {what}
    </Text>
  );
}

/**
 * `docs/09`'s five integration states, in Astryx's semantic variants.
 *
 * `neutral` is deliberately not `info`. A track that has not started is not
 * news, and an agent with a verified identity and no wallet is financially
 * unprovisioned rather than broken.
 */
const TONE = {
  good: "success",
  bad: "error",
  warn: "warning",
  neutral: "neutral",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return <AstryxBadge variant={TONE[tone]} label={children} />;
}

/**
 * A denial, rendered as the product state it is.
 *
 * `docs/03` says a permission denial is not a generic red error, so `proof`
 * maps to `info` rather than `error`: this is the control plane working, and
 * the interface should read as though that were expected, because it was.
 *
 * `collapsible={false}` because the detail is the evidence. A banner that
 * hides its own proof behind a toggle is a banner asserting something it will
 * not show.
 */
const OUTCOME_STATUS = {
  proof: "info",
  waiting: "warning",
  fault: "error",
} as const;

export function Outcome({
  tone,
  title,
  detail,
  action,
}: {
  tone: keyof typeof OUTCOME_STATUS;
  title: string;
  detail?: string;
  action?: string;
}) {
  return (
    <Banner
      status={OUTCOME_STATUS[tone]}
      title={title}
      description={
        detail ? (
          <Text type="code" size="sm" wordBreak="break-all">
            {detail}
          </Text>
        ) : undefined
      }
      collapsible={false}
    >
      {action ? (
        <Text type="supporting" as="p">
          {action}
        </Text>
      ) : undefined}
    </Banner>
  );
}

/**
 * A loading state that names what is being read — task 7.16.
 *
 * No skeleton rows. A grey rectangle where a value will go is content the
 * system has not returned, and the eye reads it as data that is nearly here.
 */
export function Loading({ what }: { what: string }) {
  return (
    <Text type="code" size="sm" color="secondary">
      {what}…
    </Text>
  );
}

export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState title={title} description={detail} actions={action} isCompact />
  );
}
