/**
 * The Day 1 gate: prove on ENSv2 Sepolia that an organization can delegate one
 * text record to an agent controller, that the controller can write it, and
 * that everything not delegated is refused by the contracts.
 *
 * `docs/14_EXECUTION_PLAN.md` makes this a hard go/no-go, and
 * `docs/17_RISKS_AND_FALLBACKS.md` Risk 1 says there is no fallback. So a
 * no-go answer here is a successful run, not a failure.
 *
 * Run: pnpm --filter @nymspace/ens spike
 *
 * Every call goes through `EnsService`, the same boundary the API route
 * handlers import. The spike is a caller, not a second implementation — one
 * place breaks when the ENSv2 beta moves.
 *
 * Not idempotent by design in one place: the agent label carries a timestamp,
 * so a re-run registers a fresh subname rather than reverting on
 * `NameAlreadyRegistered`. Everything expensive — the parent name, the registry
 * proxy, the resolver proxy — is reused when configuration already names it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import {
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  namehash,
  toHex,
} from "viem";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address, Hex } from "@nymspace/core";
import {
  ALL_ROLES,
  AGENT_SUBNAME_OWNER_ROLES,
  EnsService,
  RESOLVER_ROLE,
  REGISTRY_ROLE,
  ROOT_RESOURCE,
  USER_REGISTRY_INIT_ROLES,
  adminOf,
  agentEndpointKey,
  agentRegistrationKey,
  chainConfig,
  createViemChainClient,
  encodeDnsName,
  erc20Abi,
  ethRegistrarAbi,
  nameResource,
  registryAbi,
  resolverSalt,
  textRecordResource,
  universalResolverAbi,
  userRegistrySalt,
  verifiableFactoryAbi,
  wildcardTextResource,
  type ViemChainClient,
} from "../src/index";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

/** One year, the shortest sensible parent registration. */
const PARENT_DURATION = 365n * 24n * 60n * 60n;
/** Ten years on the agent subname; it costs nothing and outlives the demo. */
const SUBNAME_DURATION = 10n * 365n * 24n * 60n * 60n;

const HERE = dirname(fileURLToPath(import.meta.url));

/** The Day 1 gate artifact. Written by a full run, never by --verify-only. */
const EVIDENCE_PATH = resolvePath(HERE, "..", "spike-evidence.json");

/** The fresh-process re-read. A separate file so it cannot overwrite the gate. */
const VERIFY_PATH = resolvePath(HERE, "..", "spike-verify.json");

const DELEGATED_KEY = agentEndpointKey("mcp");
const UNDELEGATED_KEY = agentEndpointKey("a2a");
const AGENT_ENDPOINT = "https://mcp.nymspace.example/agent";

//////////////////////////////////////////////////////////////////////////////
// Evidence
//////////////////////////////////////////////////////////////////////////////

interface Assertion {
  name: string;
  passed: boolean;
  detail: string;
}

const assertions: Assertion[] = [];
const transactions: { what: string; hash: Hex }[] = [];
const facts: Record<string, unknown> = {};

/**
 * The receipt waiter, installed once the client exists.
 *
 * Every write must be confirmed before anything reads the state it changed.
 * Without this the script races itself: a balance read lands before the mint
 * that funds it, a permission read lands before the grant that creates it, and
 * a whole run of false failures follows one unconfirmed transaction. Worse,
 * `checkReverts` then passes for the wrong reason — a call reverting because
 * the name does not exist yet looks exactly like the boundary holding.
 */
let confirm: ((hash: Hex) => Promise<{ status: string }>) | undefined;

async function record(what: string, hash: Hex): Promise<Hex> {
  transactions.push({ what, hash });
  console.log(`      tx ${what}: ${hash}`);

  if (confirm) {
    const receipt = await confirm(hash);
    if (receipt.status !== "success") {
      throw new Error(`${what} reverted on chain: ${hash}`);
    }
  }
  return hash;
}

/**
 * One pass/fail line per check. A thrown error is a failure with its message
 * attached rather than a stack trace that ends the run: a spike that stops at
 * the first surprise answers fewer questions than one that keeps going.
 */
