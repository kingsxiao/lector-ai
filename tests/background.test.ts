/**
 * Integration test for src/background.ts's message-driven relay glue.
 *
 * background.ts registers a chrome.runtime.onMessage listener at module load
 * and forwards capture messages (highlight / translation-history / etc.) into
 * chrome.storage.local lists via the serialized storageQueue helper. This test
 * stubs `chrome` before importing the module, captures the listener, then
 * drives messages through it and asserts the serialized writes land without
 * loss — the end-to-end proof for the A6 RMW-race fix (the pure helper is
 * covered separately in storageQueue.test.ts).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

// --- chrome stub -----------------------------------------------------------
// A minimal, callback-style chrome.storage.local + chrome.runtime.onMessage
// mirror of what the real APIs expose. Storage is an in-memory map; onChanged
// is NOT used by these tests (the sidepanel drain is exercised in browser E2E).
type Listener = (msg: any, sender: any, sendResponse: (r?: any) => void) => boolean | undefined | void

let storage: Record<string, unknown>
let messageListener: Listener | null

function makeChromeStub() {
  storage = {}
  const chromeStub = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => { messageListener = fn } },
      onInstalled: { addListener: () => {} },
      lastError: null,
      sendMessage: () => Promise.resolve({}),
    },
    storage: {
      local: {
        // Resolve on a microtask so the serialized chain drains as one batch
        // without the 4ms-per-clamp cost of setTimeout(0) (the chain is
        // fundamentally sequential — 500 setTimeout(0) steps would take ~2s).
        get(keys: string[], cb: (r: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {}
          for (const k of keys) out[k] = storage[k]
          Promise.resolve().then(() => cb(out))
        },
        set(obj: Record<string, unknown>, cb?: () => void) {
          for (const k of Object.keys(obj)) storage[k] = obj[k]
          if (cb) Promise.resolve().then(() => cb())
        },
        remove(_keys: string[], cb?: () => void) {
          if (cb) Promise.resolve().then(() => cb())
        },
      },
    },
    contextMenus: {
      removeAll: (cb: () => void) => cb(),
      create: () => {},
      onClicked: { addListener: () => {} },
    },
    commands: { onCommand: { addListener: () => {} } },
    sidePanel: { open: () => Promise.resolve(), setPanelBehavior: () => Promise.resolve() },
    tabs: { query: (_q: any, cb: (t: any[]) => void) => cb([{ id: 1, windowId: 1 }]), sendMessage: () => {} },
  }
  ;(globalThis as any).chrome = chromeStub
}

// Drain the microtask queue enough times for the serialized chain to fully
// complete. Each chain step resolves across a few microtasks (get→set→resolve),
// and steps are strictly sequential, so N items need ~N*k microtask ticks.
// We loop generously and yield a macrotask too.
async function flush(ticks = 4000) {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

// Install chrome BEFORE importing the module so the listener is captured on
// first (and only) module evaluation. Vitest caches the module, so we import
// once at the top level and reset `storage` between tests.
makeChromeStub()
await import('../src/background')
await flush()

describe('background relay (A6 serialization integration)', () => {
  beforeEach(() => {
    storage = {}
  })

  it('writes a single highlight via the serialized relay', async () => {
    expect(messageListener).toBeTruthy()
    messageListener!({ action: 'lector-highlight', highlight: { id: 'h1', text: 'hi' } }, {}, () => {})
    await flush()
    expect((storage.lectorHighlights as any[]).length).toBe(1)
    expect((storage.lectorHighlights as any[])[0].text).toBe('hi')
  })

  // Regression for A6: 20 rapid highlights must all land. Before the
  // serialized chain, two concurrent relays observed the same base list and
  // the second set clobbered the first.
  it('loses no highlights when many arrive in quick succession', async () => {
    for (let i = 0; i < 20; i++) {
      messageListener!({ action: 'lector-highlight', highlight: { id: `h${i}`, text: `t${i}` } }, {}, () => {})
    }
    // Give the serialized chain time to drain.
    await flush(2000)
    const list = storage.lectorHighlights as any[]
    expect(list.length).toBe(20)
    expect(list.map((h) => h.text).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `t${i}`).sort()
    )
  })

  it('caps highlights at 500', async () => {
    for (let i = 0; i < 510; i++) {
      messageListener!({ action: 'lector-highlight', highlight: { id: `h${i}`, text: `t${i}` } }, {}, () => {})
    }
    await flush(8000)
    expect((storage.lectorHighlights as any[]).length).toBe(500)
  })

  it('queues a translation-history entry via the shared helper', async () => {
    messageListener!(
      {
        action: 'lector-translation-history',
        entry: { source: 's', target: 't', sourceLang: 'en', targetLang: 'zh', kind: 'page', url: 'u', createdAt: 1 },
      },
      {},
      () => {}
    )
    await flush()
    const list = storage.lectorTranslationHistory as any[]
    expect(list.length).toBe(1)
    expect(list[0].source).toBe('s')
    expect(typeof list[0].id).toBe('string')
  })
})
