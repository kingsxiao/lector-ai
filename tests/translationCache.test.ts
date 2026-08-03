import { describe, it, expect } from 'vitest'
import {
  hashString,
  cacheKey,
  TRANSLATION_CACHE_VERSION,
  estimateTokens,
  isExpired,
  putEntry,
  trimStore,
  mergeCacheStores,
  getEntry,
  gcStore,
  totalSavedTokens,
  estimateSavedUsd,
  serializeStore,
  parseStore,
  type CacheStore,
} from '../src/shared/translationCache'

describe('hashString', () => {
  it('is deterministic for the same input', () => {
    expect(hashString('hello world')).toBe(hashString('hello world'))
  })
  it('differs for different input', () => {
    expect(hashString('hello world')).not.toBe(hashString('hello world!'))
  })
  it('distinguishes same-prefix strings', () => {
    expect(hashString('translate me please part1')).not.toBe(hashString('translate me please part2'))
  })
  it('returns a base36-ish string', () => {
    expect(hashString('x')).toMatch(/^[0-9a-z]+$/)
  })
})

describe('cacheKey', () => {
  it('includes the translation strategy version so legacy outputs are invalidated', () => {
    const source = 'Built by'
    const target = 'zh'
    const model = 'm'
    const glossary = ''
    const persona = ''
    const legacyKey = hashString(
      [target, model, glossary, persona, source].join('\u0000')
    )

    expect(TRANSLATION_CACHE_VERSION).toBe('page-translation-v3')
    expect(cacheKey(source, target, model, glossary, persona)).not.toBe(legacyKey)
  })
  it('changes when targetLang changes', () => {
    expect(cacheKey('hi', 'zh', 'gpt-4o', '')).not.toBe(cacheKey('hi', 'en', 'gpt-4o', ''))
  })
  it('changes when model changes', () => {
    expect(cacheKey('hi', 'zh', 'gpt-4o', '')).not.toBe(cacheKey('hi', 'zh', 'claude', ''))
  })
  it('changes when glossary changes', () => {
    expect(cacheKey('hi', 'zh', 'm', 'g1')).not.toBe(cacheKey('hi', 'zh', 'm', 'g2'))
  })
  it('changes when persona changes', () => {
    expect(cacheKey('hi', 'zh', 'm', '', 'academic')).not.toBe(cacheKey('hi', 'zh', 'm', '', 'colloquial'))
  })
  it('changes when source changes', () => {
    expect(cacheKey('hi', 'zh', 'm', '')).not.toBe(cacheKey('hi there', 'zh', 'm', ''))
  })
})

describe('estimateTokens', () => {
  it('returns ~chars/4, floored at 1', () => {
    expect(estimateTokens('')).toBe(1)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })
})

describe('isExpired', () => {
  it('expired when now - t exceeds ttlDays', () => {
    expect(isExpired({ v: 'x', t: 1000, n: 1 }, 1, 1000 + 2 * 86400000)).toBe(true)
  })
  it('fresh within ttl', () => {
    expect(isExpired({ v: 'x', t: 1000, n: 1 }, 1, 1000 + 1000)).toBe(false)
  })
  it('ttl 0 means always expired (cache disabled)', () => {
    expect(isExpired({ v: 'x', t: 1000, n: 1 }, 0, 1000)).toBe(true)
  })
})

describe('putEntry / getEntry', () => {
  it('round-trips a value through put then get', () => {
    const k = cacheKey('hello', 'zh', 'm', '')
    let store: CacheStore = {}
    store = putEntry(store, k, '你好', 5, 1000)
    const { value } = getEntry(store, k, 30, 1000)
    expect(value).toBe('你好')
  })
  it('getEntry returns null for a miss without throwing', () => {
    const { value } = getEntry({}, 'nope', 30)
    expect(value).toBeNull()
  })
  it('getEntry drops a stale entry on read (self-cleaning)', () => {
    const k = cacheKey('hi', 'zh', 'm', '')
    let store = putEntry({}, k, '你好', 2, 1000)
    const res = getEntry(store, k, 0, 5000) // ttl 0 = disabled → expired
    expect(res.value).toBeNull()
    expect(res.store[k]).toBeUndefined()
  })
  it('getEntry touches recency on hit (updates t)', () => {
    const k = cacheKey('hi', 'zh', 'm', '')
    let store = putEntry({}, k, '你好', 2, 1000)
    const res = getEntry(store, k, 30, 9999)
    expect(res.store[k].t).toBe(9999)
  })
})

describe('LRU eviction (putEntry cap)', () => {
  it('evicts the oldest entries when exceeding the cap', () => {
    let store: CacheStore = {}
    // Fill to the cap (3).
    store = putEntry(store, 'a', 'A', 1, 1000, 3)
    store = putEntry(store, 'b', 'B', 1, 2000, 3)
    store = putEntry(store, 'c', 'C', 1, 3000, 3)
    expect(Object.keys(store)).toHaveLength(3)
    // Adding a 4th evicts 'a' (oldest t).
    store = putEntry(store, 'd', 'D', 1, 4000, 3)
    expect(Object.keys(store).sort()).toEqual(['b', 'c', 'd'])
  })
})

