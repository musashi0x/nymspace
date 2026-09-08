import { NextResponse } from "next/server";
import { getActivity, REVALIDATE_SECONDS } from "@/lib/github";

export const revalidate = 60;

/**
 * The same payload the landing page renders, exposed as raw JSON so anyone can
 * diff what the page claims against what GitHub actually returns.
 */
export async function GET() {
  const data = await getActivity();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=60`,
    },
  });
}
