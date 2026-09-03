// Lector AI background service worker.
//
// Responsibilities (minimal in the BYOK model):
//   - Register context-menu entries that seed the side panel.
//   - Open the side panel on demand (from the FAB, action icon, or menus).
// All AI calls happen client-side (content script or side panel) using the
// user's own key — there is no backend.

import { t, type StringKey } from './shared/i18n'
import { getSettings, completeOnce, saveSettings } from './shared/byok'
import { SENTENCE_CARD_SYSTEM_PROMPT, extractTranslation, extractKeywords, extractCefr, newCardId, type SentenceCard } from './shared/sentences'
import { appendHistory, newHistoryId, isValidDisplayMode, type TranslationHistoryEntry } from './shared/translation'
import { normalizeTranslationSettings } from './shared/providers'
import { appendToList, type ListStore } from './shared/storageQueue'
import type { Highlight } from './shared/highlights'
import type { VocabEntry } from './shared/vocabulary'

// Serializes read-modify-write steps on each chrome.storage.local list key so
// that rapid successive relay messages (e.g. saving two words back-to-back,
// or a concurrent bilingual pass) don't both observe the same base list and
// lose one write to a last-write-wins clobber. Each key gets its own chain.
let historyChain: Promise<void> = Promise.resolve()
let vocabChain: Promise<void> = Promise.resolve()
let sentenceChain: Promise<void> = Promise.resolve()
let highlightChain: Promise<void> = Promise.resolve()

// Thin adapter from chrome.storage.local (callback-style) to the async
// get/set ListStore interface the serialization helper expects. Lives here so
// the pure logic in shared/storageQueue.ts stays chrome-free and unit-tested.
// lastError MUST be checked: a failed get used to resolve [] and the
// read-modify-write mutator would then overwrite a 2000-entry vocab list with
// a single-row list — unrecoverable data loss. Rejecting propagates to
// appendToList's onError instead.
const listStore: ListStore = {
  get(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], (r) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        const v = (r as Record<string, unknown>)[key]
        resolve(Array.isArray(v) ? v : [])
      })
    })
  },
  set(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve()
      })
    })
  },
}

function ensureActionOpensPanel() {
  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {})
  }
}

// Run on every service-worker start, not only onInstalled. This repairs stale
// browser state after an extension update/reload and makes the very first
// toolbar-icon click consistently open the configured panel.
ensureActionOpensPanel()

chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')
  ensureActionOpensPanel()

  // Context-menu titles are fixed at creation in MV3; they reflect the
  // language active on install/update. setupMenus reads the stored pref.
  void setupMenus()
})

async function setupMenus() {
  const pref = (await getSettings()).locale ?? 'auto'
  const menus: { id: string; key: StringKey }[] = [
    { id: 'lector-summarize', key: 'menu.summarize' },
    { id: 'lector-translate', key: 'menu.translate' },
    { id: 'lector-explain', key: 'menu.explain' },
    { id: 'lector-ask', key: 'menu.ask' },
  ]
  // Remove old entries first (create() throws on duplicate id).
  chrome.contextMenus.removeAll(() => {
    menus.forEach((m) => {
      chrome.contextMenus.create({ id: m.id, title: t(m.key, pref), contexts: ['selection'] })
    })
  })
}

