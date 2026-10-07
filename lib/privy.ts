/**
 * Privy on the server: verifying that a request really comes from a signed in
 * user, and finding the email address behind a DID.
 *
 * Privy is used here purely as an email identity provider. It issues no wallet
 * this app uses and signs nothing on chain; the GenLayer key is derived from the
 * DID in lib/signer.ts. That keeps the sign-in flow to one email code and keeps
 * every chain write server side.
 */
import "@/lib/net";
import { PrivyClient } from "@privy-io/server-auth";
import { privyAppId, privyAppSecret } from "@/lib/env";

let cached: PrivyClient | undefined;

export function privy(): PrivyClient {
  if (!cached) cached = new PrivyClient(privyAppId(), privyAppSecret());
  return cached;
}

export class NotSignedIn extends Error {
  constructor(message = "sign in to continue") {
    super(message);
    this.name = "NotSignedIn";
  }
}

/** Pulls the bearer token off a request. */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export type Identity = { privyDid: string; email: string };

/**
 * Verifies the access token and resolves the email behind it.
 *
 * The signature check is local, against Privy's published verification key, so
 * it costs no round trip. Reading the email does cost one, and it is worth it:
 * the token carries only the DID, and a console that shows a counterparty as a
 * DID is not showing a person.
 */
export async function identify(request: Request): Promise<Identity> {
  const token = bearerToken(request);
  if (!token) throw new NotSignedIn("no access token on the request");

  let claims;
  try {
    claims = await privy().verifyAuthToken(token);
  } catch {
    // Expired and forged tokens are the same thing from here: not signed in.
    throw new NotSignedIn("that session is no longer valid, sign in again");
  }

  const privyDid = claims.userId;
  if (!privyDid) throw new NotSignedIn("the access token carries no user id");

  const user = await privy().getUser(privyDid);
  const email =
    user.email?.address ??
    user.linkedAccounts.find(
      (account): account is typeof account & { address: string } =>
        account.type === "email" && "address" in account,
    )?.address;

  if (!email) {
    throw new NotSignedIn(
      "this account has no email address linked, so it cannot be a party to a facility",
    );
  }
  return { privyDid, email: email.toLowerCase() };
}
