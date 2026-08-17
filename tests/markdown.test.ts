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

  it('does not re-process inline code content with later inline rules', () => {
    // Bold/link markers inside a code span must stay literal…
    let out = renderMarkdown('`**x**` and `[a](https://x)`')
    expect(out).toContain('<code>**x**</code>')
    expect(out).not.toContain('<code><strong>')
    expect(out).toContain('<code>[a](https://x)</code>')
    expect(out).not.toContain('<code><a')
    // …while the same markers OUTSIDE code spans still apply.
    out = renderMarkdown('`**x**` vs **real bold**')
    expect(out).toContain('<strong>real bold</strong>')
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

describe('POS color tags', () => {
  it('renders [n]word[/n] as a colored noun span', () => {
    const out = renderMarkdown('[n]fox[/n]')
    expect(out).toContain('<span class="lector-pos lector-pos-n">fox</span>')
  })

  it('renders all 8 POS types with their class', () => {
    const tagged = '[n]fox[/n] [v]runs[/v] [a]quick[/a] [d]fast[/d] [p]on[/p] [c]and[/c] [r]she[/r] [t]the[/t]'
    const out = renderMarkdown(tagged)
    expect(out).toContain('lector-pos-n">fox')
    expect(out).toContain('lector-pos-v">runs')
    expect(out).toContain('lector-pos-a">quick')
    expect(out).toContain('lector-pos-d">fast')
    expect(out).toContain('lector-pos-p">on')
    expect(out).toContain('lector-pos-c">and')
    expect(out).toContain('lector-pos-r">she')
    expect(out).toContain('lector-pos-t">the')
  })

  it('does NOT colorize unknown tag letters (degrades to plain text)', () => {
    const out = renderMarkdown('[x]unknown[/x]')
    expect(out).not.toContain('lector-pos')
    expect(out).toContain('[x]unknown[/x]')
  })

  it('works inside a sentence with surrounding plain words', () => {
    const out = renderMarkdown('The [n]fox[/n] jumps.')
    expect(out).toContain('lector-pos-n">fox')
    expect(out).toContain('The ')
    expect(out).toContain(' jumps.')
  })

  it('escapes HTML inside the tagged word (XSS-safe)', () => {
    const out = renderMarkdown('[n]<script>[/n]')
    expect(out).toContain('lector-pos-n">&lt;script&gt;')
    expect(out).not.toContain('<script>')
  })

  it('renders correctly when analysis has no POS tags (backward compat)', () => {
    const out = renderMarkdown('## 句法结构\n\n主谓宾结构清晰。')
    expect(out).toContain('主谓宾结构清晰。')
    expect(out).not.toContain('lector-pos')
  })
})
