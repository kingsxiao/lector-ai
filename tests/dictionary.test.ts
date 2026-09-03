import { describe, it, expect } from 'vitest'
import {
  isWordLookupQuery,
  buildDictionarySystemPrompt,
  buildDictionaryUserPrompt,
  parseDictionaryCard,
} from '../src/shared/dictionary'

describe('isWordLookupQuery', () => {
  it('accepts single words and short phrases', () => {
    expect(isWordLookupQuery('resilience')).toBe(true)
    expect(isWordLookupQuery('  state-of-the-art ')).toBe(true)
    expect(isWordLookupQuery('look up')).toBe(true)
    expect(isWordLookupQuery('well known')).toBe(true)
    expect(isWordLookupQuery('数据库')).toBe(true)
  })
  it('rejects sentences and long selections', () => {
    expect(isWordLookupQuery('He left.')).toBe(false)
    expect(isWordLookupQuery('What is this?')).toBe(false)
    expect(isWordLookupQuery('这是完整的一句话，不应查词。')).toBe(false)
    expect(isWordLookupQuery('one two three four')).toBe(false)
    expect(isWordLookupQuery('a'.repeat(60))).toBe(false)
  })
  it('rejects non-words', () => {
    expect(isWordLookupQuery('')).toBe(false)
    expect(isWordLookupQuery('   ')).toBe(false)
    expect(isWordLookupQuery('123')).toBe(false)
    expect(isWordLookupQuery('!!!')).toBe(false)
  })
})

describe('dictionary prompts', () => {
  it('system prompt names the target language and demands strict JSON', () => {
    const sys = buildDictionarySystemPrompt('zh')
    expect(sys).toContain('Chinese (Simplified)')
    expect(sys).toContain('"senses"')
    expect(sys).toContain('ONLY one JSON object')
    expect(sys).toContain('TERM_JSON')
  })
  it('user prompt wraps the term as a JSON string literal', () => {
    const user = buildDictionaryUserPrompt('resilience', 'zh')
    expect(user).toContain('TERM_JSON:')
    expect(user).toContain(JSON.stringify('resilience'))
    expect(user).toContain('Chinese (Simplified)')
  })
})

describe('parseDictionaryCard', () => {
  const payload = {
    word: 'resilience',
    phonetic_us: '/rɪˈzɪliəns/',
    phonetic_uk: '/rɪˈzɪliəns/',
    cefr: 'C1',
    frequency: '学术与商业语境常用',
    senses: [
      {
        pos: 'n.',
        gloss: '韧性；快速恢复的能力',
        example: 'The system showed remarkable resilience under load.',
        example_gloss: '该系统在高负载下表现出卓越的韧性。',
      },
      { pos: 'n.', gloss: '（心理）复原力' },
    ],
    note: '不可数名词',
  }
  it('parses a clean JSON object', () => {
    const card = parseDictionaryCard(JSON.stringify(payload), 'resilience')!
    expect(card.word).toBe('resilience')
    expect(card.phoneticUs).toBe('/rɪˈzɪliəns/')
    expect(card.cefr).toBe('C1')
    expect(card.senses).toHaveLength(2)
    expect(card.senses[0].exampleTranslation).toContain('韧性')
    expect(card.senses[1].example).toBeUndefined()
  })
  it('strips markdown fences and surrounding prose', () => {
    const fenced = '```json\n' + JSON.stringify(payload) + '\n```'
    expect(parseDictionaryCard(fenced, 'resilience')?.senses).toHaveLength(2)
    const chatty = 'Here is the result:\n' + JSON.stringify(payload) + '\nHope it helps!'
    expect(parseDictionaryCard(chatty, 'resilience')?.word).toBe('resilience')
  })
  it('falls back to the selected word and drops junk fields', () => {
    const card = parseDictionaryCard(
      JSON.stringify({ senses: [{ gloss: '韧性' }], cefr: 'X9', phonetic_us: 42 }),
      ' resilience '
    )!
    expect(card.word).toBe('resilience')
    expect(card.cefr).toBeUndefined()
    expect(card.phoneticUs).toBeUndefined()
    expect(card.senses[0].pos).toBe('—')
  })
  it('returns null for unusable payloads', () => {
    expect(parseDictionaryCard('', 'x')).toBeNull()
    expect(parseDictionaryCard('not json at all', 'x')).toBeNull()
    expect(parseDictionaryCard('{"word":"x"}', 'x')).toBeNull() // no senses
    expect(parseDictionaryCard('{"senses":[{"pos":"n."}]}', 'x')).toBeNull() // gloss missing
  })
  it('caps senses at 5 and long fields at 300 chars', () => {
    const many = {
      senses: Array.from({ length: 9 }, (_, i) => ({ pos: 'n.', gloss: '义项' + i })),
    }
    expect(parseDictionaryCard(JSON.stringify(many), 'w')?.senses).toHaveLength(5)
    const long = { senses: [{ gloss: 'x'.repeat(500) }] }
    expect(parseDictionaryCard(JSON.stringify(long), 'w')!.senses[0].gloss.length).toBe(300)
  })
})
