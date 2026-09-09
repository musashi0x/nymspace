import { serverEnv } from "@nymspace/core/env";
import type { Address, ChainId } from "@nymspace/core";
import type {
  AgentReputation,
  GraphProvenance,
  NormalisedAgent,
  RawAgent,
  RawFeedback,
  RawValidation,
  ValidationSignal,
} from "./types";

/**
 * The Agent0 subgraph client.
 *
 * The queries below are written against the real `schema.graphql`, not against
 * `docs/07`'s conceptual one. The differences that matter are recorded in
 * `types.ts`; the one that shapes every query here is that an agent's name, ENS
 * claim, and endpoints all live in `registrationFile`, which is null whenever
 * the `agentURI` was not something the mapping could parse.
 */

export type Agent0Network = "sepolia" | "base-sepolia";

const CHAIN_IDS: Record<Agent0Network, ChainId> = {
  sepolia: 11155111,
  "base-sepolia": 84532,
};

/**
 * The network discovery queries when a caller does not say.
 *
 * Configuration rather than a constant, because ADR 009 asked that a second
 * network be a config entry. Unknown values fall back to Sepolia rather than
 * throwing — a typo here should not take down every discovery request.
 */
export function defaultNetwork(): Agent0Network {
  const configured = process.env["GRAPH_DEFAULT_NETWORK"];
  return configured === "base-sepolia" || configured === "sepolia"
    ? configured
    : "sepolia";
}

export interface Agent0ClientOptions {
  network?: Agent0Network;
  fetchImpl?: typeof fetch;
  /**
   * Explicit credentials, overriding the server environment.
   *
   * Present so this client can be constructed without one. Reading `serverEnv()`
   * unconditionally made the class untestable without a real API key and the
   * whole ENSv2 address set — a unit test of normalisation would fail with
   * "Missing required environment variables: SEPOLIA_RPC_URL", which is a
   * confusing way to learn that a fake never reached the network anyway.
   */
  apiKey?: string;
  subgraphId?: string;
}

/**
 * Thrown when the provider itself failed, as distinct from returning nothing.
 *
 * The distinction is the whole of task 4.16 and Gate B assertion 6: "the
 * subgraph is unreachable" and "the subgraph has no matching agents" must not
 * render the same way, or an outage looks like an empty market.
 */
export class Agent0ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "Agent0ProviderError";
  }
}

const REGISTRATION_FILE_FIELDS = `
  cid
  name
  description
  image
  active
  x402Support
  supportedTrusts
  mcpEndpoint
  mcpVersion
  a2aEndpoint
  a2aVersion
  webEndpoint
  oasfEndpoint
  oasfSkills
  oasfDomains
  emailEndpoint
  ens
  did
`;

const AGENT_FIELDS = `
  id
  chainId
  agentId
  agentURI
  agentURIType
  owner
  agentWallet
  operators
  createdAt
  updatedAt
  totalFeedback
  lastActivity
  registrationFile { ${REGISTRATION_FILE_FIELDS} }
  feedback(first: 100) {
    id
    clientAddress
    value
    tag1
    tag2
    isRevoked
    createdAt
  }
  validations(first: 100) {
    id
    validatorAddress
    response
    status
    createdAt
  }
`;

/**
 * Agents with an MCP endpoint.
 *
 * The filter runs on `registrationFile_`, which excludes every agent whose URI
 * was never parsed — correctly, since an agent with no registration file has no
 * MCP endpoint to call even if it has one in reality. `docs/04` forbids
 * inventing capabilities, and inferring one from an unparsed URI would be
 * exactly that.
 */
export const MCP_AGENT_SEARCH_QUERY = `
  query McpAgents($first: Int!, $skip: Int!) {
    agents(
      first: $first
      skip: $skip
      orderBy: lastActivity
      orderDirection: desc
      where: { registrationFile_: { mcpEndpoint_not: null } }
    ) { ${AGENT_FIELDS} }
  }
`;

/** Every indexed agent, for the browse view and for ranking over a wider set. */
export const AGENT_SEARCH_QUERY = `
  query Agents($first: Int!, $skip: Int!) {
    agents(
      first: $first
      skip: $skip
      orderBy: lastActivity
      orderDirection: desc
    ) { ${AGENT_FIELDS} }
  }
`;