async function check(
  name: string,
  fn: () => Promise<string | void>,
): Promise<boolean> {
  try {
    const detail = (await fn()) ?? "";
    assertions.push({ name, passed: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    assertions.push({ name, passed: false, detail });
    console.log(`FAIL  ${name} — ${firstLine(detail)}`);
    return false;
  }
}

/**
 * A check that passes only when the call reverts.
 *
 * The negative proofs are the point of the spike, so they must come from an
 * actual contract refusal. Everything is simulated before it is sent, which
 * means a denial surfaces as a decoded custom error rather than a failed
 * receipt — and a *successful* simulation here is the failure.
 */
async function checkReverts(
  name: string,
  fn: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await fn();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    assertions.push({ name, passed: true, detail: firstLine(detail) });
    console.log(`PASS  ${name} — reverted: ${firstLine(detail)}`);
    return true;
  }
  assertions.push({
    name,
    passed: false,
    detail: "the call succeeded; the boundary does not hold",
  });
  console.log(`FAIL  ${name} — the call succeeded; the boundary does not hold`);
  return false;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? text;
}

function must<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

//////////////////////////////////////////////////////////////////////////////
// Proxy deployment
//////////////////////////////////////////////////////////////////////////////

/** Pull the proxy address out of the factory's `ProxyDeployed` event. */
async function deployProxy(
  ens: EnsService,
  params: { implementation: Address; salt: bigint; initData: Hex; what: string },
): Promise<Address> {
  const hash = await record(
    params.what,
    await ens.deployProxy({
      implementation: params.implementation,
      salt: params.salt,
      initData: params.initData,
    }),
  );

  const receipt = await ens.waitForReceipt(hash);
  assert(receipt.status === "success", `${params.what} reverted`);

  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({
        abi: verifiableFactoryAbi,
        topics: log.topics,
        data: log.data,
      });
      if (event.eventName === "ProxyDeployed") {
        return (event.args as { proxyAddress: Address }).proxyAddress;
      }
    } catch {
      // Not a factory log. The receipt carries the proxy's own initialization
      // events too, and those decode against a different ABI.
    }
  }
  throw new Error(`${params.what}: no ProxyDeployed event in the receipt`);
}

//////////////////////////////////////////////////////////////////////////////
// Phases
//////////////////////////////////////////////////////////////////////////////

/**
 * Preflight. Every address is confirmed to carry code and both keys are
 * confirmed funded before anything is spent.
 *
 * The addresses came from a repository. Two other Sepolia deployment sets
 * exist with entirely different addresses, and a transaction against a stale
 * contract fails in ways that look like a protocol problem.
 */
async function preflight(client: ViemChainClient, config = chainConfig()) {
  const addresses: [string, Address | undefined][] = [
    ["ETHRegistry", config.ensv2.ethRegistry],
    ["ETHRegistrar", config.ensv2.ethRegistrar],
    ["VerifiableFactory", config.ensv2.verifiableFactory],
    ["UserRegistryImpl", config.ensv2.userRegistryImpl],
    ["PermissionedResolverImpl", config.ensv2.permissionedResolverImpl],
    ["UniversalResolverV2", config.ensv2.universalResolver],
    ["PaymentToken", config.ensv2.paymentToken],
    ["ERC8004 IdentityRegistry", config.erc8004.identityRegistry],
  ];

  for (const [name, address] of addresses) {
    await check(`${name} is deployed`, async () => {
      const configured = must(address, `${name} is not configured`);
      const code = await client.getCode(configured);
      assert(
        code !== undefined && code !== "0x",
        `${configured} has no code on chain ${config.chainId}`,
      );
      return configured;
    });
  }

  for (const signer of ["organization", "controller"] as const) {
    await check(`${signer} key is funded`, async () => {
      const address = client.addressOf(signer);
      const balance = await client.getBalance(address);
      assert(balance > 0n, `${address} holds no Sepolia ETH`);
      return `${address} — ${formatEther(balance)} ETH`;
    });
  }

  facts.organization = client.organization;
  facts.controller = client.controller;
}

