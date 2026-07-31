import { describe, it, expect } from 'vitest'
import {
  TRANSLATION_PERSONAS,
  getPersona,
  isValidPersonaId,
  personaPrompt,
} from '../src/shared/translationPersonas'
import { buildTranslateSystemPrompt } from '../src/shared/translation'

describe('TRANSLATION_PERSONAS', () => {
  it('has unique ids with bilingual labels', () => {
    const ids = TRANSLATION_PERSONAS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of TRANSLATION_PERSONAS) {
      expect(p.en.length).toBeGreaterThan(0)
      expect(p.zh.length).toBeGreaterThan(0)
    }
  })
  it('includes the agreed preset set', () => {
    const ids = TRANSLATION_PERSONAS.map((p) => p.id)
    for (const id of ['general', 'academic', 'tech', 'colloquial', 'literary', 'news', 'business']) {
      expect(ids).toContain(id)
    }
  })
  it('general persona has an empty prompt (so the base prompt is unchanged)', () => {
    expect(TRANSLATION_PERSONAS[0].id).toBe('general')
    expect(TRANSLATION_PERSONAS[0].prompt).toBe('')
  })
})

describe('getPersona / isValidPersonaId', () => {
  it('returns the def for a known id', () => {
    expect(getPersona('academic').en).toBe('Academic')
  })
  it('falls back to general for unknown id', () => {
    expect(getPersona('nope').id).toBe('general')
  })
  it('validates ids', () => {
    expect(isValidPersonaId('tech')).toBe(true)
    expect(isValidPersonaId('nope')).toBe(false)
  })
})

describe('personaPrompt', () => {
  it('returns empty for general', () => {
    expect(personaPrompt('general')).toBe('')
  })
  it('returns the sub-prompt for a specialized persona', () => {
    expect(personaPrompt('academic').length).toBeGreaterThan(0)
  })
})

describe('buildTranslateSystemPrompt + persona integration', () => {
  // The persona sub-prompt must be spliced in while preserving the hard
  // output-language requirement (regression guard for the English→English fix).
  it('general persona leaves the prompt unchanged (back-compat)', () => {
    const base = buildTranslateSystemPrompt('zh', '')
    const withGeneral = buildTranslateSystemPrompt('zh', '', personaPrompt('general'))
    expect(withGeneral).toBe(base)
  })
  it('specialized persona is included and still names the target language', () => {
    const p = buildTranslateSystemPrompt('zh', '', personaPrompt('academic'))
    expect(p).toContain('academic register')
    expect(p.toLowerCase()).toContain('chinese')
  })
  it('persona + glossary are both present, persona before glossary', () => {
    const p = buildTranslateSystemPrompt('en', 'GLOSSARY:\n- AI → 人工智能', personaPrompt('tech'))
    const techIdx = p.indexOf('technical-writing register')
    const glossIdx = p.indexOf('GLOSSARY')
    expect(techIdx).toBeGreaterThan(-1)
    expect(glossIdx).toBeGreaterThan(-1)
    expect(techIdx).toBeLessThan(glossIdx)
  })
})
