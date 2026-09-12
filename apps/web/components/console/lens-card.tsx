"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import * as React from "react";
import { GraphMatrix } from "./graph-matrix";
import type {
  LensAnswer,
  LensEdge,
  LensNode,
  LensTone,
} from "@nymspace/core";

/**
 * One answer, drawn.
 *
 * Lanes across, nodes inside them, edges between. The layout is CSS grid rather
 * than a graph library: the answers this renders have three lanes and under a
 * dozen nodes, and a force-directed layout would move things between renders,
 * which on a screen whose job is to be checkable is a cost with no benefit. The
 * same diagram twice must look the same twice.
 *
 * Nothing here decides anything. Tone, badges and edge labels all arrive
 * computed from the API, which read them from chain — a renderer that inferred
 * "denied" from a missing value would be a second source of truth for a
 * permission, which `docs/09` forbids. The only thing this file chooses is
 * colour.
 *
 * ## The View toggles
 *
 * `Show every detail` reveals the rows the diagram was drawn from. It is not a
 * power-user affordance: the diagram is a summary, summaries are where
 * overclaiming happens, and this is the way back to the values with their
 * provenance attached.
 */

const TONE: Record<LensTone, { node: string; text: string; badge: string }> = {
  verified: {
    node: "border-emerald-500/40 bg-emerald-500/[0.04]",
    text: "text-emerald-700 dark:text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  active: {
    node: "border-border bg-card",
    text: "text-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  // Denied is the control plane working, so it is stated plainly rather than
  // alarmingly — `docs/03` again. Amber, not red.
  denied: {
    node: "border-amber-500/40 bg-amber-500/[0.05]",
    text: "text-amber-700 dark:text-amber-400",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  absent: {
    node: "border-dashed border-border bg-transparent",
    text: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  unknown: {
    node: "border-dashed border-border/70 bg-transparent",
    text: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
};

export function LensCard({ answer }: { answer: LensAnswer }) {
  const [showDetail, setShowDetail] = React.useState(false);
  const [showLabels, setShowLabels] = React.useState(true);

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden className="text-muted-foreground">
            ◈
          </span>
          {answer.title}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {answer.pills.map((pill) => (
            <Pill key={pill.label} tone={pill.tone}>
              {pill.label}
            </Pill>
          ))}
        </div>
      </header>

      {/*
        A counted grid replaces the diagram, it does not join it.

        The register's rules forbid a gallery, and two figures of the same
        events would leave the reader working out which one is redundant. The
        answer decides which shape it is — `chat.ts` attaches a matrix only when
        the question is "how many, crossed with what" — and the detail table
        below still lists every row, so choosing a figure never costs the
        reader a fact.

        `surface="card"` because the frame's corner marks and title paint over
        the edge beneath them, and this card is not the page background.
      */}
      {answer.matrix ? (
        <GraphMatrix matrix={answer.matrix} surface="card" />
      ) : (
        <Diagram answer={answer} showLabels={showLabels} />
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {answer.caption}
      </p>

      {showDetail && <DetailTable rows={answer.detail} />}

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3">
        <Toggle checked={showDetail} onChange={setShowDetail}>
          Show every detail
        </Toggle>
        {/* Nothing to label when there are no edges on screen. A toggle that
            controls nothing is worse than an absent one: it invites a click
            that reads as broken. */}
        {!answer.matrix && (
          <Toggle checked={showLabels} onChange={setShowLabels}>
            Edge labels
          </Toggle>
        )}
        <span className="ml-auto font-mono text-[0.65rem] text-muted-foreground">
          read {answer.readAt.slice(11, 19)}Z
        </span>
      </footer>
    </article>
  );
}

/**
 * How long one node waits before it appears, and why there is an order at all.
 *
 * `answer.nodes` arrives in the order the API built it, which is the order it
 * performed the reads: the name before the registration that claims it, each
 * permission cell before the record it governs. Staggering along that array
 * replays the derivation instead of decorating it — the diagram assembles in
 * the sequence that produced it, and the edges write themselves out underneath
 * once the things they connect exist.
 *
 * Short numbers on purpose. This is a console someone checks facts in, and an
 * answer that takes a second to finish arriving is an answer that feels slower
 * to read than it is. The whole sequence for a nine-node agent lens is under
 * 600ms, and every element is legible from its first frame — the motion is
 * opacity and six pixels, never a slide from off-screen.
 */
const STEP = 0.045;
const EDGE_STEP = 0.03;
const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Lanes as columns, nodes stacked inside them.
 *
 * Edges are drawn as a list under the lanes rather than as SVG paths between
 * boxes. An arrow that has to route around a column is the part of a diagram
 * that goes wrong first, and a mis-routed arrow between two permission nodes
 * would be a picture asserting something false. A named "from → to" cannot be
 * ambiguous about which pair it means.
 */
function Diagram({
  answer,
  showLabels,
}: {
  answer: LensAnswer;
  showLabels: boolean;
}) {
  const reduced = useReducedMotion();
  const byId = new Map(answer.nodes.map((node) => [node.id, node]));
  const orderOf = new Map(answer.nodes.map((node, i) => [node.id, i]));
  const afterNodes = answer.nodes.length * STEP;

  /*
    `initial={false}` rather than a zero-duration variant.

    Under `prefers-reduced-motion` the element mounts already in its final
    state, so there is no first frame at opacity 0 for a screenshot or a slow
    device to catch. Shortening the animation would still animate; this does
    not run one.
  */
  const enter = (delay: number) =>
    reduced
      ? { initial: false as const }
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.28, delay, ease: EASE },
        };

  return (
    <div className="flex flex-col gap-3 overflow-x-auto rounded-lg border border-border/60 bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [background-size:12px_12px] p-3">
      <div
        className="grid min-w-[36rem] gap-3"
        style={{
          gridTemplateColumns: `repeat(${answer.lanes.length}, minmax(0, 1fr))`,
        }}
      >
        {answer.lanes.map((lane, laneIndex) => (
          <section key={lane} className="flex flex-col gap-2">
            {/*
              The lane headings land first and together — they are the frame the
              answer is read against, and staggering them would make the reader
              wait to learn what the columns even are.
            */}
            <motion.h4
              className="font-mono text-[0.6rem] tracking-[0.18em] text-muted-foreground"
              {...enter(laneIndex * 0.02)}
            >
              {lane.toUpperCase()}
            </motion.h4>
            {answer.nodes
              .filter((node) => node.lane === lane)
              .map((node) => (
                /*
                  The wrapper animates; `Node` is untouched. It renders an
                  anchor when the API gave it an href, and turning that into a
                  motion component to move it six pixels would be spending a
                  link's semantics on an entrance.
                */
                <motion.div key={node.id} {...enter(0.06 + (orderOf.get(node.id) ?? 0) * STEP)}>
                  <Node node={node} />
                </motion.div>
              ))}
          </section>
        ))}
      </div>

      {showLabels && answer.edges.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border/60 pt-2">
          {answer.edges.map((edge, i) => (
            <Edge
              key={i}
              edge={edge}
              byId={byId}
              enter={enter(afterNodes + i * EDGE_STEP)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One node, and a link out of it when the API gave it one.
 *
 * The `href` is read, never derived. Node ids look like `agent-research:ens`,
 * so this file could split on the colon and build the route itself — and would
 * then be deciding which agent a node is about from a string it was handed for
 * layout. Same rule as the tones above: this file chooses colour, and nothing
 * else.
 *
 * A linked node is an anchor rather than a div with a click handler, so it
 * keeps the things a link has for free — middle-click, copy address, focus
 * order, and a status bar that shows where it goes before you commit to it.
 */
function Node({ node }: { node: LensNode }) {
  const tone = TONE[node.tone];

  const body = (
    <>
      {node.badge && (
        <span
          className={`absolute -top-2 right-2 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium ${tone.badge}`}
        >
          {node.badge}
        </span>
      )}
      <p className={`text-xs font-medium break-all ${tone.text}`}>{node.label}</p>
      {node.sublabel && (
        <p className="mt-0.5 font-mono text-[0.62rem] break-all text-muted-foreground">
          {node.sublabel}
        </p>
      )}
    </>
  );

  if (!node.href) {
    return (
      <div className={`relative rounded-lg border p-2.5 ${tone.node}`}>{body}</div>
    );
  }

  return (
    <Link
      href={node.href}
      // The tone's own border on hover: an affordance drawn from the node's
      // state rather than a colour bolted on top of it, so a denied node does
      // not turn neutral the moment a pointer touches it.
      className={`relative block rounded-lg border p-2.5 transition-[box-shadow,opacity] hover:opacity-90 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${tone.node}`}
    >
      {body}
    </Link>
  );
}

/**
 * One edge, with each end named by lane as well as label.
 *
 * The lane is not decoration. A record key names both a permission cell and the
 * record it governs, so without it this line read "agent-context →
 * agent-context · may not write" — a node apparently pointing at itself, which
 * is the diagram asserting something that is not true about the graph it is
 * drawing. Two ends can share a label; they cannot share a lane and a label.
 */
function Edge({
  edge,
  byId,
  enter,
}: {
  edge: LensEdge;
  byId: Map<string, LensNode>;
  /** Entrance props from `Diagram`, so the line lands after both its ends. */
  enter: Record<string, unknown>;
}) {
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  return (
    <motion.li
      {...enter}
      className="flex flex-wrap items-baseline gap-1.5 font-mono text-[0.62rem] text-muted-foreground"
    >
      <End node={from} fallback={edge.from} />
      <span aria-hidden className={TONE[edge.tone].text}>
        →
      </span>
      <End node={to} fallback={edge.to} />
      {edge.label && (
        <span className={`${TONE[edge.tone].text}`}>· {edge.label}</span>
      )}
    </motion.li>
  );
}

function End({
  node,
  fallback,
}: {
  node: LensNode | undefined;
  fallback: string;
}) {
  if (!node) return <span className="break-all">{fallback}</span>;
  return (
    <span className="break-all">
      {node.label}
      <span className="text-muted-foreground/60"> ({node.lane.toLowerCase()})</span>
    </span>
  );
}

function DetailTable({ rows }: { rows: LensAnswer["detail"] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-left text-xs">
        <tbody className="divide-y divide-border/40">
          {rows.map((row, i) => (
            <tr key={i}>
              <th className="w-1/3 px-3 py-2 align-top font-normal text-muted-foreground">
                <span className="break-all">{row.label}</span>
              </th>
              <td className="px-3 py-2 align-top font-mono break-all">
                {row.value}
              </td>
              <td className="px-3 py-2 align-top whitespace-nowrap">
                {row.provenance && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-foreground">
                    {row.provenance}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: LensTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[0.65rem] ${TONE[tone].badge}`}
    >
      {children}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-foreground"
      />
      {children}
    </label>
  );
}
