import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, type ChatSession } from '../src/shared/store'
import type { Highlight } from '../src/shared/highlights'
import type { VocabEntry } from '../src/shared/vocabulary'

// The zustand store is persisted to localStorage under 'lector-ai-storage'.
// jsdom gives us localStorage; clear it between tests for isolation.
beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    user: null,
    accessToken: null,
    isPro: false,
    isLoading: false,
    usageCount: 0,
    sessions: [],
    highlights: [],
    vocab: [],
  })
})

describe('auth + usage', () => {
  it('setUser stores user + token', () => {
    useStore.getState().setUser({ id: 'u1', email: 'a@b.com' }, 'tok')
    const s = useStore.getState()
    expect(s.user?.email).toBe('a@b.com')
    expect(s.accessToken).toBe('tok')
  })

  it('incrementUsage increments for free users only', () => {
    useStore.getState().incrementUsage()
    expect(useStore.getState().usageCount).toBe(1)
    useStore.getState().setPro(true)
    useStore.getState().incrementUsage()
    expect(useStore.getState().usageCount).toBe(1) // pro does not increment
  })

  it('logout resets auth + usage', () => {
    useStore.getState().setUser({ id: 'u1', email: 'a@b.com' }, 'tok')
    useStore.getState().incrementUsage()
    useStore.getState().logout()
    const s = useStore.getState()
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.isPro).toBe(false)
    expect(s.usageCount).toBe(0)
  })
})

describe('sessions (reading library)', () => {
  const session = (id: string, createdAt: number): ChatSession => ({
    id,
    title: 'T',
    url: 'u',
    createdAt,
    messages: [],
  })

  it('addSession prepends and caps at 50', () => {
    for (let i = 0; i < 55; i++) useStore.getState().addSession(session(`s${i}`, i))
    expect(useStore.getState().sessions.length).toBe(50)
    // newest-first: s54 should be first
    expect(useStore.getState().sessions[0].id).toBe('s54')
  })

  it('updateSession patches by id', () => {
    useStore.getState().addSession(session('s1', 1))
    useStore.getState().updateSession('s1', { title: 'Updated' })
    expect(useStore.getState().sessions[0].title).toBe('Updated')
  })

  it('removeSession removes by id', () => {
    useStore.getState().addSession(session('s1', 1))
    useStore.getState().removeSession('s1')
    expect(useStore.getState().sessions.length).toBe(0)
  })

  it('clearSessions empties the list', () => {
    useStore.getState().addSession(session('s1', 1))
    useStore.getState().clearSessions()
    expect(useStore.getState().sessions.length).toBe(0)
  })
})

describe('highlights (Feature ②)', () => {
  const hl = (id: string, text = 't', url = 'u'): Highlight => ({
    id,
    text,
    note: '',
    quote: '',
    url,
    title: 'T',
    createdAt: 1,
    color: 'yellow',
  })

  it('addHighlight returns duplicate=false for new', () => {
    expect(useStore.getState().addHighlight(hl('h1')).duplicate).toBe(false)
    expect(useStore.getState().highlights.length).toBe(1)
  })

  it('addHighlight flags duplicate by text+url and does not add', () => {
    useStore.getState().addHighlight(hl('h1', 'same', 'url1'))
    const res = useStore.getState().addHighlight(hl('h2', 'same', 'url1'))
    expect(res.duplicate).toBe(true)
    expect(useStore.getState().highlights.length).toBe(1)
  })

  it('addHighlight treats same text different url as distinct', () => {
    useStore.getState().addHighlight(hl('h1', 'same', 'url1'))
    const res = useStore.getState().addHighlight(hl('h2', 'same', 'url2'))
    expect(res.duplicate).toBe(false)
    expect(useStore.getState().highlights.length).toBe(2)
  })

  it('removeHighlight and updateHighlight work', () => {
    useStore.getState().addHighlight(hl('h1'))
    useStore.getState().updateHighlight('h1', { note: 'n' })
    expect(useStore.getState().highlights[0].note).toBe('n')
    useStore.getState().removeHighlight('h1')
    expect(useStore.getState().highlights.length).toBe(0)
  })

  it('caps highlights at 500', () => {
    for (let i = 0; i < 505; i++) useStore.getState().addHighlight(hl(`h${i}`, `t${i}`))
    expect(useStore.getState().highlights.length).toBe(500)
  })
})

describe('vocab (Feature ③)', () => {
  const v = (id: string, word = 'w', createdAt = 1): VocabEntry => ({
    id,
    word,
    translation: '',
    context: '',
    url: '',
    title: '',
    lang: 'en',
    createdAt,
    srs: { due: 1, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  })

  it('addVocab prepends new entries', () => {
    useStore.getState().addVocab(v('v1', 'apple'))
    useStore.getState().addVocab(v('v2', 'banana'))
    expect(useStore.getState().vocab.length).toBe(2)
    expect(useStore.getState().vocab[0].id).toBe('v2')
  })

  it('addVocab merges duplicates case-insensitively, preserving srs + earliest createdAt', () => {
    useStore.getState().addVocab(v('v1', 'Word', 1000))
    // promote it so we can assert srs is preserved on merge
    useStore.getState().updateVocabSrs('v1', { due: 9, interval: 5, ease: 2.6, reps: 3, lapses: 1 })
    // incoming duplicate with different case + later createdAt
    useStore.getState().addVocab({
      ...v('v2', 'word', 5000),
      context: 'new context',
      translation: '新',
    })
    const list = useStore.getState().vocab
    expect(list.length).toBe(1)
    expect(list[0].context).toBe('new context')
    expect(list[0].translation).toBe('新')
    expect(list[0].createdAt).toBe(1000) // earliest kept
    expect(list[0].srs.interval).toBe(5) // srs preserved
  })

  it('removeVocab removes by id', () => {
    useStore.getState().addVocab(v('v1'))
    useStore.getState().removeVocab('v1')
    expect(useStore.getState().vocab.length).toBe(0)
  })

  it('updateVocabSrs replaces the srs state', () => {
    useStore.getState().addVocab(v('v1'))
    useStore.getState().updateVocabSrs('v1', { due: 999, interval: 7, ease: 2.7, reps: 4, lapses: 2 })
    expect(useStore.getState().vocab[0].srs.interval).toBe(7)
    expect(useStore.getState().vocab[0].srs.lapses).toBe(2)
  })

  it('caps vocab at 2000', () => {
    for (let i = 0; i < 2005; i++) useStore.getState().addVocab(v(`v${i}`, `w${i}`))
    expect(useStore.getState().vocab.length).toBe(2000)
  })
})
