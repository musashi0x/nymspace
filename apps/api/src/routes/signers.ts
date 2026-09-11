import { Hono } from "hono";
import type { DepsEnv } from "../deps";
import { readAt } from "./shared";

/**
 * The two accounts this deployment signs with, as addresses.
 *
 * Addresses only, and that is not a redaction: both are derived from private
 * keys the API process holds, and an address is public by construction — it is
 * on every transaction the account has ever sent. The keys stay in `deps` and
 * have no route.
 *
 * ## Why it exists
 *
 * The create-agent screen asks for a controller address, and exactly one value
 * works: the address of `ENSV2_AGENT_CONTROLLER_PRIVATE_KEY`. Provisioning
 * grants record keys to whatever the form sends, but the record write is always
 * signed by that key (`actor: "controller"` in `routes/chat.ts`). Send a
 * different address and the grants land on an account that never signs, so
 * `canSetText` reports every key denied and the console shows a permission
 * matrix of refusals. That reads as a permissions bug and is a typo.
 *
 * Serving the address is what makes the screen unable to ask the wrong
 * question. The alternative — validating the submitted address against
 * `deps.controller` — rejects the mistake but still invites it.
 */
export const signers = new Hono<DepsEnv>().get("/", (c) => {
  const { organization, controller } = c.var.deps;

  return c.json({
    organization,
    controller,
    readAt: readAt(),
  });
});
