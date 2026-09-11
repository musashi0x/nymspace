/**
 * The shape of a console answer.
 *
 * The chat console does not paraphrase. Every answer is a structure assembled
 * from reads the API just performed, and this is that structure — lanes of
 * nodes with the edges between them, plus the rows of raw values the diagram
 * was drawn from.
 *
 * Pure types, no guard, because the browser renders them. Nothing here holds a
 * secret and nothing here is computed: `@nymspace/api` builds a `LensAnswer`
 * from live ENS, ERC 8004 and EAC reads, and the web app draws exactly what it
 * is given. A renderer that decided anything would be a second source of truth
 * for a permission, which `docs/09` forbids outright.
 *
 * ## Why every answer carries `detail`
 *
 * The diagram is a summary, and a summary is the easiest place to overclaim.
 * `detail` is the same answer as rows — each with the system it came from and
 * when — so a reader can check the picture against the values without leaving
 * the message. `docs/01`'s success metric is that 100 percent of displayed
 * permission state is contract derived; a diagram with no way back to the reads
 * cannot demonstrate that.
 */

/** What a node or edge is saying about itself. */
export type LensTone =
  /** Present and confirmed by the system that owns it. */
  | "verified"
  /** Exists and is reachable, with nothing further claimed. */
  | "active"
  /** A control refused something. Not a fault — the boundary holding. */
  | "denied"
  /** Known to be absent. Different from unknown. */
  | "absent"
  /** Not read, or read and inconclusive. Never rendered as a finding. */
  | "unknown";

export interface LensPill {
  label: string;
  tone: LensTone;
}

export interface LensNode {
  id: string;
  /** Must be one of `LensAnswer.lanes`. */
  lane: string;
  label: string;
  /** A second line — a record key, an address, a type. */
  sublabel?: string;
  /** Short status word shown on the node's corner. */
  badge?: string;
  tone: LensTone;
  /**
   * Where this node goes, when it stands for something with a screen.
   *
   * Set by the API, never derived in the browser. Node ids read like
   * `agent-research:ens`, so a renderer could split on the colon and build the
   * link itself — and would then be deciding which agent a node is about from
   * a string it was handed for layout. That is the same class of mistake as
   * inferring "denied" from a missing value: a second place that answers a
   * question this package says only one place may answer. The API knows the
   * agent id because it read the agent; it says so here.
   *
   * Absent on nodes that stand for a fact rather than a thing — a permission
   * cell, a record value — because there is nothing to open.
   */
  href?: string;
}

export interface LensEdge {
  from: string;
  to: string;
  label?: string;
  tone: LensTone;
}

/**
 * One row of the answer, as read.
 *
 * `provenance` is not decoration: `CHAIN 11155111` and `STORE` mean different
 * things about how much the value can be trusted, and a row without it is a
 * value pretending to be live.
 */
export interface LensDetail {
  label: string;
  value: string;
  provenance?: string;
}

export interface LensAnswer {
  title: string;
  pills: LensPill[];
  /** Column headings, left to right. */
  lanes: string[];
  nodes: LensNode[];
  edges: LensEdge[];
  /** One line under the diagram, e.g. "5 components across 3 lanes". */
  caption: string;
  detail: LensDetail[];
  /** When the reads happened. */
  readAt: string;
}

/**
 * What comes back when the console did not understand.
 *
 * Deliberately not a `LensAnswer` with empty lanes. An empty diagram reads as
 * "nothing is there", which is a claim about the fleet; this is a statement
 * about the question. The two must not render the same way, for the same
 * reason `empty` and `provider_error` must not on the discovery screen.
 */
export interface LensUnanswered {
  kind: "unanswered";
  message: string;
  /** Questions this console can actually answer, shown as offers. */
  suggestions: string[];
}

export type ConsoleAnswer = ({ kind: "lens" } & LensAnswer) | LensUnanswered;

export function isUnanswered(answer: ConsoleAnswer): answer is LensUnanswered {
  return answer.kind === "unanswered";
}
