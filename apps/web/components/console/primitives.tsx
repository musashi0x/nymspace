import { Badge as AstryxBadge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import { CopyableValue } from "./copyable-value";
import { EvidenceJson } from "./evidence-json";

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
  /*
    Copyable when the value is a plain string, which in practice is every
    address, hash, registry id and resolved name on the inspector.

    They were selectable and nothing more, and a forty-two character hex string
    that can only be selected is a value the reader has to drag across
    accurately to check anywhere else — against Etherscan, against their wallet,
    against the address in the header. The whole page argues that its values are
    verifiable; getting one out of it was the step that was missing.

    A `ReactNode` value is skipped: those are the `Absent` and `Badge` branches,
    where there is no string to put on a clipboard and a copy button would offer
    to copy the words "not set".
  */
  const copyable = typeof value === "string" ? value : undefined;

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
      {copyable ? (
        <CopyableValue value={copyable} label={label} mono={mono} />
      ) : (
        <Text
          type={mono ? "code" : "body"}
          hasTabularNumbers={mono}
          wordBreak="break-all"
        >
          {value}
        </Text>
      )}
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
 * `allowed` is the other half of that pair and is a real success — a write the
 * resolver permitted, with its hash.
 *
 * `collapsible={false}` because the detail is the evidence. A banner that
 * hides its own proof behind a toggle is a banner asserting something it will
 * not show.
 */
const OUTCOME_STATUS = {
  allowed: "success",
  proof: "info",
  /*
    `info`, not `warning`.

    A transaction in flight is not a warning — nothing is wrong and nothing
    needs the operator. `warning` painted it amber with a ⚠, which is the
    loudest thing on a screen otherwise built from dashed rules and greys, and
    it said "attend to this" about the one state whose correct response is to
    wait. `docs/03`'s argument against rendering a denial as a red error is the
    same argument: the colour is a claim about what happened.

    It shares `info` with `proof` and is told apart by its icon below, because
    Astryx's Banner has four statuses and none of them means "pending".
  */
  waiting: "info",
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
  /** Structured evidence, or a sentence. Rendered below the header. */
  action?: ReactNode;
}) {
  return (
    <Banner
      status={OUTCOME_STATUS[tone]}
      // The only tone whose status does not identify it: `waiting` and `proof`
      // are both `info`, and a clock is what separates "still happening" from
      // "happened, and was refused".
      icon={tone === "waiting" ? <Icon icon="clock" /> : undefined}
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
      {typeof action === "string" ? (
        <Text type="supporting" as="p">
          {action}
        </Text>
      ) : (
        action ?? undefined
      )}
    </Banner>
  );
}

/**
 * A loading state that names what is being read — task 7.16.
 *
 * No skeleton rows. A grey rectangle where a value will go is content the
 * system has not returned, and the eye reads it as data that is nearly here.
 * `docs/03`'s rule is "never show fake success placeholders", and a shimmer in
 * the shape of the answer is the clearest way to break it.
 *
 * A spinner is not that. It renders no value, claims no shape, and says only
 * that the request is still open — which is the one thing the static line could
 * not distinguish from a request that had died. Astryx names this exact split:
 * Spinner for unknown duration, Skeleton for known dimensions, and the doctrine
 * above is why only the first is used here.
 *
 * The text stays the accessible name. `label` would stack its own copy under
 * the ring, so the name is passed as `aria-label` and the line beside it is
 * what everyone reads.
 */
export function Loading({ what }: { what: string }) {
  return (
    <HStack gap={2} align="center">
      <Spinner size="sm" shade="subtle" aria-label={what} />
      <Text type="code" size="sm" color="secondary">
        {what}…
      </Text>
    </HStack>
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

/**
 * Serialize for display, or say why not.
 *
 * The replacer exists because `JSON.stringify` drops a `BigInt` by throwing,
 * and wei amounts are the one value in this product most likely to arrive as
 * one. A cycle still throws, and that is the case the fallback is for.
 *
 * `JSON.stringify` also returns `undefined` — the value, not the string — for
 * a function or a bare `undefined`, which is why the result is checked rather
 * than trusted.
 */
function serialize(
  value: unknown,
): { ok: true; json: string } | { ok: false; text: string } {
  try {
    const json = JSON.stringify(
      value,
      (_key, v: unknown) => (typeof v === "bigint" ? `${v.toString()}n` : v),
      2,
    );
    return json === undefined
      ? { ok: false, text: String(value) }
      : { ok: true, json };
  } catch {
    return { ok: false, text: String(value) };
  }
}

/**
 * Structured evidence, rendered as a value rather than as a string.
 *
 * This replaced `JSON.stringify(row.evidence)` in a cell. That call produced
 * one unbroken line with no highlighting and nothing to copy, which is the
 * least readable presentation available for the field carrying the product's
 * actual claim — `docs/09` spends its whole length arguing that provenance is
 * the point.
 *
 * `container="section"` because this sits inside a `Frame`. A card border
 * inside a dashed frame is two edges arguing about where the boundary is.
 *
 * Absence goes through `Absent`, not through an empty code block. Evidence
 * that was never carried and evidence that is an empty object are different
 * facts, and an empty `{}` renders as `{}`.
 */
export function Evidence({
  value,
  label = "Evidence",
}: {
  value: unknown;
  label?: string;
}) {
  if (value === undefined || value === null) {
    return <Field label={label} value={<Absent what="no evidence was carried" />} />;
  }

  const result = serialize(value);

  if (!result.ok) {
    return (
      <Field
        label={label}
        value={
          <>
            <Text type="supporting" size="sm" as="p">
              This evidence could not be serialized as JSON — shown as text.
            </Text>
            <Text type="code" size="sm" wordBreak="break-all">
              {result.text}
            </Text>
          </>
        }
      />
    );
  }

  return <EvidenceJson label={label} json={result.json} />;
}
