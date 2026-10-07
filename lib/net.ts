/**
 * Raises Node's happy eyeballs per address attempt timeout.
 *
 * Node tries each resolved address in turn and abandons an attempt after
 * `autoSelectFamilyAttemptTimeout`, which defaults to 250ms. Neon's us-east-2
 * endpoint and the GenLayer studio RPC both sit about 270ms away from here, so
 * every connection was being abandoned a few milliseconds before it would have
 * succeeded. The symptom is not a slow connection, it is `fetch failed` or
 * ETIMEDOUT against an address that answers fine when dialled directly, which
 * reads like an outage rather than a local timeout.
 *
 * Importing this module for its side effect fixes it process wide. It is
 * imported by the database client, the worker and the standalone scripts.
 * Next.js picks it up through instrumentation.ts, which runs before the server
 * handles anything. The drizzle-kit CLI cannot be patched from here, so its npm
 * scripts pass the equivalent --network-family-autoselection-attempt-timeout.
 *
 * This only bounds how long one address gets before Node moves to the next, so
 * a generous value costs nothing when the first address works.
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

const ATTEMPT_TIMEOUT_MS = 5000;

let applied = false;

export function tuneNetworkTimeouts(): void {
  if (applied) return;
  applied = true;
  try {
    setDefaultAutoSelectFamilyAttemptTimeout(ATTEMPT_TIMEOUT_MS);
  } catch {
    // Older runtimes do not expose it. The default is then whatever Node sets.
  }
}

tuneNetworkTimeouts();
