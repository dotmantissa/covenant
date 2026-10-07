/**
 * Runs before any server code handles a request.
 *
 * Tunes Node happy eyeballs network timeouts so connections to Neon and
 * GenLayer RPC do not time out prematurely.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { tuneNetworkTimeouts } = await import("@/lib/net");
    tuneNetworkTimeouts();
  }
}
