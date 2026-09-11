import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";

/**
 * The process log.
 *
 * One JSON object per line, flat, written to stdout. Railway parses a line in
 * that shape into its log explorer: `message` is what it shows, `level` is the
 * severity, and every other key becomes an attribute to filter on
 * (`@requestId:…`, `@status:>=500`). JSON spread across lines, or an object
 * nested inside one, is not parsed that way, which is why both are ruled out
 * below by type and by `JSON.stringify` rather than by convention.
 *
 * `docs/22_DEPLOYMENT.md` says how to search it.
 */

/**
 * Every value a line may carry.
 *
 * Primitives only, so a nested object or an array is a compile error rather
 * than a line Railway shows as one opaque string. `undefined` is allowed so a
 * caller can pass an optional value without a conditional spread;
 * `JSON.stringify` drops it.
 */
export type LogFields = Record<string, string | number | boolean | undefined>;

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Where finished lines go. Injected so a test reads lines instead of spying on `console`. */
export type Sink = (line: string) => void;

/**
 * The default sink. Everything goes to stdout, errors included: `level`
 * carries severity, and one stream keeps lines in the order they were written.
 */
export const stdoutSink: Sink = (line) => {
  process.stdout.write(`${line}\n`);
};

export interface Log {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/**
 * A logger whose every line carries `bound`.
 *
 * `level`, `message` and the bound fields are written first and a caller's
 * fields cannot overwrite them: a handler passing its own `requestId` would
 * otherwise detach its line from the request it belongs to.
 */
export function createLog(sink: Sink, bound: LogFields = {}): Log {
  const write =
    (level: LogLevel) =>
    (message: string, fields: LogFields = {}) => {
      const line: LogFields = { level, message, ...bound };
      for (const [key, value] of Object.entries(fields)) {
        if (!Object.hasOwn(line, key)) line[key] = value;
      }
      sink(JSON.stringify(line));
    };

  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
  };
}

/**
 * An error as log fields.
 *
 * The stack is a string with newlines in it. `JSON.stringify` escapes them, so
 * it stays one line and one Railway entry.
 */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorName: typeof error, errorMessage: String(error) };
}

/** What `requestId()` and {@link requestLogger} add to every request's context. */
export type LogVariables = { log: Log } & RequestIdVariables;

/**
 * One line per request, written once the response exists.
 *
 * After `await next()` Hono has already run `onError` for a thrown error and
 * set the response it returned, so a request that threw is logged with the 500
 * it answered. That is Hono's compose behaviour, pinned by a test in
 * `app.test.ts` rather than assumed here.
 *
 * `path` is `c.req.path`, which has no query string. Today's queries are
 * activity filters, but a query parameter is where a future identifier would
 * travel, and a log line should not start carrying one without a decision.
 *
 * Must run after `requestId()`, whose id it binds into `c.var.log`.
 */
export function requestLogger(sink: Sink) {
  return createMiddleware<{ Variables: LogVariables }>(async (c, next) => {
    const log = createLog(sink, { requestId: c.var.requestId });
    c.set("log", log);
    const started = performance.now();

    await next();

    const { method, path } = c.req;
    const status = c.res.status;
    log[levelFor(method, path, status)](`${method} ${path} ${status}`, {
      method,
      path,
      status,
      durationMs: Math.round(performance.now() - started),
    });
  });
}

/**
 * 5xx is an error and 4xx a warning. A successful liveness check is `debug`:
 * Railway polls it through every deploy, so those lines are noise until a
 * deploy fails, and then they are the evidence.
 */
export function levelFor(method: string, path: string, status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  if (method === "GET" && path === "/health") return "debug";
  return "info";
}
