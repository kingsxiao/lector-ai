import { describe, it, expect } from 'vitest'
import {
  fillTemplate,
  filterTemplates,
  sortTemplates,
  newTemplateId,
  validateTemplate,
  BUILTIN_TEMPLATES,
  type PromptTemplate,
} from '../src/shared/promptTemplates'

const tpl = (
  id: string,
  title: string,
  order: number,
  content = 'c',
  builtIn = false
): PromptTemplate => ({ id, title, content, builtIn, order })

describe('fillTemplate', () => {
  const ctx = { selection: 'hello', page: 'world', lang: 'en' }

  it('replaces all known placeholders', () => {
    expect(fillTemplate('{selection} {page} {lang}', ctx)).toBe('hello world en')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(fillTemplate('{selection} {unknown}', ctx)).toBe('hello {unknown}')
  })

  it('handles empty context values', () => {
    expect(fillTemplate('[{selection}]', { selection: '', page: '', lang: '' })).toBe('[]')
  })

  it('replaces repeated placeholders', () => {
    expect(fillTemplate('{selection}-{selection}', ctx)).toBe('hello-hello')
  })

  // Regression: String.prototype.replace with a STRING replacement interprets
  // $&, $', $`, $$, $n as special patterns. User content (selection/page)
  // containing $ — prices, shell vars, code — was silently corrupted before
  // reaching the AI. A function replacement (or split/join) treats the value
  // verbatim.
  it('does not mangle selection content containing $ patterns', () => {
    expect(fillTemplate('{selection}', { selection: '$$', page: '', lang: '' })).toBe('$$')
    expect(fillTemplate('{selection}', { selection: 'a$&b', page: '', lang: '' })).toBe('a$&b')
    expect(fillTemplate('{selection}', { selection: "x$'y", page: '', lang: '' })).toBe("x$'y")
    expect(fillTemplate('Total: {selection}', { selection: '$5.00', page: '', lang: '' })).toBe(
      'Total: $5.00'
    )
    expect(fillTemplate('{selection}', { selection: 'echo $HOME', page: '', lang: '' })).toBe(
      'echo $HOME'
    )
  })

  // Regression: the three .replace() calls ran sequentially, so a selection
  // value that literally contained "{page}" or "{lang}" got re-substituted by
  // the next stage (cross-contamination). A single-pass replace eliminates it.
  it('does not re-substitute a placeholder-shaped selection value', () => {
    expect(
      fillTemplate('{selection}', { selection: '{page}', page: 'INJECTED', lang: '' })
    ).toBe('{page}')
    expect(
      fillTemplate('{selection}', { selection: '{lang}', page: '', lang: 'INJECTED' })
    ).toBe('{lang}')
    expect(
      fillTemplate('{selection} {page}', { selection: '{page}', page: 'P', lang: '' })
    ).toBe('{page} P')
  })
})

describe('filterTemplates', () => {
  const list = [
    tpl('1', 'Summarize', 0, 'Summarize this'),
    tpl('2', 'Translate', 1, 'Translate to English'),
    tpl('3', 'ELI5', 2, 'Explain like five'),
  ]

  it('returns all when query is empty', () => {
    expect(filterTemplates(list, '').length).toBe(3)
  })

  it('matches title case-insensitively', () => {
    expect(filterTemplates(list, 'trans').map((t) => t.id)).toEqual(['2'])
  })

  it('matches content', () => {
    expect(filterTemplates(list, 'english').map((t) => t.id)).toEqual(['2'])
  })

  it('returns empty when nothing matches', () => {
    expect(filterTemplates(list, 'xyz')).toEqual([])
  })
})

describe('sortTemplates', () => {
  it('sorts by order ascending', () => {
    const list = [tpl('a', 'A', 5), tpl('b', 'B', 1), tpl('c', 'C', 3)]
    expect(sortTemplates(list).map((t) => t.id)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input', () => {
    const list = [tpl('a', 'A', 2), tpl('b', 'B', 1)]
    const original = list.map((t) => t.id)
    sortTemplates(list)
    expect(list.map((t) => t.id)).toEqual(original)
  })
})

describe('validateTemplate', () => {
  it('rejects empty title', () => {
    expect(validateTemplate({ title: '   ', content: 'x' }).ok).toBe(false)
  })

  it('rejects empty content', () => {
    expect(validateTemplate({ title: 't', content: '' }).ok).toBe(false)
  })

  it('rejects content over 2000 chars', () => {
    expect(validateTemplate({ title: 't', content: 'x'.repeat(2001) }).ok).toBe(false)
  })

  it('accepts valid template', () => {
    expect(validateTemplate({ title: 't', content: 'x' }).ok).toBe(true)
  })

  it('accepts exactly 2000 chars', () => {
    expect(validateTemplate({ title: 't', content: 'x'.repeat(2000) }).ok).toBe(true)
  })
})

describe('newTemplateId', () => {
  it('generates unique ids', () => {
    const a = newTemplateId()
    const b = newTemplateId()
    expect(a).not.toBe(b)
    expect(a.startsWith('tpl_')).toBe(true)
  })
})

describe('BUILTIN_TEMPLATES', () => {
  it('has 10 templates with sequential orders', () => {
    expect(BUILTIN_TEMPLATES.length).toBe(10)
    expect(BUILTIN_TEMPLATES.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('all built-ins are marked builtIn and have titleKey', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.builtIn).toBe(true)
      expect(t.titleKey).toBeTruthy()
    }
  })

  it('all ids are unique', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
