// Lector AI background service worker.
//
// Responsibilities (minimal in the BYOK model):
//   - Register context-menu entries that seed the side panel.
//   - Open the side panel on demand (from the FAB, action icon, or menus).
// All AI calls happen client-side (content script or side panel) using the
// user's own key — there is no backend.

import { t, type StringKey } from './shared/i18n'
import { getSettings, completeOnce } from './shared/byok'
import { SENTENCE_CARD_SYSTEM_PROMPT, extractTranslation, extractKeywords, extractCefr, newCardId } from './shared/sentences'
import { appendHistory, newHistoryId } from './shared/translation'
import { normalizeTranslationSettings } from './shared/providers'

// Serializes translation-history appends so rapid successive relay messages
// (read-modify-write on chrome.storage) don't clobber each other.
let historyChain: Promise<void> = Promise.resolve()

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
    chrome.storage.local.get(['lectorHighlights'], (r) => {
      const list = Array.isArray(r.lectorHighlights) ? r.lectorHighlights : []
      list.unshift(message.highlight)
      chrome.storage.local.set({ lectorHighlights: list.slice(0, 500) })
    })
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
    // Serialize the read-modify-write so rapid successive entries (e.g. a
    // concurrent bilingual pass) don't lose writes to a shared base list.
    historyChain = historyChain
      .then(
        () =>
          new Promise<void>((resolve) => {
            chrome.storage.local.get(['lectorTranslationHistory'], (r) => {
              const list = Array.isArray(r.lectorTranslationHistory) ? r.lectorTranslationHistory : []
              const next = appendHistory(list as any[], { ...message.entry, id: newHistoryId() })
              chrome.storage.local.set({ lectorTranslationHistory: next }, () => resolve())
            })
          })
      )
      .catch(() => {})
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
    // Alt+T triggers bilingual page translation directly.
    const action =
      cmd === 'lector-translate' ? { action: 'lector-toggle-bilingual' } : { action: 'lector-command', command: cmd }
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
  const entry = {
    id: 'v' + Date.now().toString(36),
    word: message.word,
    translation,
    context: message.context,
    url: message.url,
    title: message.title,
    // Detect the word's own language family (mirrors content.ts detectLang).
    lang: /[\u4e00-\u9fff]/.test(message.word) ? 'zh' : 'en',
    blockId: message.blockId,
    createdAt: Date.now(),
    srs: { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  }
  chrome.storage.local.get(['lectorVocab'], (r) => {
    const list: Array<{ word: string; srs: { interval: number; ease: number; reps: number; lapses: number; due: number }; createdAt: number; context: string; translation: string }> =
      Array.isArray(r.lectorVocab) ? r.lectorVocab : []
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
    chrome.storage.local.set({ lectorVocab: list.slice(0, 2000) })
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
  const card = {
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
  chrome.storage.local.get(['lectorSentences'], (r) => {
    const list = Array.isArray(r.lectorSentences) ? r.lectorSentences : []
    list.unshift(card)
    chrome.storage.local.set({ lectorSentences: list.slice(0, 50) })
  })
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
