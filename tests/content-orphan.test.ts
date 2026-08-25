import { describe, it, expect, vi } from 'vitest'

// After an extension reload/update, content scripts still running in old tabs
// become "orphaned": chrome.runtime.id reads as undefined and every call to
// chrome.runtime.sendMessage throws SYNCHRONOUSLY ("Extension context
// invalidated"). A returned-promise .catch() cannot catch that throw, so any
// bare `sendMessage(...).catch(() => {})` in an async function turns into
// "Uncaught (in promise) Error: Extension context invalidated" (seen in the
// wild from the bilingual pipeline's relays). These tests pin the orphan-safe
// contract of the runtime send helpers.
const chromeStub = vi.hoisted(() => {
  const syncThrow = () => {
    throw new Error('Extension context invalidated')
  }
  return {
    i18n: {
      detectLanguage: vi.fn(async () => ({ isReliable: false, languages: [] })),
    },
    runtime: {
      // undefined in an orphaned content script (valid while the context lives)
      id: undefined as string | undefined,
      onMessage: { addListener: () => {} },
      sendMessage: vi.fn(syncThrow),
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

const { reportBilingualTerminal, safeRuntimeSend } = await import('../src/content')

describe('orphaned content script (extension context invalidated)', () => {
  it('reportBilingualTerminal does not throw when sendMessage throws synchronously', () => {
    // Regression: this exact call escaped toggleBilingual's catch as an
    // uncaught promise rejection after an extension reload mid-translation.
    expect(() => reportBilingualTerminal('boom')).not.toThrow()
    expect(chromeStub.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('safeRuntimeSend swallows the synchronous invalidated throw', () => {
    expect(() => safeRuntimeSend({ action: 'x' })).not.toThrow()
    expect(safeRuntimeSend({ action: 'x' })).toBeUndefined()
  })

  it('safeRuntimeSend still swallows async rejections on a live context', async () => {
    chromeStub.runtime.id = 'live-extension-id'
    chromeStub.runtime.sendMessage.mockImplementation(() =>
      Promise.reject(new Error('worker asleep'))
    )
    await expect(safeRuntimeSend({ action: 'x' })).resolves.toBeUndefined()
    // Restore the orphaned state for any later test in this file.
    chromeStub.runtime.id = undefined
    chromeStub.runtime.sendMessage.mockImplementation(() => {
      throw new Error('Extension context invalidated')
    })
  })
})
