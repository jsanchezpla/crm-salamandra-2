const TTL_MS = 60 * 1000; // 60 segundos

// Map<key, { value, expiresAt }>
const cache = new Map();

export function cacheSet(key, value, ttlMs = TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheInvalidate(key) {
  cache.delete(key);
}

export function cacheStats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  for (const entry of cache.values()) {
    now > entry.expiresAt ? expired++ : active++;
  }
  return { active, expired, total: cache.size };
}