/** One agent's full profile, by `"<chainId>:<agentId>"`. */
export const AGENT_PROFILE_QUERY = `
  query Agent($id: ID!) {
    agent(id: $id) { ${AGENT_FIELDS} }
  }
`;

/** Indexing head, used to say how fresh an answer is and to prove auth. */
export const META_QUERY = `
  query Meta { _meta { block { number timestamp } hasIndexingErrors } }
`;

export class Agent0Client {
  readonly network: Agent0Network;
  private readonly fetchImpl: typeof fetch;
  private readonly explicitApiKey?: string;
  private readonly explicitSubgraphId?: string;

  constructor({
    network = defaultNetwork(),
    fetchImpl = fetch,
    apiKey,
    subgraphId,
  }: Agent0ClientOptions = {}) {
    this.network = network;
    this.fetchImpl = fetchImpl;
    this.explicitApiKey = apiKey;
    this.explicitSubgraphId = subgraphId;
  }

  get chainId(): ChainId {
    return CHAIN_IDS[this.network];
  }

  subgraphId(): string {
    if (this.explicitSubgraphId) return this.explicitSubgraphId;
    const env = serverEnv();
    const id =
      this.network === "sepolia"
        ? env.graph.agent0SepoliaSubgraphId
        : env.graph.agent0BaseSepoliaSubgraphId;

    if (!id) {
      throw new Agent0ProviderError(
        `Missing subgraph id for network ${this.network}; set the matching GRAPH_AGENT0_*_SUBGRAPH_ID`,
      );
    }
    return id;
  }

  private endpoint(): string {
    const apiKey = this.explicitApiKey ?? serverEnv().graph.apiKey;
    if (!apiKey) {
      throw new Agent0ProviderError("GRAPH_API_KEY is required");
    }
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${this.subgraphId()}`;
  }

  /**
   * Execute one GraphQL query.
   *
   * Every failure path throws {@link Agent0ProviderError} rather than a bare
   * Error, so a caller can tell "the provider failed" from "the provider
   * answered and the answer was empty" without inspecting a message string.
   */
  async query<T>(
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: document, variables }),
      });
    } catch (cause) {
      throw new Agent0ProviderError(
        `Agent0 subgraph unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (!response.ok) {
      throw new Agent0ProviderError(
        `Agent0 subgraph responded ${response.status}`,
        response.status,
      );
    }

    const body = (await response.json()) as {
      data?: T;
      errors?: { message?: string }[];
    };
    if (body.errors?.length) {
      throw new Agent0ProviderError(
        `Agent0 subgraph error: ${body.errors.map((e) => e.message ?? JSON.stringify(e)).join("; ")}`,
      );
    }
    if (!body.data) {
      throw new Agent0ProviderError("Agent0 subgraph returned no data");
    }

    return body.data;
  }

  /** Provenance for results from this client, stamped at the query. */
  provenance(queriedAt: string = new Date().toISOString()): GraphProvenance {
    return {
      provider: "agent0",
      chainId: this.chainId,
      subgraphId: this.subgraphId(),
      queriedAt,
    };
  }

  async searchAgents(
    options: { requireMcp?: boolean; first?: number; skip?: number } = {},
  ): Promise<NormalisedAgent[]> {
    const queriedAt = new Date().toISOString();
    const data = await this.query<{ agents: RawAgent[] }>(
      options.requireMcp ? MCP_AGENT_SEARCH_QUERY : AGENT_SEARCH_QUERY,
      { first: options.first ?? 25, skip: options.skip ?? 0 },
    );
    const provenance = this.provenance(queriedAt);
    return data.agents.map((agent) => normaliseAgent(agent, provenance));
  }

  async agentProfile(graphAgentKey: string): Promise<NormalisedAgent | undefined> {
    const queriedAt = new Date().toISOString();
    const data = await this.query<{ agent: RawAgent | null }>(
      AGENT_PROFILE_QUERY,
      { id: graphAgentKey },
    );
    if (!data.agent) return undefined;
    return normaliseAgent(data.agent, this.provenance(queriedAt));
  }

