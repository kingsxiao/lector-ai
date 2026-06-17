// Tiny, dependency-free Markdown → HTML renderer.
//
// Scope: the things an assistant actually emits in this product — headings,
// bold/italic, inline code, fenced code blocks, unordered/ordered lists,
// blockquotes, links, paragraphs. We intentionally do NOT support raw HTML:
// all user/AI text is escaped first, then our own tags are applied, so this
// is XSS-safe by construction.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(s: string): string {
  let out = escapeHtml(s)
  // inline code first so its content isn't re-processed
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  // italic
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>')
  // links [text](url) — only http/https. Group 1 = text, group 2 = url, so the
  // href gets the url (not the text).
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
  })
  return out
}

export function renderMarkdown(src: string): string {
  if (!src) return ''
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []

  let i = 0
  let inUl = false
  let inOl = false

  const closeLists = () => {
    if (inUl) {
      html.push('</ul>')
      inUl = false
    }
    if (inOl) {
      html.push('</ol>')
      inOl = false
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const fence = line.match(/^```(\w+)?\s*$/)
    if (fence) {
      closeLists()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      i++ // skip closing fence
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      closeLists()
      const level = h[1].length
      html.push(`<h${level}>${renderInline(h[2])}</h${level}>`)
      i++
      continue
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      closeLists()
      const quote = line.replace(/^>\s?/, '')
      html.push(`<blockquote>${renderInline(quote)}</blockquote>`)
      i++
      continue
    }

    // Unordered list item
    const ul = line.match(/^[-*+]\s+(.*)$/)
    if (ul) {
      if (inOl) {
        html.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        html.push('<ul>')
        inUl = true
      }
      html.push(`<li>${renderInline(ul[1])}</li>`)
      i++
      continue
    }

    // Ordered list item
    const ol = line.match(/^\d+\.\s+(.*)$/)
    if (ol) {
      if (inUl) {
        html.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        html.push('<ol>')
        inOl = true
      }
      html.push(`<li>${renderInline(ol[1])}</li>`)
      i++
      continue
    }

    // Blank line
    if (line.trim() === '') {
      closeLists()
      i++
      continue
    }

    // Paragraph (accumulate consecutive non-empty, non-special lines)
    closeLists()
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    html.push(`<p>${renderInline(para.join(' '))}</p>`)
  }

  closeLists()
  return html.join('\n')
}
