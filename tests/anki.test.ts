import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_ANKI_CONNECT_URL,
  DEFAULT_DECK_NAME,
  DEFAULT_MODEL_NAME,
  DEFAULT_TAGS,
  vocabToAnkiNote,
  buildAnkiConnectBody,
  invokeAnkiConnect,
  exportVocabToAnki,
  withAnkiDefaults,
  type AnkiConnectAction,
} from '../src/shared/anki'
import type { VocabEntry } from '../src/shared/vocabulary'

// Build a VocabEntry with sane defaults; only the interesting fields vary.
const v = (over: Partial<VocabEntry>): VocabEntry => ({
  id: 'v1',
  word: 'ephemeral',
  translation: '短暂的',
  context: 'Fame is ephemeral.',
  url: 'https://example.com/post',
  title: 'Fame',
  lang: 'en',
  createdAt: 1000,
  srs: { due: 1000, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  ...over,
})

describe('defaults', () => {
  it('exposes sensible default URL/deck/model', () => {
    expect(DEFAULT_ANKI_CONNECT_URL).toBe('http://127.0.0.1:8765')
    expect(DEFAULT_DECK_NAME).toBe('Lector::Vocabulary')
    expect(DEFAULT_MODEL_NAME).toBe('Basic')
  })
})

describe('withAnkiDefaults', () => {
  it('returns defaults when anki is undefined', () => {
    const out = withAnkiDefaults(undefined)
    expect(out).toEqual({
      url: DEFAULT_ANKI_CONNECT_URL,
      deckName: DEFAULT_DECK_NAME,
      modelName: DEFAULT_MODEL_NAME,
      tags: DEFAULT_TAGS,
    })
  })

  it('fills missing fields but preserves provided ones', () => {
    const out = withAnkiDefaults({ deckName: 'MyDeck' })
    expect(out.deckName).toBe('MyDeck')
    expect(out.url).toBe(DEFAULT_ANKI_CONNECT_URL)
    expect(out.modelName).toBe(DEFAULT_MODEL_NAME)
    expect(out.tags).toEqual(['lector'])
  })

  it('preserves custom tags', () => {
    const out = withAnkiDefaults({ tags: ['english', 'vocab'] })
    expect(out.tags).toEqual(['english', 'vocab'])
  })
})

describe('vocabToAnkiNote', () => {
  it('maps word→Front, translation→Back, tags include "lector"', () => {
    const note = vocabToAnkiNote(v({}), {
      deckName: 'Lector::Vocabulary',
      modelName: 'Basic',
      tags: ['lector'],
    })
    expect(note.deckName).toBe('Lector::Vocabulary')
    expect(note.modelName).toBe('Basic')
    expect(note.fields.Front).toBe('ephemeral')
    expect(note.fields.Back).toContain('短暂的')
    expect(note.tags).toContain('lector')
  })

  it('includes the example context sentence in Back when present', () => {
    const note = vocabToAnkiNote(v({ context: 'Fame is ephemeral.' }), {
      deckName: 'D',
      modelName: 'Basic',
    })
    expect(note.fields.Back).toContain('Fame is ephemeral.')
  })

  it('includes source link (title + url) in Back', () => {
    const note = vocabToAnkiNote(v({ title: 'Fame', url: 'https://example.com/p' }), {
      deckName: 'D',
      modelName: 'Basic',
    })
    expect(note.fields.Back).toContain('Fame')
    expect(note.fields.Back).toContain('https://example.com/p')
  })

  it('gracefully degrades when translation is empty', () => {
    const note = vocabToAnkiNote(v({ translation: '' }), {
      deckName: 'D',
      modelName: 'Basic',
    })
    expect(note.fields.Front).toBe('ephemeral')
    // Back should still be a non-empty string (placeholder) so Anki accepts it.
    expect(typeof note.fields.Back).toBe('string')
    expect(note.fields.Back.length).toBeGreaterThan(0)
  })

  it('uses default deck/model/tags when not specified', () => {
    const note = vocabToAnkiNote(v({}), { deckName: DEFAULT_DECK_NAME, modelName: DEFAULT_MODEL_NAME })
    expect(note.deckName).toBe(DEFAULT_DECK_NAME)
    expect(note.modelName).toBe(DEFAULT_MODEL_NAME)
    expect(note.tags).toEqual([])
  })
})

describe('buildAnkiConnectBody', () => {
  it('wraps a single action with version 6', () => {
    const action: AnkiConnectAction = { action: 'deckNames', params: {} }
    const body = buildAnkiConnectBody(action)
    const parsed = JSON.parse(body)
    expect(parsed).toEqual({ action: 'deckNames', version: 6, params: {} })
  })

  it('wraps multiple actions as a multi-action with version 6', () => {
    const actions: AnkiConnectAction[] = [
      { action: 'a', params: { x: 1 } },
      { action: 'b', params: { y: 2 } },
    ]
    const body = buildAnkiConnectBody(actions)
    const parsed = JSON.parse(body)
    expect(parsed).toEqual({
      action: 'multi',
      version: 6,
      params: { actions: [{ action: 'a', params: { x: 1 }, version: 6 }, { action: 'b', params: { y: 2 }, version: 6 }] },
    })
  })
})

describe('invokeAnkiConnect', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    global.fetch = realFetch
  })

  it('returns ok=true with result when AnkiConnect returns result field', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: 12345, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as unknown as typeof global.fetch
    const r = await invokeAnkiConnect('http://localhost:8765', { action: 'foo', params: {} })
    expect(r.ok).toBe(true)
    expect(r.result).toBe(12345)
  })

  it('returns ok=false with error when AnkiConnect returns an error string', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: null, error: 'deck not found' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as unknown as typeof global.fetch
    const r = await invokeAnkiConnect('http://localhost:8765', { action: 'foo', params: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('deck not found')
  })

  it('returns ok=false with a friendly message when fetch rejects (Anki not running)', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof global.fetch
    const r = await invokeAnkiConnect('http://localhost:8765', { action: 'foo', params: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    // Should mention Anki so the user knows what to do.
    expect(r.error.toLowerCase()).toContain('anki')
  })

  it('returns ok=false when HTTP status is not ok', async () => {
    global.fetch = vi.fn(
      async () => new Response('Not Found', { status: 404 })
    ) as unknown as typeof global.fetch
    const r = await invokeAnkiConnect('http://localhost:8765', { action: 'foo', params: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('returns ok=false when response is not valid JSON', async () => {
    global.fetch = vi.fn(
      async () => new Response('not json', { status: 200 })
    ) as unknown as typeof global.fetch
    const r = await invokeAnkiConnect('http://localhost:8765', { action: 'foo', params: {} })
    expect(r.ok).toBe(false)
  })

  it('returns ok=false with a timeout-specific message when fetch is aborted', async () => {
    // Simulate the browser aborting the fetch (AbortController fires): the
    // fetch rejects with a DOMException whose name/message signals abort.
    global.fetch = vi.fn((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted.', 'AbortError')
            reject(err)
          })
        }
      })
    }) as unknown as typeof global.fetch
    const pending = invokeAnkiConnect(
      'http://localhost:8765',
      { action: 'foo', params: {} },
      5000
    )
    // Fire the AbortController timer inside invokeAnkiConnect.
    await vi.advanceTimersByTimeAsync(5001)
    const r = await pending
    expect(r.ok).toBe(false)
    // The timeout branch mentions Anki explicitly so the user knows what to do.
    expect(r.error?.toLowerCase()).toContain('anki')
  })
})