  async indexingHead(): Promise<{
    blockNumber: number;
    hasIndexingErrors: boolean;
  }> {
    const data = await this.query<{
      _meta: {
        block: { number: number; timestamp?: number };
        hasIndexingErrors: boolean;
      };
    }>(META_QUERY);
    return {
      blockNumber: data._meta.block.number,
      hasIndexingErrors: data._meta.hasIndexingErrors,
    };
  }
}

//////////////////////////////////////////////////////////////////////////////
// Normalisation
//////////////////////////////////////////////////////////////////////////////

/**
 * Feedback and validation, with absence preserved as absence.
 *
 * Revoked feedback is excluded from the count rather than filtered out
 * silently — `revokedExcluded` is reported so the interface can say "3 of 5
 * reviews, 2 revoked" instead of quietly showing a smaller number than the
 * chain does.
 *
 * Validation is the load-bearing case. No ValidationRegistry is deployed on
 * either Sepolia network, so the array is empty for every agent, and the
 * difference between "nobody validated this agent" and "this agent scored
 * zero" is the difference between an honest gap and invented reputation. The
 * signal is a union, so a ranker cannot accidentally arithmetic its way past
 * it: there is no number to multiply by a weight.
 */
export function normaliseReputation(
  feedback: RawFeedback[] = [],
  validations: RawValidation[] = [],
  options: { validationRegistryDeployed?: boolean } = {},
): AgentReputation {
  const live = feedback.filter((entry) => !entry.isRevoked);
  const values = live
    .map((entry) => Number(entry.value))
    .filter((value) => Number.isFinite(value));

  let validation: ValidationSignal;
  if (options.validationRegistryDeployed === false || validations.length === 0) {
    validation = {
      available: false,
      reason:
        options.validationRegistryDeployed === false
          ? "no_validation_registry"
          : "none_recorded",
    };
  } else {
    // `response` is 0-100 where 0 means pending, so a zero is not a score and
    // must not be averaged in as one.
    const completed = validations.filter(
      (v) => v.status === "COMPLETED" && typeof v.response === "number" && v.response > 0,
    );
    const scores = completed.map((v) => v.response as number);
    validation = {
      available: true,
      completed: completed.length,
      pending: validations.filter((v) => v.status === "PENDING").length,
      ...(scores.length > 0 && {
        meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      }),
    };
  }

  return {
    feedbackCount: live.length,
    revokedExcluded: feedback.length - live.length,
    ...(values.length > 0 && {
      meanFeedbackValue: values.reduce((a, b) => a + b, 0) / values.length,
    }),
    validation,
  };
}

/**
 * Collapse a raw agent into the shape the product consumes.
 *
 * Absent fields stay absent rather than becoming empty strings, so "no MCP
 * endpoint" renders as a missing capability rather than a broken link. The
 * registration file being null is a normal state — see `types.ts` — and every
 * field sourced from it is optional for that reason alone.
 */
export function normaliseAgent(
  raw: RawAgent,
  provenance: GraphProvenance,
  options: { validationRegistryDeployed?: boolean } = {},
): NormalisedAgent {
  const file = raw.registrationFile ?? undefined;
  const orUndefined = (value: string | null | undefined) =>
    value && value.length > 0 ? value : undefined;

  return {
    graphAgentKey: raw.id,
    agentId: raw.agentId,
    chainId: Number(raw.chainId) as ChainId,
    owner: raw.owner as Address,
    agentWallet: (orUndefined(raw.agentWallet) as Address | undefined),
    name: orUndefined(file?.name),
    description: orUndefined(file?.description),
    claimedEnsName: orUndefined(file?.ens),
    mcpEndpoint: orUndefined(file?.mcpEndpoint),
    a2aEndpoint: orUndefined(file?.a2aEndpoint),
    webEndpoint: orUndefined(file?.webEndpoint),
    supportedTrusts: file?.supportedTrusts ?? [],
    reputation: normaliseReputation(
      raw.feedback ?? [],
      raw.validations ?? [],
      options,
    ),
    ...(file && { registrationFile: file }),
    provenance,
  };
}
