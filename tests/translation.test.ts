import { describe, it, expect } from 'vitest'
import {
  LANGUAGES,
  detectScript,
  resolveTargetLang,
  getLanguage,
  buildTranslateSystemPrompt,
  filterGlossaryForDirection,
  runConcurrent,
  shouldTranslateBlock,
  TRANSLATABLE_TAGS,
  EXCLUDED_ANCESTOR_TAGS,
  appendHistory,
  newHistoryId,
  BATCH_SEP,
  buildBatchPrompt,
  parseBatchResult,
  isValidDisplayMode,
  type TargetLangCode,
  type TranslationHistoryEntry,
  type BlockCandidate,
} from '../src/shared/translation'
import type { GlossaryEntry } from '../src/shared/glossary'

const ge = (id: string, source: string, target: string, enabled = true): GlossaryEntry => ({
  id, source, target, enabled, createdAt: 1000,
})

describe('LANGUAGES', () => {
  it('has 12 entries with unique codes and non-empty speechCode', () => {
    expect(LANGUAGES).toHaveLength(12)
    const codes = LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(12)
    for (const l of LANGUAGES) {
      expect(l.speechCode.length).toBeGreaterThan(0)
      expect(l.en.length).toBeGreaterThan(0)
      expect(l.zh.length).toBeGreaterThan(0)
    }
  })
  it('lists zh and en first', () => {
    expect(LANGUAGES[0].code).toBe('zh')
    expect(LANGUAGES[1].code).toBe('en')
  })
})

describe('getLanguage', () => {
  it('returns the def for a known code', () => {
    expect(getLanguage('ja').zh).toBe('日语')
  })
  it('falls back to en for unknown code', () => {
    expect(getLanguage('xx' as TargetLangCode).code).toBe('en')
  })
})

describe('detectScript', () => {
  it('detects cjk', () => {
    expect(detectScript('你好世界，这是一段中文')).toBe('cjk')
  })
  it('detects latin', () => {
    expect(detectScript('Hello world this is English')).toBe('latin')
  })
  it('detects cyrillic', () => {
    expect(detectScript('Привет мир')).toBe('cyrillic')
  })
  it('detects arabic', () => {
    expect(detectScript('مرحبا بالعالم')).toBe('arabic')
  })
})

describe('resolveTargetLang', () => {
  it('auto + cjk source -> en', () => {
    expect(resolveTargetLang('auto', '你好世界')).toBe('en')
  })
  it('auto + latin source -> zh', () => {
    expect(resolveTargetLang('auto', 'Hello world')).toBe('zh')
  })
  it('auto + cyrillic source -> zh', () => {
    expect(resolveTargetLang('auto', 'Привет')).toBe('zh')
  })
  it('explicit override wins', () => {
    expect(resolveTargetLang('ja', '你好')).toBe('ja')
  })
})

describe('buildTranslateSystemPrompt', () => {
  it('includes the target language name', () => {
    const p = buildTranslateSystemPrompt('ja', '')
    expect(p).toContain('Japanese')
    expect(p).toContain('Output ONLY')
  })
  it('appends glossary block when provided', () => {
    const p = buildTranslateSystemPrompt('en', 'GLOSSARY (translate these terms consistently):\n- LLM → 大语言模型')
    expect(p).toContain('LLM → 大语言模型')
  })
  it('omits glossary section when empty', () => {
    const p = buildTranslateSystemPrompt('en', '')
    expect(p).not.toContain('GLOSSARY')
  })
})

describe('filterGlossaryForDirection', () => {
  it('keeps cjk-source entries when translating to en', () => {
    const entries = [
      ge('1', '大语言模型', 'LLM'),
      ge('2', 'RAG', '检索增强生成'),
    ]
    const out = filterGlossaryForDirection(entries, 'en')
    expect(out.map((e) => e.id)).toEqual(['1'])
  })
  it('keeps latin-source entries when translating to zh', () => {
    const entries = [
      ge('1', '大语言模型', 'LLM'),
      ge('2', 'RAG', '检索增强生成'),
    ]
    const out = filterGlossaryForDirection(entries, 'zh')
    expect(out.map((e) => e.id)).toEqual(['2'])
  })
  it('returns all enabled when target is neither zh nor en', () => {
    const entries = [ge('1', 'A', 'B'), ge('2', 'C', 'D')]
    const out = filterGlossaryForDirection(entries, 'ja')
    expect(out).toHaveLength(2)
  })
  it('drops disabled entries', () => {
    const entries = [ge('1', 'RAG', '检索增强生成', false)]
    expect(filterGlossaryForDirection(entries, 'zh')).toHaveLength(0)
  })
})

describe('runConcurrent', () => {
  it('respects the concurrency limit', async () => {
    let inflight = 0
    let maxInflight = 0
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const worker = async (n: number) => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise((r) => setTimeout(r, 10))
      inflight--
      return n * 2
    }
    const results = await runConcurrent(items, worker, { concurrency: 3 })
    expect(maxInflight).toBeLessThanOrEqual(3)
    expect(results).toHaveLength(8)
    expect(results.every((r) => r.ok)).toBe(true)
    expect((results[0] as { value: number }).value).toBe(2)
  })

  it('isolates per-task errors (does not throw, marks failing tasks)', async () => {
    const items = [1, 2, 3]
    const worker = async (n: number) => {
      if (n === 2) throw new Error('boom')
      return n
    }
    const results = await runConcurrent(items, worker, { concurrency: 2 })
    expect(results[0]).toEqual({ ok: true, value: 1 })
    expect(results[1].ok).toBe(false)
    expect(results[2]).toEqual({ ok: true, value: 3 })
  })

  it('aborts remaining tasks when signal aborts', async () => {
    const controller = new AbortController()
    const started: number[] = []
    const items = [1, 2, 3, 4, 5]
    const worker = async (n: number) => {
      started.push(n)
      await new Promise((r) => setTimeout(r, 50))
      return n
    }
    setTimeout(() => controller.abort(), 20)
    const results = await runConcurrent(items, worker, { concurrency: 2, signal: controller.signal })
    expect(started.length).toBeLessThan(items.length)
    const aborted = results.filter((r) => !r.ok)
    expect(aborted.length).toBeGreaterThan(0)
  })
})

