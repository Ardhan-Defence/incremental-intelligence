/** Shared fetch helper — timeout + JSON convenience, nothing clever. */
export async function fetchJson<T = any>(url: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { Accept: 'application/json', ...opts.headers },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
