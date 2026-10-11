// Sliding-window rate limiter. In memory, so it protects a single server process; behind several
// instances use a shared store (see docs/DEPLOYMENT.md). The clock is injectable for tests.
type Bucket = number[];

export class RateLimiter {
  private hits = new Map<string, Bucket>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}

  // Returns true if the action is allowed (and records it), false if the limit is reached.
  take(key: string): boolean {
    const t = this.now();
    const fresh = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (fresh.length >= this.max) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(t);
    this.hits.set(key, fresh);
    if (this.hits.size > 10_000) this.prune(t);
    return true;
  }

  retryAfterSeconds(key: string): number {
    const bucket = this.hits.get(key) ?? [];
    if (bucket.length === 0) return 0;
    return Math.max(0, Math.ceil((bucket[0] + this.windowMs - this.now()) / 1000));
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}

// One process-wide limiter per purpose (survives hot reloads in development)
const g = globalThis as unknown as { __limiters?: Record<string, RateLimiter> };
export function limiter(name: string, max: number, windowMs: number): RateLimiter {
  g.__limiters ??= {};
  return (g.__limiters[name] ??= new RateLimiter(max, windowMs));
}
