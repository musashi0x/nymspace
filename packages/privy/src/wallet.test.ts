import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PrivyClient, PrivyError, type PrivyCredentials } from "./wallet";
import { BASE_SEPOLIA_USDC } from "./token";

/**
 * The request the client builds, asserted without a network.
 *
 * These are the two places the integration can be wrong while every screen
 * still looks right: a transfer whose amount is not where the policy reads it,
 * and a limit read back in units nobody checked. Both produce a confident
 * number rather than an error, so both are pinned here.
 */

const CREDENTIALS: PrivyCredentials = {
  appId: "app_1",
  appSecret: "secret",
  authorizationKeyId: "key_1",
  authorizationPrivateKey: "unused",
};

const RECIPIENT = "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9";

interface Capture {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(responses: unknown[] | unknown, status = 200) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: Capture[] = [];

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

function tokenPolicyBody(maxAmountHex: string) {
  return {
    id: "pol_token",
    name: "nymspace research max transfer",
    rules: [
      {
        name: "Transfer at most 10000000 USDC base units",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          {
            field_source: "ethereum_transaction",
            field: "to",
            operator: "eq",
            value: BASE_SEPOLIA_USDC.address,
          },
          {
            field_source: "ethereum_calldata",
            field: "transfer.amount",
            operator: "lte",
            value: maxAmountHex,
          },
        ],
      },
    ],
  };
}

describe("the token policy", () => {
  it("pins the contract and the amount in one ALLOW rule", async () => {
    const { fetchImpl, calls } = stub({ id: "pol_token", name: "cap" });
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    await client.createTokenPolicy({
      name: "cap",
      token: BASE_SEPOLIA_USDC,
      maxAmount: 10_000_000n,
    });

    const rule = (calls[0]!.body as { rules: { conditions: Record<string, string>[]; action: string }[] })
      .rules[0]!;

    expect(rule.action).toBe("ALLOW");
    expect(rule.conditions[0]).toMatchObject({
      field: "to",
      operator: "eq",
      value: BASE_SEPOLIA_USDC.address,
    });
    expect(rule.conditions[1]).toMatchObject({
      field_source: "ethereum_calldata",
      field: "transfer.amount",
      operator: "lte",
      // Hex, because a decimal in this field is a silently different number.
      value: "0x989680",
    });
  });
});

describe("reading the limit back", () => {
  it("denominates a token limit in the token's own units", async () => {
    const { fetchImpl } = stub(tokenPolicyBody("0x989680"));
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    const limit = await client.getPolicyLimit("pol_token");

    expect(limit.maxAmount).toBe("10000000");
    expect(limit.token).toEqual(BASE_SEPOLIA_USDC);
  });

  it("reads a native limit as having no token", async () => {
    const { fetchImpl } = stub({
      id: "pol_native",
      name: "native cap",
      rules: [
        {
          name: "Restrict native transfers to 1000000000000000 wei",
          conditions: [
            {
              field_source: "ethereum_transaction",
              field: "value",
              operator: "lte",
              value: "0x38d7ea4c68000",
            },
          ],
        },
      ],
    });
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    const limit = await client.getPolicyLimit("pol_native");

    expect(limit.token).toBeNull();
    expect(limit.maxAmount).toBe("1000000000000000");
  });

  /**
   * A limit in unknown units is the failure this refuses to render: the number
   * is real, the policy is real, and the scale is a guess.
   */
  it("refuses a token limit it cannot denominate", async () => {
    const unknown = tokenPolicyBody("0x989680");
    unknown.rules[0]!.conditions[0]!.value = "0x0000000000000000000000000000000000000bad";

    const { fetchImpl } = stub(unknown);
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    await expect(client.getPolicyLimit("pol_token")).rejects.toThrow(/denominate/);
  });

  it("refuses a policy that constrains nothing", async () => {
    const { fetchImpl } = stub({ id: "pol_open", name: "open", rules: [] });
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    await expect(client.getPolicyLimit("pol_open")).rejects.toThrow(/no limit/);
  });
});

describe("moving the limit", () => {
  it("keeps the contract condition while the amount changes", async () => {
    const { fetchImpl, calls } = stub([
      tokenPolicyBody("0x989680"), // GET current
      {}, // PATCH
      tokenPolicyBody("0x5f5e100"), // GET after
    ]);
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    const limit = await client.updatePolicyLimit("pol_token", 100_000_000n);

    const patched = calls[1]!.body as {
      rules: { conditions: { field: string; value: string }[] }[];
    };
    // The `to` condition survives. Rebuilding the rules from parameters is how
    // it silently disappears, leaving an amount cap on any contract at all.
    expect(patched.rules[0]!.conditions[0]).toMatchObject({
      field: "to",
      value: BASE_SEPOLIA_USDC.address,
    });
    expect(patched.rules[0]!.conditions[1]!.value).toBe("0x5f5e100");
    expect(limit.maxAmount).toBe("100000000");
  });

  it("refuses to rewrite a policy with no amount condition", async () => {
    const { fetchImpl } = stub({ id: "pol_open", name: "open", rules: [] });
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    await expect(client.updatePolicyLimit("pol_open", 1n)).rejects.toThrow(
      /no amount condition/,
    );
  });
});

