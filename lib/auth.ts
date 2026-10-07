/**
 * Turns a request into the person making it, and the address they act as.
 *
 * Every API route starts here. The flow is: verify the Privy token, derive the
 * GenLayer address from the DID, and make sure a row exists tying the two to an
 * email. The row is a lookup table so a facility's counterparties can be named;
 * it is never consulted to decide what someone may do. Authority comes from the
 * address, and the contracts check it.
 */
import { eq, sql } from "drizzle-orm";
import { db, users, type User } from "@/lib/db";
import { identify, NotSignedIn } from "@/lib/privy";
import { deriveAddress } from "@/lib/signer";

export { NotSignedIn };

export type Actor = {
  privyDid: string;
  email: string;
  /** The GenLayer address this user signs as. */
  address: `0x${string}`;
  user: User;
};

/**
 * Authenticates the request and upserts the user row.
 *
 * Conflicts resolve on privy_did because that is the stable identity. An email
 * can be reassigned between Privy accounts, and the derived address follows the
 * DID, so the DID is the only safe key.
 */
export async function requireActor(request: Request): Promise<Actor> {
  const { privyDid, email } = await identify(request);
  const address = deriveAddress(privyDid);

  const [row] = await db()
    .insert(users)
    .values({ privyDid, email, genlayerAddress: address })
    .onConflictDoUpdate({
      target: users.privyDid,
      set: { email, genlayerAddress: address, lastSeenAt: sql`now()` },
    })
    .returning();

  if (!row) throw new Error("could not record the signed in user");
  return { privyDid, email, address, user: row };
}

/**
 * Returns the actor if a valid Privy token is provided, or null if unauthenticated.
 */
export async function optionalActor(request: Request): Promise<Actor | null> {
  try {
    return await requireActor(request);
  } catch (err) {
    if (err instanceof NotSignedIn) return null;
    throw err;
  }
}

/** Looks up who an address belongs to, for showing counterparties as people. */
export async function actorsByAddress(
  addressList: string[],
): Promise<Map<string, User>> {
  const wanted = [...new Set(addressList.map((a) => a.toLowerCase()))].filter(Boolean);
  if (wanted.length === 0) return new Map();

  const rows = await db()
    .select()
    .from(users)
    .where(sql`lower(${users.genlayerAddress}) = any(${wanted})`);

  return new Map(rows.map((row) => [row.genlayerAddress.toLowerCase(), row]));
}

/** Finds an existing user by email, for naming a borrower who has signed in. */
export async function userByEmail(email: string): Promise<User | undefined> {
  const [row] = await db()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return row;
}
