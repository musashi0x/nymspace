import { apiBaseUrl } from "@/lib/api";

/**
 * The console's writes, signed on the server.
 *
 * Every route that spends the organization's money — registering a subname,
 * granting a permission, writing a record, sending a payment — now needs a
 * bearer token (`apps/api/src/write-gate.ts`). The browser cannot hold one: a
 * token in client JavaScript is a token in view source, and this console is
 * served to anyone who can open it.
 *
 * So the browser posts here instead, same-origin, and this handler adds the
 * credential on its way out. `CONSOLE_MCP_TOKEN` is read from the server
 * environment and is deliberately not `NEXT_PUBLIC_` — Next inlines those into
 * the bundle, which is the exact failure this exists to avoid.
 *
 * ## What this is not
 *
 * Not authentication. Anyone who can reach this console can still reach these
 * writes through it, exactly as before — what changed is that they can no
 * longer reach them by `curl`ing the API directly from anywhere on the
 * internet, which was the open door. Putting a real identity in front of the
 * console is a separate change and a larger one; this closes the hole that
 * needed no account at all.
 *
 * Not a general proxy either. The path is rebuilt from the segments rather than
 * taken from a query parameter, and only `/v1/*` is forwarded, so it cannot be
 * pointed at somebody else's host.
 */

/** Only the product API, and only its versioned surface. */
function targetFor(segments: string[]): URL | undefined {
  if (segments[0] !== "v1") return undefined;
  // `URL` with a base cannot escape the origin here: every segment is
  // percent-encoded, so `..` arrives as a literal path component rather than
  // climbing out of `/v1`.
  return new URL(
    segments.map(encodeURIComponent).join("/"),
    `${apiBaseUrl.replace(/\/+$/, "")}/`,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const token = process.env.CONSOLE_MCP_TOKEN;
  if (!token) {
    // The same shape and the same reason the API gives: unconfigured refuses,
    // rather than passing an unsigned write along to be refused further out
    // with a message about a variable this deployment is the one missing.
    return Response.json(
      {
        error:
          "this console cannot perform writes: CONSOLE_MCP_TOKEN is not set on the web app",
        status: 503,
      },
      { status: 503 },
    );
  }

  const { path } = await params;
  const target = targetFor(path);
  if (!target) {
    return Response.json({ error: "not found", status: 404 }, { status: 404 });
  }

  target.search = new URL(request.url).search;

  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      authorization: `Bearer ${token}`,
    },
    body: await request.text(),
  });

  /*
    The upstream body and status are passed through unchanged.

    A denial from the resolver and a refusal from a spend policy both arrive
    here as ordinary 200s carrying a typed outcome, and `docs/11` is explicit
    that those must not be re-dressed as errors. Rewriting anything on this path
    would put a second opinion between the contract and the screen.
  */
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}
