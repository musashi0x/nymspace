import { describe, expect, it } from "vitest";
import { previewAgainstLimit, type PaymentRequest, type PolicyLimit } from "./policy";
import { PrivyError, normalisePrivyError } from "./wallet";

/**
 * Task 5.8 — the mapping from provider failure to typed outcome.
 *
 * The distinction under test is `denied` versus `failed`, and getting it wrong
 * costs in both directions. A denial reported as a failure hides the product's
 * central proof behind an error screen; a failure reported as a denial claims a
 * control worked when it never ran, which is the worse of the two because it
 * demos as a success.
 */

const limit: PolicyLimit = {
  policyId: "pol_1",
  name: "Demo limit",
  maxAmount: "1000000000000000", // 0.001 ETH
  token: null,
  ruleName: "Restrict native transfers to 1000000000000000 wei",
};

function request(amount: string): PaymentRequest {
  return {
    amount,
    recipient: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9",
    caip2: "eip155:84532",
  };
}

describe("a policy rejection is a denial, not a failure", () => {
  it("maps 403 to denied and keeps the provider's own words", () => {
    const result = normalisePrivyError(
      new PrivyError("Privy responded 403", 403, {
        message: "Transaction violates policy pol_abc",
        policy_id: "pol_abc",
      }),
    );

    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.reason).toBe("Transaction violates policy pol_abc");
      expect(result.policyId).toBe("pol_abc");
    }
  });

  it("maps a 400 that names a policy to denied", () => {
    const result = normalisePrivyError(
      new PrivyError("Privy responded 400", 400, {
        message: "Request denied by policy",
      }),
    );
    expect(result.status).toBe("denied");
  });

  /**
   * The narrowness is the point. A 400 for a malformed address is a bug in our
   * request, and calling it a denial would credit a policy that never ran.
   */
  it("leaves an ordinary 400 as a failure", () => {
    const result = normalisePrivyError(
      new PrivyError("Privy responded 400", 400, {
        message: "invalid recipient address",
      }),
    );
    expect(result.status).toBe("failed");
  });

  it("maps a 500 to failed even when its body mentions a policy", () => {
    const result = normalisePrivyError(
      new PrivyError("Privy responded 500", 500, {
        message: "policy service unavailable",
      }),
    );
    // A status match first, message second: an outage that happens to say
    // "policy" is not the policy working.
    expect(result.status).toBe("failed");
  });

  it("maps a network fault to failed", () => {
    const result = normalisePrivyError(new TypeError("fetch failed"));
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.reason).toBe("fetch failed");
  });

  it("never invents pending_approval from a provider error", () => {
    const outcomes = [
      normalisePrivyError(new PrivyError("x", 403, {})),
      normalisePrivyError(new PrivyError("x", 400, { message: "policy" })),
      normalisePrivyError(new PrivyError("x", 500, {})),
      normalisePrivyError(new Error("boom")),
    ];
    // docs/08 forbids simulating an approval path. `pending_approval` is
    // produced by the approval route, where a second authority actually acts —
    // never by reinterpreting a denial as a pending request.
    expect(outcomes.every((o) => o.status !== "pending_approval")).toBe(true);
  });
});

describe("the preview is a preview, not an authority", () => {
  it("reports a request under the limit as within it", () => {
    const preview = previewAgainstLimit(request("100000000000000"), limit);
    expect(preview.withinLimit).toBe(true);
    expect(preview.limitAmount).toBe(limit.maxAmount);
  });

  it("reports a request over the limit as outside it", () => {
    const preview = previewAgainstLimit(request("10000000000000000"), limit);
    expect(preview.withinLimit).toBe(false);
  });

  it("treats the limit as inclusive, matching the policy's lte operator", () => {
    const preview = previewAgainstLimit(request(limit.maxAmount), limit);
    // `lte`, so exactly the limit is allowed. An exclusive preview would show a
    // denial the provider does not produce.
    expect(preview.withinLimit).toBe(true);
  });

  it("compares as integers, so a large amount does not lose precision", () => {
    const huge = "115792089237316195423570985008687907853269984665640564039457";
    const preview = previewAgainstLimit(request(huge), limit);
    // Number() would round this and could compare equal to the limit.
    expect(preview.withinLimit).toBe(false);
    expect(preview.requestedAmount).toBe(huge);
  });
});
