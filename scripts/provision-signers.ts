/**
 * Split the wallet's authority: the organization owns it, the agent signs
 * within a policy.
 *
 * Run: pnpm provision:signers
 *      pnpm provision:signers --create-keys      (first time only)
 *
 * Until this runs, the cap is attached to the *wallet*, so "the agent cannot
 * spend more than this" is really "the application configured itself a limit".
 * Privy evaluates only the acting signer's override policy, so moving the cap
 * onto the agent's key makes the sentence literally true — and makes two other
 * things true with it: the agent cannot reconfigure itself, because changing a
 * signer is a wallet update and wallet updates need the owner; and the owner's
 * key can execute what the agent's key was refused, which is what turns an
 * approval affordance from a claim into a mechanism.
 *
 * This is a one-way door in practice. Once the wallet has an owner, every
 * request against it must be signed, and an unsigned caller that used to work
 * stops working. That is the intended outcome — an unsigned request carries no
 * authority and should carry none — but it is why this is its own script rather
 * than a step inside `provision:wallet`.
 */

import { generateKeyPairSync } from "node:crypto";
import { requireServerEnv, serverEnv } from "@nymspace/core/env";
import { formatAmount } from "@nymspace/core";
import {
  PrivyClient,
  agentSignerKey,
  demoToken,
  ownerSignerKey,
  toBaseUnits,
  type AuthorizationKey,
} from "@nymspace/privy";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";

const AGENT_DB_ID = "agent-research";

/**
 * The owner's own ceiling.
 *
 * Not "no policy at all": a wallet with an unconstrained signer is one leaked
 * key away from everything, and the owner key lives on the same server. A
 * hundred times the agent's cap is high enough that the escalation demonstrably
 * executes what the agent could not, and low enough that the blast radius is a
 * number rather than the balance.
 */
const OWNER_LIMIT_UNITS = "1000";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

/**
 * A P-256 keypair, generated here and registered with Privy by its public half.
 *
 * The private half is printed once and never stored by this script. That is the
 * only moment it exists outside the operator's environment file, and it is
 * printed rather than written because a script that edits `.env` is a script
 * that can overwrite a key that is still in use.
 */
function generateAuthorizationKey(): { privateKey: string; publicKeyDer: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKey: `wallet-auth:${privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64")}`,
    publicKeyDer: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

async function main(): Promise<void> {
  const createKeys = process.argv.includes("--create-keys");
  requireServerEnv(["PRIVY_APP_SECRET"] as const);

  const token = demoToken();
  const app = new PrivyClient();
  const db = database();
  await migrate(db);
  const store = new Store(db);

  const ref = await store.getFinancialAuthority(AGENT_DB_ID);
  if (!ref?.policyId) {
    throw new Error(
      `No wallet for ${AGENT_DB_ID}. Run \`pnpm provision:wallet\` first.`,
    );
  }

  //////////////////////////////////////////////////////////////////////////
  // The two keys
  //////////////////////////////////////////////////////////////////////////

  /**
   * The agent key already exists — it is `PRIVY_AUTHORIZATION_*`, which the
   * app has held all along. What changes is its meaning: it stops being "the
   * application's key" and becomes the key whose authority is capped.
   */
  const agentKey: AuthorizationKey = agentSignerKey();
  let owner = ownerSignerKey();

  if (!owner) {
    if (!createKeys) {
      throw new Error(
        "PRIVY_OWNER_KEY_ID and PRIVY_OWNER_PRIVATE_KEY are not set, so there is no " +
          "authority above the agent. Re-run with --create-keys to generate one, or " +
          "set them from a key you already hold.",
      );
    }

    const generated = generateAuthorizationKey();
    const quorum = await app.createKeyQuorum({
      displayName: "nymspace organization owner",
      publicKeyDer: generated.publicKeyDer,
    });

    console.log("\n  A new owner key was generated. It is printed once.\n");
    console.log(`  PRIVY_OWNER_KEY_ID=${quorum.id}`);
    console.log(`  PRIVY_OWNER_PRIVATE_KEY=${generated.privateKey}\n`);
    console.log(
      "  Put both in .env before continuing — without the private half the wallet\n" +
        "  has an owner nobody can act as, and the escalation path is unreachable.\n",
    );

    owner = { keyId: quorum.id, privateKey: generated.privateKey };
  }

  /**
   * The agent's key needs a quorum id of its own to be named as a signer.
   *
   * `PRIVY_AUTHORIZATION_KEY_ID` already is one if the key came from the
   * dashboard; if it does not resolve, the operator is told rather than having
   * a second key quietly generated under the same name.
   */
  const agentSignerId = serverEnv().privy.agentSignerId ?? agentKey.keyId;

  //////////////////////////////////////////////////////////////////////////
  // The owner's policy, and the agent's
  //////////////////////////////////////////////////////////////////////////

  const agentLimit = await app.getPolicyLimit(ref.policyId);

  let ownerPolicyId = serverEnv().privy.ownerPolicyId;
  if (!ownerPolicyId) {
    const ownerLimit = token
      ? await app.createTokenPolicy({
          name: "nymspace organization owner ceiling",
          token,
          maxAmount: toBaseUnits(OWNER_LIMIT_UNITS, token),
        })
      : await app.createAmountPolicy({
          name: "nymspace organization owner ceiling",
          maxValueWei: toBaseUnits(OWNER_LIMIT_UNITS, null),
        });
    ownerPolicyId = ownerLimit.policyId;
    console.log(`  PRIVY_OWNER_POLICY_ID=${ownerPolicyId}\n`);
  }

  //////////////////////////////////////////////////////////////////////////
  // Attach both to the wallet
  //////////////////////////////////////////////////////////////////////////

  const wallet = await app.setWalletSigners(ref.privyWalletId, {
    ownerId: owner.keyId,
    additionalSigners: [
      { signerId: agentSignerId, overridePolicyIds: [ref.policyId] },
      { signerId: owner.keyId, overridePolicyIds: [ownerPolicyId] },
    ],
  });

  const agentSigner = wallet.additionalSigners.find(
    (signer) => signer.signerId === agentSignerId,
  );

  console.log(`  wallet     ${wallet.address}`);
  console.log(`  owner      ${wallet.ownerId ?? "(none)"}`);
  console.log(
    `  agent      ${agentSignerId} capped at ${formatAmount(agentLimit.maxAmount, agentLimit.token)}`,
  );
  console.log(
    `  attached   ${agentSigner ? agentSigner.overridePolicyIds.join(", ") : "(the agent is not a signer)"}\n`,
  );

  const ok =
    wallet.ownerId === owner.keyId &&
    agentSigner?.overridePolicyIds.includes(ref.policyId) === true;

  console.log(
    ok
      ? "The cap is now on the agent's key. Run `pnpm --filter @nymspace/privy verify:policy`."
      : "The wallet did not come back configured as requested — do not run the gate against it.",
  );

  if (!ok) process.exitCode = 1;
  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error(`signer provisioning failed: ${messageOf(error)}`);
  process.exitCode = 1;
  await closeDatabase().catch(() => {});
});
