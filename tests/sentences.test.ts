import { describe, it, expect } from 'vitest'
import {
  validateSentence,
  normalizeSentence,
  newCardId,
  makeSentenceCard,
  mergeSentenceCard,
  isDuplicateSentence,
  dedupeCards,
  searchSentences,
  groupSentences,
  extractTranslation,
  extractKeywords,
  extractCefr,
  exportSentences,
  importSentences,
  SENTENCE_CARD_SYSTEM_PROMPT,
  type SentenceCard,
} from '../src/shared/sentences'

const card = (
  id: string,
  sentence: string,
  opts: Partial<SentenceCard> = {}
): SentenceCard => ({
  id,
  sentence,
  translation: opts.translation ?? '译文',
  analysis: opts.analysis ?? '## 译文\n\n译文',
  keywords: opts.keywords ?? [],
  quote: opts.quote ?? '',
  url: opts.url ?? 'https://example.com',
  title: opts.title ?? 'Title',
  blockId: opts.blockId,
  lang: opts.lang ?? 'en',
  cefr: opts.cefr ?? null,
  createdAt: opts.createdAt ?? 1000,
  srs: opts.srs ?? null,
})

describe('validateSentence', () => {
  it('accepts a normal sentence', () => {
    expect(validateSentence('The quick brown fox jumps.').ok).toBe(true)
  })
  it('rejects empty', () => {
    expect(validateSentence('   ').ok).toBe(false)
  })
  it('rejects fragments shorter than 10 chars', () => {
    expect(validateSentence('hi there').ok).toBe(false)
  })
  it('rejects paragraphs over 1000 chars', () => {
    expect(validateSentence('a '.repeat(600)).ok).toBe(false)
  })
  it('accepts exactly 10 chars (boundary)', () => {
    expect(validateSentence('1234567890').ok).toBe(true)
  })
})

describe('normalizeSentence', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeSentence('  The   quick\nfox  ')).toBe('The quick fox')
  })
  it('preserves case (sentence-start casing is significant)', () => {
    expect(normalizeSentence('Hello world')).toBe('Hello world')
  })
})

describe('newCardId', () => {
  it('generates unique ids with the s prefix', () => {
    const a = newCardId()
    const b = newCardId()
    expect(a).not.toBe(b)
    expect(a.startsWith('s')).toBe(true)
  })
})

describe('makeSentenceCard', () => {
  it('fills defaults: srs=null, createdAt=now', () => {
    const c = makeSentenceCard({
      id: 's1',
      sentence: 'A test sentence here.',
      translation: '',
      analysis: '',
      keywords: [],
      quote: '',
      url: '',
      title: '',
      lang: 'en',
      cefr: null,
    })
    expect(c.srs).toBeNull()
    expect(typeof c.createdAt).toBe('number')
  })
  it('normalizes the sentence', () => {
    const c = makeSentenceCard({
      id: 's1',
      sentence: '  messy   spacing  ',
      translation: '',
      analysis: '',
      keywords: [],
      quote: '',
      url: '',
      title: '',
      lang: 'en',
      cefr: null,
    })
    expect(c.sentence).toBe('messy spacing')
  })
})

describe('mergeSentenceCard', () => {
  it('refreshes analysis/translation/keywords, keeps earliest createdAt, preserves srs', () => {
    const existing = card('s1', 'Hello world', {
      createdAt: 500,
      translation: '旧译文',
      analysis: 'old',
      srs: { due: 9999, interval: 5, ease: 2.5, reps: 3, lapses: 1 },
    })
    const incoming = card('s2', 'Hello world', {
      createdAt: 1000,
      translation: '新译文',
      analysis: 'new',
      keywords: ['hello'],
      srs: null,
    })
    const merged = mergeSentenceCard(existing, incoming)
    expect(merged.createdAt).toBe(500)
    expect(merged.analysis).toBe('new')
    expect(merged.translation).toBe('新译文')
    expect(merged.keywords).toEqual(['hello'])
    expect(merged.srs).toEqual({ due: 9999, interval: 5, ease: 2.5, reps: 3, lapses: 1 })
  })
})

describe('isDuplicateSentence', () => {
  it('matches by normalized sentence, ignoring whitespace differences', () => {
    const a = card('s1', 'Hello   world')
    const b = card('s2', 'Hello world')
    expect(isDuplicateSentence(a, b)).toBe(true)
  })
  it('does NOT match different sentences', () => {
    expect(isDuplicateSentence(card('s1', 'Hello'), card('s2', 'Goodbye'))).toBe(false)
  })
})

