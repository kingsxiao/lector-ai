import { describe, it, expect } from 'vitest'
import { toMarkdown, toObsidian, toNotionProperties, sessionToMarkdown, toAnkiTsv } from '../src/shared/exporters'
import type { Highlight } from '../src/shared/highlights'
import type { VocabEntry } from '../src/shared/vocabulary'

const hs: Highlight[] = [
  {
    id: 'h1',
    text: 'Trust matters.',
    note: 'key idea',
    quote: 'In software, Trust matters.',
    url: 'https://a.com/p',
    title: 'Post',
    blockId: 'b0',
    createdAt: 1000,
    color: 'yellow',
  },
]

describe('toMarkdown', () => {
  it('emits a blockquote of the text, note, and source link', () => {
    const out = toMarkdown(hs)
    expect(out).toContain('> Trust matters.')
    expect(out).toContain('key idea')
    expect(out).toContain('https://a.com/p')
  })
  it('omits the note line when note is empty', () => {
    const out = toMarkdown([{ ...hs[0], note: '' }])
    expect(out).not.toContain('**Note:**')
  })
})

describe('toObsidian', () => {
  it('includes front-matter with source and tags', () => {
    const out = toObsidian(hs)
    expect(out).toContain('---')
    expect(out).toContain('source:')
    expect(out).toContain('tags:')
    // The highlight text appears inside an Obsidian callout block.
    expect(out).toContain('[!quote] Trust matters.')
  })
})

// Regression: page-controlled title/url/text previously reached the markdown
// raw. A title like `a](http://evil) x` injected an arbitrary link; a title
// containing `)` truncated the source link; multi-line text broke out of the
// blockquote. Everything must be escaped/quoted now.
describe('export injection safety', () => {
  const hostile: Highlight = {
    ...hs[0],
    title: 'a](https://evil.example) x',
    text: 'line one\nline two',
  }
  it('toMarkdown escapes link-text brackets so no extra link can be injected', () => {
    const out = toMarkdown([hostile])
    // Brackets in the title are escaped (rendered literally, never as links),
    // in both the heading and the source line.
    expect(out).toContain('### a\\](https://evil.example) x')
    expect(out).toContain('Source: [a\\](https://evil.example) x](<https://a.com/p>)')
    // The one real link destination is the highlight URL, angle-bracketed.
    expect(out.match(/\]\(<https:/g)?.length).toBe(1)
  })
  it('toMarkdown prefixes every line of multi-line text as blockquote', () => {
    const out = toMarkdown([hostile])
    expect(out).toContain('> line one\n> line two')
  })
  it('toObsidian quotes multi-line callout bodies and escapes link text', () => {
    const out = toObsidian([hostile])
    // Callout marker and both lines each carry their own `> ` prefix.
    expect(out).toContain('> [!quote] line one\n> line two')
    expect(out).toContain('Source: [a\\](https://evil.example) x](<https://a.com/p>)')
    expect(out).toContain('## a\\](https://evil.example) x')
  })
  it('toObsidian keeps front-matter valid when the URL contains a quote', () => {
    const out = toObsidian([{ ...hs[0], url: 'https://a.com/x"y' }])
    expect(out).toContain('source: ""')
  })
})

describe('toNotionProperties', () => {
  it('produces a create-page properties payload', () => {
    const payload = toNotionProperties(hs[0])
    expect(payload).toHaveProperty('Title')
    expect(payload).toHaveProperty('Source')
    expect(payload).toHaveProperty('Note')
  })

  // Regression: Notion rejects both `title` and `rich_text` content fields
  // longer than 2000 chars with a ValidationError (the whole createPage call
  // fails). Title was sliced; Note was not — a long note nuked the export.
  it('caps the note rich_text content at 2000 chars (Notion API limit)', () => {
    const long = 'x'.repeat(5000)
    const payload = toNotionProperties({ ...hs[0], note: long }) as {
      Note: { rich_text: { text: { content: string } }[] }
    }
    expect(payload.Note.rich_text[0].text.content.length).toBe(2000)
  })
})

describe('sessionToMarkdown', () => {
  const session = {
    id: 's1',
    title: 'My chat',
    url: 'https://a.com/p',
    createdAt: new Date('2026-08-28T10:00:00').getTime(),
    messages: [
      { id: 'm1', role: 'user' as const, content: 'What is this about?' },
      { id: 'm2', role: 'assistant' as const, content: 'It is about **testing**.' },
    ],
  }

  it('emits a header with title, source link and date, then the turns', () => {
    const out = sessionToMarkdown(session)
    expect(out).toContain('# My chat')
    expect(out).toContain('Source: [My chat](<https://a.com/p>)')
    expect(out).toContain('## ❓ What is this about?')
    expect(out).toContain('It is about **testing**.')
  })

  it('escapes markdown-injecting titles like the highlight exporters', () => {
    const out = sessionToMarkdown({ ...session, title: 'a](https://evil.example) x' })
    expect(out).toContain('# a\\](https://evil.example) x')
    expect(out).not.toContain('# a](https://evil.example) x')
  })

  it('omits the source line when the session has no url', () => {
    const out = sessionToMarkdown({ ...session, url: '' })
    expect(out).not.toContain('Source:')
  })
})

describe('toAnkiTsv', () => {
  const entries: VocabEntry[] = [
    {
      id: 'v1', word: 'serendipity', translation: '机缘巧合', context: 'A happy accident.',
      url: 'u', title: 'T', lang: 'en', createdAt: 1,
      srs: { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
    },
    {
      // Commas/quotes/newlines/tabs in fields must not corrupt the row.
      id: 'v2', word: 'tricky, "word"', translation: '难\n词', context: 'has\ttab',
      url: 'u', title: 'T', lang: 'en', createdAt: 1,
      srs: { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
    },
  ]

  it('writes Anki import headers and one tab-separated row per word', () => {
    const out = toAnkiTsv(entries)
    const lines = out.trimEnd().split('\n')
    expect(lines[0]).toBe('#separator:tab')
    expect(lines[1]).toBe('#html:true')
    expect(lines[2]).toBe('#columns:Word\tTranslation\tContext\tSource')
    expect(lines[3]).toBe('serendipity\t机缘巧合\tA happy accident.\tT')
  })

  it('escapes fields containing separators/quotes/newlines', () => {
    const out = toAnkiTsv(entries)
    const row = out.trimEnd().split('\n')[4]
    const fields = row.split('\t')
    expect(fields).toHaveLength(4)
    expect(fields[0]).toBe('"tricky, ""word"""')
    // Newlines become <br> (html:true), tabs become spaces.
    expect(fields[1]).toBe('难<br>词')
    expect(fields[2]).toBe('has tab')
  })
})
