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

/**
 * Exact numbers on both axes — the register's `graph-matrix`.
 *
 * A separate shape from {@link LensAnswer}'s lanes and nodes because it answers
 * a different question. A diagram says "this connects to that"; a matrix says
 * "this many, crossed with that". The audit trail had been rendered as the
 * former: every event became three nodes in three lanes, so an agent with fifty
 * events produced a hundred and fifty boxes and the edges between them carried
 * nothing — an event is not connected to its own timestamp, it *has* one.
 *
 * Counts, not statuses. `mdx-graphs.kshv.me/docs/graph-matrix` is a numeric
 * grid with tabular figures, and a grid of words in the same frame would borrow
 * a form that means "compare these quantities" to show something that cannot be
 * compared.
 */
export interface LensMatrix {
  /** Drawn as `[ TITLE ]` on the frame. One or two words, uppercase. */
  title: string;
  /** Headings across the top, left to right. */
  columns: string[];
  /** Heading for the row-label column. Often empty — the rows name themselves. */
  rowHeader?: string;
  rows: LensMatrixRow[];
  /** One line under the title, saying what was counted and over what. */
  caption?: string;
}

export interface LensMatrixRow {
  label: string;
  /** One number per column, in the same order. */
  values: number[];
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
  /**
   * A counted grid, when the answer has one.
   *
   * Rendered *instead of* the lane diagram, never beside it. Two figures of the
   * same data on one screen is the gallery the register's own rules forbid, and
   * the second one is always the one the reader has to work out is redundant.
   */
  matrix?: LensMatrix;
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

/**
 * One request a plan will send, written out in full.
 *
 * The plan *is* the requests. There is no parallel execution path inside the
 * chat route that re-implements what the product routes already do — the step
 * names the endpoint and carries the body, the browser sends it to the same
 * URL any other screen would, and the answer comes back through the same
 * validation, the same signer and the same activity log. A chat that grew its
 * own way to grant a permission would be a second implementation of the one
 * thing this product is about.
 *
 * It is also what makes the confirmation honest. "Show request" on a plan is
 * not a rendering of what the console intends to do; it is the bytes.
 */
export interface PlanStep {
  /** What this step accomplishes, in the operator's language. */
  title: string;
  method: "POST";
  /** Relative to the API base, e.g. `/v1/agents/agent-research/records`. */
  path: string;
  body: Record<string, unknown>;
  /**
   * Which key signs it, named so the operator can see authority change hands
   * mid-plan. The controller writing its own record and the organization
   * granting it the right to are different powers, and a plan that does both
   * without saying so hides the only interesting thing about it.
   *
   * `none` is a step no key signs: an MCP connect reads somebody else's server
   * and writes an activity row, so the chat still offers it rather than doing
   * it, but there is no authority changing hands to name.
   */
  actor: "organization" | "controller" | "agent wallet" | "none";
  /**
   * Set when the step is expected to be refused, and why.
   *
   * The permission proof and the spend limit are steps whose *failure* is the
   * result. Without this the console would have to decide after the fact
   * whether a denial was the point, and it would sometimes decide wrong.
   */
  expectDenial?: string;
}

/**
 * A write the console has understood but not performed.
 *
 * Returned instead of doing it. `POST /v1/chat` reads and matches; it never
 * writes, and nothing here has happened yet — the plan is an offer, and the
 * operator's confirmation is what turns it into requests. That split is why a
 * chat is allowed near an irreversible action at all.
 */
export interface LensPlan {
  kind: "plan";
  title: string;
  /** One sentence on what this does and what it costs. */
  summary: string;
  steps: PlanStep[];
  /** What to say once every step has run. */
  closing: string;
}

export type ConsoleAnswer =
  | ({ kind: "lens" } & LensAnswer)
  | LensUnanswered
  | LensPlan;

export function isUnanswered(answer: ConsoleAnswer): answer is LensUnanswered {
  return answer.kind === "unanswered";
}

export function isPlan(answer: ConsoleAnswer): answer is LensPlan {
  return answer.kind === "plan";
}

/**
 * What the console can be asked, in the order the demo walks them.
 *
 * Here rather than in either app because both need it and they must not drift:
 * the web page offers these as the opening, and the API returns them when it
 * did not understand. Two copies would eventually offer a question the matcher
 * no longer answers — the console inviting you to ask something it will then
 * refuse, which is worse than offering nothing.
 *
 * Every line has to match a real intent. This list is a promise.
 */
export const CONSOLE_SUGGESTIONS = [
  "show me the fleet",
  "show research",
  "create a support agent",
  "let research update its agent-context",
  'as research, set agent-context to "Specialized in ENS research"',
  "as research, set its mcp endpoint to https://example.com/mcp",
  "what does research's mcp serve",
  "pay 0.0001 ETH from research to research",
  "show the audit trail for research",
] as const;
