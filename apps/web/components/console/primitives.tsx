import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * The console's shared vocabulary.
 *
 * Two of these carry rules rather than styles. `Field` refuses to render a
 * chain-derived value without saying which chain and when it was read — task
 * 7.3 — so the label is a required prop rather than an optional one a screen
 * can forget. And `Absent` exists so "we have nothing" has a single appearance
 * that cannot be mistaken for a zero: `docs/04` forbids inventing reputation,
 * and the easiest way to invent it is to render an absent number as 0.
 */

export function Panel({
  id,
  title,
  subtitle,
  children,
  className,
}: {
  /** An anchor target, so the fleet card can link straight to a section. */
  id?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {subtitle ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * One labelled value, with its provenance.
 *
 * `source` and `readAt` are required for anything read from outside the
 * process. A field that shows an owner address with no indication of where it
 * came from or when invites the reader to assume it is current, which is the
 * assumption `docs/09` spends its whole length arguing against.
 */
export function Field({
  label,
  value,
  source,
  readAt,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  source?: string;
  readAt?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/50 py-2 last:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        {source ? <Provenance source={source} readAt={readAt} /> : null}
      </div>
      <div className={cn("text-sm break-all", mono && "font-mono text-[0.8rem]")}>
        {value}
      </div>
    </div>
  );
}

/** Where a value came from and when. Small, and never omitted. */
export function Provenance({
  source,
  readAt,
}: {
  source: string;
  readAt?: string;
}) {
  return (
    <span className="shrink-0 font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground/70">
      {source}
      {readAt ? ` · ${new Date(readAt).toLocaleTimeString()}` : ""}
    </span>
  );
}

/**
 * The one way to render "there is nothing here".
 *
 * Never a 0, never an empty string, never a dash that could be read as a value.
 */
export function Absent({ what }: { what: string }) {
  return (
    <span className="text-muted-foreground italic">not set — {what}</span>
  );
}

const TONE = {
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  neutral: "border-border bg-muted/50 text-muted-foreground",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[0.7rem] whitespace-nowrap",
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * A denial, rendered as the product state it is.
 *
 * `docs/03` says a permission denial is not a generic red error, so `proof`
 * gets its own treatment: this is the control plane working and the interface
 * should read as though that were expected, because it was.
 */
export function Outcome({
  tone,
  title,
  detail,
  action,
}: {
  tone: "proof" | "fault" | "waiting";
  title: string;
  detail?: string;
  action?: string;
}) {
  const style =
    tone === "proof"
      ? "border-sky-500/30 bg-sky-500/10"
      : tone === "waiting"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-destructive/30 bg-destructive/10";

  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border p-3", style)}>
      <p className="text-sm font-medium">{title}</p>
      {detail ? (
        <p className="font-mono text-[0.7rem] leading-relaxed break-all text-muted-foreground">
          {detail}
        </p>
      ) : null}
      {action ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{action}</p>
      ) : null}
    </div>
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
    <p className="font-mono text-xs text-muted-foreground">{what}…</p>
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
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-5">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
      {action}
    </div>
  );
}
