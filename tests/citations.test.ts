import { describe, it, expect } from 'vitest'
import {
  parseCitations,
  buildCitedSystemPrompt,
  renderCitations,
  type PageBlock,
} from '../src/shared/citations'

describe('parseCitations', () => {
  const valid = new Set(['b0', 'b1', 'b2'])
  it('extracts valid bracketed ids', () => {
    expect(parseCitations('trust matters [0][2].', valid)).toEqual([
      { raw: 'b0', display: '0' },
      { raw: 'b2', display: '2' },
    ])
  })
  it('drops ids not in the whitelist', () => {
    expect(parseCitations('nope [99] and [0].', valid)).toEqual([
      { raw: 'b0', display: '0' },
    ])
  })
  it('accepts [bN] form too', () => {
    expect(parseCitations('see [b1] here', valid)).toEqual([
      { raw: 'b1', display: '1' },
    ])
  })
  it('returns empty for text without markers', () => {
    expect(parseCitations('nothing here', valid)).toEqual([])
  })
})

describe('buildCitedSystemPrompt', () => {
  const blocks: PageBlock[] = [
    { id: 'b0', text: 'First paragraph.', domSelector: 'p' },
    { id: 'b1', text: 'Second paragraph.', domSelector: 'p' },
  ]
  it('prefixes each block with its id and includes citation instructions', () => {
    const out = buildCitedSystemPrompt(blocks)
    expect(out).toContain('[b0] First paragraph.')
    expect(out).toContain('[b1] Second paragraph.')
    expect(out).toContain('cite ONLY these ids')
  })
  it('is empty-safe', () => {
    expect(buildCitedSystemPrompt([])).not.toContain('[b0]')
  })
})

describe('renderCitations', () => {
  const valid = new Set(['b0', 'b1'])
  it('replaces [bN] with a chip', () => {
    const html = renderCitations('trust matters [0][1].', valid)
    expect(html).toContain('data-cite="b0"')
    expect(html).toContain('data-cite="b1"')
    // Each marker becomes a chip; no bare marker text remains outside a chip.
    expect(html).not.toMatch(/[^"]\[0\][^<]/)
  })
  it('leaves invalid markers stripped (no chip, no bracket)', () => {
    const html = renderCitations('bad [99] here.', valid)
    expect(html).not.toContain('data-cite')
    expect(html).not.toMatch(/\[99\]/)
  })
  it('leaves code spans untouched — arr[0] is indexing, not a citation', () => {
    const html = renderCitations('use <code>arr[0]</code> first, source says [0].', valid)
    // The code span keeps its raw bracket text and gains NO chip.
    expect(html).toContain('<code>arr[0]</code>')
    // Prose outside the span still gets its chip.
    expect(html).toContain('data-cite="b0"')
  })
  it('leaves pre/code blocks untouched (multi-line, multiple indexes)', () => {
    const code = '<pre><code>const x = items[1];\nreturn matrix[7][0];</code></pre>'
    const html = renderCitations(`before [0] ${code} after [1].`, valid)
    expect(html).toContain(code)
    expect(html).toContain('data-cite="b0"')
    expect(html).toContain('data-cite="b1"')
  })
  it('returns the html unchanged when the page has no citable blocks', () => {
    const raw = 'the [0] and [42] brackets are plain prose here'
    expect(renderCitations(raw, new Set())).toBe(raw)
  })
})