describe('mergeCacheStores', () => {
  it('preserves disjoint entries from storage and the incoming snapshot', () => {
    const latest: CacheStore = { remote: { v: '远端', t: 20, n: 2 } }
    const incoming: CacheStore = { local: { v: '本地', t: 10, n: 2 } }

    expect(mergeCacheStores(latest, incoming)).toEqual({
      remote: latest.remote,
      local: incoming.local,
    })
  })

  it('keeps the newer value for a key and lets storage win timestamp ties', () => {
    const latest: CacheStore = {
      newerRemote: { v: 'new remote', t: 30, n: 1 },
      newerLocal: { v: 'old remote', t: 10, n: 1 },
      tie: { v: 'storage wins', t: 20, n: 1 },
    }
    const incoming: CacheStore = {
      newerRemote: { v: 'stale page snapshot', t: 20, n: 1 },
      newerLocal: { v: 'new local', t: 40, n: 1 },
      tie: { v: 'delayed page snapshot', t: 20, n: 1 },
    }

    const merged = mergeCacheStores(latest, incoming)
    expect(merged.newerRemote.v).toBe('new remote')
    expect(merged.newerLocal.v).toBe('new local')
    expect(merged.tie.v).toBe('storage wins')
  })

  it('applies explicit removals after merging so invalid entries stay deleted', () => {
    const latest: CacheStore = {
      invalid: { v: 'unchanged English', t: 30, n: 1 },
      keep: { v: '保留', t: 20, n: 1 },
    }
    const incoming: CacheStore = {
      invalid: { v: 'stale snapshot copy', t: 10, n: 1 },
    }

    expect(mergeCacheStores(latest, incoming, new Map([['invalid', 30]]))).toEqual({
      keep: latest.keep,
    })
  })

  it('does not let a delayed old tombstone delete a newer retry value', () => {
    const latest: CacheStore = {
      repaired: { v: '新的正确译文', t: 50, n: 2 },
    }
    const delayedSnapshot: CacheStore = {}

    expect(mergeCacheStores(
      latest,
      delayedSnapshot,
      new Map([['repaired', 30]])
    )).toEqual(latest)
  })

  it('enforces the LRU cap after combining stores', () => {
    const latest: CacheStore = {}
    const incoming: CacheStore = {}
    for (let i = 0; i < 6; i++) {
      const target = i % 2 === 0 ? latest : incoming
      target[`k${i}`] = { v: String(i), t: i, n: 1 }
    }

    const merged = mergeCacheStores(latest, incoming, new Map(), 3)
    expect(Object.keys(merged).sort()).toEqual(['k3', 'k4', 'k5'])
    expect(trimStore({ ...latest, ...incoming }, 3)).toEqual(merged)
  })
})

describe('gcStore', () => {
  it('removes only expired entries', () => {
    const DAY = 86400000
    const store: CacheStore = {
      fresh: { v: 'x', t: 2 * DAY, n: 1 }, // written recently
      stale: { v: 'y', t: 0, n: 1 },       // written 2 days ago
    }
    // 1-day ttl, evaluated "now" = 2 days → fresh survives, stale expires.
    const out = gcStore(store, 1, 2 * DAY)
    expect(out.fresh).toBeDefined()
    expect(out.stale).toBeUndefined()
  })
})

describe('saved-cost readout', () => {
  it('totalSavedTokens sums entry token counts', () => {
    const store: CacheStore = {
      a: { v: 'x', t: 1, n: 10 },
      b: { v: 'y', t: 1, n: 20 },
    }
    expect(totalSavedTokens(store)).toBe(30)
  })
  it('estimateSavedUsd scales tokens × price / 1M', () => {
    const store: CacheStore = { a: { v: 'x', t: 1, n: 1_000_000 } }
    // 1M tokens @ $2/1M = $2
    expect(estimateSavedUsd(store, 2)).toBeCloseTo(2, 5)
  })
})

describe('serialize / parse', () => {
  it('round-trips a store losslessly', () => {
    const store: CacheStore = { a: { v: '你好', t: 123, n: 5 } }
    const back = parseStore(JSON.parse(serializeStore(store)))
    expect(back).toEqual(store)
  })
  it('parse is tolerant of malformed entries (drops them)', () => {
    const back = parseStore({ good: { v: 'x', t: 1 }, bad: { t: 1 }, worse: 'nope' })
    expect(Object.keys(back)).toEqual(['good'])
  })
  it('parse returns {} for non-object input', () => {
    expect(parseStore(null)).toEqual({})
    expect(parseStore('x')).toEqual({})
  })
})
