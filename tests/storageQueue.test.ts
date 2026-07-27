import { describe, it, expect } from 'vitest'
import { appendToList, type ListStore } from '../src/shared/storageQueue'

/**
 * A fake in-process ListStore that mimics the async chrome.storage.local
 * get/set contract but is fully controllable from tests. `delayMs` lets us
 * interleave concurrent appends to exercise the read-modify-write race that
 * the serialized chain is meant to eliminate.
 */
function fakeStore(initial: Record<string, unknown[]> = {}, delayMs = 0): ListStore & {
  raw: Record<string, unknown[]>
} {
  const raw: Record<string, unknown[]> = { ...initial }
  const sleep = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve())
  return {
    raw,
    async get<T>(key: string): Promise<T[]> {
      await sleep()
      return (raw[key] ?? []) as T[]
    },
    async set(key: string, value: unknown[]): Promise<void> {
      await sleep()
      raw[key] = value
    },
  }
}

describe('appendToList — serialization (race elimination)', () => {
  it('appends a single item when starting from empty', async () => {
    const store = fakeStore()
    let chain: Promise<void> = Promise.resolve()
    chain = appendToList<string>(chain, store, 'lectorVocab', (list) => {
      list.unshift('a')
    })
    await chain
    expect(store.raw.lectorVocab).toEqual(['a'])
  })

  // Regression (A6): two relay messages arriving close together both ran
  // get → mutate → set against the same base list, so the second set
  // overwrote the first and one item was silently lost. The serialized chain
  // makes the second step wait for the first's set, so both land.
  it('loses NO items when many appends are enqueued concurrently', async () => {
    const store = fakeStore({ lectorVocab: [] }, 5)
    let chain: Promise<void> = Promise.resolve()
    const N = 20
    for (let i = 0; i < N; i++) {
      const item = `item${i}`
      chain = appendToList<string>(chain, store, 'lectorVocab', (list) => {
        list.unshift(item)
      })
    }
    await chain
    expect(store.raw.lectorVocab.length).toBe(N)
    // Every item must be present exactly once (no duplicates, no losses).
    const sorted = [...store.raw.lectorVocab].sort()
    expect(sorted).toEqual(
      Array.from({ length: N }, (_, i) => `item${i}`).sort()
    )
  })

  it('respects a max-length cap applied in the mutator', async () => {
    const store = fakeStore({ lectorVocab: [] })
    let chain: Promise<void> = Promise.resolve()
    for (let i = 0; i < 10; i++) {
      chain = appendToList<number>(chain, store, 'lectorVocab', (list) => {
        list.unshift(i)
        return list.slice(0, 3)
      })
    }
    await chain
    expect(store.raw.lectorVocab.length).toBe(3)
    // Newest three (9, 8, 7) survive; oldest evicted.
    expect(store.raw.lectorVocab).toEqual([9, 8, 7])
  })

  it('supports merge (dedup) in the mutator instead of blind prepend', async () => {
    const store = fakeStore({ lectorHighlights: [] })
    let chain: Promise<void> = Promise.resolve()
    const add = (text: string) =>
      (chain = appendToList<{ text: string }>(chain, store, 'lectorHighlights', (list) => {
        if (!list.some((h) => h.text === text)) list.unshift({ text })
      }))
    add('a')
    add('b')
    add('a') // duplicate — must be ignored
    await chain
    expect(store.raw.lectorHighlights.map((h) => h.text).sort()).toEqual(['a', 'b'])
  })

  it('keeps the chain alive if one mutator throws (best-effort)', async () => {
    const store = fakeStore({ lectorVocab: [] })
    let chain: Promise<void> = Promise.resolve()
    const errors: unknown[] = []
    chain = appendToList<string>(chain, store, 'lectorVocab', () => {
      throw new Error('boom')
    }, (e) => errors.push(e))
    chain = appendToList<string>(chain, store, 'lectorVocab', (list) => {
      list.unshift('after-error')
    }, (e) => errors.push(e))
    await chain
    // The throwing step was skipped, but the next step still ran.
    expect(store.raw.lectorVocab).toEqual(['after-error'])
    expect(errors.length).toBe(1)
  })
})
