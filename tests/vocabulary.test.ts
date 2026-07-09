import { describe, it, expect } from 'vitest'
import {
  type VocabEntry,
  mergeVocabEntry,
  validateWord,
  makeVocabEntry,
} from '../src/shared/vocabulary'

const base: VocabEntry = {
  id: 'v1',
  word: 'ephemeral',
  translation: '短暂的',
  context: 'Fame is ephemeral.',
  url: 'https://a.com',
  title: 'Post',
  lang: 'en',
  createdAt: 1000,
  srs: { due: 1000, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
}

describe('mergeVocabEntry', () => {
  it('keeps earliest createdAt, latest context, does NOT reset srs', () => {
    const existing: VocabEntry = { ...base, createdAt: 1000 }
    const incoming: VocabEntry = {
      ...base,
      createdAt: 5000,
      context: 'Updated context.',
      srs: { due: 999999, interval: 10, ease: 2.6, reps: 5, lapses: 1 },
    }
    const merged = mergeVocabEntry(existing, incoming)
    expect(merged.createdAt).toBe(1000)
    expect(merged.context).toBe('Updated context.')
    expect(merged.srs.interval).toBe(0) // unchanged from existing
  })
})

describe('validateWord', () => {
  it('accepts a normal word', () => {
    expect(validateWord('ephemeral').ok).toBe(true)
  })
  it('rejects too-long input (looks like a sentence)', () => {
    const long = 'word '.repeat(20).trim()
    expect(validateWord(long).ok).toBe(false)
  })
  it('rejects empty', () => {
    expect(validateWord('').ok).toBe(false)
  })
  it('accepts a short multi-word phrase under the limit', () => {
    expect(validateWord('ad hoc').ok).toBe(true)
  })
})

describe('makeVocabEntry', () => {
  it('creates an entry with default SRS state due now', () => {
    const e = makeVocabEntry({
      id: 'v2',
      word: 'w',
      translation: '',
      context: '',
      url: '',
      title: '',
      lang: 'en',
    })
    expect(e.srs.reps).toBe(0)
    expect(typeof e.createdAt).toBe('number')
  })
})
