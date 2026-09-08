/**
 * Commit activity for the landing page's verifiable build log.
 *
 * It lives in a package rather than in either application because both consume
 * it: the Next page server-renders from it, and the API serves it as JSON at
 * `/v1/activity`. The monorepo-workspace requirement "A server application owns
 * no domain logic" is what forced the move — a copy in each app is exactly the
 * drift the packages exist to prevent.
 *
 * The guard is inherited from `github.ts`, which reads `GITHUB_TOKEN`. Types
 * are re-exported from here too, so a client component can import
 * `ActivityPayload` without pulling the guarded module into its bundle — a type
 * import is erased at compile time.
 */

export * from "./github";