// Open the side panel from the FAB / popup / content script. sender.tab carries
// the originating tab (and thus windowId) synchronously — required to keep
// chrome.sidePanel.open() inside the user-gesture window.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.action === 'open-side-panel') {
    openSidePanel(message.seed || null, sender.tab?.windowId)
    return false
  }
  if (message?.action === 'lector-highlight') {
    // Serialized: prevents two quick highlights from losing one to a
    // read-modify-write race on the shared lectorHighlights list.
    highlightChain = appendToList<Highlight>(
      highlightChain,
      listStore,
      'lectorHighlights',
      (list) => {
        list.unshift(message.highlight)
        return list.slice(0, 500)
      },
      (err) => console.warn('[Lector] highlight queue write failed:', err instanceof Error ? err.message : String(err))
    )
    return false
  }
  if (message?.action === 'lector-save-word') {
    if (typeof message.word !== 'string' || !message.word.trim()) return false
    handleSaveWordRelay(message).catch((err) =>
      console.warn('[Lector] save-word relay failed:', err instanceof Error ? err.message : String(err))
    )
    return false
  }
  if (message?.action === 'lector-explain-sentence') {
    if (typeof message.sentence !== 'string' || !message.sentence.trim()) return false
    handleExplainSentenceRelay(message).catch((err) =>
      console.warn('[Lector] explain-sentence relay failed:', err instanceof Error ? err.message : String(err))
    )
    return false
  }
  if (message?.action === 'lector-translation-history') {
    // Queue into storage; the side panel drains & merges into zustand.
    // Serialized via the shared helper so rapid successive entries (e.g. a
    // concurrent bilingual pass) don't lose writes to a shared base list.
    historyChain = appendToList(
      historyChain,
      listStore,
      'lectorTranslationHistory',
      (list) => appendHistory(list as TranslationHistoryEntry[], { ...message.entry, id: newHistoryId() }),
      (err) => console.warn('[Lector] history queue write failed:', err instanceof Error ? err.message : String(err))
    )
    return false
  }
  if (message?.action === 'lector-set-translation-target') {
    // Persist the popup's language choice back into BYOK settings and broadcast.
    void (async () => {
      const s = await getSettings()
      const ts = normalizeTranslationSettings(s.translation)
      ts.targetLanguage = message.target
      // Route through saveSettings' serialized write chain: a direct
      // storage.set here raced the panel's own saveSettings and could
      // resurrect an older snapshot over the user's newer edits.
      await saveSettings({ ...s, translation: ts })
      const tabs = await chrome.tabs.query({})
      for (const tab of tabs) {
        if (tab.id === undefined) continue
        // Content scripts only exist on real web pages; messaging chrome://
        // and friends just produces lastError noise.
        if (!tab.url || !/^https?:/i.test(tab.url)) continue
        chrome.tabs.sendMessage(tab.id, { action: 'lector-translation-settings-changed' }, () => {
          void chrome.runtime.lastError
        })
      }
    })()
    return false
  }
  if (message?.action === 'lector-set-translation-display-mode') {
    // Persist the page-level display-mode cycle (FAB menu / status toast) back
    // into BYOK settings and broadcast — same relay pattern as
    // lector-set-translation-target so the panel's zustand copy stays fresh.
    if (isValidDisplayMode(message.mode)) {
      void (async () => {
        const s = await getSettings()
        const ts = normalizeTranslationSettings(s.translation)
        ts.displayMode = message.mode
        await saveSettings({ ...s, translation: ts })
        const tabs = await chrome.tabs.query({})
        for (const tab of tabs) {
          if (tab.id === undefined) continue
          if (!tab.url || !/^https?:/i.test(tab.url)) continue
          chrome.tabs.sendMessage(tab.id, { action: 'lector-translation-settings-changed' }, () => {
            void chrome.runtime.lastError
          })
        }
      })()
    }
    return false
  }
  return false
})

// Keyboard commands → forward to the active tab's content script.
chrome.commands?.onCommand.addListener((cmd) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId === undefined) return
    // Map the manifest command id to the content-script action.
    //   lector-toggle-bilingual / lector-translate-whole-page → bilingual toggle
    //   lector-translate-selection → translate the current selection (Alt+Q)
    let action: { action: string; scope?: 'smart' | 'whole'; command?: string }
    if (cmd === 'lector-toggle-bilingual') {
      action = { action: 'lector-toggle-bilingual', scope: 'smart' }
    } else if (cmd === 'lector-translate-whole-page') {
      action = { action: 'lector-toggle-bilingual', scope: 'whole' }
    } else if (cmd === 'lector-translate-selection') {
      action = { action: 'lector-translate-selection' }
    } else {
      // highlight-selection / save-word
      action = { action: 'lector-command', command: cmd }
    }
    chrome.tabs.sendMessage(tabId, action, () => {
      void chrome.runtime.lastError
    })
  })
})

