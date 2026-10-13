// Small in-process cache with TTL and tag-based invalidation, used for expensive read models (yield, scorecards, home aggregates).
// Keys must include everything the result depends on (role, scope, date…) so one person's data is never served to another.
// A shared (Redis/Upstash) backend replaces `store` in Phase 5 without changing callers.
type Entry = { at: number; ttl: number; tags: string[]; value: unknown };
const g = globalThis as unknown as { _vssCache?: { store: Map<string, Entry>; inflight: Map<string, Promise<unknown>>; hits: number; misses: number } };
const c = (g._vssCache ??= { store: new Map(), inflight: new Map(), hits: 0, misses: 0 });
const MAX = 500;

export async function cached<T>(key: string, ttlMs: number, tags: string[], fn: () => Promise<T>): Promise<T> {
  const e = c.store.get(key);
  if (e && Date.now() - e.at < e.ttl) { c.hits++; return e.value as T; }
  const running = c.inflight.get(key);
  if (running) return running as Promise<T>; // de-dupe concurrent identical requests
  c.misses++;
  const p = fn()
    .then((value) => {
      if (c.store.size >= MAX) c.store.delete(c.store.keys().next().value as string);
      c.store.set(key, { at: Date.now(), ttl: ttlMs, tags, value });
      return value;
    })
    .finally(() => c.inflight.delete(key));
  c.inflight.set(key, p);
  return p;
}

export function invalidate(...tags: string[]) {
  for (const [k, e] of c.store) if (e.tags.some((t: string) => tags.includes(t))) c.store.delete(k);
}
export const cacheStats = () => ({ size: c.store.size, hits: c.hits, misses: c.misses });
export function clearCache() { c.store.clear(); c.inflight.clear(); }
