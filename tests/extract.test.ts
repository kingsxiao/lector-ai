import { describe, it, expect, beforeEach, vi } from 'vitest'

// content.ts registers a chrome.runtime.onMessage listener at module top level,
// so we stub the global `chrome` before importing the module. The handler body
// only runs on incoming messages, which we never emit in these tests.
const chromeStub = vi.hoisted(() => ({
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: () => ({ catch: () => {} }),
    lastError: null as { message?: string } | null,
  },
  storage: {
    local: {
      get: (_keys: string[], cb: (r: Record<string, unknown>) => void) => cb({}),
    },
  },
}))
;(globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub

const { extractPage } = await import('../src/content')

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.title = ''
})

describe('extractPage', () => {
  it('extracts paragraph text from the densest container', () => {
    document.title = 'My Page'
    const main = document.createElement('main')
    const p1 = document.createElement('p')
    p1.textContent = 'This is the first paragraph with enough text to be scored well.'
    const p2 = document.createElement('p')
    p2.textContent = 'Second paragraph here, also reasonably long and meaningful for reading.'
    main.appendChild(p1)
    main.appendChild(p2)
    document.body.appendChild(main)

    const page = extractPage()
    expect(page.title).toBe('My Page')
    expect(page.text).toContain('first paragraph')
    expect(page.text).toContain('Second paragraph')
    expect(page.url).toBe(window.location.href)
  })

  it('tags live DOM nodes with stable data-lector-id block ids', () => {
    const article = document.createElement('article')
    for (let i = 0; i < 3; i++) {
      const p = document.createElement('p')
      p.textContent = `Paragraph number ${i} has some reasonable length content inside it.`
      article.appendChild(p)
    }
    document.body.appendChild(article)

    const page = extractPage()
    expect(page.blocks.length).toBe(3)
    expect(page.blocks[0].id).toBe('b0')
    expect(page.blocks[1].id).toBe('b1')
    expect(page.blocks[2].id).toBe('b2')
    // The live nodes are tagged with matching ids.
    const tagged = document.querySelectorAll('[data-lector-id]')
    expect(tagged.length).toBe(3)
    expect(tagged[0].getAttribute('data-lector-id')).toBe('b0')
  })

  it('detects language for CJK vs latin text', () => {
    const article = document.createElement('article')
    const p = document.createElement('p')
    p.textContent = '这是一段足够长的中文内容，用来测试语言检测功能是否正常工作。'
    article.appendChild(p)
    document.body.appendChild(article)
    expect(extractPage().lang).toBe('zh')

    document.body.innerHTML = ''
    const a2 = document.createElement('article')
    const p2 = document.createElement('p')
    p2.textContent = 'This is a long enough English paragraph to test language detection.'
    a2.appendChild(p2)
    document.body.appendChild(a2)
    expect(extractPage().lang).toBe('en')
  })

  it('skips empty / whitespace-only blocks', () => {
    const article = document.createElement('article')
    const empty = document.createElement('p')
    empty.textContent = '   '
    const real = document.createElement('p')
    real.textContent = 'A real paragraph with actual content worth extracting here.'
    article.appendChild(empty)
    article.appendChild(real)
    document.body.appendChild(article)

    const page = extractPage()
    expect(page.blocks.length).toBe(1)
    expect(page.blocks[0].text).toContain('real paragraph')
  })

  it('falls back to document.title when no h1 is present', () => {
    document.title = 'Fallback Title'
    const article = document.createElement('article')
    const p = document.createElement('p')
    p.textContent = 'Some content that is long enough to be picked up by the scorer here.'
    article.appendChild(p)
    document.body.appendChild(article)
    expect(extractPage().title).toBe('Fallback Title')
  })
})