/** Deliver an enrichment to the live side panel first. The panel drains the
 *  storage queue into zustand within milliseconds of the initial write, so by
 *  the time a multi-second provider call resolves, the queued row (matched by
 *  id) is usually already gone — the old storage-only enrich silently dropped
 *  the PAID result. The panel merges by id with fill-empty semantics; when no
 *  panel is open (or it never drained this row), we fall back to the storage
 *  enrich below. */
async function panelHasEntry(kind: 'lectorVocab' | 'lectorSentences', id: string): Promise<boolean> {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'lector-has-entry', kind, id })
    return resp?.ok === true
  } catch {
    // No receiving end (panel closed) — use the storage fallback.
    return false
  }
}

async function handleSaveWordRelay(message: {
  word: string
  context: string
  url: string
  title: string
  blockId?: string
}) {
  const entry: VocabEntry = {
    id: 'v' + Date.now().toString(36),
    word: message.word,
    translation: '',
    context: message.context,
    url: message.url,
    title: message.title,
    // Detect the word's own language family (mirrors content.ts detectLang).
    lang: /[\u4e00-\u9fff]/.test(message.word) ? 'zh' : 'en',
    createdAt: Date.now(),
    srs: { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  }
  // Persist IMMEDIATELY with an empty translation. An MV3 service worker can
  // be torn down after ~30s idle while completeOnce's budget is 60s — with the
  // old persist-after-translate order, a slow provider call silently lost the
  // word entirely. The translation is enriched below once it resolves.
  // Serialized: prevents two quick word-saves from both reading the same base
  // list and losing one entry to a last-write-wins clobber.
  // enrichId tracks the row the paid translation must land in: the merge branch
  // keeps the EXISTING row (discarding entry.id), so enriching entry.id would
  // silently drop a successful (paid) translation for a duplicate save.
  let enrichId = entry.id
  vocabChain = appendToList<VocabEntry>(
    vocabChain,
    listStore,
    'lectorVocab',
    (list) => {
      const w = entry.word.toLowerCase()
      const idx = list.findIndex((x) => x.word.toLowerCase() === w)
      if (idx === -1) {
        list.unshift(entry)
      } else {
        enrichId = list[idx].id
        const existing = list[idx]
        list[idx] = {
          ...existing,
          context: entry.context || existing.context,
          createdAt: Math.min(existing.createdAt, entry.createdAt),
          srs: existing.srs,
        }
      }
      return list.slice(0, 2000)
    },
    (err) => console.warn('[Lector] vocab queue write failed:', err instanceof Error ? err.message : String(err))
  )

  // Translate the saved word with the user's own key (BYOK). If no key is set,
  // the translation stays empty and is surfaced at review time.
  let translation = ''
  try {
    const settings = await getSettings()
    if (settings.apiKey) {
      const target = /[\u4e00-\u9fff]/.test(message.word) ? 'English' : '中文'
      translation = await completeOnce(
        settings,
        `You are a professional translator. Translate the user text to ${target}. Preserve meaning and tone. Output ONLY the translation.`,
        message.word,
        { maxTokens: 120, temperature: 0.2 }
      )
    }
  } catch {
    // leave translation empty; flagged at review time
  }
  if (!translation) return
  // Live panel first (it owns the row now); storage enrich only as fallback.
  if (await panelHasEntry('lectorVocab', enrichId)) {
    try {
      await chrome.runtime.sendMessage({ action: 'lector-vocab-enrich', id: enrichId, translation })
    } catch {
      /* panel closed between the check and the send — fall through */
    }
    return
  }
  // Enrich the persisted row (same id). Only fills an EMPTY translation so a
  // concurrent save of the same word with its own result is never clobbered.
  vocabChain = appendToList<VocabEntry>(
    vocabChain,
    listStore,
    'lectorVocab',
    (list) => {
      const idx = list.findIndex((x) => x.id === enrichId)
      if (idx !== -1 && !list[idx].translation) {
        list[idx] = { ...list[idx], translation }
      }
      return list
    },
    (err) => console.warn('[Lector] vocab enrich write failed:', err instanceof Error ? err.message : String(err))
  )
}

async function handleExplainSentenceRelay(message: {
  sentence: string
  quote: string
  url: string
  title: string
  blockId?: string
}) {
  const settings = await getSettings()
  if (!settings.apiKey) {
    // No key: content.ts already surfaces the "add key" UX (result popup +
    // opens the side panel), so this is a defensive secondary guard for the
    // case where a relay arrives without a key (e.g. race / direct message).
    return
  }
  const card: SentenceCard = {
    id: newCardId(),
    sentence: message.sentence,
    translation: '',
    analysis: '',
    keywords: [],
    quote: message.quote,
    url: message.url,
    title: message.title,
    blockId: message.blockId,
    lang: 'en',
    cefr: null,
    createdAt: Date.now(),
    srs: null,
  }
  // Persist IMMEDIATELY with empty analysis (same MV3 idle-out rationale as
  // handleSaveWordRelay: the analysis call may exceed the ~30s service-worker
  // lifetime, and the captured sentence must not be lost with it). Enriched
  // below once the analysis resolves.
  sentenceChain = appendToList<SentenceCard>(
    sentenceChain,
    listStore,
    'lectorSentences',
    (list) => {
      list.unshift(card)
      return list.slice(0, 50)
    },
    (err) => console.warn('[Lector] sentence queue write failed:', err instanceof Error ? err.message : String(err))
  )

  let analysis = ''
  try {
    analysis = await completeOnce(
      settings,
      SENTENCE_CARD_SYSTEM_PROMPT,
      message.sentence,
      { maxTokens: 1200, temperature: 0.4 }
    )
  } catch {
    analysis = '' // 空分析；卡片仍创建，UI 显示占位
  }
  if (!analysis) return
  // Live panel first (it owns the card now); storage enrich only as fallback.
  if (await panelHasEntry('lectorSentences', card.id)) {
    try {
      await chrome.runtime.sendMessage({ action: 'lector-sentence-enrich', id: card.id, analysis })
    } catch {
      /* panel closed between the check and the send — fall through */
    }
    return
  }
  // Enrich the persisted card (same id) with the parsed analysis fields.
  sentenceChain = appendToList<SentenceCard>(
    sentenceChain,
    listStore,
    'lectorSentences',
    (list) => {
      const idx = list.findIndex((x) => x.id === card.id)
      if (idx !== -1 && !list[idx].analysis) {
        list[idx] = {
          ...list[idx],
          translation: extractTranslation(analysis),
          analysis,
          keywords: extractKeywords(analysis),
          cefr: extractCefr(analysis),
        }
      }
      return list
    },
    (err) => console.warn('[Lector] sentence enrich write failed:', err instanceof Error ? err.message : String(err))
  )
}

// Open the side panel. `chrome.sidePanel.open()` must be called synchronously
// inside the user-gesture-qualified event handler (context-menu click, content
// message) — awaiting storage/tabs first loses the gesture and Chrome rejects
// with "may only be called in response to a user gesture". So: open FIRST
// (windowId is available synchronously from the event args), then persist the
// seed; the panel reads the seed from storage during its boot, which is slower
// than this write. If windowId wasn't available on the event (defensive:
// Chrome always provides it, stubs/tests may not), fall back to querying the
// active tab and open late rather than never.
function openSidePanel(seed: { kind: string; text: string } | null, windowId?: number) {
  if (chrome.sidePanel && windowId !== undefined) {
    chrome.sidePanel.open({ windowId }).catch(() => {})
  } else if (chrome.sidePanel) {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
      })
      .catch(() => {})
  }
  if (seed) {
    void chrome.storage.local.set({ lectorSeed: seed })
  }
}

// Context-menu clicks seed the side panel (translate/summarize/explain/ask).
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText) return
  const map: Record<string, string> = {
    'lector-summarize': 'summarize',
    'lector-translate': 'translate',
    'lector-explain': 'explain',
    'lector-ask': 'ask',
  }
  const kind = map[info.menuItemId as string]
  if (kind) {
    openSidePanel({ kind, text: info.selectionText }, tab?.windowId)
  }
})
