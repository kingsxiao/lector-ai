import { describe, it, expect } from 'vitest'
import {
  LANGUAGES,
  detectScript,
  resolveTargetLang,
  getLanguage,
  type TargetLangCode,
} from '../src/shared/translation'

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
