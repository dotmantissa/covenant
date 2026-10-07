/**
 * Confirms the Privy app id and secret actually reach Privy.
 *
 * Run with `npm run check:privy`. Catches a typo or a secret from the wrong app
 * before the failure shows up as a sign-in that silently never completes.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import "../lib/net.ts";
import { PrivyClient } from "@privy-io/server-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
if (!appId || !appSecret) {
  throw new Error("NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET must both be set");
}

const privy = new PrivyClient(appId, appSecret);

const key = await privy.getVerificationKey();
console.log(`app id            ${appId}`);
console.log(`verification key  ${key.slice(0, 32).replace(/\n/g, " ")}...`);

const settings = await privy.getAppSettings();
console.log(`app name          ${settings.name ?? "(unnamed)"}`);
console.log("\ncredentials are valid");
