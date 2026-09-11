import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizationPayload,
  authorizationSignature,
  canonicalize,
} from "./authorization";

/**
 * The header that says which authority is acting.
 *
 * Everything the financial demo claims about the agent's limit rests on Privy
 * attributing a request to the agent's key. A signature that does not verify is
 * rejected and visible; a signature over the *wrong bytes* is the quiet
 * failure, so canonicalisation is tested against reordering rather than against
 * itself.
 */

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const der = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  return { der, publicKey };
}

describe("canonical JSON", () => {
  it("sorts keys recursively and emits no whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: "x", c: [3, 2] } })).toBe(
      '{"a":{"c":[3,2],"d":"x"},"b":1}',
    );
  });

  it("produces the same bytes for objects written in a different order", () => {
    expect(canonicalize({ url: "u", method: "POST", version: 1 })).toBe(
      canonicalize({ version: 1, method: "POST", url: "u" }),
    );
  });

  it("drops undefined the way JSON.stringify does", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("preserves array order, which is not a set", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("escapes strings as JSON does", () => {
    expect(canonicalize({ a: 'q"\n' })).toBe('{"a":"q\\"\\n"}');
  });

  /**
   * A float here means an amount has already been through a lossy conversion
   * upstream. Refusing is cheaper than signing it.
   */
  it("refuses a non-integer number", () => {
    expect(() => canonicalize({ amount: 5.5 })).toThrow(/non-integer/);
  });

  it("refuses a bigint rather than guessing a serialisation", () => {
    expect(() => canonicalize({ amount: 5n })).toThrow(/bigint/);
  });
});

describe("the payload", () => {
  it("carries the version, the method, the full url and the app id", () => {
    const payload = authorizationPayload({
      method: "POST",
      url: "https://api.privy.io/v1/wallets/w1/rpc",
      body: { method: "eth_sendTransaction" },
      appId: "app_1",
    });

    expect(payload).toEqual({
      version: 1,
      method: "POST",
      url: "https://api.privy.io/v1/wallets/w1/rpc",
      body: { method: "eth_sendTransaction" },
      headers: { "privy-app-id": "app_1" },
    });
  });

  it("omits the body entirely when there is none", () => {
    const payload = authorizationPayload({
      method: "DELETE",
      url: "https://api.privy.io/v1/wallets/w1",
      appId: "app_1",
    });
    expect("body" in payload).toBe(false);
  });
});

describe("the signature", () => {
  it("verifies against the public half of the key that signed it", () => {
    const { der, publicKey } = keypair();
    const request = {
      method: "POST",
      url: "https://api.privy.io/v1/wallets/w1/rpc",
      body: { amount: "5000000" },
      appId: "app_1",
    };

    const signature = authorizationSignature(
      { keyId: "k1", privateKey: `wallet-auth:${der}` },
      request,
    );

    const verifier = createVerify("sha256");
    verifier.update(canonicalize(authorizationPayload(request)));
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64"))).toBe(true);
  });

  it("accepts the key with or without the wallet-auth prefix", () => {
    const { der } = keypair();
    expect(() =>
      authorizationSignature(
        { keyId: "k1", privateKey: der },
        { method: "POST", url: "https://api.privy.io/v1/x", appId: "a" },
      ),
    ).not.toThrow();
  });

  /**
   * The assertion that matters for the demo: two keys are two authorities. If
   * the same bytes signed by the agent and by the owner were indistinguishable,
   * the escalation would be theatre.
   */
  it("differs between two keys signing the same request", () => {
    const agent = keypair();
    const owner = keypair();
    const request = {
      method: "POST",
      url: "https://api.privy.io/v1/wallets/w1/rpc",
      body: { amount: "100000000" },
      appId: "app_1",
    };

    const byAgent = authorizationSignature(
      { keyId: "agent", privateKey: agent.der },
      request,
    );
    const byOwner = authorizationSignature(
      { keyId: "owner", privateKey: owner.der },
      request,
    );

    expect(byAgent).not.toBe(byOwner);

    const verifier = createVerify("sha256");
    verifier.update(canonicalize(authorizationPayload(request)));
    expect(
      verifier.verify(owner.publicKey, Buffer.from(byAgent, "base64")),
    ).toBe(false);
  });
});
