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
})
