import { waitForIntent, type PendingIntent } from "@/lib/client-transactions";
/**
 * Client-side fetch helper that attaches Privy auth tokens and unwraps API responses.
 */

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (
    !headers.has("Content-Type") &&
    options.body &&
    typeof options.body === "string"
  ) {
    headers.set("Content-Type", "application/json");
  }

  const isWrite=(options.method??"GET").toUpperCase()==="POST" && url.startsWith("/api/facilities");
  const storageKey=`covenant:request:${url}:${typeof options.body==='string'?options.body:''}`;
  if(isWrite && !headers.has("Idempotency-Key")) {
    const key=typeof window!=="undefined"?localStorage.getItem(storageKey):null;
    const requestKey=key??crypto.randomUUID();
    headers.set("Idempotency-Key",requestKey);
    if(typeof window!=="undefined")localStorage.setItem(storageKey,requestKey);
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg =
      (data as { error?: string }).error || `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  if(isWrite && 'intentId' in data) {
    const result=await waitForIntent<T>(data as PendingIntent,token);
    if(typeof window!=="undefined")localStorage.removeItem(storageKey);
    return result;
  }
  return data as T;
}
