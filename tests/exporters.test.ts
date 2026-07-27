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
