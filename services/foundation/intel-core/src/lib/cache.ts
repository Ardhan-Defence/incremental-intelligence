/**
 * In-memory TTL cache with request coalescing. The original app reimplemented
 * this per-route (flights, satellites) with copy-pasted module-level
 * `cachedData`/`fetchPromise` variables — pulled out once here so every
 * source gets coalescing without re-deriving it.
 *
 * NOTE: process-local, same caveat the original code called out — fine for a
 * single instance, not a shared cache across horizontally scaled replicas.
 * Swap for Redis/KV if this service runs more than one instance.
 */
export class TtlCache<T> {
  private data: T | null = null;
  private fetchedAt = 0;
  private pending: Promise<T> | null = null;

  constructor(private ttlMs: number) {}

  async get(producer: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.data !== null && now - this.fetchedAt < this.ttlMs) {
      return this.data;
    }
    if (this.pending) return this.pending;

    this.pending = producer()
      .then((result) => {
        this.data = result;
        this.fetchedAt = Date.now();
        return result;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }
}