/**
 * U1 — the parent name.
 *
 * Acquiring a `.eth` name is a commit-reveal purchase priced in an ERC 20, not
 * a lookup. If the organization already owns the label the whole phase is a
 * single read, which is why settling the parent before anything else matters.
 */
async function acquireParentName(
  ens: EnsService,
  client: ViemChainClient,
  label: string,
): Promise<void> {
  const config = ens.config;
  const ethRegistry = config.ensv2.ethRegistry;
  const registrar = must(
    config.ensv2.ethRegistrar,
    "ENSV2_ETH_REGISTRAR_ADDRESS is not configured",
  );

  const owner = await ens.findOwner(ethRegistry, label);
  if (owner.toLowerCase() === client.organization.toLowerCase()) {
    await check("U1 parent label is already owned by the organization", async () =>
      `${label}.eth`);
    return;
  }
  assert(
    owner === ZERO_ADDRESS,
    `${label}.eth is owned by ${owner}, not the organization. ` +
      `Pick another ENSV2_PARENT_LABEL or transfer it.`,
  );

  const paymentToken = must(
    config.ensv2.paymentToken,
    "ENSV2_PAYMENT_TOKEN_ADDRESS is not configured",
  );

  // Price first: getRegisterPrice returns (base, premium) and the approval must
  // cover both. Approving only the base is a revert at the reveal, after the
  // commitment wait has already been paid for.
  const [base, premium] = (await client.readContract({
    address: registrar,
    abi: ethRegistrarAbi,
    functionName: "getRegisterPrice",
    args: [label, PARENT_DURATION, paymentToken],
  })) as [bigint, bigint];
  const price = base + premium;
  facts.parentPrice = price.toString();

  await check("U1a payment token balance covers the price", async () => {
    let balance = (await client.readContract({
      address: paymentToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [client.organization],
    })) as bigint;

    if (balance < price) {
      // MockUSDC and MockDAI expose an open mint(). They are the testnet
      // faucet, which is the whole reason a mock token ships with the registrar.
      await record(
        "mint payment token",
        await client.writeContract({
          address: paymentToken,
          abi: erc20Abi,
          functionName: "mint",
          args: [client.organization, price * 2n],
          as: "organization",
        }),
      );
      balance = (await client.readContract({
        address: paymentToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [client.organization],
      })) as bigint;
    }

    assert(balance >= price, `holds ${balance}, needs ${price}`);
    return `${balance} of ${paymentToken}`;
  });

  await record(
    "approve registrar",
    await client.writeContract({
      address: paymentToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [registrar, price],
      as: "organization",
    }),
  );

  // A secret that is neither logged nor derived from anything guessable. The
  // commitment is public; the secret is what stops another account front-running
  // the reveal.
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const referrer = ZERO_BYTES32;

  const commitment = (await client.readContract({
    address: registrar,
    abi: ethRegistrarAbi,
    functionName: "makeCommitment",
    args: [
      label,
      client.organization,
      secret,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      PARENT_DURATION,
      referrer,
    ],
  })) as Hex;

  await check("U1 commitment lands", async () => {
    await record(
      "commit",
      await client.writeContract({
        address: registrar,
        abi: ethRegistrarAbi,
        functionName: "commit",
        args: [commitment],
        as: "organization",
      }),
    );
    return commitment;
  });

  const minAge = (await client.readContract({
    address: registrar,
    abi: ethRegistrarAbi,
    functionName: "MIN_COMMITMENT_AGE",
    args: [],
  })) as bigint;
  const maxAge = (await client.readContract({
    address: registrar,
    abi: ethRegistrarAbi,
    functionName: "MAX_COMMITMENT_AGE",
    args: [],
  })) as bigint;
  facts.commitmentAges = { min: minAge.toString(), max: maxAge.toString() };

  // The wait is mandatory and the window closes, so this is timed rather than
  // eyeballed. One extra second absorbs block-timestamp granularity.
  const waitMs = Number(minAge + 1n) * 1000;
  console.log(
    `      waiting ${waitMs / 1000}s for MIN_COMMITMENT_AGE (window closes after ${maxAge}s)`,
  );
  await new Promise((done) => setTimeout(done, waitMs));

  await check("U1 parent name is registered", async () => {
    await record(
      "register parent",
      await client.writeContract({
        address: registrar,
        abi: ethRegistrarAbi,
        functionName: "register",
        args: [
          label,
          client.organization,
          secret,
          ZERO_ADDRESS,
          ZERO_ADDRESS,
          PARENT_DURATION,
          paymentToken,
          referrer,
        ],
        as: "organization",
      }),
    );
    const registered = await ens.findOwner(ethRegistry, label);
    assert(
      registered.toLowerCase() === client.organization.toLowerCase(),
      `owner is ${registered}`,
    );
    return `${label}.eth`;
  });
}

