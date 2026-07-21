import { describe, it, expect } from 'vitest'
import {
  validateEntry,
  newEntryId,
  renderGlossaryPrompt,
  exportGlossary,
  importGlossary,
  dedupeEntries,
  type GlossaryEntry,
} from '../src/shared/glossary'

const entry = (
  id: string,
  source: string,
  target: string,
  opts: Partial<GlossaryEntry> = {}
): GlossaryEntry => ({
  id,
  source,
  target,
  enabled: opts.enabled ?? true,
  note: opts.note,
  createdAt: opts.createdAt ?? 1000,
})

describe('validateEntry', () => {
  it('accepts a normal entry', () => {
    expect(validateEntry({ source: 'LLM', target: '大语言模型' }).ok).toBe(true)
  })

  it('rejects empty source', () => {
    expect(validateEntry({ source: '   ', target: 'x' }).ok).toBe(false)
  })

  it('rejects empty target', () => {
    expect(validateEntry({ source: 'x', target: '' }).ok).toBe(false)
  })

  it('rejects source over 200 chars', () => {
    expect(validateEntry({ source: 'a'.repeat(201), target: 'x' }).ok).toBe(false)
  })

  it('rejects target over 200 chars', () => {
    expect(validateEntry({ source: 'x', target: 'a'.repeat(201) }).ok).toBe(false)
  })

  it('accepts exactly 200 chars (boundary)', () => {
    expect(
      validateEntry({ source: 'a'.repeat(200), target: 'b'.repeat(200) }).ok
    ).toBe(true)
  })
})

describe('newEntryId', () => {
  it('generates unique ids with the glossary_ prefix', () => {
    const a = newEntryId()
    const b = newEntryId()
    expect(a).not.toBe(b)
    expect(a.startsWith('glossary_')).toBe(true)
  })
})

describe('renderGlossaryPrompt', () => {
  it('returns empty string for an empty list', () => {
    expect(renderGlossaryPrompt([])).toBe('')
  })

  it('returns empty string when all entries are disabled', () => {
    const list = [
      entry('1', 'LLM', '大语言模型', { enabled: false }),
      entry('2', 'RAG', '检索增强生成', { enabled: false }),
    ]
    expect(renderGlossaryPrompt(list)).toBe('')
  })

  it('filters out disabled entries', () => {
    const list = [
      entry('1', 'LLM', '大语言模型'),
      entry('2', 'RAG', '检索增强生成', { enabled: false }),
    ]
    const out = renderGlossaryPrompt(list)
    expect(out).toContain('LLM → 大语言模型')
    expect(out).not.toContain('RAG')
  })

  it('renders each enabled entry as "source → target"', () => {
    const list = [
      entry('1', 'LLM', '大语言模型'),
      entry('2', 'Hugging Face', '抱抱脸'),
    ]
    const out = renderGlossaryPrompt(list)
    expect(out).toContain('- LLM → 大语言模型')
    expect(out).toContain('- Hugging Face → 抱抱脸')
  })

  it('includes the GLOSSARY header so the model treats it as authoritative', () => {
    const out = renderGlossaryPrompt([entry('1', 'LLM', '大语言模型')])
    expect(out.toLowerCase()).toContain('glossary')
  })

  it('does NOT include notes (notes are UI-only)', () => {
    const out = renderGlossaryPrompt([
      entry('1', 'LLM', '大语言模型', { note: 'internal-only comment' }),
    ])
    expect(out).not.toContain('internal-only comment')
  })
})

describe('exportGlossary / importGlossary round-trip', () => {
  const list: GlossaryEntry[] = [
    entry('1', 'LLM', '大语言模型', { note: 'x', createdAt: 100 }),
    entry('2', 'RAG', '检索增强生成', { enabled: false, createdAt: 200 }),
  ]

  it('round-trips losslessly', () => {
    const json = exportGlossary(list)
    const result = importGlossary(json)
    expect(result.ok).toBe(true)
    expect(result.entries).toEqual(list)
  })

  it('exportGlossary produces pretty JSON for easy manual editing', () => {
    const json = exportGlossary(list)
    // Pretty-printed JSON contains newlines, not a single line.
    expect(json.includes('\n')).toBe(true)
    expect(() => JSON.parse(json)).not.toThrow()
  })
})

describe('importGlossary', () => {
  it('rejects malformed JSON', () => {
    const result = importGlossary('{not json')
    expect(result.ok).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('rejects non-array top-level', () => {
    const result = importGlossary(JSON.stringify({ not: 'an array' }))
    expect(result.ok).toBe(false)
  })

  it('skips entries missing required fields but keeps good ones', () => {
    const dirty = [
      { id: '1', source: 'LLM', target: '大语言模型', enabled: true, createdAt: 100 },
      { id: '2', source: '', target: 'x' }, // bad: empty source
      { id: '3', source: 'RAG' }, // bad: missing target
      { notEven: 'an entry' },
    ]
    const result = importGlossary(JSON.stringify(dirty))
    expect(result.ok).toBe(true)
    expect(result.entries?.length).toBe(1)
    expect(result.entries?.[0].id).toBe('1')
  })

  it('fills defaults for optional fields (enabled=true, createdAt=now)', () => {
    const minimal = [{ id: 'x', source: 'LLM', target: '大语言模型' }]
    const result = importGlossary(JSON.stringify(minimal))
    expect(result.ok).toBe(true)
    expect(result.entries?.[0].enabled).toBe(true)
    expect(typeof result.entries?.[0].createdAt).toBe('number')
  })
})

describe('dedupeEntries', () => {
  it('keeps the earliest-created entry when sources collide case-insensitively', () => {
    const list = [
      entry('1', 'LLM', '旧译文', { createdAt: 500 }),
      entry('2', 'llm', '新译文', { createdAt: 100 }),
      entry('3', 'RAG', '检索增强生成', { createdAt: 300 }),
    ]
    const out = dedupeEntries(list)
    expect(out.length).toBe(2)
    // The earliest (createdAt=100) wins; its target is preserved.
    const llm = out.find((e) => e.source.toLowerCase() === 'llm')
    expect(llm?.target).toBe('新译文')
  })

  it('does not mutate the input', () => {
    const list = [entry('1', 'LLM', 'a'), entry('2', 'llm', 'b')]
    const snapshot = list.map((e) => ({ ...e }))
    dedupeEntries(list)
    expect(list).toEqual(snapshot)
  })

  it('preserves relative order of first occurrences', () => {
    const list = [
      entry('1', 'A', 'a', { createdAt: 1 }),
      entry('2', 'B', 'b', { createdAt: 2 }),
      entry('3', 'A', 'duplicate', { createdAt: 3 }),
    ]
    const out = dedupeEntries(list)
    expect(out.map((e) => e.source)).toEqual(['A', 'B'])
  })

  it('returns empty for empty input', () => {
    expect(dedupeEntries([])).toEqual([])
  })
})
