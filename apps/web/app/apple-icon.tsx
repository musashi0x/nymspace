import { ImageResponse } from "next/og";

/**
 * The home-screen icon iOS uses, generated rather than committed as a PNG.
 *
 * Same source of truth as `icon.svg` — one path, so the mark cannot drift
 * between the browser tab and the home screen. Next picks this file up by
 * convention and writes the `apple-touch-icon` link tag itself.
 *
 * Two things differ from `icon.svg` deliberately:
 *
 * The background is solid, not transparent. iOS composites a home-screen icon
 * onto whatever wallpaper is behind it, and a transparent PNG there renders as
 * a floating shape on an arbitrary photo. It also never honours
 * `prefers-color-scheme`, so the light/dark switch `icon.svg` relies on is not
 * available and one fixed pairing has to be chosen — dark ground, light mark,
 * which is the treatment the OG card already uses.
 *
 * The mark is inset rather than filling the square. iOS applies its own
 * rounded-rect mask, and a mark drawn to the edges loses its corners to it.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The same path as `app/icon.svg`, on that file's 32x32 viewBox. */
const MARK =
  "M6 2h20a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Zm10 8a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        {/*
          Inline SVG rather than an <img>: satori has no filesystem and no
          network here, so the path has to travel in the markup.
        */}
        <svg width="108" height="108" viewBox="0 0 32 32">
          <path fill="#fafafa" fillRule="evenodd" d={MARK} />
        </svg>
      </div>
    ),
    size,
  );
}