/**
 * U2 and U3 — the subregistry.
 *
 * A parent name without a subregistry mints subname tokens that never resolve,
 * because the Universal Resolver walks `getSubregistry()` down from the root.
 * The role bitmap passed to `initialize()` is effectively one-shot.
 */
async function ensureSubregistry(
  ens: EnsService,
  client: ViemChainClient,
  label: string,
): Promise<Address> {
  const config = ens.config;
  const ethRegistry = config.ensv2.ethRegistry;

  const existing = await ens.getSubregistry(ethRegistry, label);
  if (existing !== ZERO_ADDRESS) {
    await check("U2 parent already has a subregistry", async () => existing);
    facts.userRegistry = existing;
    return existing;
  }

  // Configured but not yet wired: a previous run deployed the proxy and failed
  // before `setSubregistry` landed. The salt is deterministic, so redeploying
  // reverts on the address that already exists — reuse it and finish the wiring.
  const configured = config.deployed.parentRegistry;
  if (configured) {
    await check("U3 reusing the UserRegistry from a previous run", async () => {
      const isRegistrar = await ens.canRegister(configured, client.organization);
      assert(isRegistrar, `${configured} does not grant us ROLE_REGISTRAR`);
      return configured;
    });
    await wireSubregistry(ens, label, configured);
    facts.userRegistry = configured;
    return configured;
  }

  const implementation = must(
    config.ensv2.userRegistryImpl,
    "ENSV2_USER_REGISTRY_IMPL_ADDRESS is not configured",
  );

  const userRegistry = await deployProxy(ens, {
    implementation,
    // Deterministic, per the factory's published convention: one subname
    // registry per name. A random salt would deploy a second registry on every
    // re-run and strand the grants held by the first.
    salt: userRegistrySalt(namehash(`${label}.eth`) as Hex),
    // Two parameters. The resolver's initialize takes three; reusing that
    // shape here encodes call data the proxy cannot dispatch.
    initData: encodeFunctionData({
      abi: registryAbi,
      functionName: "initialize",
      args: [client.organization, USER_REGISTRY_INIT_ROLES],
    }),
    what: "deploy UserRegistry proxy",
  });

  await check("U3 UserRegistry proxy is deployed and initialized", async () => {
    const isRegistrar = await ens.canRegister(userRegistry, client.organization);
    assert(
      isRegistrar,
      "the organization does not hold ROLE_REGISTRAR at ROOT_RESOURCE; " +
        "the initialize bitmap was wrong and the proxy must be redeployed",
    );
    return userRegistry;
  });

  await wireSubregistry(ens, label, userRegistry);

  facts.userRegistry = userRegistry;
  return userRegistry;
}

/** Point the parent label at a UserRegistry and confirm it took. */
async function wireSubregistry(
  ens: EnsService,
  label: string,
  userRegistry: Address,
): Promise<void> {
  const ethRegistry = ens.config.ensv2.ethRegistry;

  await check("U2 subregistry is wired under the parent label", async () => {
    if (
      (await ens.getSubregistry(ethRegistry, label)).toLowerCase() ===
      userRegistry.toLowerCase()
    ) {
      return `${userRegistry} (already wired)`;
    }
    // A token id, not a labelhash, and it changes when roles change — so it is
    // read immediately before use.
    const tokenId = await ens.findTokenId(ethRegistry, label);
    await record(
      "setSubregistry",
      await ens.setSubregistry({
        registry: ethRegistry,
        tokenId,
        subregistry: userRegistry,
      }),
    );
    const wired = await ens.getSubregistry(ethRegistry, label);
    assert(
      wired.toLowerCase() === userRegistry.toLowerCase(),
      `getSubregistry returned ${wired}`,
    );
    return wired;
  });
}

