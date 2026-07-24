import { describe, it, expect } from 'vitest'
import {
  LANGUAGES,
  detectScript,
  resolveTargetLang,
  getLanguage,
  buildTranslateSystemPrompt,
  filterGlossaryForDirection,
  type TargetLangCode,
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
