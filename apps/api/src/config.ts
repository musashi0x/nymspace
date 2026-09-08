/**
 * Configuration local to the API process. Everything shared with the web app
 * lives in `@nymspace/core`; only the values that describe *this* server are
 * read here.
 */

function requireOne(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface ApiConfig {
  port: number;
  /** Origins allowed to call this API from a browser. */
  allowedOrigins: string[];
}

export function apiConfig(): ApiConfig {
  const port = Number(process.env.API_PORT ?? 3112);
  if (!Number.isSafeInteger(port) || port <= 0) {
    throw new Error(`API_PORT must be a positive integer, got: ${port}`);
  }

  return {
    port,
    allowedOrigins: requireOne("WEB_ORIGIN")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
}