/**
 * D5 — the organization deploys and owns its resolver.
 *
 * Resolver authority flows only from roles held on the resolver. Registry
 * ownership confers none, so a name pointed at someone else's resolver can
 * never be delegated on. `ALL_ROLES` carries every regular bit and every admin
 * bit: the admin half alone would let the organization delegate a key it could
 * not write itself.
 */
async function ensureResolver(
  ens: EnsService,
  client: ViemChainClient,
): Promise<Address> {
  const configured = ens.config.deployed.permissionedResolver;
  if (configured) {
    await check("resolver proxy is already deployed", async () => configured);
    facts.resolver = configured;
    return configured;
  }

  const implementation = must(
    ens.config.ensv2.permissionedResolverImpl,
    "ENSV2_PERMISSIONED_RESOLVER_IMPL_ADDRESS is not configured",
  );

  const resolver = await deployProxy(ens, {
    implementation,
    // One resolver per owner, so the address is known before the transaction
    // is sent and a re-run cannot fork the grants across two proxies.
    salt: resolverSalt(client.organization),
    // Three parameters here, unlike the registry. The empty setters array is
    // the multicall the resolver runs at initialization; nothing to seed.
    initData: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "initialize",
          stateMutability: "nonpayable",
          inputs: [
            { name: "admin", type: "address" },
            { name: "roleBitmap", type: "uint256" },
            { name: "setters", type: "bytes[]" },
          ],
          outputs: [],
        },
      ] as const,
      functionName: "initialize",
      args: [client.organization, ALL_ROLES, []],
    }),
    what: "deploy PermissionedResolver proxy",
  });

  facts.resolver = resolver;
  return resolver;
}

//////////////////////////////////////////////////////////////////////////////
// Main
//////////////////////////////////////////////////////////////////////////////

/**
 * Task 7.3 — re-read the permission state in a fresh process.
 *
 * Reads nothing but the evidence file and the chain. If this disagrees with
 * what the run reported, some part of the permission surface was being served
 * from memory rather than from chain, which is the failure the whole
 * "never derive permissions from local flags" rule exists to catch.
 *
 * Run: pnpm --filter @nymspace/ens spike -- --verify-only
 */
async function verifyOnly(): Promise<void> {
  const config = chainConfig();
  const env = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
  ] as const);

  const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as {
    facts: { agentName?: string; userRegistry?: Address; resolver?: Address };
  };
  const agentName = must(
    evidence.facts.agentName,
    `${EVIDENCE_PATH} names no agent; run the spike first`,
  );

  const client = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey: env.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: env.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });

  const ens = new EnsService({
    client,
    config: {
      ...config,
      deployed: {
        parentLabel: config.deployed.parentLabel,
        parentRegistry: must(
          evidence.facts.userRegistry ?? config.deployed.parentRegistry,
          "no UserRegistry in the evidence file or the environment",
        ),
        permissionedResolver: must(
          evidence.facts.resolver ?? config.deployed.permissionedResolver,
          "no resolver in the evidence file or the environment",
        ),
      },
    },
  });

  confirm = (hash) => client.waitForReceipt(hash);

  console.log(`\nre-reading ${agentName} in a fresh process\n`);

  await check("delegated keys are enumerable from chain", async () => {
    // From NamedTextResource events, not from a hardcoded key list: the UI
    // must be able to discover a delegation nobody told it about.
    // Public RPCs refuse an unbounded earliest..latest scan. The spike's own
    // grants are minutes old, so a short window finds them and stays inside
    // every provider's range cap.
    const head = await client.publicClient.getBlockNumber();
    const keys = await ens.delegatedKeys({
      name: agentName,
      controller: client.controller,
      fromBlock: head > 5000n ? head - 5000n : 0n,
    });
    assert(keys.length > 0, "no NamedTextResource event names this name");
    return keys
      .map(({ key, granted }) => `${key}=${granted ? "granted" : "revoked"}`)
      .join(", ");
  });

  await check("the organization still holds grant authority", async () => {
    const allowed = await ens.canDelegateText(agentName, client.organization);
    assert(allowed, "ROLE_SET_TEXT_ADMIN is absent");
    return "hasRoles on resource(namehash, 0)";
  });

  await check("the endpoint record survives the process boundary", async () => {
    const value = await ens.readText(agentName, DELEGATED_KEY);
    assert(value.length > 0, "the record reads back empty");
    return value;
  });

  finish(true, "verify");
}