describe('dedupeCards', () => {
  it('keeps earliest createdAt on normalized-sentence collision', () => {
    const list = [
      card('s1', 'Hello world', { createdAt: 500, translation: '旧' }),
      card('s2', 'Hello   world', { createdAt: 100, translation: '新' }),
      card('s3', 'Goodbye', { createdAt: 300 }),
    ]
    const out = dedupeCards(list)
    expect(out.length).toBe(2)
    const hw = out.find((c) => normalizeSentence(c.sentence) === 'Hello world')
    expect(hw?.createdAt).toBe(100)
    expect(hw?.translation).toBe('新')
  })
  it('returns empty for empty input', () => {
    expect(dedupeCards([])).toEqual([])
  })
})

describe('searchSentences', () => {
  const list = [
    card('s1', 'The quick brown fox', { translation: '敏捷的棕狐', keywords: ['fox'] }),
    card('s2', 'A lazy dog', { translation: '懒狗', keywords: ['dog'], title: 'Animals' }),
  ]
  it('matches sentence text case-insensitively', () => {
    expect(searchSentences(list, 'FOX').length).toBe(1)
  })
  it('matches translation', () => {
    expect(searchSentences(list, '懒狗').length).toBe(1)
  })
  it('matches keywords', () => {
    expect(searchSentences(list, 'dog').length).toBe(1)
  })
  it('matches title', () => {
    expect(searchSentences(list, 'animal').length).toBe(1)
  })
  it('returns all on empty query', () => {
    expect(searchSentences(list, '').length).toBe(2)
  })
})

describe('groupSentences', () => {
  it('groups by title+url, newest-first within group', () => {
    const list = [
      card('s1', 'A', { title: 'P1', url: 'u1', createdAt: 100 }),
      card('s2', 'B', { title: 'P1', url: 'u1', createdAt: 300 }),
      card('s3', 'C', { title: 'P2', url: 'u2', createdAt: 200 }),
    ]
    const groups = groupSentences(list)
    expect(groups.size).toBe(2)
    const p1 = groups.get('P1\u0000u1')!
    expect(p1.map((c) => c.id)).toEqual(['s2', 's1']) // newest first
  })
})

const SAMPLE_ANALYSIS = `## 译文
这是一个测试句子。

## 句法结构
- 主语：This
- 谓语：is

## 关键词与搭配
- **test** — 搭配：test case；辨析：test vs exam
- **sentence** — 搭配：write a sentence

## 地道表达
无明显地道表达

## 举一反三
1. This is another test.
2. The test was hard.

## 记忆点
记住 test 的搭配 test case。`

describe('extractTranslation', () => {
  it('extracts the 译文 section', () => {
    expect(extractTranslation(SAMPLE_ANALYSIS)).toBe('这是一个测试句子。')
  })
  it('returns empty string when section is missing', () => {
    expect(extractTranslation('## 其他\n\n内容')).toBe('')
  })
})

describe('extractKeywords', () => {
  it('extracts bolded headwords from 关键词与搭配', () => {
    expect(extractKeywords(SAMPLE_ANALYSIS)).toEqual(['test', 'sentence'])
  })
  it('returns empty array when section is missing', () => {
    expect(extractKeywords('## 译文\n\nx')).toEqual([])
  })
  it('returns empty array when no bolded words', () => {
    expect(extractKeywords('## 关键词与搭配\n\n- plain bullet')).toEqual([])
  })
})

describe('exportSentences / importSentences round-trip', () => {
  const list = [
    card('s1', 'Hello world', { createdAt: 100, keywords: ['hi'] }),
    card('s2', 'Goodbye for now', { createdAt: 200, srs: null }),
  ]
  it('round-trips losslessly', () => {
    const json = exportSentences(list)
    const result = importSentences(json)
    expect(result.ok).toBe(true)
    expect(result.cards).toEqual(list)
  })
  it('produces pretty JSON', () => {
    expect(exportSentences(list).includes('\n')).toBe(true)
  })
})

