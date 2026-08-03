import { describe, it, expect, beforeEach, vi } from 'vitest'

// content.ts registers a chrome.runtime.onMessage listener at module top level,
// so we stub the global `chrome` before importing the module. The handler body
// only runs on incoming messages, which we never emit in these tests.
const chromeStub = vi.hoisted(() => ({
  i18n: {
    detectLanguage: vi.fn(async (_text: string) => ({
      isReliable: true,
      languages: [{ language: 'en', percentage: 100 }],
    })),
  },
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

const {
  extractPage,
  collectTranslationCandidates,
  detectLanguageSafely,
  translationFailsQuality,
  textAlreadyInTargetLanguage,
} = await import('../src/content')

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.title = ''
  chromeStub.i18n.detectLanguage.mockReset()
  chromeStub.i18n.detectLanguage.mockResolvedValue({
    isReliable: true,
    languages: [{ language: 'en', percentage: 100 }],
  })
})

describe('translation language detection cancellation', () => {
  const abortOutcome = async (promise: Promise<unknown>) => Promise.race([
    promise.then(() => 'resolved', (error: unknown) =>
      error instanceof DOMException ? error.name : 'other-error'
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 80)),
  ])

  it('does not start detection for a signal that is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(detectLanguageSafely(
      'This is long enough to require browser language detection.',
      controller.signal
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(chromeStub.i18n.detectLanguage).not.toHaveBeenCalled()
  })

  it('rejects a pending detector immediately instead of waiting for its timeout', async () => {
    chromeStub.i18n.detectLanguage.mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const pending = detectLanguageSafely(
      'This pending language detector must be canceled immediately.',
      controller.signal
    )
    controller.abort()
    expect(await abortOutcome(pending)).toBe('AbortError')
  })

  it('propagates cancellation through quality and already-target checks', async () => {
    chromeStub.i18n.detectLanguage.mockImplementation(() => new Promise(() => {}))

    const qualityController = new AbortController()
    const quality = translationFailsQuality(
      'Una aplicación rápida para todos los equipos.',
      'Una herramienta veloz para cada grupo.',
      'en',
      qualityController.signal
    )
    qualityController.abort()
    expect(await abortOutcome(quality)).toBe('AbortError')

    const targetController = new AbortController()
    const alreadyTarget = textAlreadyInTargetLanguage(
      'This paragraph is already written in English.',
      'en',
      targetController.signal
    )
    targetController.abort()
    expect(await abortOutcome(alreadyTarget)).toBe('AbortError')
  })
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

describe('collectTranslationCandidates', () => {
  const candidateIds = (root: Element): string[] =>
    collectTranslationCandidates(root).map((el) => el.id).sort()

  it('keeps one non-overlapping host for a paragraph with nested spans', () => {
    document.body.innerHTML = `
      <main>
        <p id="paragraph"><span id="inner">A complete English sentence that should be translated once.</span></p>
      </main>
    `
    const candidates = collectTranslationCandidates(document.querySelector('main')!)
    expect(candidates.map((el) => el.id)).toEqual(['paragraph'])
  })

  it('skips short metadata labels and technology names even when attributes dominate outerHTML', () => {
    document.body.innerHTML = `
      <main>
        <div id="label" data-long-attribute="${'x'.repeat(200)}">Built by</div>
        <a id="language" class="${'x'.repeat(200)}" href="/language">TypeScript</a>
      </main>
    `
    const ids = collectTranslationCandidates(document.querySelector('main')!).map((el) => el.id)
    expect(ids).not.toContain('label')
    expect(ids).not.toContain('language')
  })

  it('keeps the deepest identical nested prose leaf instead of dropping both', () => {
    document.body.innerHTML = `
      <main>
        <div id="outer"><span id="inner">Read the complete project overview</span></div>
      </main>
    `
    const candidates = collectTranslationCandidates(document.querySelector('main')!)
    expect(candidates.map((el) => el.id)).toEqual(['inner'])
  })

  it('recovers prose in semantic inline wrappers and preserves ancestor direct prose', () => {
    document.body.innerHTML = `
      <main>
        <div><strong id="release-notes">Release notes</strong></div>
        <div id="ancestor">
          Read the complete migration guide
          <span id="descendant">with important compatibility details</span>
        </div>
      </main>
    `
    expect(candidateIds(document.querySelector('main')!)).toEqual([
      'ancestor',
      'release-notes',
    ])
  })

  it('does not mistake ordinary icon/avatar prose for repository counters', () => {
    document.body.innerHTML = `
      <main>
        <p id="icon-heading"><svg aria-hidden="true"></svg>What's new in 2026</p>
        <p id="avatar-comment">
          <img alt="@octocat">
          This contributor explains the release clearly and includes actionable migration advice.
        </p>
        <span id="actual-counter"><svg aria-hidden="true"></svg>12,444 stars this week</span>
      </main>
    `
    expect(candidateIds(document.querySelector('main')!)).toEqual([
      'avatar-comment',
      'icon-heading',
    ])
  })

  it('selects GitHub Trending prose while skipping repository names and metadata', () => {
    document.body.innerHTML = `
      <main>
        <div class="container-lg p-responsive text-center py-6">
          <h1 id="trending-title" class="h3">Trending</h1>
          <p id="page-description">
            See what the GitHub community is most excited about this week.
          </p>
        </div>

        <article class="Box-row">
          <h2 id="repo-heading-1" class="h3 lh-condensed">
            <a href="/extremely-long-organization-name/exceptionally-long-repository-name">
              <svg aria-hidden="true"></svg>
              <span class="text-normal">extremely-long-organization-name /</span>
              exceptionally-long-repository-name
            </a>
          </h2>
          <p id="repo-description-1" class="col-9 color-fg-muted my-1 pr-4">
            A hive mind communication platform
          </p>
          <div class="f6 color-fg-muted mt-2">
            <span id="programming-language" itemprop="programmingLanguage">TypeScript</span>
            <a id="star-count" class="Link--muted d-inline-block mr-3" href="/stars">18,594</a>
            <a id="fork-count" class="Link--muted d-inline-block mr-3" href="/forks">1,821</a>
            <span id="built-by" class="d-inline-block mr-3">
              Built by
              <a href="/octocat"><img alt="@octocat"></a>
            </span>
            <span id="weekly-stars" class="d-inline-block float-sm-right">
              <svg aria-hidden="true"></svg>
              12,444 stars this week
            </span>
          </div>
        </article>

        <article class="Box-row">
          <h2 id="repo-heading-2" class="h3 lh-condensed">
            <a href="/owner/repository"><span class="text-normal">owner /</span> repository</a>
          </h2>
          <p
            id="repo-description-2"
            class="col-9 color-fg-muted my-1 pr-4"
            data-hydro-click="${'x'.repeat(240)}"
          >
            The most RAM efficient harness
          </p>
        </article>
      </main>
    `

    expect(candidateIds(document.querySelector('main')!)).toEqual([
      'page-description',
      'repo-description-1',
      'repo-description-2',
      'trending-title',
    ])
  })

  it('skips page chrome, closed menus, hidden text, assistive text, and editable content', () => {
    document.body.innerHTML = `
      <header>
        <p id="header-copy">Sign in to explore all of the available GitHub navigation features.</p>
      </header>
      <nav>
        <ul>
          <li id="nav-copy">Browse repositories, developers, topics, collections, and events.</li>
        </ul>
      </nav>
      <main>
        <p id="visible-prose">This visible repository description belongs in the translation pass.</p>

        <details id="language-filter">
          <summary id="closed-menu-trigger">Choose a programming language filter</summary>
          <div>
            <a id="closed-menu-option" href="/trending/javascript">JavaScript repositories</a>
          </div>
        </details>

        <section hidden>
          <p id="hidden-copy">This hidden explanatory paragraph must never be translated.</p>
        </section>
        <section aria-hidden="true">
          <p id="aria-hidden-copy">This aria-hidden explanatory paragraph must never be translated.</p>
        </section>
        <span id="screen-reader-copy" class="sr-only">Repository star count for screen readers</span>
        <div id="editor" contenteditable="true">
          <p id="editable-copy">Draft text inside an editor must not be modified by page translation.</p>
        </div>
      </main>
    `

    expect(candidateIds(document.body)).toEqual(['visible-prose'])
  })

  it('never re-collects Lector UI, source wrappers, or rendered translations', () => {
    document.body.innerHTML = `
      <main>
        <p id="visible-prose">A normal visible paragraph should still be translated.</p>

        <div id="lector-ai-result">
          <p id="lector-result-copy">Text rendered inside the Lector result popup.</p>
        </div>

        <div id="translated-host" class="lector-bilingual-host">
          <span id="lector-source-copy" class="lector-bi-source">
            Previously translated source content
          </span>
          <div id="lector-translated-copy" class="lector-bilingual">
            Already rendered translation output
          </div>
        </div>

        <div data-lector-no-translate>
          <p id="explicitly-excluded-copy">Content explicitly excluded by Lector.</p>
        </div>
      </main>
    `

    expect(candidateIds(document.querySelector('main')!)).toEqual(['visible-prose'])
  })

  it('tolerates invalid custom selectors and respects valid exclusions', () => {
    document.body.innerHTML = `
      <main>
        <p id="keep">Keep this meaningful English paragraph for translation.</p>
        <p id="skip" class="skip-me">Skip this meaningful English paragraph.</p>
      </main>
    `
    expect(() =>
      collectTranslationCandidates(document.querySelector('main')!, ['[invalid'], ['[also-invalid', '.skip-me'])
    ).not.toThrow()
    const ids = collectTranslationCandidates(
      document.querySelector('main')!,
      ['[invalid'],
      ['[also-invalid', '.skip-me']
    ).map((el) => el.id)
    expect(ids).toEqual(['keep'])
  })
})