describe('shouldTranslateBlock', () => {
  const cand = (over: Partial<BlockCandidate>): BlockCandidate => ({
    text: 'Hello world this is a normal paragraph with enough text',
    tag: 'P',
    isInsideExcluded: false,
    isAlreadyTranslated: false,
    textRatio: 0.9,
    ...over,
  })
  it('accepts a normal paragraph', () => {
    expect(shouldTranslateBlock(cand({}))).toBe(true)
  })
  it('rejects too-short text', () => {
    expect(shouldTranslateBlock(cand({ text: 'hi' }))).toBe(false)
  })
  it('rejects too-long text', () => {
    expect(shouldTranslateBlock(cand({ text: 'x'.repeat(2001) }))).toBe(false)
  })
  it('rejects excluded ancestor', () => {
    expect(shouldTranslateBlock(cand({ isInsideExcluded: true }))).toBe(false)
  })
  it('rejects already-translated', () => {
    expect(shouldTranslateBlock(cand({ isAlreadyTranslated: true }))).toBe(false)
  })
  it('rejects low text ratio', () => {
    expect(shouldTranslateBlock(cand({ textRatio: 0.3 }))).toBe(false)
  })
  it('rejects non-translatable tag', () => {
    expect(shouldTranslateBlock(cand({ tag: 'DIV' }))).toBe(false)
  })
  it('accepts a heading', () => {
    expect(shouldTranslateBlock(cand({ tag: 'H2', text: 'A meaningful heading here' }))).toBe(true)
  })
})

describe('tag lists', () => {
  it('TRANSLATABLE_TAGS includes core block tags', () => {
    expect(TRANSLATABLE_TAGS.has('P')).toBe(true)
    expect(TRANSLATABLE_TAGS.has('H1')).toBe(true)
    expect(TRANSLATABLE_TAGS.has('LI')).toBe(true)
    expect(TRANSLATABLE_TAGS.has('BLOCKQUOTE')).toBe(true)
  })
  it('EXCLUDED_ANCESTOR_TAGS includes code/pre/script', () => {
    expect(EXCLUDED_ANCESTOR_TAGS.has('CODE')).toBe(true)
    expect(EXCLUDED_ANCESTOR_TAGS.has('PRE')).toBe(true)
    expect(EXCLUDED_ANCESTOR_TAGS.has('SCRIPT')).toBe(true)
  })
})

describe('appendHistory', () => {
  const he = (id: string, source: string, target: string, targetLang: TargetLangCode, createdAt = 1000): TranslationHistoryEntry => ({
    id, source, target, sourceLang: 'auto', targetLang, kind: 'selection', url: 'https://x', createdAt,
  })
  it('prepends new entries', () => {
    const out = appendHistory([], he('1', 'a', 'A', 'en'))
    expect(out[0].id).toBe('1')
  })
  it('dedupes by source+targetLang keeping newest', () => {
    const list = [he('1', 'a', 'A', 'en', 1000)]
    const out = appendHistory(list, he('2', 'a', 'A2', 'en', 2000))
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('2')
    expect(out[0].target).toBe('A2')
  })
  it('keeps different targetLang for same source', () => {
    const list = [he('1', 'a', 'A', 'en')]
    const out = appendHistory(list, he('2', 'a', '甲', 'zh'))
    expect(out).toHaveLength(2)
  })
  it('caps at max (default 200)', () => {
    const list = Array.from({ length: 200 }, (_, i) => he(String(i), `s${i}`, `t${i}`, 'en', i))
    const out = appendHistory(list, he('new', 's', 't', 'en', 999))
    expect(out).toHaveLength(200)
    expect(out[0].id).toBe('new')
  })
  it('truncates source/target to 200 chars', () => {
    const long = 'x'.repeat(500)
    const out = appendHistory([], he('1', long, long, 'en'))
    expect(out[0].source.length).toBe(200)
    expect(out[0].target.length).toBe(200)
  })
})

describe('newHistoryId', () => {
  it('produces a non-empty string', () => {
    expect(newHistoryId().length).toBeGreaterThan(0)
  })
})

describe('batch prompt', () => {
  it('round-trips N items via the separator', () => {
    const { system, user } = buildBatchPrompt(['hello', 'world'], 'zh', '')
    expect(system).toContain('Chinese')
    const parts = parseBatchResult('你好' + BATCH_SEP + '世界', 2)
    expect(parts).toEqual(['你好', '世界'])
  })
  it('parseBatchResult pads missing parts', () => {
    const parts = parseBatchResult('only one', 3)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('only one')
    expect(parts[1]).toBe('')
    expect(parts[2]).toBe('')
  })
  it('parseBatchResult trims extra parts', () => {
    const parts = parseBatchResult('a' + BATCH_SEP + 'b' + BATCH_SEP + 'c', 2)
    expect(parts).toEqual(['a', 'b'])
  })
})

describe('isValidDisplayMode', () => {
  it('accepts the three modes', () => {
    expect(isValidDisplayMode('bilingual')).toBe(true)
    expect(isValidDisplayMode('translationOnly')).toBe(true)
    expect(isValidDisplayMode('hover')).toBe(true)
  })
  it('rejects unknown', () => {
    expect(isValidDisplayMode('xxx')).toBe(false)
  })
})
