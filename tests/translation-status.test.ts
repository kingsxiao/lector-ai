import { describe, it, expect, vi, beforeEach } from 'vitest'

// Page-level translation status toast + toggle-restore semantics. content.ts
// registers its chrome.runtime.onMessage listener at module scope; we capture
// that handler so the toggle message can be dispatched like the real
// background worker does. A translated page is simulated by hand-building the
// same DOM markup the bilingual pipeline injects (.lector-bilingual-host with
// .lector-bilingual children + source-node wrappers).

type MessageHandler = (
  message: Record<string, unknown>,
  sender: unknown,
  sendResponse: (r: unknown) => void
) => boolean | undefined

const chromeStub = vi.hoisted(() => {
  const handlers: MessageHandler[] = []
  return {
    handlers,
    i18n: {
      detectLanguage: vi.fn(async () => ({ isReliable: false, languages: [] })),
    },
    runtime: {
      id: 'test-extension-id',
      onMessage: {
        addListener: (fn: MessageHandler) => {
          handlers.push(fn)
        },
      },
      sendMessage: vi.fn(() => Promise.resolve({})),
      lastError: null as { message?: string } | null,
    },
    storage: {
      local: {
        get: (_keys: unknown, cb: (r: Record<string, unknown>) => void) => cb({}),
      },
    },
  }
})
;(globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub

const { reportBilingualTerminal, pageHasTranslations, restorePageTranslations } = await import('../src/content')

function dispatch(message: Record<string, unknown>): void {
  for (const handler of chromeStub.handlers) {
    handler(message, {}, () => {})
  }
}

/** Build one translated host block exactly as translateBlockChunks leaves it:
 *  host class + source-node wrapper + a non-error translation span. */
function buildTranslatedHost(): HTMLElement {
  const p = document.createElement('p')
  p.className = 'lector-bilingual-host'
  const src = document.createElement('span')
  src.className = 'lector-bi-source lector-bi-source-node'
  src.textContent = 'The quick brown fox.'
  const tr = document.createElement('span')
  tr.className = 'lector-bilingual'
  tr.textContent = '敏捷的棕色狐狸。'
  p.appendChild(src)
  p.appendChild(tr)
  document.body.appendChild(p)
  return p
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  chromeStub.runtime.sendMessage.mockClear()
})

describe('pageHasTranslations', () => {
  it('is false on a plain page', () => {
    document.body.innerHTML = '<p>nothing here</p>'
    expect(pageHasTranslations()).toBe(false)
  })
  it('is true once a non-error translation span exists', () => {
    buildTranslatedHost()
    expect(pageHasTranslations()).toBe(true)
  })
  it('ignores errored chunks', () => {
    buildTranslatedHost()
    document.querySelector('.lector-bilingual')!.classList.add('is-error')
    expect(pageHasTranslations()).toBe(false)
  })
})

describe('restorePageTranslations', () => {
  it('strips host markup, body presentation classes, and the toast', () => {
    const host = buildTranslatedHost()
    document.body.classList.add('lector-dm-translationOnly', 'lector-theme-default', 'lector-focus-on')
    restorePageTranslations()
    expect(document.querySelectorAll('.lector-bilingual')).toHaveLength(0)
    expect(document.querySelectorAll('.lector-bilingual-host')).toHaveLength(0)
    expect(host.classList.contains('lector-translation-error')).toBe(false)
    expect(document.body.classList.contains('lector-dm-translationOnly')).toBe(false)
    expect(document.body.classList.contains('lector-theme-default')).toBe(false)
    expect(document.body.classList.contains('lector-focus-on')).toBe(false)
    // A transient confirmation toast replaces the translations.
    expect(document.querySelector('.lector-tstatus')).not.toBeNull()
  })

  it('releases the side panel busy state via a complete progress message', () => {
    buildTranslatedHost()
    chromeStub.runtime.sendMessage.mockClear()
    restorePageTranslations()
    const sent = chromeStub.runtime.sendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'lector-bilingual-progress'
    )
    expect(sent).toBeTruthy()
    expect((sent![0] as { complete?: boolean }).complete).toBe(true)
  })
})

describe('toggle semantics (lector-toggle-bilingual)', () => {
  it('restores the original instead of re-running when translations exist', () => {
    buildTranslatedHost()
    dispatch({ action: 'lector-toggle-bilingual' })
    // The restore path is synchronous up to the toast; no provider calls are
    // possible in this stub environment, so an empty page + removed markup
    // proves the toggle took the restore branch.
    expect(document.querySelectorAll('.lector-bilingual')).toHaveLength(0)
    expect(document.querySelector('.lector-tstatus')).not.toBeNull()
  })
})

describe('on-page status toast', () => {
  it('surfaces the terminal error with attribution text', () => {
    expect(() => reportBilingualTerminal('quota exhausted')).not.toThrow()
    const toast = document.querySelector('.lector-tstatus .ts-text.is-error')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('quota exhausted')
  })

  it('is dismissed by Escape', () => {
    reportBilingualTerminal('boom')
    expect(document.querySelector('.lector-tstatus')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('.lector-tstatus')).toBeNull()
  })
})
