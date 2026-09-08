import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The workspace packages ship TypeScript source rather than build output, so
   * Next compiles them itself. A package missing from this list surfaces as a
   * parse error inside `node_modules`, not as a clear message — so all four are
   * listed from the start, including the ones that are still shells.
   */
  transpilePackages: [
    "@nymspace/core",
    "@nymspace/ens",
    "@nymspace/graph",
    "@nymspace/privy",
  ],
};

export default nextConfig;
