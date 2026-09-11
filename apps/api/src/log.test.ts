import { describe, expect, it } from "vitest";
import { createLog, errorFields, levelFor, type LogFields } from "./log";

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => void lines.push(line) };
}

describe("a log line", () => {
  it("is one JSON object, with level, message and the bound fields first", () => {
    const { lines, sink } = capture();
    createLog(sink, { requestId: "r1" }).info("hello", { status: 200 });

    expect(lines).toHaveLength(1);
    expect(Object.keys(JSON.parse(lines[0]!))).toEqual([
      "level",
      "message",
      "requestId",
      "status",
    ]);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: "info",
      message: "hello",
      requestId: "r1",
      status: 200,
    });
  });

  // A stack trace is the value most likely to carry a newline, and a line
  // Railway splits in two is a line it cannot parse.
  it("stays on one line when a value holds a newline or a quote", () => {
    const { lines, sink } = capture();
    const stack = 'Error: "boom"\n    at somewhere (file.ts:1:1)';
    createLog(sink).error("unhandled Error", { stack });

    expect(lines[0]).not.toContain("\n");
    expect(JSON.parse(lines[0]!).stack).toBe(stack);
  });

  it("does not let a caller's fields overwrite level, message or a bound field", () => {
    const { lines, sink } = capture();
    createLog(sink, { requestId: "r1" }).info("mine", {
      level: "debug",
      message: "theirs",
      requestId: "r2",
      extra: true,
    });

    expect(JSON.parse(lines[0]!)).toEqual({
      level: "info",
      message: "mine",
      requestId: "r1",
      extra: true,
    });
  });

  it("drops undefined fields and keeps ones named like Object.prototype members", () => {
    const { lines, sink } = capture();
    createLog(sink).warn("m", { absent: undefined, toString: "kept" });

    expect(JSON.parse(lines[0]!)).toEqual({ level: "warn", message: "m", toString: "kept" });
  });

  it("refuses nested values at compile time", () => {
    // @ts-expect-error a nested object is not a log field
    const nested: LogFields = { error: { name: "x" } };
    // @ts-expect-error an array is not a log field
    const list: LogFields = { tags: ["a"] };
    expect([nested, list]).toHaveLength(2);
  });
});

describe("errorFields", () => {
  it("carries an Error's name, message and stack", () => {
    const error = new TypeError("bad");
    expect(errorFields(error)).toEqual({
      errorName: "TypeError",
      errorMessage: "bad",
      stack: error.stack,
    });
  });

  it("describes a thrown non-Error without losing it", () => {
    expect(errorFields("just a string")).toEqual({
      errorName: "string",
      errorMessage: "just a string",
    });
  });
});

describe("levelFor", () => {
  it("maps 5xx to error, 4xx to warn, and the rest to info", () => {
    expect(levelFor("GET", "/v1/agents", 502)).toBe("error");
    expect(levelFor("GET", "/v1/agents", 404)).toBe("warn");
    expect(levelFor("POST", "/v1/agents", 202)).toBe("info");
  });

  it("logs a successful liveness check at debug, and a failing one by its status", () => {
    expect(levelFor("GET", "/health", 200)).toBe("debug");
    expect(levelFor("GET", "/health", 503)).toBe("error");
    expect(levelFor("OPTIONS", "/health", 204)).toBe("info");
  });
});
