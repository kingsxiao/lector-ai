// Lector AI background service worker.
//
// Responsibilities (minimal in the BYOK model):
//   - Register context-menu entries that seed the side panel.
//   - Open the side panel on demand (from the FAB, action icon, or menus).
// All AI calls happen client-side (content script or side panel) using the
// user's own key — there is no backend.

import { t, type StringKey } from './shared/i18n'
import { getSettings, completeOnce } from './shared/byok'
import { SENTENCE_CARD_SYSTEM_PROMPT, extractTranslation, extractKeywords, extractCefr, newCardId, type SentenceCard } from './shared/sentences'
import { appendHistory, newHistoryId, type TranslationHistoryEntry } from './shared/translation'
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
const listStore: ListStore = {
  get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (r) => {
        const v = (r as Record<string, unknown>)[key]
        resolve(Array.isArray(v) ? v : [])
      })
    })
  },
  set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve())
    })
  },
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Lector AI installed')

  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {})
  }

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

// Open the side panel from the FAB / popup / content script.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'open-side-panel') {
    openSidePanel(message.seed || null)
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
      }
    )
    return false
  }
  if (message?.action === 'lector-save-word') {
    handleSaveWordRelay(message).catch(() => {})
    return false
  }
  if (message?.action === 'lector-explain-sentence') {
    handleExplainSentenceRelay(message).catch(() => {})
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
      (list) => appendHistory(list as TranslationHistoryEntry[], { ...message.entry, id: newHistoryId() })
    )
    return false
  }
  if (message?.action === 'lector-set-translation-target') {
    // Persist the popup's language choice back into BYOK settings and broadcast.
    void (async () => {
      const s = await getSettings()
      const ts = normalizeTranslationSettings(s.translation)
      ts.targetLanguage = message.target
      const next = { ...s, translation: ts }
      // Save directly to storage (background has no zustand).
      await chrome.storage.local.set({ lector_byok_settings: next })
      const tabs = await chrome.tabs.query({})
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          chrome.tabs.sendMessage(tab.id, { action: 'lector-translation-settings-changed' }, () => {
            void chrome.runtime.lastError
          })
        }
      }
    })()
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
    //   lector-translate / lector-toggle-bilingual → smart bilingual toggle
    //   lector-translate-whole-page               → whole-page bilingual
    //   lector-translate-selection                 → translate the selection
    let action: { action: string; scope?: 'smart' | 'whole'; command?: string }
    if (cmd === 'lector-translate' || cmd === 'lector-toggle-bilingual') {
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

async function handleSaveWordRelay(message: {
  word: string
  context: string
  url: string
  title: string
  blockId?: string
}) {
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
  const entry: VocabEntry = {
    id: 'v' + Date.now().toString(36),
    word: message.word,
    translation,
    context: message.context,
    url: message.url,
    title: message.title,
    // Detect the word's own language family (mirrors content.ts detectLang).
    lang: /[\u4e00-\u9fff]/.test(message.word) ? 'zh' : 'en',
    createdAt: Date.now(),
    srs: { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  }
  // Serialized: prevents two quick word-saves (each preceded by a ~1s
  // completeOnce translation call) from both reading the same base list and
  // losing one entry to a last-write-wins clobber.
  vocabChain = appendToList<VocabEntry>(vocabChain, listStore, 'lectorVocab', (list) => {
    const idx = list.findIndex((x) => x.word.toLowerCase() === entry.word.toLowerCase())
    if (idx === -1) {
      list.unshift(entry)
    } else {
      const existing = list[idx]
      list[idx] = {
        ...existing,
        context: entry.context || existing.context,
        translation: entry.translation || existing.translation,
        createdAt: Math.min(existing.createdAt, entry.createdAt),
        srs: existing.srs,
      }
    }
    return list.slice(0, 2000)
  })
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
  const card: SentenceCard = {
    id: newCardId(),
    sentence: message.sentence,
    translation: extractTranslation(analysis),
    analysis,
    keywords: extractKeywords(analysis),
    quote: message.quote,
    url: message.url,
    title: message.title,
    blockId: message.blockId,
    lang: 'en',
    cefr: extractCefr(analysis),
    createdAt: Date.now(),
    srs: null,
  }
  // Serialized: prevents two quick sentence-analyses from losing one card.
  sentenceChain = appendToList<SentenceCard>(
    sentenceChain,
    listStore,
    'lectorSentences',
    (list) => {
      list.unshift(card)
      return list.slice(0, 50)
    }
  )
}

async function openSidePanel(seed: { kind: string; text: string } | null) {
  if (seed) {
    await chrome.storage.local.set({ lectorSeed: seed })
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.windowId !== undefined && chrome.sidePanel) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  }
}

// Context-menu clicks seed the side panel (translate/summarize/explain/ask).
chrome.contextMenus.onClicked.addListener((info) => {
  if (!info.selectionText) return
  const map: Record<string, string> = {
    'lector-summarize': 'summarize',
    'lector-translate': 'translate',
    'lector-explain': 'explain',
    'lector-ask': 'ask',
  }
  const kind = map[info.menuItemId as string]
  if (kind) {
    openSidePanel({ kind, text: info.selectionText })
  }
})