async function main() {
  const config = chainConfig();
  const env = requireServerEnv([
    "ENSV2_PARENT_LABEL",
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
  ] as const);

  const label = env.ENSV2_PARENT_LABEL;
  const parentName = `${label}.eth`;

  const client = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey: env.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: env.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });

  confirm = (hash) => client.waitForReceipt(hash);

  console.log(`\nENSv2 authority spike — chain ${config.chainId}, ${parentName}\n`);
  facts.chainId = config.chainId;
  facts.parentName = parentName;

  console.log("-- preflight --");
  await preflight(client, config);
  if (assertions.some((a) => !a.passed)) {
    // Stop rather than continue into writes. A stale address or an unfunded key
    // produces failures further down that look like protocol problems, and the
    // first of those transactions has already been paid for.
    console.log("\npreflight failed; not sending any transaction");
    return finish(false);
  }

  console.log("\n-- section 2: namespace --");
  const bootstrap = new EnsService({ client, config });
  await acquireParentName(bootstrap, client, label);

  const parentOwner = await bootstrap.findOwner(config.ensv2.ethRegistry, label);
  if (parentOwner.toLowerCase() !== client.organization.toLowerCase()) {
    // Without the parent, every check below reverts because the name does not
    // exist, which would read as the permission boundary holding. A denial that
    // is really an absence is worse than a plain failure.
    console.log(`\n${parentName} is not ours (owner ${parentOwner}); stopping`);
    return finish(false);
  }

  const userRegistry = await ensureSubregistry(bootstrap, client, label);

  console.log("\n-- section 4: resolver --");
  const resolver = await ensureResolver(bootstrap, client);

  // Everything below runs against the deployed pair, so the service is rebuilt
  // with them in place rather than mutating the one above.
  const ens = new EnsService({
    client,
    config: {
      ...config,
      deployed: {
        parentLabel: label,
        parentRegistry: userRegistry,
        permissionedResolver: resolver,
      },
    },
  });

  console.log("\n-- section 3: agent subname --");
  const agentLabel = `spike-${Date.now()}`;
  const agentName = `${agentLabel}.${parentName}`;
  const agentNode = namehash(agentName) as Hex;
  const dnsName = encodeDnsName(agentName);
  facts.agentName = agentName;

  await check("U6 organization may register directly", async () => {
    const allowed = await ens.canRegister(userRegistry, client.organization);
    assert(allowed, "ROLE_REGISTRAR is absent at ROOT_RESOURCE");
    return "hasRoles(ROOT_RESOURCE, ROLE_REGISTRAR, organization)";
  });

  await check("agent subname is registered against our own resolver", async () => {
    const expiry =
      BigInt(Math.floor(Date.now() / 1000)) + SUBNAME_DURATION;
    await record(
      "register subname",
      await ens.registerSubname({
        registry: userRegistry,
        label: agentLabel,
        owner: client.organization,
        subregistry: ZERO_ADDRESS,
        resolver,
        // Registry-domain roles on the subname's own resource. The controller
        // receives none of them, which is what makes the setResolver denial
        // below hold by construction rather than by an application check.
        roleBitmap: AGENT_SUBNAME_OWNER_ROLES,
        expiry,
      }),
    );
    const owner = await ens.findOwner(userRegistry, agentLabel);
    assert(
      owner.toLowerCase() === client.organization.toLowerCase(),
      `owner is ${owner}`,
    );
    const attached = await ens.getResolver(userRegistry, agentLabel);
    assert(
      attached.toLowerCase() === resolver.toLowerCase(),
      `resolver is ${attached}, not ours`,
    );
    return agentName;
  });

  await check("subname resolves through the Universal Resolver", async () => {
    const universal = must(
      config.ensv2.universalResolver,
      "ENSV2_UNIVERSAL_RESOLVER_ADDRESS is not configured",
    );
    const [found] = (await client.readContract({
      address: universal,
      abi: universalResolverAbi,
      functionName: "findResolver",
      args: [dnsName],
    })) as [Address, Hex, bigint];
    assert(
      found.toLowerCase() === resolver.toLowerCase(),
      `the registry walk reached ${found}; the subregistry wiring did not take effect`,
    );
    return found;
  });

  console.log("\n-- section 4: grant authority --");

  await check("U5 parent and agent share one resolver proxy", async () => {
    const parentResolver = await ens.getResolver(config.ensv2.ethRegistry, label);
    const agentResolver = await ens.getResolver(userRegistry, agentLabel);
    facts.sharedResolver =
      parentResolver.toLowerCase() === agentResolver.toLowerCase();
    return `parent ${parentResolver}, agent ${agentResolver}`;
  });

  const canDelegate = await check(
    "U4 organization holds ROLE_SET_TEXT_ADMIN on the agent name",
    async () => {
      // hasRoles, never roles(): the organization holds everything at
      // ROOT_RESOURCE and roles() would report zero.
      const allowed = await ens.canDelegateText(agentName, client.organization);
      assert(
        allowed,
        "the organization cannot grant text roles on this name; it does not " +
          "control the resolver and no delegation is possible",
      );
      return `resource(namehash(${agentName}), 0)`;
    },
  );

  if (!canDelegate) {
    // Task 4.5: without grant authority there is nothing below to measure.
    return finish(false);
  }

  console.log("\n-- section 5: record-level delegation --");

  await check("record-level grant is accepted", async () => {
    await record(
      "authorizeTextRoles grant",
      await ens.authorizeTextRole({
        dnsName,
        key: DELEGATED_KEY,
        controller: client.controller,
        authorized: true,
      }),
    );
    return `${DELEGATED_KEY} to ${client.controller}`;
  });

  await check("U7 positive control: the derivation finds the grant", async () => {
    const allowed = await ens.resolverHasRoles(
      textRecordResource(agentName, DELEGATED_KEY),
      RESOLVER_ROLE.SET_TEXT,
      client.controller,
    );
    assert(
      allowed,
      "a grant that was just made reads as absent — the resource derivation " +
        "is wrong, not the permission",
    );
    return "hasRoles(resource(node, partHash(key)), ROLE_SET_TEXT, controller)";
  });

  await check("the grant is record-scoped, not name-scoped", async () => {
    // roles() is the correct call here: the question is what is stored at the
    // name resource, not what authority is effective there.
    const atName = await ens.resolverRolesAt(
      nameResource(agentName),
      client.controller,
    );
    assert(
      (atName & RESOLVER_ROLE.SET_TEXT) === 0n,
      `the controller holds name-level roles: ${atName}`,
    );
    return "roles(resource(node, 0), controller) carries no ROLE_SET_TEXT";
  });

  await check("no account holds the wildcard resource", async () => {
    // resource(0, part) authorizes a key on every name this resolver serves.
    // One shared resolver across all agents makes that a cross-agent breach.
    for (const account of [client.controller, client.organization]) {
      const held = await ens.resolverRolesAt(
        wildcardTextResource(DELEGATED_KEY),
        account,
      );
      assert(held === 0n, `${account} holds ${held} at resource(0, part)`);
    }
    return `resource(0, partHash(${DELEGATED_KEY})) is empty`;
  });

  console.log("\n-- section 6: proofs --");

  await check("the controller writes its delegated endpoint", async () => {
    await record(
      "controller setText",
      await ens.writeText({
        name: agentName,
        key: DELEGATED_KEY,
        value: AGENT_ENDPOINT,
        as: "controller",
      }),
    );
    return DELEGATED_KEY;
  });

  await check("the written value reads back", async () => {
    const value = await ens.readText(agentName, DELEGATED_KEY);
    assert(value === AGENT_ENDPOINT, `read ${JSON.stringify(value)}`);
    return value;
  });

  await checkReverts("an undelegated text key is denied", () =>
    ens.writeText({
      name: agentName,
      key: UNDELEGATED_KEY,
      value: "https://a2a.example/agent",
      as: "controller",
    }),
  );

  const identityRegistry = must(
    config.erc8004.identityRegistry,
    "ERC8004_IDENTITY_REGISTRY_ADDRESS is not configured",
  );
  const registrationKey = agentRegistrationKey({
    chainId: config.chainId,
    registry: identityRegistry,
    agentId: "1",
  });
  facts.ensip25Key = registrationKey;

  await checkReverts("the ENSIP 25 verification key is denied", () =>
    ens.writeText({
      name: agentName,
      key: registrationKey,
      value: "1",
      as: "controller",
    }),
  );

  await checkReverts("the controller cannot change the resolver", async () => {
    const tokenId = await ens.findTokenId(userRegistry, agentLabel);
    return ens.setResolver({
      registry: userRegistry,
      tokenId,
      resolver: ZERO_ADDRESS,
      as: "controller",
    });
  });

  await check("only the organization writes the ENSIP 25 key", async () => {
    await record(
      "organization setText (ENSIP 25)",
      await ens.writeText({
        name: agentName,
        key: registrationKey,
        value: "1",
        as: "organization",
      }),
    );
    const value = await ens.readText(agentName, registrationKey);
    assert(value === "1", `read ${JSON.stringify(value)}`);
    return registrationKey;
  });

  await check("revocation takes effect without a restart", async () => {
    await record(
      "authorizeTextRoles revoke",
      await ens.authorizeTextRole({
        dnsName,
        key: DELEGATED_KEY,
        controller: client.controller,
        authorized: false,
      }),
    );
    const allowed = await ens.canSetText(
      agentName,
      DELEGATED_KEY,
      client.controller,
    );
    assert(!allowed, "the controller still reads as permitted after revocation");
    return "canSetText is false immediately after the revoke";
  });

  await checkReverts("the revoked controller can no longer write", () =>
    ens.writeText({
      name: agentName,
      key: DELEGATED_KEY,
      value: "https://mcp.nymspace.example/changed",
      as: "controller",
    }),
  );

  facts.agentNode = agentNode;
  finish(true);
}

