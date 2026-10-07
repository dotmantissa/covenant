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

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg =
      (data as { error?: string }).error || `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  return data as T;
}
