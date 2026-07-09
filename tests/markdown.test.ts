import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../src/sidepanel/markdown'

describe('renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('renders a paragraph', () => {
    const out = renderMarkdown('Hello world.')
    expect(out).toContain('<p>Hello world.</p>')
  })

  it('renders headings h1–h3', () => {
    const out = renderMarkdown('# Title\n## Sub\n### Subsub')
    expect(out).toContain('<h1>Title</h1>')
    expect(out).toContain('<h2>Sub</h2>')
    expect(out).toContain('<h3>Subsub</h3>')
  })

  it('renders bold and italic inline', () => {
    const out = renderMarkdown('**bold** and *italic* and __b__')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
    expect(out).toContain('<strong>b</strong>')
  })

  it('renders inline code', () => {
    const out = renderMarkdown('Use `const x = 1` here')
    expect(out).toContain('<code>const x = 1</code>')
  })

  it('renders fenced code blocks and escapes inner HTML', () => {
    const out = renderMarkdown('```\n<a href="x">hi</a>\n```')
    expect(out).toContain('<pre><code>')
    // raw HTML inside the code block must be escaped
    expect(out).toContain('&lt;a href=&quot;x&quot;&gt;')
    expect(out).not.toContain('<a href="x">')
  })

  it('renders unordered and ordered lists', () => {
    const out = renderMarkdown('- one\n- two\n\n1. first\n2. second')
    expect(out).toContain('<ul>')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('<li>two</li>')
    expect(out).toContain('<ol>')
    expect(out).toContain('<li>first</li>')
    expect(out).toContain('<li>second</li>')
  })

  it('renders blockquotes', () => {
    const out = renderMarkdown('> quoted text')
    expect(out).toContain('<blockquote>quoted text</blockquote>')
  })

  it('renders http/https links and preserves text', () => {
    const out = renderMarkdown('[click](https://example.com)')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('>click<')
  })

  it('does NOT render javascript: links', () => {
    const out = renderMarkdown('[bad](javascript:alert(1))')
    expect(out).not.toContain('href="javascript:')
  })

  it('escapes raw HTML in paragraphs (XSS-safe)', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})
