import { describe, it, expect } from 'vitest'
import { toMarkdown, toObsidian, toNotionProperties } from '../src/shared/exporters'
import type { Highlight } from '../src/shared/highlights'

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
