// Translation coverage regression tests — guards the "some English stayed
// untranslated" bug class. Each case encodes a REAL page structure that the
// collector used to drop:
//   - <summary> FAQ headings (missing from the DOM selector)
//   - hero prose inside <header>/<footer>/<aside> (treated as noise wholesale)
//   - prose living directly inside <a> link cards (not in the leaf query)
//   - single title-cased section labels ("Overview")
// Nav/menu short links must STAY excluded (regression guard for the fix).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const chromeStub = vi.hoisted(() => ({
  i18n: {
    detectLanguage: vi.fn(async () => ({
      isReliable: true,
      languages: [{ language: 'en', percentage: 100 }],
    })),
  },
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: () => ({ catch: () => {} }),
    lastError: null,
  },
  storage: {
    local: {
      get: (_keys: unknown, cb: (r: Record<string, unknown>) => void) => cb({}),
    },
  },
}))
;(globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub

const { collectTranslationCandidates, collectIncrementalCandidates } = await import('../src/content')

function setBody(html: string) {
  document.head.innerHTML = ''
  document.body.innerHTML = html
}

function collected(): string[] {
  return collectTranslationCandidates(document.body).map((el) =>
    (el.textContent || '').replace(/\s+/g, ' ').trim()
  )
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('bilingual collection coverage', () => {
  it('collects <summary> headings (FAQ / collapsible sections)', () => {
    setBody(`
      <details open><summary>How does billing work for annual plans?</summary>
        <p>You are charged once per year in advance.</p></details>
      <details><summary>Can I cancel my subscription at any time?</summary></details>
    `)
    const texts = collected()
    expect(texts).toContain('How does billing work for annual plans?')
    expect(texts).toContain('Can I cancel my subscription at any time?')
    expect(texts).toContain('You are charged once per year in advance.')
  })

  it('collects hero headings and long prose inside <header>, but not nav links', () => {
    setBody(`
      <header>
        <nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
        <h1>Build better software faster</h1>
        <p>Our platform helps teams ship with confidence using automated testing and continuous delivery pipelines built for scale.</p>
        <a href="/signup">Start free trial</a>
      </header>
      <main><p>Regular article content paragraph that is long enough to translate for sure.</p></main>
    `)
    const texts = collected()
    // Hero prose is the most visible English on marketing pages — must translate.
    expect(texts).toContain('Build better software faster')
    expect(texts).toContain(
      'Our platform helps teams ship with confidence using automated testing and continuous delivery pipelines built for scale.'
    )
    // Navigation chrome (nav element AND short links in the header) stays out.
    expect(texts).not.toContain('Home')
    expect(texts).not.toContain('Pricing')
    expect(texts).not.toContain('Start free trial')
  })

  it('collects long footer / aside text but not short link lists there', () => {
    setBody(`
      <footer>
        <p>All rights reserved. This documentation is provided under the MIT license for everyone.</p>
        <a href="/about">About us</a>
      </footer>
      <aside>
        <h3>Related reading suggestions</h3>
        <p>Editors picked these articles because they cover the same production deployment topic.</p>
      </aside>
    `)
    const texts = collected()
    expect(texts).toContain('All rights reserved. This documentation is provided under the MIT license for everyone.')
    expect(texts).toContain('Related reading suggestions')
    expect(texts).toContain('Editors picked these articles because they cover the same production deployment topic.')
    expect(texts).not.toContain('About us')
  })

  it('collects prose living directly inside <a> (link cards)', () => {
    setBody(`
      <div class="card"><a href="/blog">Read about our latest performance improvements and what they mean for your team.</a></div>
    `)
    expect(collected()).toContain(
      'Read about our latest performance improvements and what they mean for your team.'
    )
  })

  it('does not double-collect links that sit inside standard paragraphs', () => {
    setBody(`
      <p>This paragraph already owns the text including a <a href="/x">very interesting inline link</a> inside it.</p>
    `)
    expect(collected()).toEqual([
      'This paragraph already owns the text including a very interesting inline link inside it.'
    ])
  })

  it('collects single title-cased section labels (Overview) but not badges', () => {
    setBody(`
      <div class="section-label">Overview</div>
      <div class="section-label">Documentation</div>
      <span class="badge">kubernetes</span>
      <span class="badge">JavaScript</span>
      <span class="badge">API</span>
    `)
    const texts = collected()
    expect(texts).toContain('Overview')
    expect(texts).toContain('Documentation')
    expect(texts).not.toContain('kubernetes')
    expect(texts).not.toContain('JavaScript')
    expect(texts).not.toContain('API')
  })
})

describe('collectIncrementalCandidates (dynamically added content)', () => {
  it('returns English blocks from added subtrees, skipping translated/Chinese ones', async () => {
    setBody(`
      <main>
        <p class="done">This block was already translated by an earlier run.</p>
        <p class="zh">这一段本来就是中文内容，不需要翻译。</p>
      </main>
    `)
    // Mark the first block as an already-translated host (as a finished run would).
    document.querySelector('.done')!.classList.add('lector-bilingual-host')

    // Simulate infinite-scroll: new subtree appended after the run.
    const added = document.createElement('div')
    added.innerHTML = `
      <p>Brand new content that loaded after the translation finished running.</p>
      <h3>Fresh heading</h3>
    `
    document.querySelector('main')!.appendChild(added)

    const out = await collectIncrementalCandidates([added], 'zh')
    const texts = out.map((el) => (el.textContent || '').trim())
    expect(texts).toContain('Brand new content that loaded after the translation finished running.')
    expect(texts).toContain('Fresh heading')
  })

  it('ignores subtrees inside Lector-injected UI', async () => {
    setBody(`<main><p>Existing article text that stays where it always was.</p></main>`)
    const host = document.createElement('span')
    host.className = 'lector-bilingual'
    host.textContent = '这是注入的译文。'
    document.body.appendChild(host)
    const out = await collectIncrementalCandidates([host], 'zh')
    expect(out).toEqual([])
  })
})
