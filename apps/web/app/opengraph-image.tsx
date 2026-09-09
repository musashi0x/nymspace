import { ImageResponse } from "next/og";

/**
 * The card image both `openGraph` and `twitter` in `app/layout.tsx` point at.
 * Next picks this file up by convention and writes the absolute URL, size and
 * type tags itself, so the metadata object names no image.
 *
 * Styling is inline on purpose: `ImageResponse` renders through satori, which
 * reads inline styles only and supports flexbox but not grid. The repo's
 * component and token rules do not reach here because no CSS is loaded.
 */
export const alt = "Nymspace — ENS as the identity layer";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "#a1a1aa",
          }}
        >
          nymspace
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1 }}>
            ENS is the identity layer
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              lineHeight: 1.4,
              color: "#a1a1aa",
              maxWidth: 900,
            }}
          >
            Agent identity on ENSv2, discovery over live ERC 8004 data, and
            payments inside an enforced policy.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
