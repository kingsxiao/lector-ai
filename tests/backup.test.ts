import { describe, it, expect } from 'vitest'
import {
  buildBackup,
  parseBackup,
  mergeBackupInto,
  BackupFormatError,
  LIBRARY_CAPS,
  type LectorBackup,
  type BackupSource,
} from '../src/shared/backup'
import type { ChatSession } from '../src/shared/store'
import type { Highlight } from '../src/shared/highlights'
import type { VocabEntry } from '../src/shared/vocabulary'
import type { SentenceCard } from '../src/shared/sentences'
import type { TranslationHistoryEntry } from '../src/shared/translation'
import { newSrs } from '../src/shared/srs'

const session = (id: string, createdAt = 1000, title = 'S'): ChatSession => ({
  id,
  title,
  url: 'https://example.com/a',
  createdAt,
  messages: [
    { id: id + '_m0', role: 'user', content: 'hi' },
    { id: id + '_m1', role: 'assistant', content: 'hello' },
  ],
})

const highlight = (id: string, text: string): Highlight => ({
  id,
  text,
  note: '',
  quote: '',
  url: 'https://example.com/a',
  title: 'Example',
  createdAt: 1,
})

const vocab = (word: string, reps = 0): VocabEntry => ({
  id: 'v_' + word,
  word,
  translation: '译-' + word,
  context: '',
  url: 'https://example.com/a',
  title: 'Example',
  lang: 'en',
  createdAt: 1,
  srs: { ...newSrs(100), reps },
})

const card = (sentence: string): SentenceCard => ({
  id: 's_' + sentence,
  sentence,
  translation: '',
  analysis: '## 译文\nx',
  keywords: [],
  quote: '',
  url: 'https://example.com/a',
  title: 'Example',
  lang: 'en',
  cefr: null,
  createdAt: 1,
  srs: null,
})

const history = (id: string, source: string): TranslationHistoryEntry => ({
  id,
  source,
  target: 't',
  sourceLang: 'en',
  targetLang: 'zh',
  kind: 'selection',
  url: 'https://example.com/a',
  createdAt: 5,
})

const emptySource = (): BackupSource => ({
  sessions: [],
  highlights: [],
  vocab: [],
  templates: [],
  glossary: [],
  sentences: [],
  translationHistory: [],
})

describe('buildBackup', () => {
  it('stamps app marker, version, createdAt and excludes built-in templates', () => {
    const b = buildBackup({
      ...emptySource(),
      vocab: [vocab('alpha')],
      templates: [
        { id: 'b1', title: 'B', content: 'x', builtIn: true, order: 0 },
        { id: 'c1', title: 'C', content: 'y', builtIn: false, order: 1 },
      ],
    })
    expect(b.app).toBe('lector-ai')
    expect(b.version).toBe(1)
    expect(typeof b.createdAt).toBe('number')
    expect(b.templates).toHaveLength(1)
    expect(b.templates[0].id).toBe('c1')
  })
})

describe('parseBackup', () => {
  it('round-trips a built backup', () => {
    const b = buildBackup({
      ...emptySource(),
      sessions: [session('s1')],
      vocab: [vocab('alpha')],
      sentences: [card('Hello there.')],
    })
    const parsed = parseBackup(JSON.stringify(b))
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.vocab[0].word).toBe('alpha')
    expect(parsed.sentences[0].sentence).toBe('Hello there.')
  })

  it('rejects non-JSON and non-Lector files', () => {
    expect(() => parseBackup('not json')).toThrow(BackupFormatError)
    expect(() => parseBackup('{"app":"other"}')).toThrow(BackupFormatError)
    expect(() => parseBackup('null')).toThrow(BackupFormatError)
  })

  it('rejects wrong versions', () => {
    const raw = JSON.stringify({ ...buildBackup(emptySource()), version: 99 })
    expect(() => parseBackup(raw)).toThrow(/version/i)
  })

  it('drops malformed entries but keeps valid ones in the same slice', () => {
    const b = buildBackup({ ...emptySource(), vocab: [vocab('ok')] })
    const tampered = {
      ...b,
      vocab: [...b.vocab, { id: 42, word: 'bad' }, 'junk'],
    }
    const parsed = parseBackup(JSON.stringify(tampered))
    expect(parsed.vocab).toHaveLength(1)
    expect(parsed.vocab[0].word).toBe('ok')
  })

  it('rejects a file whose slices are not arrays', () => {
    const raw = JSON.stringify({ app: 'lector-ai', version: 1, vocab: 'oops' })
    expect(() => parseBackup(raw)).toThrow(BackupFormatError)
  })
})

