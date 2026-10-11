/** Crash boundaries are explicit and independently testable without a network or DB. */
export type JournalState = { signedTransaction: string | null; txHash: string | null };
export async function broadcastOnce<T>(
  current: JournalState,
  submit: (beforeBroadcast: (raw: string) => Promise<void>) => Promise<string>,
  replay: (raw: string) => Promise<string>,
  saveSigned: (raw: string) => Promise<void>,
  saveHash: (hash: string) => Promise<T>,
): Promise<T> {
  if (current.txHash) return saveHash(current.txHash);
  if (current.signedTransaction) return saveHash(await replay(current.signedTransaction));
  const hash = await submit(async raw => {
    if (current.signedTransaction && current.signedTransaction !== raw) throw new Error("refusing to replace an already signed transaction");
    await saveSigned(raw); // MUST complete before the SDK is allowed to broadcast.
    current.signedTransaction = raw;
  });
  return saveHash(hash);
}
