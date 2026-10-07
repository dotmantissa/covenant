/**
 * Per user GenLayer keys, derived rather than stored.
 *
 * The product constraint is that a user signs in with an email address and
 * never sees a wallet, while the contracts enforce real `lender` and `borrower`
 * access control on real addresses. A single shared server key would satisfy
 * the first and destroy the second: every facility would have the same party on
 * both sides and the access control would be decoration.
 *
 * So each user gets their own key, derived with HKDF-SHA256 from a server held
 * master secret and their Privy DID. The key is recomputed in the route handler
 * that needs it, used to sign, and dropped. Nothing is persisted but the
 * resulting address, and nothing is ever sent to the browser.
 *
 * Two consequences worth stating plainly:
 *
 *  - SIGNER_MASTER_SECRET is load bearing forever. Rotating it derives a
 *    different address for every user, which would orphan every facility
 *    already on chain, because the registry would no longer recognise the
 *    caller as the lender or the borrower.
 *  - Custody is the server's. This is the right trade for a demo of covenant
 *    enforcement and the wrong one for custody of real money, where the user
 *    should hold the key and sign for themselves.
 *
 * studionet is gasless, so derived accounts never need funding.
 */
import { hkdfSync } from "node:crypto";
import { createAccount } from "genlayer-js";
import { signerMasterSecret } from "@/lib/env";

/** Order of the secp256k1 group. A private key must be in [1, n-1]. */
const SECP256K1_N = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);

/**
 * Bumping this derives a fresh address for every user, so it changes only if
 * the derivation itself ever has to change, and then deliberately.
 */
const DERIVATION_VERSION = "v1";

const SALT = "covenant/genlayer-signer";

export type DerivedAccount = {
  address: `0x${string}`;
  privateKey: `0x${string}`;
};

function masterKeyMaterial(): Buffer {
  const secret = signerMasterSecret();
  // A hex master secret is used as the bytes it encodes; anything else is used
  // as its UTF-8 bytes. Either way the full entropy reaches HKDF.
  return /^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0
    ? Buffer.from(secret, "hex")
    : Buffer.from(secret, "utf8");
}

/**
 * Derives the signing key for a Privy DID.
 *
 * HKDF output is uniform over 32 bytes, so it can in principle land on zero or
 * above the group order. The chance is about one in 2^128, but a key that is
 * out of range would throw deep inside the signer rather than here, so the
 * counter is advanced until the output is usable.
 */
export function deriveAccount(privyDid: string): DerivedAccount {
  if (!privyDid) throw new Error("cannot derive a key without a Privy DID");

  const ikm = masterKeyMaterial();
  for (let counter = 0; counter < 256; counter += 1) {
    const info = `covenant:genlayer-key:${DERIVATION_VERSION}:${privyDid}:${counter}`;
    const bytes = Buffer.from(hkdfSync("sha256", ikm, SALT, info, 32));
    const scalar = BigInt(`0x${bytes.toString("hex")}`);
    if (scalar === 0n || scalar >= SECP256K1_N) continue;

    const privateKey = `0x${bytes.toString("hex")}` as `0x${string}`;
    const account = createAccount(privateKey);
    return { address: account.address as `0x${string}`, privateKey };
  }
  // Unreachable short of a broken hash implementation.
  throw new Error(`could not derive a valid key for ${privyDid}`);
}

/** The address alone, for when no signing is needed. */
export function deriveAddress(privyDid: string): `0x${string}` {
  return deriveAccount(privyDid).address;
}