describe('importSentences', () => {
  it('rejects malformed JSON', () => {
    const r = importSentences('{not json')
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })
  it('rejects non-array top-level', () => {
    expect(importSentences(JSON.stringify({ x: 1 })).ok).toBe(false)
  })
  it('skips rows missing required fields, keeps good ones', () => {
    const dirty = [
      { id: 's1', sentence: 'Hello world', translation: 't', analysis: 'a', keywords: [], quote: '', url: 'u', title: 'T', lang: 'en', createdAt: 1, srs: null },
      { id: 's2', sentence: '' }, // bad: empty sentence
      { notEven: 'a card' },
    ]
    const r = importSentences(JSON.stringify(dirty))
    expect(r.ok).toBe(true)
    expect(r.cards?.length).toBe(1)
  })
  it('fills defaults for optional fields (srs=null, createdAt=now)', () => {
    const minimal = [{ id: 's1', sentence: 'A real sentence.', translation: '', analysis: '', keywords: [], quote: '', url: '', title: '', lang: 'en' }]
    const r = importSentences(JSON.stringify(minimal))
    expect(r.ok).toBe(true)
    expect(r.cards?.[0].srs).toBeNull()
    expect(typeof r.cards?.[0].createdAt).toBe('number')
  })
})

describe('SENTENCE_CARD_SYSTEM_PROMPT', () => {
  it('contains all 6 H2 section headers', () => {
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 译文')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 句法结构')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 关键词与搭配')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 地道表达')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 举一反三')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 记忆点')
  })
})

describe('SENTENCE_CARD_SYSTEM_PROMPT — POS tags (Phase 2)', () => {
  it('instructs the model to output a POS-tagged sentence in 句法结构', () => {
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('[n]')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('[/n]')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('[v]')
    for (const code of ['n', 'v', 'a', 'd', 'p', 'c', 'r', 't']) {
      expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain(`[${code}]`)
    }
  })

  it('keeps 句法结构 as the second H2 section (after 译文)', () => {
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 句法结构')
    const yi = SENTENCE_CARD_SYSTEM_PROMPT.indexOf('## 译文')
    const ju = SENTENCE_CARD_SYSTEM_PROMPT.indexOf('## 句法结构')
    expect(yi).toBeLessThan(ju)
  })
})

describe('importSentences — SrsState validation', () => {
  it('rejects srs with non-numeric fields (falls back to null)', () => {
    const dirty = [
      {
        id: 's1', sentence: 'A valid sentence here.', translation: '', analysis: '',
        keywords: [], quote: '', url: '', title: '', lang: 'en',
        srs: { due: 'not-a-number', interval: 1, ease: 2.5, reps: 0, lapses: 0 },
      },
    ]
    const r = importSentences(JSON.stringify(dirty))
    expect(r.ok).toBe(true)
    expect(r.cards?.[0].srs).toBeNull()
  })

  it('keeps valid srs intact', () => {
    const valid = [
      {
        id: 's1', sentence: 'A valid sentence here.', translation: '', analysis: '',
        keywords: [], quote: '', url: '', title: '', lang: 'en',
        srs: { due: 123456, interval: 5, ease: 2.5, reps: 3, lapses: 1 },
      },
    ]
    const r = importSentences(JSON.stringify(valid))
    expect(r.ok).toBe(true)
    expect(r.cards?.[0].srs).toEqual({ due: 123456, interval: 5, ease: 2.5, reps: 3, lapses: 1 })
  })

  it('rejects srs missing required numeric fields', () => {
    const dirty = [
      {
        id: 's1', sentence: 'A valid sentence here.', translation: '', analysis: '',
        keywords: [], quote: '', url: '', title: '', lang: 'en',
        srs: { due: 123, interval: 1 },
      },
    ]
    const r = importSentences(JSON.stringify(dirty))
    expect(r.cards?.[0].srs).toBeNull()
  })
})

describe('CEFR level (Phase 5)', () => {
  const ANALYSIS_WITH_CEFR = `## 译文
测试句子。

## 难度
B2

## 句法结构
[n]test[/n]`

  it('extractCefr extracts the level from 难度 section', () => {
    expect(extractCefr(ANALYSIS_WITH_CEFR)).toBe('B2')
  })

  it('extractCefr returns null when section missing', () => {
    expect(extractCefr('## 译文\n\nx')).toBeNull()
  })

  it('extractCefr tolerates extra text around the level', () => {
    const a = `## 难度\n\nThis sentence is B1 level.`
    expect(extractCefr(a)).toBe('B1')
  })

  it('extractCefr returns null for invalid level', () => {
    const a = `## 难度\n\nXYZ`
    expect(extractCefr(a)).toBeNull()
  })

  it('extractCefr handles all 6 valid levels', () => {
    for (const lvl of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) {
      expect(extractCefr(`## 难度\n\n${lvl}`)).toBe(lvl)
    }
  })

  it('SENTENCE_CARD_SYSTEM_PROMPT includes a 难度 section instructing CEFR output', () => {
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('## 难度')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('A1')
    expect(SENTENCE_CARD_SYSTEM_PROMPT).toContain('C2')
  })
})
