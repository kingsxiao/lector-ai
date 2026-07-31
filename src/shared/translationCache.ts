// Translation result cache (pure, chrome-free).
//
// Caches translation results by a content hash of (source + targetLang + model
// + glossaryHash) so a re-translation (page reload, same paragraph on another
// page) does NOT re-pay the provider. Persisted by the content script /
// background into chrome.storage.local under `lectorCache`; this module owns
// only the pure logic (keying, TTL, LRU trim, serialization, hit/miss).
//
// BYOK-privacy note (surpass-feature): the cache is strictly local — it never
// leaves the browser, unlike a cloud-synced cache. The user can clear it and
// sees a saved-cost estimate (tokens × model pricing) surfaced in settings.

export interface CacheEntry {
  /** Cached translation output. */
  v: string
  /** Unix ms timestamp the entry was written. */
  t: number
  /** Approx source token count, for the saved-cost estimate. */
  n: number
}

export interface CacheStore {
  [key: string]: CacheEntry
}

/**
 * A tiny, dependency-free, synchronous string hash (FNV-1a 32-bit, base36).
 * We avoid window.crypto/subtle here because (a) the content script's
 * crypto.subtle is async and we want a sync key, and (b) collision-safety is
 * not security-sensitive — a rare collision just re-translates a chunk. The
 * hash mixes every char so similar strings (same prefix, different tail) get
 * distinct keys.
 */
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // FNV prime (16777619) via Math.imul to keep it a 32-bit int.
    h = Math.imul(h, 0x01000193)
  }
  // Force unsigned then base36.
  return (h >>> 0).toString(36)
}

/**
 * Build the cache key. Everything that affects the translation output must be
 * part of the key, so a settings change (different target language, different
 * model, different glossary, different persona) correctly invalidates stale
 * entries. The persona prompt text is folded in so switching "Academic" →
 * "Colloquial" does not return the old academic translation.
 */
export function cacheKey(
  source: string,
  targetLang: string,
  model: string,
  glossaryBlock: string,
  personaPrompt: string = ''
): string {
  return hashString(
    [targetLang, model, glossaryBlock, personaPrompt, source].join('\u0000')
  )
}

/** Rough token estimate (chars / 4) for the saved-cost readout. Good enough
 *  for an "approximately saved $" display; not used for billing. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/** Has the entry expired given a TTL in days (0 = cache disabled)? */
export function isExpired(entry: CacheEntry, ttlDays: number, now: number = Date.now()): boolean {
  if (ttlDays <= 0) return true
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000
  return now - entry.t > ttlMs
}

/**
 * Insert/refresh an entry and return a new store. LRU is enforced by a cap on
 * the total number of entries (default 1000); when exceeded, the OLDEST
 * entries (by write time `t`) are dropped. This is pure — it does not mutate
 * the input store.
 */
export function putEntry(
  store: CacheStore,
  key: string,
  value: string,
  sourceLen: number,
  now: number = Date.now(),
  maxEntries = 1000
): CacheStore {
  const next: CacheStore = { ...store, [key]: { v: value, t: now, n: estimateTokens('x'.repeat(sourceLen)) } }
  const keys = Object.keys(next)
  if (keys.length <= maxEntries) return next
  // Evict oldest by t ascending until we are back under the cap.
  keys
    .sort((a, b) => next[a].t - next[b].t)
    .slice(0, keys.length - maxEntries)
    .forEach((k) => delete next[k])
  return next
}

/**
 * Read with TTL + LRU touch. Returns the value if present & fresh, else null.
 * "Touch" means: on a hit, refresh the entry's `t` so frequently-used
 * translations survive LRU eviction (true LRU semantics). Returns the store
 * too (it may be a new object if touched) so the caller can persist it.
 */
export function getEntry(
  store: CacheStore,
  key: string,
  ttlDays: number,
  now: number = Date.now()
): { value: string | null; store: CacheStore } {
  const e = store[key]
  if (!e || isExpired(e, ttlDays, now)) {
    // Drop a stale entry while we're here so the store self-cleans over time.
    if (e) {
      const cleaned = { ...store }
      delete cleaned[key]
      return { value: null, store: cleaned }
    }
    return { value: null, store }
  }
  // Touch the entry's recency.
  const touched = { ...e, t: now }
  return { value: e.v, store: { ...store, [key]: touched } }
}

/** Remove all expired entries; returns a new (possibly smaller) store. */
export function gcStore(store: CacheStore, ttlDays: number, now: number = Date.now()): CacheStore {
  const next: CacheStore = {}
  for (const [k, e] of Object.entries(store)) {
    if (!isExpired(e, ttlDays, now)) next[k] = e
  }
  return next
}

/** Total cached source-token count, for the saved-cost readout. */
export function totalSavedTokens(store: CacheStore): number {
  let n = 0
  for (const e of Object.values(store)) n += e.n || 0
  return n
}

/**
 * Rough USD saved estimate: tokens × price-per-1M-tokens / 1e6. Falls back to
 * a conservative $2/1M when no price is known (typical cheap-model input
 * price). Purely informational.
 */
export function estimateSavedUsd(store: CacheStore, pricePer1m: number = 2): number {
  return (totalSavedTokens(store) * pricePer1m) / 1_000_000
}

/** Serialize / parse the store for chrome.storage round-trips. */
export function serializeStore(store: CacheStore): string {
  return JSON.stringify(store)
}
export function parseStore(raw: unknown): CacheStore {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const out: CacheStore = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      const e = v as Partial<CacheEntry>
      if (typeof e.v === 'string' && typeof e.t === 'number') {
        out[k] = { v: e.v, t: e.t, n: typeof e.n === 'number' ? e.n : estimateTokens(e.v) }
      }
    }
  }
  return out
}