describe('exportVocabToAnki', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('creates the deck first, then adds each note via multi-action', async () => {
    const calls: { body: string }[] = []
    global.fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? init.body : ''
        calls.push({ body })
        // AnkiConnect returns one result per action in `multi`.
        const parsed = JSON.parse(body)
        if (parsed.action === 'multi') {
          const n = parsed.params.actions.length
          // First action = createDeck (returns true); remaining = addNote (return note id).
          const results = [true, ...Array(n - 1).fill(1700000000000)]
          return new Response(JSON.stringify({ result: results, error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ result: true, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    ) as unknown as typeof global.fetch

    const vocab = [v({ id: '1' }), v({ id: '2', word: 'serendipity' })]
    const result = await exportVocabToAnki(vocab, {
      url: DEFAULT_ANKI_CONNECT_URL,
      deckName: 'Lector::Vocabulary',
      modelName: 'Basic',
      tags: ['lector'],
    })
    expect(result.added).toBe(2)
    expect(result.duplicated).toBe(0)
    expect(result.failed).toBe(0)
    // Exactly one POST (the multi action).
    expect(calls.length).toBe(1)
    const body = JSON.parse(calls[0].body)
    expect(body.action).toBe('multi')
    // 1 createDeck + 2 addNote = 3 sub-actions.
    expect(body.params.actions.length).toBe(3)
    expect(body.params.actions[0].action).toBe('createDeck')
    expect(body.params.actions[1].action).toBe('addNote')
    expect(body.params.actions[2].action).toBe('addNote')
  })

  it('counts duplicates when AnkiConnect returns null result for an addNote', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            // createDeck ok, then addNote returns null (duplicate per AnkiConnect spec).
            result: [true, null, 1700000000000],
            error: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as unknown as typeof global.fetch
    const vocab = [v({ id: '1' }), v({ id: '2', word: 'serendipity' })]
    const result = await exportVocabToAnki(vocab, {
      url: DEFAULT_ANKI_CONNECT_URL,
      deckName: 'D',
      modelName: 'Basic',
    })
    expect(result.added).toBe(1)
    expect(result.duplicated).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('counts failures when the multi call itself errors', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: null, error: 'AnkiConnect internal' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as unknown as typeof global.fetch
    const vocab = [v({ id: '1' }), v({ id: '2', word: 'serendipity' })]
    const result = await exportVocabToAnki(vocab, {
      url: DEFAULT_ANKI_CONNECT_URL,
      deckName: 'D',
      modelName: 'Basic',
    })
    expect(result.added).toBe(0)
    expect(result.failed).toBe(2)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns all-failed with friendly error when Anki is not running', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof global.fetch
    const vocab = [v({ id: '1' })]
    const result = await exportVocabToAnki(vocab, {
      url: DEFAULT_ANKI_CONNECT_URL,
      deckName: 'D',
      modelName: 'Basic',
    })
    expect(result.added).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].toLowerCase()).toContain('anki')
  })

  it('skips empty vocab list with zero effect', async () => {
    global.fetch = vi.fn(async () => new Response('{}')) as unknown as typeof global.fetch
    const result = await exportVocabToAnki([], {
      url: DEFAULT_ANKI_CONNECT_URL,
      deckName: 'D',
      modelName: 'Basic',
    })
    expect(result.added).toBe(0)
    expect(result.duplicated).toBe(0)
    expect(result.failed).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
