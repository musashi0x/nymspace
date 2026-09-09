import "server-only";

/**
 * Is this user agent a program rather than a person?
 *
 * A substring list, not a library, and deliberately conservative. The number
 * this feeds is on a page whose entire argument is that displayed values are
 * checkable, so the failure to avoid is over-claiming: a filter that quietly
 * dropped real readers to make the excluded count look impressive would be the
 * same class of error as rendering a fabricated total.
 *
 * So the rule is: match only agents that *say* they are automated. Every entry
 * below is a token a client puts in its own user agent voluntarily. There is
 * no heuristic on request timing, no IP reputation, no header fingerprinting —
 * those catch more bots and also catch people.
 *
 * What this therefore does not catch, stated rather than hidden: a headless
 * browser with a spoofed agent string is counted as a person, and always will
 * be. `docs/22` says the visitor count is a lower bound on nothing and an upper
 * bound on people, which is the honest reading of that.
 */
const BOT_TOKENS = [
  // Self-identified crawlers and the "bot" family.
  "bot",
  "crawler",
  "crawling",
  "spider",
  "slurp",
  "archiver",
  "scraper",
  // Headless and automation runtimes.
  "headless",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
  "lighthouse",
  "pagespeed",
  // Command-line and library clients. Anything using these is not reading.
  "curl",
  "wget",
  "python-requests",
  "python-urllib",
  "go-http-client",
  "node-fetch",
  "axios",
  "okhttp",
  "java/",
  "libwww-perl",
  "httpie",
  // Link unfurlers. A preview card is not a reader, and one link pasted into a
  // group chat can produce a dozen of these.
  "facebookexternalhit",
  "twitterbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "linkedinbot",
  "embedly",
  "quora link preview",
  "skypeuripreview",
  // Uptime and monitoring.
  "pingdom",
  "uptimerobot",
  "statuscake",
  "datadog",
  "newrelic",
] as const;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) {
    // No user agent at all is not a browser. Every real one sends the header,
    // so an absent one is a script that did not bother — which is exactly the
    // thing being excluded.
    return true;
  }

  const agent = userAgent.toLowerCase();
  return BOT_TOKENS.some((token) => agent.includes(token));
}