describe("sending a payment", () => {
  it("sends a token transfer as zero-value calldata to the contract", async () => {
    const { fetchImpl, calls } = stub({
      method: "eth_sendTransaction",
      data: { hash: "0xhash", transaction_id: "req_1" },
    });
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    const result = await client.sendPayment("w1", {
      amount: "5000000",
      recipient: RECIPIENT,
      caip2: "eip155:84532",
      token: BASE_SEPOLIA_USDC,
    });

    const transaction = (
      calls[0]!.body as { params: { transaction: Record<string, string> } }
    ).params.transaction;

    expect(transaction.to).toBe(BASE_SEPOLIA_USDC.address);
    expect(transaction.value).toBe("0x0");
    expect(transaction.data?.startsWith("0xa9059cbb")).toBe(true);
    expect(result).toMatchObject({ status: "executed", transactionHash: "0xhash" });
  });

  it("still sends a native transfer when no token is given", async () => {
    const { fetchImpl, calls } = stub({ data: { hash: "0xhash" } });
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    await client.sendPayment("w1", {
      amount: "1000",
      recipient: RECIPIENT,
      caip2: "eip155:84532",
    });

    const transaction = (
      calls[0]!.body as { params: { transaction: Record<string, string> } }
    ).params.transaction;

    expect(transaction.to).toBe(RECIPIENT);
    expect(transaction.value).toBe("0x3e8");
    expect(transaction.data).toBeUndefined();
  });

  it("returns denied rather than throwing when the policy refuses", async () => {
    const { fetchImpl } = stub({ message: "RPC request denied due to policy violation" }, 403);
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    const result = await client.sendPayment("w1", {
      amount: "100000000",
      recipient: RECIPIENT,
      caip2: "eip155:84532",
      token: BASE_SEPOLIA_USDC,
    });

    expect(result.status).toBe("denied");
    expect("transactionHash" in result).toBe(false);
  });
});

describe("acting as a key", () => {
  function authorizationKey() {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return {
      keyId: "key_agent",
      privateKey: `wallet-auth:${privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")}`,
    };
  }

  it("signs state-changing requests and leaves reads unsigned", async () => {
    const { fetchImpl, calls } = stub([
      { id: "w1", address: "0xabc", chain_type: "ethereum" },
      { data: { hash: "0xhash" } },
    ]);
    const client = new PrivyClient({
      credentials: CREDENTIALS,
      fetchImpl,
      authorizationKey: authorizationKey(),
    });

    await client.getWallet("w1");
    await client.sendPayment("w1", {
      amount: "1",
      recipient: RECIPIENT,
      caip2: "eip155:84532",
    });

    expect(calls[0]!.headers["privy-authorization-signature"]).toBeUndefined();
    expect(calls[1]!.headers["privy-authorization-signature"]).toBeTypeOf("string");
  });

  it("sends no signature at all when it holds no key", async () => {
    const { fetchImpl, calls } = stub({ data: { hash: "0xhash" } });
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    await client.sendPayment("w1", {
      amount: "1",
      recipient: RECIPIENT,
      caip2: "eip155:84532",
    });

    expect(calls[0]!.headers["privy-authorization-signature"]).toBeUndefined();
  });

  /**
   * The escalation is a change of authority, not a change of code path. Two
   * clients differing only in the key they hold is what makes that literally
   * true rather than a claim in a comment.
   */
  it("produces a second client that differs only in its key", () => {
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl: stub({}).fetchImpl });
    const owner = client.withKey({ keyId: "key_owner", privateKey: "x" });

    expect(client.actingKeyId).toBeUndefined();
    expect(owner.actingKeyId).toBe("key_owner");
  });
});

describe("errors carry their status", () => {
  it("keeps the provider's status on the error it throws", async () => {
    const { fetchImpl } = stub({ message: "nope" }, 401);
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    await expect(client.getWallet("w1")).rejects.toBeInstanceOf(PrivyError);
  });

  /**
   * An unsigned request against an owned wallet fails authentication, and that
   * is not the policy working. Reporting it as a denial would put "the control
   * worked" on screen for a request the control never saw.
   */
  it("reports a 401 as a failure, never as a denial", async () => {
    const { fetchImpl } = stub({ message: "missing authorization signature" }, 401);
    const client = new PrivyClient({ credentials: CREDENTIALS, fetchImpl });

    const result = await client.sendPayment("w1", {
      amount: "1",
      recipient: RECIPIENT,
      caip2: "eip155:84532",
    });

    expect(result.status).toBe("failed");
  });
});