/** Print the Day 1 deliverable and write the evidence file. */
function finish(reachedTheEnd: boolean, mode: "gate" | "verify" = "gate"): void {
  const failed = assertions.filter((a) => !a.passed);
  const go = reachedTheEnd && failed.length === 0;

  // Only a full run can answer the gate. Printing those three lines after a
  // re-read would report a NO-GO for checks that never ran.
  if (mode === "gate") {
    console.log("\n-- Day 1 gate --");
    for (const name of [
      "the controller writes its delegated endpoint",
      "an undelegated text key is denied",
      "the controller cannot change the resolver",
    ]) {
      const result = assertions.find((a) => a.name === name);
      console.log(
        `  ${result?.passed ? "PASS" : "FAIL"}  ${name}${result ? "" : " (not reached)"}`,
      );
    }
  }

  console.log(
    `\n${assertions.length - failed.length}/${assertions.length} assertions passed — ` +
      `${go ? "GO" : "NO-GO"}\n`,
  );

  const out = mode === "gate" ? EVIDENCE_PATH : VERIFY_PATH;
  writeFileSync(
    out,
    `${JSON.stringify(
      { ranAt: new Date().toISOString(), go, facts, assertions, transactions },
      null,
      2,
    )}\n`,
  );
  console.log(`Evidence: ${out}`);

  process.exitCode = go ? 0 : 1;
}

if (process.argv.includes("--verify-only")) {
  await verifyOnly();
} else {
  await main();
}
