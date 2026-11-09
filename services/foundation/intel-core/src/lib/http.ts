/** Shared fetch helpers — timeout + JSON/text convenience, nothing clever. */

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
}

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: opts.method,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { Accept: 'application/json', ...opts.headers },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: opts.method,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: opts.headers,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Runs a list of async producers in parallel and keeps only the fulfilled ones. */
export async function settleAll<T>(tasks: Array<Promise<T>>): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const out: T[] = [];
  for (const r of results) if (r.status === 'fulfilled' && r.value != null) out.push(r.value);
  return out;
}
