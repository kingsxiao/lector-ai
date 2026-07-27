import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, type ChatSession } from '../src/shared/store'
import type { Highlight } from '../src/shared/highlights'
import type { VocabEntry } from '../src/shared/vocabulary'
import type { GlossaryEntry } from '../src/shared/glossary'

// The zustand store is persisted to localStorage under 'lector-ai-storage'.
// jsdom gives us localStorage; clear it between tests for isolation.
beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    sessions: [],
    highlights: [],
    vocab: [],
    glossary: [],
    translationHistory: [],
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

describe('glossary (术语表)', () => {
  const e = (source: string, target: string, opts: Partial<GlossaryEntry> = {}): Omit<GlossaryEntry, 'id' | 'createdAt'> => ({
    source,
    target,
    enabled: opts.enabled ?? true,
    note: opts.note,
  })

  it('addGlossaryEntry prepends new entries with id+createdAt', () => {
    useStore.getState().addGlossaryEntry(e('LLM', '大语言模型'))
    const list = useStore.getState().glossary
    expect(list.length).toBe(1)
    expect(list[0].source).toBe('LLM')
    expect(list[0].target).toBe('大语言模型')
    expect(list[0].enabled).toBe(true)
    expect(typeof list[0].id).toBe('string')
    expect(typeof list[0].createdAt).toBe('number')
  })

  it('addGlossaryEntry merges duplicate source case-insensitively, preserving id+createdAt', () => {
    useStore.getState().addGlossaryEntry(e('LLM', '旧译文'))
    const origId = useStore.getState().glossary[0].id
    const origCreated = useStore.getState().glossary[0].createdAt
    // Wait a tick so createdAt would differ if it were being reset.
    useStore.getState().addGlossaryEntry(e('llm', '新译文', { enabled: false }))
    const list = useStore.getState().glossary
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(origId)
    expect(list[0].createdAt).toBe(origCreated)
    expect(list[0].target).toBe('新译文')
    expect(list[0].enabled).toBe(false)
  })

  it('updateGlossaryEntry patches by id', () => {
    useStore.getState().addGlossaryEntry(e('LLM', '大语言模型'))
    const id = useStore.getState().glossary[0].id
    useStore.getState().updateGlossaryEntry(id, { enabled: false, note: 'paused' })
    expect(useStore.getState().glossary[0].enabled).toBe(false)
    expect(useStore.getState().glossary[0].note).toBe('paused')
  })

  it('removeGlossaryEntry removes by id', () => {
    useStore.getState().addGlossaryEntry(e('LLM', '大语言模型'))
    const id = useStore.getState().glossary[0].id
    useStore.getState().removeGlossaryEntry(id)
    expect(useStore.getState().glossary.length).toBe(0)
  })

  it('replaceGlossary dedupes by source (case-insensitive, earliest createdAt wins)', () => {
    useStore.getState().replaceGlossary([
      { id: '1', source: 'LLM', target: '旧', enabled: true, createdAt: 500 },
      { id: '2', source: 'llm', target: '新', enabled: true, createdAt: 100 },
      { id: '3', source: 'RAG', target: '检索增强生成', enabled: true, createdAt: 300 },
    ])
    const list = useStore.getState().glossary
    expect(list.length).toBe(2)
    // The earliest createdAt (100) wins.
    const llm = list.find((x) => x.source === 'llm' || x.source === 'LLM')
    expect(llm?.target).toBe('新')
    expect(llm?.id).toBe('2')
  })

  it('replaceGlossary fully replaces the previous list (not append)', () => {
    useStore.getState().addGlossaryEntry(e('A', 'a'))
    useStore.getState().replaceGlossary([
      { id: 'x', source: 'B', target: 'b', enabled: true, createdAt: 1 },
    ])
    const list = useStore.getState().glossary
    expect(list.length).toBe(1)
    expect(list[0].source).toBe('B')
  })
})

describe('translation history', () => {
  it('addTranslationHistory prepends and assigns id', () => {
    useStore.getState().addTranslationHistory({
      source: 'hi', target: '你好', sourceLang: 'auto', targetLang: 'zh',
      kind: 'selection', url: 'u', createdAt: 1,
    })
    const list = useStore.getState().translationHistory
    expect(list).toHaveLength(1)
    expect(list[0].id).toBeTruthy()
    expect(list[0].source).toBe('hi')
  })
  it('clearTranslationHistory empties the list', () => {
    useStore.getState().addTranslationHistory({
      source: 'hi', target: '你好', sourceLang: 'auto', targetLang: 'zh',
      kind: 'selection', url: 'u', createdAt: 1,
    })
    useStore.getState().clearTranslationHistory()
    expect(useStore.getState().translationHistory).toHaveLength(0)
  })
})

describe('persist migration (B5)', () => {
  // The store is persisted to localStorage under 'lector-ai-storage'. An
  // upgrade from an old persisted shape must not corrupt saved data: missing
  // slices are filled with defaults, present slices are preserved.
  it('rehydrates an old (version-less) persisted state, preserving saved data and filling defaults', async () => {
    localStorage.clear()
    // Simulate a v0 persisted blob: has sessions + vocab, but no version,
    // no hasOpened, no glossary.
    const oldState = {
      state: {
        sessions: [{ id: 's1', title: 'Old', url: 'u', createdAt: 1, messages: [] }],
        vocab: [{ id: 'v1', word: 'hello', translation: '你好', context: '', url: '', title: '', lang: 'en', createdAt: 1, srs: { due: 1, interval: 0, ease: 2.5, reps: 0, lapses: 0 } }],
      },
      version: 0,
    }
    localStorage.setItem('lector-ai-storage', JSON.stringify(oldState))

    // Force rehydration of the existing store, which runs migrate.
    await useStore.persist.rehydrate()

    expect(useStore.getState().sessions.length).toBe(1)
    expect(useStore.getState().sessions[0].id).toBe('s1')
    expect(useStore.getState().vocab.length).toBe(1)
    expect(useStore.getState().vocab[0].word).toBe('hello')
    // Missing slices get defaults, not undefined.
    expect(Array.isArray(useStore.getState().glossary)).toBe(true)
    expect(useStore.getState().glossary.length).toBe(0)
    expect(useStore.getState().hasOpened).toBe(false)
    // Builtin templates are restored when absent.
    expect(useStore.getState().templates.length).toBeGreaterThan(0)
  })

  it('markOpened flips hasOpened to true', () => {
    useStore.setState({ hasOpened: false })
    useStore.getState().markOpened()
    expect(useStore.getState().hasOpened).toBe(true)
  })
})
