import { createPrivateKey, sign } from "node:crypto";

/**
 * Request signing — the header that says which authority is acting.
 *
 * Privy authorises a wallet request two ways. The app secret says *which
 * application* is calling; the `privy-authorization-signature` header says
 * *which key* is calling, and that is the one that matters here, because a
 * wallet's per-signer policies are evaluated against the signer that signed the
 * request. Without this header the agent's cap is not applied to the agent — it
 * is not applied at all, and every proof downstream of it is worthless.
 *
 * The signature is ECDSA P-256 over the RFC 8785 canonicalisation of
 * `{version, method, url, body, headers}`, base64-encoded.
 */

export interface AuthorizationKey {
  /** The key quorum or authorization key id, as Privy issued it. */
  keyId: string;
  /** `wallet-auth:`-prefixed base64 DER PKCS8, as Privy issued it. */
  privateKey: string;
}

/**
 * RFC 8785 canonical JSON, for the subset this payload can contain.
 *
 * Implemented rather than depended on. The payload is strings, one integer,
 * objects and arrays — the part of 8785 that applies is "sort keys recursively,
 * emit no whitespace", and a dependency whose version moves is one more thing
 * to re-verify before a demo. Non-integer numbers are refused rather than
 * serialised approximately: every number in a Privy request body is an integer
 * or a hex string, and a float reaching here means an amount has already been
 * through a lossy conversion somewhere upstream.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(
          `Cannot canonicalise the non-integer number ${value}. Amounts cross ` +
            "this boundary as decimal strings, never as floats.",
        );
      }
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new Error(
        "Cannot canonicalise a bigint. Serialise amounts as decimal or hex " +
          "strings before they reach a request body.",
      );
    case "object":
      break;
    default:
      throw new Error(`Cannot canonicalise a ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    // Sort by UTF-16 code unit, which is what `<` on JS strings already does
    // and what RFC 8785 specifies.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

/** `wallet-auth:MIGH…` → a PEM node's crypto will accept. */
function toPem(privateKey: string): string {
  const base64 = privateKey.replace(/^wallet-auth:/, "");
  const wrapped = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

export interface SignableRequest {
  method: string;
  /** The full URL, with no trailing slash. */
  url: string;
  body?: unknown;
  appId: string;
  /** Privy-prefixed headers that participate in the signature. */
  extraHeaders?: Record<string, string>;
}

/**
 * The payload, built separately from the signing so a test can assert its
 * shape without holding a key.
 */
export function authorizationPayload(request: SignableRequest): {
  version: number;
  method: string;
  url: string;
  body?: unknown;
  headers: Record<string, string>;
} {
  return {
    version: 1,
    method: request.method,
    url: request.url,
    ...(request.body !== undefined && { body: request.body }),
    headers: { "privy-app-id": request.appId, ...request.extraHeaders },
  };
}

/** The value of the `privy-authorization-signature` header. */
export function authorizationSignature(
  key: AuthorizationKey,
  request: SignableRequest,
): string {
  const payload = canonicalize(authorizationPayload(request));
  const signature = sign(
    "sha256",
    Buffer.from(payload, "utf8"),
    createPrivateKey({ key: toPem(key.privateKey), format: "pem" }),
  );
  return signature.toString("base64");
}
