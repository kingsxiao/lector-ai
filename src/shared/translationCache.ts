// Translation result cache (pure, chrome-free).
//
// Caches translation results by a content hash of (strategy version + source +
// targetLang + model + glossary + persona) so a re-translation (page reload,
// same paragraph on another page) does NOT re-pay the provider. Persisted by the content script /
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

/** A deletion observed at a specific cache-entry timestamp. The timestamp is
 * a lightweight version: a delayed writer may remove that entry (or an older
 * snapshot), but must not delete a newer translation written meanwhile. */
export type CacheRemovalTombstones = ReadonlyMap<string, number>

/** Hard cap shared by normal inserts and read/merge/write persistence. */
export const MAX_CACHE_ENTRIES = 1000

/** Soft byte budget for the whole store (UTF-16 chars ≈ 2 bytes each; key +
 *  value counted). chrome.storage.local gives ~10MB total shared with the vocab
 *  queue and settings, so the cache self-trims well below that to keep quota
 *  errors — which would silently kill every subsequent write — off the table. */
export const MAX_CACHE_BYTES = 4_000_000

/** Bump whenever prompt semantics or output validation changes. Keeping it in
 * the key prevents an old source-language echo from surviving a quality fix. */
export const TRANSLATION_CACHE_VERSION = 'page-translation-v3'

/**
 * A tiny, dependency-free, synchronous string hash (two independent FNV-1a
 * 32-bit lanes, base36). We avoid window.crypto/subtle here because (a) the
 * content script's crypto.subtle is async and we want a sync key, and (b)
 * collision-safety is not security-sensitive — a rare collision just
 * re-translates a chunk. Two lanes give an effective ~64-bit key: with the
 * 1000-entry cap the birthday-collision probability (~n²/2⁶⁵) is negligible,
 * whereas a single 32-bit lane collided often enough to silently serve the
 * WRONG cached translation — the worst failure mode for a translator. Each
 * lane hashes every char so similar strings get distinct keys.
 */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x89abc141
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 ^= c
    // FNV prime (16777619) via Math.imul to keep it a 32-bit int.
    h1 = Math.imul(h1, 0x01000193)
    // Second lane: a different offset basis + a different prime (0x85ebca6b,
    // the murmur3 finalizer constant) so the two lanes decorrelate.
    h2 = Math.imul(h2 ^ c, 0x85ebca6b)
  }
  // Force unsigned, pad to a fixed width so concatenation is unambiguous.
  return (h1 >>> 0).toString(36).padStart(7, '0') + (h2 >>> 0).toString(36).padStart(7, '0')
}

/**
 * Hash the shared part of the cache key once per translation run. The
 * glossary/persona blocks can be several KB; folding them into the key for
 * every chunk re-hashed all of it per chunk (×2: hit check + write-back).
 * `cacheKeyWithPrefix` then only hashes the chunk's own source text.
 */
export function cacheKeyPrefix(
  targetLang: string,
  model: string,
  glossaryBlock: string,
  personaPrompt: string = ''
): string {
  return hashString(
    [TRANSLATION_CACHE_VERSION, targetLang, model, glossaryBlock, personaPrompt].join('\u0000')
  )
}

/** Complete the run-level prefix with a chunk's source text. */
export function cacheKeyWithPrefix(prefix: string, source: string): string {
  return hashString(prefix + '\u0000' + source)
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
  return cacheKeyWithPrefix(
    cacheKeyPrefix(targetLang, model, glossaryBlock, personaPrompt),
    source
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
  maxEntries = MAX_CACHE_ENTRIES
): CacheStore {
  return putEntries(store, [[key, value, sourceLen]], now, maxEntries)
}

/**
 * Batched insert for a translation run: one store copy + one trim for the
 * whole batch instead of two per chunk. Entries earlier in the list win on
 * duplicate keys (they were requested first; the run's own retries overwrite
 * them by passing the later one last).
 */
export function putEntries(
  store: CacheStore,
  entries: ReadonlyArray<readonly [key: string, value: string, sourceLen: number]>,
  now: number = Date.now(),
  maxEntries = MAX_CACHE_ENTRIES
): CacheStore {
  if (entries.length === 0) return store
  const next: CacheStore = { ...store }
  for (const [key, value, sourceLen] of entries) {
    next[key] = { v: value, t: now, n: Math.max(1, Math.ceil(sourceLen / 4)) }
  }
  return trimStore(next, maxEntries)
}

/** Rough byte footprint of the store (UTF-16 ≈ 2 bytes/char, key included). */
export function storeBytes(store: CacheStore): number {
  let bytes = 0
  for (const [k, e] of Object.entries(store)) bytes += (k.length + e.v.length) * 2
  return bytes
}

/**
 * Return a capped copy, evicting the oldest entries by their LRU timestamp.
 * Under both caps the input store is returned as-is: every caller either
 * passes a freshly-built object (putEntries/mergeCacheStores) or treats the
 * result as read-only, so the "new object" promise is only needed when the
 * store actually shrinks. This keeps the hot path (per-chunk insert under the
 * cap) from paying an O(entries) copy.
 */
export function trimStore(
  store: CacheStore,
  maxEntries: number = MAX_CACHE_ENTRIES,
  maxBytes: number = MAX_CACHE_BYTES
): CacheStore {
  const keys = Object.keys(store)
  let count = keys.length
  let bytes = storeBytes(store)
  if (count <= maxEntries && bytes <= maxBytes) return store
  const next: CacheStore = { ...store }
  // Evict oldest by t ascending until we are back under both caps.
  const sorted = keys.sort((a, b) => store[a].t - store[b].t)
  let i = 0
  while (i < sorted.length && (count > maxEntries || bytes > maxBytes)) {
    const k = sorted[i++]
    bytes -= (k.length + next[k].v.length) * 2
    delete next[k]
    count--
  }
  return next
}

/**
 * Merge a caller snapshot with the latest persisted cache.
 *
 * Content scripts in several tabs can save at different times. Blindly writing
 * an older page snapshot loses entries written by a manual retry or another
 * tab in the meantime. For the same key, the newest LRU/write timestamp wins;
 * disjoint keys are preserved. `removals` records expired/quality-invalid
 * entries with the timestamp observed when they were rejected. This prevents
 * stale snapshots from resurrecting them without letting an old delayed
 * tombstone erase a newer manual-retry/other-tab translation of the same key.
 */
export function mergeCacheStores(
  latest: CacheStore,
  incoming: CacheStore,
  removals: CacheRemovalTombstones = new Map(),
  maxEntries: number = MAX_CACHE_ENTRIES
): CacheStore {
  const merged: CacheStore = { ...latest }
  for (const [key, entry] of Object.entries(incoming)) {
    const current = merged[key]
    // On an exact timestamp tie prefer the value already in storage. This
    // prevents a delayed snapshot from replacing an equally recent write.
    if (!current || entry.t > current.t) merged[key] = entry
  }
  for (const [key, rejectedTimestamp] of removals) {
    const current = merged[key]
    if (current && current.t <= rejectedTimestamp) delete merged[key]
  }
  return trimStore(merged, maxEntries)
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