describe('mergeBackupInto', () => {
  it('adds missing rows and keeps existing ones (existing wins, idempotent)', () => {
    const current: BackupSource = {
      ...emptySource(),
      vocab: [vocab('alpha', 7)],
    }
    const backup: LectorBackup = buildBackup({
      ...emptySource(),
      vocab: [
          vocab('alpha', 1), // same word — current (reps 7) must win
        vocab('beta'),
      ],
    })
    const { next, added } = mergeBackupInto(current, backup)
    expect(next.vocab).toHaveLength(2)
    expect(next.vocab.find((v) => v.word === 'alpha')?.srs.reps).toBe(7)
    expect(added.vocab).toBe(1)
    // Idempotent: second import of the same file adds nothing.
    const again = mergeBackupInto(next, backup)
    expect(again.added.vocab).toBe(0)
    expect(again.next.vocab).toHaveLength(2)
  })

  it('merges sessions by id, newest-first, capped', () => {
    const current = { ...emptySource(), sessions: [session('cur', 500)] }
    const backup = buildBackup({
      ...emptySource(),
      sessions: [
        session('cur', 100), // same id — current wins
        session('old', 200),
      ],
    })
    const { next, added } = mergeBackupInto(current, backup)
    expect(next.sessions.map((s) => s.id)).toEqual(['cur', 'old'])
    expect(added.sessions).toBe(1)
  })

  it('dedupes highlights by text+url and sentences by normalized text', () => {
    const current = {
      ...emptySource(),
      highlights: [highlight('h1', 'same text')],
      sentences: [card('Same  spaced text')],
    }
    const backup = buildBackup({
      ...emptySource(),
      highlights: [highlight('h2', 'same text'), highlight('h3', 'other')],
      sentences: [card('Same spaced text')], // normalization collapses spaces
    })
    const { next, added } = mergeBackupInto(current, backup)
    expect(next.highlights).toHaveLength(2)
    expect(next.sentences).toHaveLength(1)
    expect(added.highlights).toBe(1)
    expect(added.sentences).toBe(0)
  })

  it('dedupes history by source|targetLang like appendHistory', () => {
    const current = { ...emptySource(), translationHistory: [history('h1', 'hello')] }
    const backup = buildBackup({
      ...emptySource(),
      translationHistory: [history('h2', 'hello'), history('h3', 'world')],
    })
    const { next, added } = mergeBackupInto(current, backup)
    expect(next.translationHistory.map((e) => e.source)).toEqual(['hello', 'world'])
    expect(added.history).toBe(1)
  })

  it('caps every slice at LIBRARY_CAPS', () => {
    const manyVocab = Array.from({ length: LIBRARY_CAPS.vocab + 50 }, (_, i) => vocab('w' + i))
    const backup = buildBackup({ ...emptySource(), vocab: manyVocab })
    const { next } = mergeBackupInto(emptySource(), backup)
    expect(next.vocab).toHaveLength(LIBRARY_CAPS.vocab)
  })

  it('never adds built-in templates from the backup', () => {
    const backup = buildBackup({
      ...emptySource(),
      templates: [{ id: 'x', title: 'X', content: 'x', builtIn: true, order: 0 }],
    })
    const { next, added } = mergeBackupInto(emptySource(), backup)
    expect(next.templates).toHaveLength(0)
    expect(added.templates).toBe(0)
  })
})
