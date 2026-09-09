import { describe, expect, it } from "vitest";
import { isBotUserAgent } from "./bots";

/**
 * The classifier decides which requests reach the number on the landing page,
 * so both directions matter. Missing a bot overstates readership; matching a
 * browser understates it while looking like a working filter.
 */
describe("isBotUserAgent", () => {
  it("matches agents that declare themselves automated", () => {
    for (const agent of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "node-fetch/1.0",
      "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 (compatible; UptimeRobot/2.0)",
    ]) {
      expect(isBotUserAgent(agent), agent).toBe(true);
    }
  });

  it("does not match real browsers", () => {
    for (const agent of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ]) {
      expect(isBotUserAgent(agent), agent).toBe(false);
    }
  });

  it("treats a missing agent as automated", () => {
    // Every real browser sends the header. An absent one is a script that did
    // not bother, which is exactly what is being excluded.
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
  });
});
