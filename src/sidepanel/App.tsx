import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode, type DragEvent } from 'react'
import { useStore, type ChatMessage, type ChatSession } from '../shared/store'
import { renderMarkdown } from './markdown'
import { renderCitations, type PageBlock } from '../shared/citations'
import { isDue, scheduleSrs, type Grade } from '../shared/srs'
import { computeReviewStats, type ReviewStats } from '../shared/stats'
import { toMarkdown } from '../shared/exporters'
import type { Highlight } from '../shared/highlights'
import type { VocabEntry } from '../shared/vocabulary'
import {
  searchSentences,
  groupSentences,
  exportSentences,
  importSentences,
  extractTranslation,
  extractKeywords,
  extractCefr,
  extractExamples,
  SENTENCE_CARD_SYSTEM_PROMPT,
  type SentenceCard,
} from '../shared/sentences'
import {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon,
  SendIcon, XIcon, ClipboardListIcon, PlusIcon, PencilIcon, TrashIcon,
  BookMarkedIcon, DownloadIcon, UploadIcon, CardsIcon, SparklesIcon,
  SettingsIcon, GripVerticalIcon, CheckIcon, GridIcon, StopIcon, RotateIcon, ExpandIcon,
} from '../shared/icons'
import {
  PROVIDERS,
  getProvider,
  type ProviderId,
  type ByokSettings,
  DEFAULT_TRANSLATION_SETTINGS,
  normalizeTranslationSettings,
  type TranslationSettings,
} from '../shared/providers'
import { streamChat, completeOnce, getSettings, saveSettings, testConnection, fetchModels, type ChatMessage as WireMessage, type FetchedModel } from '../shared/byok'
import { t, resolveLocale, type StringKey, type LocalePref } from '../shared/i18n'
import { getLanguage, searchLanguages, type TranslationHistoryEntry } from '../shared/translation'
import { TRANSLATION_THEMES } from '../shared/translationThemes'
import { TRANSLATION_PERSONAS } from '../shared/translationPersonas'
import {
  matchHost,
  siteToggleState,
  newSiteRuleId,
  normalizeSiteRules,
  type SiteRule,
} from '../shared/siteRules'
import { totalSavedTokens } from '../shared/translationCache'
import {
  fillTemplate, filterTemplates, sortTemplates, validateTemplate,
  type PromptTemplate, type TemplateContext,
} from '../shared/promptTemplates'
import {
  validateEntry, renderGlossaryPrompt, exportGlossary, importGlossary,
  type GlossaryEntry,
} from '../shared/glossary'
import {
  exportVocabToAnki, exportSentencesToAnki, withAnkiDefaults,
  DEFAULT_ANKI_CONNECT_URL, DEFAULT_DECK_NAME, DEFAULT_MODEL_NAME,
  DEFAULT_SENTENCE_DECK_NAME,
  type AnkiExportResult, type AnkiConfig,
} from '../shared/anki'
import { isSameQueueSnapshot } from '../shared/storageQueue'
import { downloadBlob, readJsonFile } from './lib/downloads'

interface PageContext {
  title: string
  url: string
  text: string
  lang: string
  blocks: PageBlock[]
}

const RELAY_QUEUE_KEYS = [
  'lectorHighlights',
  'lectorVocab',
  'lectorSentences',
  'lectorTranslationHistory',
] as const
type RelayQueueKey = (typeof RELAY_QUEUE_KEYS)[number]

/**
 * Merge one content→background relay queue into the persisted zustand store.
 * Store actions are idempotent, so replaying a snapshot after a producer race
 * is safe. The queue is cleared only after an exact compare-and-swap check.
 */
function consumeRelayQueue(key: RelayQueueKey, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return
  const state = useStore.getState()
  if (key === 'lectorHighlights') {
    for (const item of raw as Highlight[]) state.addHighlight(item)
  } else if (key === 'lectorVocab') {
    for (const item of raw as VocabEntry[]) state.addVocab(item)
  } else if (key === 'lectorSentences') {
    for (const item of raw as SentenceCard[]) state.addSentence(item)
  } else {
    for (const item of raw as TranslationHistoryEntry[]) state.addTranslationHistory(item)
  }

  chrome.storage.local.get([key], (latest) => {
    const current = (latest as Record<string, unknown>)[key]
    if (isSameQueueSnapshot(current, raw)) {
      chrome.storage.local.set({ [key]: [] })
    }
  })
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// Shared core: call AI + build + save a sentence card. Returns success boolean.
// Callers wrap their own error UX (alert vs inline ImportMsg). Module-level
// because it has no React closure deps.
async function runSentenceAnalysis(sentence: string, url: string, title: string): Promise<boolean> {
  const settings = useStore.getState().byok
  if (!settings.apiKey) return false
  const analysis = await completeOnce(settings, SENTENCE_CARD_SYSTEM_PROMPT, sentence, {
    maxTokens: 1200,
    temperature: 0.4,
  })
  useStore.getState().addSentence({
    sentence,
    translation: extractTranslation(analysis),
    analysis: analysis || '',
    keywords: extractKeywords(analysis),
    quote: '',
    url,
    title,
    lang: 'en',
    cefr: extractCefr(analysis),
    srs: null,
  })
  return true
}

/** Flat, mutually-exclusive side-panel views (replaces overlay drawers). */
type View =
  | 'chat'
  | 'sentences'
  | 'highlights'
  | 'vocab'
  | 'settings'
  | 'templates'
  | 'glossary'
  | 'library'
  | 'translationHistory'

export default function App() {
  // Subscribe only to the slices this component uses. Calling useStore()
  // without a selector subscribes to the entire persisted object and forces a
  // full 3k-line panel rerender for every unrelated SRS/note/settings write.
  const byok = useStore((s) => s.byok)
  const setByok = useStore((s) => s.setByok)
  const sessions = useStore((s) => s.sessions)
  const addSession = useStore((s) => s.addSession)
  const updateSession = useStore((s) => s.updateSession)
  const removeSession = useStore((s) => s.removeSession)
  const clearSessions = useStore((s) => s.clearSessions)
  const highlights = useStore((s) => s.highlights)
  const vocab = useStore((s) => s.vocab)
  const removeHighlight = useStore((s) => s.removeHighlight)
  const updateVocabSrs = useStore((s) => s.updateVocabSrs)
  const removeVocab = useStore((s) => s.removeVocab)
  const templates = useStore((s) => s.templates)
  const addTemplate = useStore((s) => s.addTemplate)
  const updateTemplate = useStore((s) => s.updateTemplate)
  const removeTemplate = useStore((s) => s.removeTemplate)
  const reorderTemplates = useStore((s) => s.reorderTemplates)
  const glossary = useStore((s) => s.glossary)
  const addGlossaryEntry = useStore((s) => s.addGlossaryEntry)
  const updateGlossaryEntry = useStore((s) => s.updateGlossaryEntry)
  const removeGlossaryEntry = useStore((s) => s.removeGlossaryEntry)
  const replaceGlossary = useStore((s) => s.replaceGlossary)
  const sentences = useStore((s) => s.sentences)
  const removeSentence = useStore((s) => s.removeSentence)
  const promoteSentenceToReview = useStore((s) => s.promoteSentenceToReview)
  const updateSentenceSrs = useStore((s) => s.updateSentenceSrs)
  const translationHistory = useStore((s) => s.translationHistory)
  const clearTranslationHistory = useStore((s) => s.clearTranslationHistory)
  const hasOpened = useStore((s) => s.hasOpened)
  const markOpened = useStore((s) => s.markOpened)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [histSearch, setHistSearch] = useState('')

  const tr = (key: StringKey) => t(key, byok.locale)
  // Resolve a template's display title (i18n key for built-ins, raw for custom).
  const tplTitle = (tpl: PromptTemplate) =>
    tpl.titleKey ? t(tpl.titleKey, byok.locale) : tpl.title

  const sortedTemplates = useMemo(() => sortTemplates(templates), [templates])
  // Empty-state suggestion chips = the first 4 templates (same data source as
  // the "/" menu and the templates drawer).
  const suggestions = sortedTemplates.slice(0, 4)

  const [page, setPage] = useState<PageContext | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  // Flat view model: a single mutually-exclusive view replaces the 8 show*
  // booleans. Opening a view = setActiveView(...); only one can be active,
  // so stacked overlays are physically impossible. See
  // docs/superpowers/specs/2026-07-24-tab-navigation-redesign.md
  const [activeView, setActiveView] = useState<View>('chat')
  const [showTools, setShowTools] = useState(false) // MoreMenu 下拉开关（局部）
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  // Hostname of the active tab, for the current-site rule chip in the header.
  const [currentHost, setCurrentHost] = useState('')
  // Inline loading for the 举一反三 → make-card action: tracks the exact
  // example sentence currently being turned into a card, so its row shows a
  // spinner and the others stay clickable. Null when nothing is generating.
  const [busyExample, setBusyExample] = useState<string | null>(null)
  const [revealedVocab, setRevealedVocab] = useState<Set<string>>(new Set())
  const [revealedSentences, setRevealedSentences] = useState<Set<string>>(new Set())
  const [bilingualBusy, setBilingualBusy] = useState(false)
  // Live bilingual translation progress ({done,total}) reported by the content
  // script via lector-bilingual-progress. Shown on the header button; cleared
  // when the run completes, is cancelled, or errors.
  const [bilingualProgress, setBilingualProgress] = useState<{ done: number; total: number } | null>(null)
  // "/" menu state
  const [slashMenu, setSlashMenu] = useState<{ open: boolean; query: string; activeIdx: number }>(
    { open: false, query: '', activeIdx: 0 }
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const assistantBuf = useRef<string>('')
  const tokenFrameRef = useRef<number | null>(null)
  // AbortController for the in-flight chat stream. Lets the user Stop a long
  // response, and lets us abort cleanly on unmount / session switch so the
  // stream can't write into the wrong session or an unmounted component.
  const abortRef = useRef<AbortController | null>(null)
  // Abort the in-flight stream when the panel unmounts (close / Chrome
  // teardown / strict-mode remount) — otherwise streamChat keeps running and
  // its onToken setMessages fires on a gone component.
  useEffect(() => () => {
    abortRef.current?.abort()
    if (tokenFrameRef.current !== null) cancelAnimationFrame(tokenFrameRef.current)
  }, [])

  // Close the tools dropdown on outside click / Escape.
  useEffect(() => {
    if (!showTools) return
    const onDown = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setShowTools(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowTools(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showTools])

  // Pull the page from the active tab's content script + read any seed.
  //
  // Performance: the zustand store is hydrated SYNCHRONOUSLY from localStorage
  // (persist w/ default storage), so `byok` is already populated on first paint
  // and the header/chrome render immediately. The async work here is the
  // "background/content sync" — it must NOT block first paint, so we:
  //   - do NOT await getSettings() before anything else (the synchronous byok is
  //     the source of truth for the UI; the storage read only reconciles values
  //     the content/background wrote);
  //   - run the independent awaits in PARALLEL (tab query, seed read, settings
  //     reconcile) instead of sequentially;
  //   - avoid the redundant SECOND getSettings() call the old code made inside
  //     the seed branch (it re-used the locale already in byok).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Fire the three independent reads concurrently.
      const settingsP = getSettings()
      const tabP = (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'lector-get-page' }, (resp) => {
              if (cancelled || chrome.runtime.lastError || !resp?.page) return
              setPage(resp.page)
            })
          }
          // Capture the active tab's hostname for the current-site rule chip.
          if (tab?.url) {
            try { if (!cancelled) setCurrentHost(new URL(tab.url).hostname) } catch { /* ignore non-url */ }
          }
        } catch {
          // ignore — no active tab (e.g. a chrome:// page)
        }
      })()
      const seedP = chrome.storage.local.get('lectorSeed') as Promise<{
        lectorSeed?: { kind: string; text: string }
      }>

      // Reconcile settings from chrome.storage (the content/background may have
      // written a newer value). Use the already-pending promise; no extra call.
      let reconciledLocale = useStore.getState().byok.locale
      try {
        const stored = await settingsP
        reconciledLocale = stored.locale
        if (!cancelled) setByok(stored)
      } catch {
        // ignore — keep the synchronous zustand value
      }

      // Seed the composer from a one-shot relay value (selection-toolbar
      // translate/explain/summarize → open panel with a prefilled prompt).
      try {
        const seed = await seedP
        if (cancelled) return
        await tabP // ensure the tab read is done before we finish (best-effort)
        if (seed.lectorSeed?.text) {
          chrome.storage.local.remove('lectorSeed')
          // Use the reconciled chrome.storage locale. Reading the render
          // closure here used the pre-sync locale on first open.
          const loc = resolveLocale(reconciledLocale)
          const translateTarget = loc === 'zh' ? 'English' : '中文'
          const s = seed.lectorSeed
          const seedPrompt =
            s.kind === 'summarize'
              ? 'Summarize this in a few bullets:\n\n'
              : s.kind === 'translate'
                ? `Translate this to ${translateTarget}:\n\n`
                : s.kind === 'explain'
                  ? 'Explain this clearly:\n\n'
                  : ''
          setInput(`${seedPrompt}${s.text}`.slice(0, 4000))
        }
      } catch {
        // ignore
      }
    })()
    return () => { cancelled = true }
  }, [setByok])

  // Sync knowledge captured by the content→background relay (chrome.storage)
  // into the zustand store so the Highlights / Vocab drawers stay live.
  //
  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return
      if (changes.lectorHighlights) {
        consumeRelayQueue('lectorHighlights', changes.lectorHighlights.newValue)
      }
      if (changes.lectorVocab) {
        consumeRelayQueue('lectorVocab', changes.lectorVocab.newValue)
      }
      if (changes.lectorSentences) {
        consumeRelayQueue('lectorSentences', changes.lectorSentences.newValue)
      }
      if (changes.lectorTranslationHistory) {
        consumeRelayQueue('lectorTranslationHistory', changes.lectorTranslationHistory.newValue)
      }
    }
    // Guard: chrome.storage.onChanged may be undefined in some contexts (e.g.
    // when the extension context is invalidated, or in test/stub environments).
    // An unguarded addListener throws "Cannot read properties of undefined
    // (reading 'addListener')" and crashes the panel render. Best-effort: if the
    // API is missing we simply skip live syncing (the store still loads once).
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged?.addListener) return
    // Drain data captured while the panel was closed. onChanged only observes
    // future writes; without this initial read those queued items could remain
    // invisible forever until another capture happened to touch the key.
    chrome.storage.local.get([...RELAY_QUEUE_KEYS], (snapshot) => {
      for (const key of RELAY_QUEUE_KEYS) {
        consumeRelayQueue(key, (snapshot as Record<string, unknown>)[key])
      }
    })
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged?.removeListener?.(onStorage)
  }, [])

  // Mirror the glossary out of zustand into chrome.storage.local so the content
  // script (which runs in a separate context and cannot read window.localStorage
  // where zustand/persist writes) can inject it into translation prompts. This
  // mirrors the byok.ts "double-write" pattern. We push the full array on every
  // glossary change; the array is tiny so the cost is negligible.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return
    chrome.storage.local.set({ lectorGlossary: glossary }).catch(() => {
      // best-effort; content script will just skip glossary injection
    })
  }, [glossary])

  // Surface bilingual translation errors reported by the content script and
  // track live progress. The inline bilingual loop runs best-effort per block;
  // if the FIRST block fails (bad key, quota, network) the content script
  // forwards the error here so the user isn't left wondering why nothing
  // happened. Progress messages ({done,total}) drive the header button's
  // "{done}/{total}" readout; when done===total the run is complete.
  useEffect(() => {
    const onMessage = (message: {
      action?: string
      message?: string
      done?: number
      total?: number
      complete?: boolean
    }) => {
      if (message?.action === 'lector-bilingual-progress') {
        const done = message.done ?? 0
        const total = message.total ?? 0
        setBilingualProgress({ done, total })
        // The content script sends a final progress with done===total when the
        // run completes; release the busy state then so the button resets.
        if (message.complete || (total > 0 && done >= total)) {
          setBilingualBusy(false)
          // Keep the {total/total} readout briefly so the user sees completion,
          // then clear it.
          setTimeout(() => setBilingualProgress(null), 1200)
        }
        return
      }
      if (message?.action === 'lector-bilingual-error' && message.message) {
        // Both hard errors and user-cancel send this. Cancel's message is the
        // bilingual.canceled string; either way the run is over.
        setBilingualBusy(false)
        setBilingualProgress(null)
        const canceled = /cancel|stop/i.test(message.message)
        if (!canceled) {
          setError(message.message)
          // Key/quota errors surface in a top banner (no auto-opening Settings
          // on top of the current view — the user jumps to Settings themselves).
          if (/401|key|quota|429|credit/i.test(message.message)) {
            setErrorBanner(message.message)
          }
        }
      }
    }
    // Guard (same reason as the storage listener above): a missing
    // onMessage API must not crash the panel render.
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage?.addListener) return
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage?.removeListener?.(onMessage)
  }, [])

  useEffect(() => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = requestAnimationFrame(() => {
      const node = scrollRef.current
      if (node) {
        // Re-starting a smooth animation for every streamed token causes a
        // visible lag/backlog. Keep token streaming pinned synchronously and
        // reserve smooth scrolling for discrete message changes.
        node.scrollTo({ top: node.scrollHeight, behavior: streaming ? 'auto' : 'smooth' })
      }
      scrollFrameRef.current = null
    })
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
    }
  }, [messages, streaming])

  // Keep <html lang> in sync with the active locale so screen readers pronounce
  // content with the right phonology. index.html ships lang="en"; a zh user
  // would otherwise hear Chinese read as English.
  useEffect(() => {
    document.documentElement.lang = resolveLocale(byok.locale)
  }, [byok.locale])

  const downloadMarkdown = (hs: Highlight[]) => {
    downloadBlob('lector-highlights.md', toMarkdown(hs), 'text/markdown')
  }

  const gradeVocab = (v: VocabEntry, grade: Grade) => {
    updateVocabSrs(v.id, scheduleSrs(v.srs, grade))
    setRevealedVocab((cur) => {
      const next = new Set(cur)
      next.delete(v.id)
      return next
    })
  }

  const toggleReveal = (id: string) => {
    setRevealedVocab((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Shared sentence-card generator. Lives at App scope so VocabView and the
  // Highlights view (sibling components, not children of SentencesView) can
  // fire it from their own item-level "explain this" buttons. Mirrors the
  // core of SentencesView.handleGenerate but parameterizes the inputs
  // (sentence / url / title) so callers don't need their own closure.
  const generateSentenceCard = async (sentence: string, url: string, title: string) => {
    const settings = useStore.getState().byok
    if (!settings.apiKey) {
      alert(tr('err.addKey'))
      return
    }
    try {
      await runSentenceAnalysis(sentence, url, title)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  // make-card from a 举一反三 example sentence (inside SentencesView).
  // Wraps generateSentenceCard with per-example busy state so the row shows
  // a spinner; the new card appears at the top of the list via the store.
  const handleMakeCardFromExample = async (sentence: string, title: string) => {
    setBusyExample(sentence)
    try {
      await generateSentenceCard(sentence, '', title)
    } finally {
      setBusyExample(null)
    }
  }

  // make-card from a Highlight's "explain" (Sparkles) button. No per-row busy
  // state here (highlights list is short and the action is secondary); we just
  // surface a lightweight inline state by reusing busyExample keyed on text.
  const handleMakeCardFromHighlight = async (h: { text: string; url: string; title: string }) => {
    setBusyExample(h.text)
    try {
      await generateSentenceCard(h.text, h.url, h.title)
    } finally {
      setBusyExample(null)
    }
  }

  // Inline bilingual translation — ask the active tab's content script to
  // inject paragraph-level translations. The content script tracks which
  // blocks it has already translated, so repeated toggles add new ones.
  //
  // The content script responds immediately (it can't hold the channel open
  // across its ~30-block loop under MV3). bilingualBusy is now driven by the
  // progress / completion / error messages rather than a fixed timer, so the
  // button shows live "{done}/{total}" and lets the user cancel mid-run.
  const toggleBilingual = async () => {
    let tab: chrome.tabs.Tab | undefined
    try {
      ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    } catch {
      setBilingualBusy(false)
      setError(tr('bilingual.unavailable'))
      return
    }
    if (!tab?.id) {
      setBilingualBusy(false)
      setError(tr('bilingual.unavailable'))
      return
    }
    if (bilingualBusy) {
      // Already translating → this click cancels the in-flight run.
      chrome.tabs.sendMessage(tab.id, { action: 'lector-cancel-bilingual' }, () => {
        void chrome.runtime.lastError
      })
      setBilingualBusy(false)
      setBilingualProgress(null)
      return
    }
    setBilingualBusy(true)
    setBilingualProgress(null)
    chrome.tabs.sendMessage(tab.id, { action: 'lector-toggle-bilingual' }, () => {
      const failed = chrome.runtime.lastError
      if (failed) {
        setBilingualBusy(false)
        setBilingualProgress(null)
        setError(tr('bilingual.unavailable'))
      }
    })
  }

  // Ask the active tab's content script for the current text selection.
  const getSelectionFromPage = async (): Promise<string> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return ''
      const tabId = tab.id
      return await new Promise<string>((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'lector-get-selection' }, (resp: { selection?: string }) => {
          void chrome.runtime.lastError
          resolve(resp?.selection || '')
        })
      })
    } catch {
      return ''
    }
  }

  // Insert a template into the composer, filling placeholders from context.
  const applyTemplate = async (tpl: PromptTemplate) => {
    const selection = await getSelectionFromPage()
    const ctx: TemplateContext = {
      selection,
      page: (page?.text || '').slice(0, 2000),
      lang: page?.lang || 'en',
    }
    setInput(fillTemplate(tpl.content, ctx))
    setSlashMenu({ open: false, query: '', activeIdx: 0 })
  }

  // Fill a template's placeholders and send it immediately. Used by the
  // empty-state suggestion chips — unlike applyTemplate (which fills the
  // composer for editing), this sends right away.
  const sendTemplate = async (tpl: PromptTemplate) => {
    const selection = await getSelectionFromPage()
    const ctx: TemplateContext = {
      selection,
      page: (page?.text || '').slice(0, 2000),
      lang: page?.lang || 'en',
    }
    handleSend(fillTemplate(tpl.content, ctx))
  }

  const handleSend = useCallback(
    async (overrideInput?: string) => {
      const text = (overrideInput ?? input).trim()
      if (!text || streaming) return

      if (!byok.apiKey) {
        setError(t('side.error.addKey', byok.locale))
        setErrorBanner(t('side.error.addKey', byok.locale))
        return
      }

      const userMsg: ChatMessage = { id: newId(), role: 'user', content: text }
      const assistantMsg: ChatMessage = { id: newId(), role: 'assistant', content: '' }
      const next = [...messages, userMsg]
      setMessages([...next, assistantMsg])
      setInput('')
      setStreaming(true)
      setError(null)
      setErrorBanner(null) // a successful send clears any prior key/quota banner
      assistantBuf.current = ''
      // Fresh abort controller for this stream; Stop button / unmount / session
      // switch can cancel it. readSSE returns gracefully on abort, preserving
      // whatever streamed so far.
      abortRef.current = new AbortController()

      try {
        // Build citation-grounded page context: number the extracted blocks so
        // the model can cite them inline as [0], [1], … which we render as
        // clickable chips that jump back to the source on the page.
        const blocks = page?.blocks ?? []
        const citeContext =
          blocks.length > 0
            ? blocks.map((b, i) => `[${i}] ${b.text}`).join('\n\n')
            : (page?.text || '')

        const systemPrompt = `You are Lector AI, a sharp reading companion embedded in the user's browser.

You answer questions about the article the user is reading, summarize, explain
concepts, translate, and draft. Be concise and information-dense. Use Markdown.
When the user asks about "the article", reason only from the provided PAGE
CONTENT; if it isn't covered there, say so rather than guessing.

When you rely on the page content, cite the source block inline using the form
[0], [1], … matching the numbered blocks below. Place the citation right after
the claim it supports.

${page?.title ? `PAGE TITLE: ${page.title}` : ''}
${page?.url ? `PAGE URL: ${page.url}` : ''}

PAGE CONTENT (numbered blocks):
"""
${citeContext.slice(0, 12000)}
"""
${renderGlossaryPrompt(glossary) ? `\n${renderGlossaryPrompt(glossary)}\n` : ''}`

        const history: WireMessage[] = messages
          .filter((m) => m.content.trim().length > 0)
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content }))

        const wire: WireMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: text },
        ]

        await streamChat(
          byok,
          wire,
          { maxTokens: 1200, temperature: 0.4 },
          (delta) => {
            assistantBuf.current += delta
            // Providers may emit dozens of tiny deltas in one frame. Batch
            // React updates to the display refresh rate instead of rerendering
            // the whole panel for every token.
            if (tokenFrameRef.current === null) {
              tokenFrameRef.current = requestAnimationFrame(() => {
                const snapshot = assistantBuf.current
                setMessages((cur) =>
                  cur.map((m) => (m.id === assistantMsg.id ? { ...m, content: snapshot } : m))
                )
                tokenFrameRef.current = null
              })
            }
          },
          abortRef.current?.signal
        )

        if (tokenFrameRef.current !== null) {
          cancelAnimationFrame(tokenFrameRef.current)
          tokenFrameRef.current = null
        }
        const finalAssistant = {
          ...assistantMsg,
          content: assistantBuf.current || '(no response)',
        }
        const finalMessages = next.concat(finalAssistant)
        setMessages(finalMessages)
        // Guard against the session being deleted while the stream was running
        // (user removed it from the Library mid-response). updateSession on a
        // missing id is a silent no-op, but the user would lose the answer;
        // fall back to creating a fresh session so the exchange isn't dropped.
        if (activeSessionId) {
          const stillExists = useStore
            .getState()
            .sessions.some((s) => s.id === activeSessionId)
          if (stillExists) {
            updateSession(activeSessionId, { messages: finalMessages })
          } else {
            const session: ChatSession = {
              id: newId(),
              title: page?.title || text.slice(0, 60),
              url: page?.url || '',
              createdAt: Date.now(),
              messages: finalMessages,
            }
            addSession(session)
            setActiveSessionId(session.id)
          }
        } else {
          const session: ChatSession = {
            id: newId(),
            title: page?.title || text.slice(0, 60),
            url: page?.url || '',
            createdAt: Date.now(),
            messages: finalMessages,
          }
          addSession(session)
          setActiveSessionId(session.id)
        }
      } catch (e) {
        if (tokenFrameRef.current !== null) {
          cancelAnimationFrame(tokenFrameRef.current)
          tokenFrameRef.current = null
        }
        // Abort (Stop / unmount / session switch) is intentional: keep whatever
        // streamed so far and don't show an error. A genuine failure surfaces
        // inline + (for key/quota errors) in the banner with an Open-settings link.
        const aborted =
          abortRef.current?.signal.aborted ||
          (e instanceof DOMException && e.name === 'AbortError')
        if (aborted) {
          const partial = assistantBuf.current
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: partial || tr('side.chat.canceled') }
                : m
            )
          )
        } else {
          const msg = e instanceof Error ? e.message : tr('err.requestFailed')
          setError(msg)
          // Key/quota/auth errors also surface in the banner (with the
          // Open-settings shortcut) so they're not buried in the inline line.
          if (/401|key|quota|429|credit/i.test(msg)) setErrorBanner(msg)
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: `⚠️ ${msg}` } : m
            )
          )
        }
      } finally {
        abortRef.current = null
        setStreaming(false)
      }
    },
    [input, streaming, messages, byok, page, activeSessionId, addSession, updateSession]
  )

  const startNewChat = () => {
    // Abort any in-flight stream so it can't finish and write its answer into
    // this fresh (empty) chat, and reset streaming state so the composer isn't
    // left disabled. Without this, a stream started in session A could land in
    // the new chat or vanish entirely.
    abortRef.current?.abort()
    abortRef.current = null
    if (tokenFrameRef.current !== null) cancelAnimationFrame(tokenFrameRef.current)
    tokenFrameRef.current = null
    assistantBuf.current = ''
    setStreaming(false)
    setMessages([])
    setActiveSessionId(null)
    setError(null)
  }

  const openSession = (s: ChatSession) => {
    // Same rationale as startNewChat: don't let a stream from another session
    // bleed into the one we're opening.
    abortRef.current?.abort()
    abortRef.current = null
    if (tokenFrameRef.current !== null) cancelAnimationFrame(tokenFrameRef.current)
    tokenFrameRef.current = null
    assistantBuf.current = ''
    setStreaming(false)
    setMessages(s.messages)
    setActiveSessionId(s.id)
    setActiveView('chat')
  }

  // Stop the in-flight chat stream (Keep the partial text already rendered).
  const stopStreaming = () => {
    abortRef.current?.abort()
  }

  // Retry the last user turn (re-send the same text). Used by the Retry button
  // on a failed/empty assistant message.
  const retryLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUser) handleSend(lastUser.content)
  }

  // Apply a partial byok patch + persist it (header chip + quick toggles use
  // this so they don't each re-implement the setByok + saveSettings dance).
  const saveByok = useCallback(async (patch: Partial<ByokSettings>) => {
    const next = { ...useStore.getState().byok, ...patch }
    setByok(next)
    await saveSettings(next)
  }, [setByok])

  // Pop Lector out into its own standalone window (the old FAB behavior, now
  // surfaced as a header button). Runs in the extension context, so
  // getURL is safe; reuse a named window so repeats focus it instead of
  // stacking windows.
  const openStandalone = () => {
    try {
      const url = chrome.runtime.getURL('sidepanel/index.html')
      window.open(url, 'lector-ai-panel')
    } catch {
      /* context unavailable — ignore */
    }
  }

  const providerConfigured = Boolean(byok.apiKey)

  return (
    <div className="flex flex-col h-screen bg-bg">
      {/* Header: page title + page-bilingual toggle + settings.
          Brand identity is already shown in the side-panel window title bar
          (<title> in index.html), so we don't repeat the "L" logo here. */}
      <header className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-surface border-b border-line">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink truncate leading-tight">
            {page?.title || tr('side.header.defaultTitle')}
          </div>
          <div className="text-[10px] text-ink-faint truncate max-w-[200px] mt-0.5">
            {providerConfigured
              ? `${getProvider(byok.provider).label} · ${byok.model || 'model'}`
              : tr('side.header.noKey')}
          </div>
          {/* Current-site quick toggle (Immersive-parity site rules). Cycles
              auto → always → never for the active tab's host. */}
          {currentHost && (
            <CurrentSiteChip
              host={currentHost}
              rules={normalizeTranslationSettings(byok.translation).siteRules}
              locale={byok.locale}
              onToggle={(next) => {
                const ts = normalizeTranslationSettings(byok.translation)
                void saveByok({ translation: { ...ts, siteRules: next } })
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={toggleBilingual}
            disabled={!page}
            title={
              !page
                ? tr('toolbar.bilingual.disabledHint')
                : bilingualBusy
                  ? tr('bilingual.cancel')
                  : tr('toolbar.bilingual')
            }
            aria-label={
              !page
                ? tr('toolbar.bilingual.disabledHint')
                : bilingualBusy
                  ? tr('bilingual.cancel')
                  : tr('toolbar.bilingual')
            }
            className={`icon-btn relative ${bilingualBusy ? 'text-accent' : ''}`}
          >
            {bilingualBusy ? (
              <span className="block w-3.5 h-3.5 border-2 border-line border-t-accent rounded-full animate-spin" />
            ) : (
              <LanguagesIcon size={17} />
            )}
            {bilingualBusy && bilingualProgress && bilingualProgress.total > 0 && (
              <span className="absolute -bottom-1.5 -right-1.5 text-[8px] font-semibold bg-accent text-accent-on rounded-full px-1 leading-tight min-w-[14px] text-center">
                {bilingualProgress.done}
              </span>
            )}
          </button>
          <button
            onClick={openStandalone}
            title={tr('side.header.openStandalone')}
            aria-label={tr('side.header.openStandalone')}
            className="icon-btn"
          >
            <ExpandIcon size={17} />
          </button>
          <button
            onClick={() => setActiveView('settings')}
            title={tr('settings.title')}
            aria-label={tr('settings.title')}
            className={`icon-btn ${activeView === 'settings' ? 'text-accent' : ''}`}
          >
            <SettingsIcon size={17} />
          </button>
        </div>
      </header>

      {/* TabBar: flat view switching (high-frequency tabs + MoreMenu). */}
      <nav className="tab-bar" role="tablist" aria-label={tr('aria.views')}>
        <button
          onClick={() => setActiveView('chat')}
          role="tab"
          aria-selected={activeView === 'chat'}
          className={`tab-item ${activeView === 'chat' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.chat')}
        >
          <SendIcon size={14} />
          <span>{tr('side.tab.chat')}</span>
        </button>
        <button
          onClick={() => setActiveView('sentences')}
          role="tab"
          aria-selected={activeView === 'sentences'}
          className={`tab-item relative ${activeView === 'sentences' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.sentences')}
        >
          <CardsIcon size={14} />
          <span>{tr('side.tab.sentences')}</span>
          {sentences.some((c) => c.srs && isDue(c.srs)) && (
            <span className="lector-due-badge">!</span>
          )}
        </button>
        <button
          onClick={() => setActiveView('highlights')}
          role="tab"
          aria-selected={activeView === 'highlights'}
          className={`tab-item relative ${activeView === 'highlights' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.highlights')}
        >
          <BookmarkIcon size={14} />
          <span>{tr('side.tab.highlights')}</span>
          {highlights.length > 0 && <span className="dot-badge" />}
        </button>
        <button
          onClick={() => setActiveView('vocab')}
          role="tab"
          aria-selected={activeView === 'vocab'}
          className={`tab-item relative ${activeView === 'vocab' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.vocab')}
        >
          <BookOpenIcon size={14} />
          <span>{tr('side.tab.vocab')}</span>
          {vocab.some((v) => isDue(v.srs)) && <span className="lector-due-badge">!</span>}
        </button>
        {/* ⋯ MoreMenu: low-frequency views (Templates / Glossary / Library) */}
        <div className="relative" ref={toolsRef}>
          <button
            onClick={() => setShowTools((v) => !v)}
            className={`tab-item ${activeView === 'templates' || activeView === 'glossary' || activeView === 'library' ? 'tab-item-active' : ''}`}
            aria-label={tr('side.tab.more')}
            aria-expanded={showTools}
          >
            <GridIcon size={14} />
            <span>{tr('side.tab.more')}</span>
          </button>
          {showTools && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-line rounded-xl shadow-pop z-30 py-1 lector-anim-fade">
              <button
                onClick={() => { setActiveView('library'); setShowTools(false) }}
                aria-label={tr('aria.library')}
                className="tools-item"
              >
                <LibraryIcon size={16} />
                <span className="flex-1 text-left">{tr('side.tab.more.library')}</span>
              </button>
              <button
                onClick={() => { setActiveView('translationHistory'); setShowTools(false) }}
                aria-label={tr('aria.translationHistory')}
                className="tools-item relative"
              >
                <LanguagesIcon size={16} />
                <span className="flex-1 text-left">{tr('side.translationHistory.title')}</span>
                {translationHistory.length > 0 && <span className="dot-badge" />}
              </button>
              <button
                onClick={() => { setActiveView('glossary'); setShowTools(false) }}
                aria-label={tr('aria.glossary')}
                className="tools-item relative"
              >
                <BookMarkedIcon size={16} />
                <span className="flex-1 text-left">{tr('side.tab.more.glossary')}</span>
                {glossary.length > 0 && <span className="dot-badge" />}
              </button>
              <button
                onClick={() => { setActiveView('templates'); setShowTools(false) }}
                aria-label={tr('aria.templates')}
                className="tools-item relative"
              >
                <ClipboardListIcon size={16} />
                <span className="flex-1 text-left">{tr('side.tab.more.templates')}</span>
                {templates.filter((tpl) => !tpl.builtIn).length > 0 && (
                  <span className="dot-badge" />
                )}
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ErrorBanner: API/key errors show here instead of auto-opening Settings. */}
      {errorBanner && (
        <div className="error-banner" role="alert">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" />
          <span className="flex-1 leading-relaxed">
            <span className="font-semibold">{tr('side.error.banner')}: </span>
            {errorBanner}
          </span>
          <div className="error-banner-actions">
            <button
              onClick={() => { setActiveView('settings'); setErrorBanner(null) }}
              className="font-medium underline hover:no-underline"
            >
              {tr('side.error.goSettings')}
            </button>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-ink-faint hover:text-ink"
              aria-label={tr('side.error.dismiss')}
            >
              <XIcon size={13} />
            </button>
          </div>
        </div>
      )}

      {activeView === 'chat' && (
        <>
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3.5"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!providerConfigured && (
          <div className="p-3 rounded-xl bg-accent-softer border border-accent-soft text-[12px] text-accent-hover leading-relaxed">
            <div className="font-semibold mb-1">{tr('side.onboard.title')}</div>
            {(() => {
              const body = tr('side.onboard.body')
              const [before, after] = body.split('{settings}')
              return (
                <>
                  {before}
                  <button onClick={() => setActiveView('settings')} className="underline font-medium hover:text-accent">
                    {tr('side.onboard.settingsLink')}
                  </button>
                  {after}
                </>
              )
            })()}
          </div>
        )}

        {messages.length === 0 && (
          <div className="text-center pt-6 pb-2">
            <div className="w-14 h-14 rounded-2xl bg-accent text-accent-on font-bold flex items-center justify-center text-2xl mx-auto mb-4 shadow-md font-serif">
              L
            </div>
            <h2 className="text-[15px] font-semibold text-ink mb-1 font-serif tracking-tight">{tr('side.empty.title')}</h2>
            <p className="text-xs text-ink-faint mb-6 px-8 leading-relaxed">
              {tr('side.empty.subtitle')}
            </p>
            {/* Prominent first-run CTA straight from the empty hero — before,
                the only path to Settings was the header gear / the onboarding
                strip above, which a first-time user scanning the center missed. */}
            {!providerConfigured && (
              <div className="mb-5">
                <button
                  onClick={() => setActiveView('settings')}
                  className="btn-primary px-5 py-2.5 text-[12px] font-medium"
                >
                  {tr('side.onboard.cta')}
                </button>
              </div>
            )}
            {/* One-time feature hint: shown only on the first open ever, then
                dismissed for good (hasOpened persists). Explains the content-
                script toolbar / FAB / bilingual features a first-time user
                can't otherwise discover from this panel. */}
            {!hintDismissed && !hasOpened && (
              <div className="mx-2 mb-5 text-left p-3 rounded-xl bg-surface border border-line">
                <div className="text-[12px] font-semibold text-ink mb-1">{tr('side.onboard.hintTitle')}</div>
                <p className="text-[11px] text-ink-soft leading-relaxed mb-2">{tr('side.onboard.hintBody')}</p>
                <button
                  onClick={() => {
                    setHintDismissed(true)
                    markOpened()
                  }}
                  className="text-[11px] text-accent font-medium hover:text-accent-hover"
                >
                  {tr('side.onboard.hintDismiss')}
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 px-1">
              {suggestions.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => sendTemplate(tpl)}
                  disabled={!page || !providerConfigured}
                  className="px-3 py-2.5 text-left text-[12px] font-medium text-ink-soft bg-surface border border-line rounded-xl hover:border-accent hover:bg-accent-softer hover:text-accent transition-colors duration-150 ease-out disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface disabled:hover:text-ink-soft"
                >
                  {tplTitle(tpl)}
                </button>
              ))}
            </div>
            {!page && (
              <p className="text-[11px] text-warn mt-5 px-6">
                {tr('side.empty.noPage')}
              </p>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] px-3.5 py-2 bg-accent text-accent-on text-body rounded-2xl rounded-br-md whitespace-pre-wrap break-words shadow-sm">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[92%] px-3.5 py-2.5 bg-surface border border-line rounded-2xl rounded-bl-md shadow-sm">
                {m.content ? (
                  <CitationContent
                    html={renderCitations(
                      renderMarkdown(m.content),
                      new Set((page?.blocks ?? []).map((b) => b.id))
                    )}
                  />
                ) : (
                  <div className="flex items-center gap-2 text-[12px] text-ink-faint">
                    <div className="w-3.5 h-3.5 border-2 border-line border-t-accent rounded-full animate-spin" />
                    {tr('side.thinking')}
                  </div>
                )}
                {/* Retry affordance on a failed or stopped assistant message:
                    re-send the last user turn. Hidden while a stream is in
                    flight and for the in-progress (empty) bubble. */}
                {m.content && !streaming && /^(⚠️|\(stopped\))/.test(m.content) && (
                  <div className="mt-1.5">
                    <button
                      onClick={retryLast}
                      className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover transition-colors"
                    >
                      <RotateIcon size={12} />
                      {tr('side.chat.retry')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="px-3.5 py-2.5 bg-surface border-t border-line">
        {error && (
          <div className="text-[11px] text-danger mb-1.5 px-1 flex items-center gap-1">
            <span className="inline-block w-1 h-1 rounded-full bg-danger" />
            {error}
          </div>
        )}

        {/* "/" template menu — floats above the textarea */}
        {slashMenu.open && (
          <SlashMenu
            templates={filterTemplates(sortedTemplates, slashMenu.query)}
            activeIdx={slashMenu.activeIdx}
            titleFor={tplTitle}
            emptyText={tr('side.templates.menuEmpty')}
            onPick={(tpl) => applyTemplate(tpl)}
            onHover={(idx) => setSlashMenu((m) => ({ ...m, activeIdx: idx }))}
          />
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={input}
            aria-label={tr('side.empty.title')}
            onChange={(e) => {
              const v = e.target.value
              setInput(v)
              // Open the "/" menu when the input is just "/" or "/" + filter text.
              if (v.startsWith('/')) {
                setSlashMenu({ open: true, query: v.slice(1), activeIdx: 0 })
              } else if (slashMenu.open) {
                setSlashMenu({ open: false, query: '', activeIdx: 0 })
              }
            }}
            onKeyDown={(e) => {
              // Keyboard navigation for the "/" menu takes priority.
              if (slashMenu.open) {
                const matches = filterTemplates(sortedTemplates, slashMenu.query)
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSlashMenu((m) => ({
                    ...m,
                    activeIdx: Math.min(m.activeIdx + 1, matches.length - 1),
                  }))
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSlashMenu((m) => ({ ...m, activeIdx: Math.max(m.activeIdx - 1, 0) }))
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const pick = matches[slashMenu.activeIdx]
                  if (pick) applyTemplate(pick)
                  else setSlashMenu({ open: false, query: '', activeIdx: 0 })
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSlashMenu({ open: false, query: '', activeIdx: 0 })
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={providerConfigured ? tr('side.composer.placeholder.ready') : tr('side.composer.placeholder.noKey')}
            rows={1}
            className="flex-1 max-h-32 resize-none px-3.5 py-2.5 text-body bg-bg border border-line rounded-2xl leading-relaxed focus:outline-none focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft transition-colors duration-150 ease-out"
          />
          <button
            onClick={() => (streaming ? stopStreaming() : handleSend())}
            disabled={!streaming && (!input.trim() || !providerConfigured)}
            aria-label={streaming ? tr('side.chat.stop') : tr('side.composer.hint')}
            className="btn-primary w-10 h-10 flex-shrink-0 rounded-2xl !p-0"
          >
            {streaming ? <StopIcon size={14} /> : <SendIcon size={17} />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-ink-faint">
            {tr('side.composer.hint')} · {tr('composer.templates.hint')}
          </span>
          {messages.length > 0 && (
            <button onClick={startNewChat} className="text-[10px] text-ink-faint hover:text-ink-soft transition-colors">
              {tr('side.composer.newChat')}
            </button>
          )}
        </div>
      </div>
        </>
      )}

      {activeView === 'settings' && (
        <SettingsView
          byok={byok}
          onChange={async (next) => {
            setByok(next)
            await saveSettings({ ...useStore.getState().byok, ...next })
          }}
        />
      )}

      {/* Library view (flat — replaces the overlay drawer) */}
      {activeView === 'library' && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="drawer-head">
            <h3 className="drawer-title">{tr('side.library.title')}</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <Empty text={tr('side.library.empty')} />
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className="group row row-hover"
                  role="button"
                  tabIndex={0}
                  onClick={() => openSession(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openSession(s)
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink truncate">{s.title}</div>
                      <div className="text-[10px] text-ink-faint mt-0.5">{new Date(s.createdAt).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeSession(s.id)
                        if (activeSessionId === s.id) startNewChat()
                      }}
                      aria-label={tr('aria.deleteConversation')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                    >
                      <XIcon size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {sessions.length > 0 && (
            <button
              onClick={() => {
                clearSessions()
                startNewChat()
              }}
              className="px-4 py-2.5 text-meta text-ink-faint hover:text-danger hover:bg-danger-soft/40 border-t border-line transition-colors text-left"
            >
              {tr('side.library.clearAll')}
            </button>
          )}
        </div>
      )}

      {/* Highlights view (flat) */}
      {activeView === 'highlights' && (
        <ViewShell title={tr('side.highlights.title')}>
          {highlights.length === 0 ? (
            <Empty text={tr('side.highlights.empty')} />
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                {highlights.map((h) => (
                  <div key={h.id} className="group row">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-ink leading-relaxed border-l-2 border-accent/40 pl-2.5">{h.text}</div>
                        {h.note && <div className="text-[11px] text-ink-soft mt-1.5 pl-2.5">{h.note}</div>}
                        <div className="text-[10px] text-ink-faint mt-1.5 pl-2.5 truncate">{h.title}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => void handleMakeCardFromHighlight(h)}
                          title={tr('side.sentences.fromHighlight')}
                          aria-label={tr('aria.makeCard')}
                          className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                        >
                          <SparklesIcon size={14} />
                        </button>
                        <button
                          onClick={() => removeHighlight(h.id)}
                          aria-label={tr('aria.deleteHighlight')}
                          className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                        >
                          <XIcon size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => downloadMarkdown(highlights)}
                className="px-4 py-2.5 text-meta text-ink-soft hover:text-accent hover:bg-accent-softer border-t border-line transition-colors text-left flex items-center gap-1.5"
              >
                <DownloadIcon size={13} />
                {tr('side.highlights.export')}
              </button>
            </>
          )}
        </ViewShell>
      )}

      {/* Translation history view (flat) */}
      {activeView === 'translationHistory' && (
        <ViewShell title={tr('side.translationHistory.title')}>
          {translationHistory.length === 0 ? (
            <Empty text={tr('side.translationHistory.empty')} />
          ) : (
            <>
              <div className="px-3 pt-3">
                <input
                  value={histSearch}
                  onChange={(e) => setHistSearch(e.target.value)}
                  placeholder={tr('side.translationHistory.search')}
                  className="field-sm w-full"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {translationHistory
                  .filter(
                    (e) =>
                      !histSearch.trim() ||
                      e.source.includes(histSearch.trim()) ||
                      e.target.includes(histSearch.trim())
                  )
                  .map((e) => (
                    <div key={e.id} className="group row">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-ink-faint bg-surface-muted px-1.5 py-0.5 rounded">
                              {tr(('side.translationHistory.kind.' + e.kind) as StringKey)}
                            </span>
                            <span className="text-[10px] text-ink-faint">
                              {getLanguage(e.targetLang)[byok.locale === 'zh' || (byok.locale === 'auto' && navigator.language?.toLowerCase().startsWith('zh')) ? 'zh' : 'en']}
                            </span>
                            <span className="text-[10px] text-ink-faint">
                              {new Date(e.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-[12px] text-ink leading-relaxed border-l-2 border-accent/40 pl-2.5">{e.source}</div>
                          <div className="text-[12px] text-ink-soft leading-relaxed mt-1 pl-2.5">{e.target}</div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => navigator.clipboard.writeText(e.target).catch(() => {})}
                            aria-label={tr('aria.copyTranslation')}
                            className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                          >
                            <ClipboardListIcon size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
              <button
                onClick={() => clearTranslationHistory()}
                className="px-4 py-2.5 text-meta text-ink-soft hover:text-danger hover:bg-surface-muted border-t border-line transition-colors text-left flex items-center gap-1.5"
              >
                <TrashIcon size={13} />
                {tr('side.translationHistory.clear')}
              </button>
            </>
          )}
        </ViewShell>
      )}

      {/* Vocabulary view (flat) */}
      {activeView === 'vocab' && (
        <VocabView
          vocab={vocab}
          revealedVocab={revealedVocab}
          ankiConfig={byok.anki}
          tr={tr}
          onToggleReveal={(id) => toggleReveal(id)}
          onRemoveVocab={removeVocab}
          onGradeVocab={(v, g) => gradeVocab(v, g)}
          onSaveAnkiConfig={(cfg) => setByok({ anki: cfg })}
          onExplainVocab={(v) => {
            if (!v.context?.trim()) {
              alert(tr('side.sentences.noContext'))
              return
            }
            void generateSentenceCard(v.context, v.url, v.title)
          }}
        />
      )}

      {/* Templates view (flat) */}
      {activeView === 'templates' && (
        <TemplatesView
          templates={sortedTemplates}
          titleFor={tplTitle}
          tr={tr}
          onAdd={(tpl) => addTemplate(tpl)}
          onUpdate={(id, patch) => updateTemplate(id, patch)}
          onRemove={(id) => removeTemplate(id)}
          onReorder={reorderTemplates}
        />
      )}

      {/* Glossary view (flat) */}
      {activeView === 'glossary' && (
        <GlossaryView
          entries={glossary}
          tr={tr}
          onAdd={(e) => addGlossaryEntry(e)}
          onUpdate={(id, patch) => updateGlossaryEntry(id, patch)}
          onRemove={(id) => removeGlossaryEntry(id)}
          onImport={(entries) => replaceGlossary(entries)}
        />
      )}

      {/* Sentence Library view (flat) */}
      {activeView === 'sentences' && (
        <SentencesView
          sentences={sentences}
          revealed={revealedSentences}
          busyExample={busyExample}
          tr={tr}
          onToggleReveal={(id) =>
            setRevealedSentences((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
          onRemove={(id) => removeSentence(id)}
          onPromote={(id) => promoteSentenceToReview(id)}
          onGrade={(c, g) => {
            if (c.srs) updateSentenceSrs(c.id, scheduleSrs(c.srs, g))
            setRevealedSentences((prev) => {
              const next = new Set(prev)
              next.delete(c.id)
              return next
            })
          }}
          onViewSource={(blockId, url) => {
            if (blockId) {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tabId = tabs[0]?.id
                if (tabId !== undefined) {
                  chrome.tabs.sendMessage(tabId, { action: 'lector-jump-to', blockId }, () => {
                    void chrome.runtime.lastError
                  })
                }
              })
            } else if (url) {
              window.open(url, '_blank')
            }
          }}
          onAnkiExport={async (cards) => {
            const settings = useStore.getState().byok
            const cfg = withAnkiDefaults(settings.anki)
            const deckName = cfg.deckName === DEFAULT_DECK_NAME ? DEFAULT_SENTENCE_DECK_NAME : cfg.deckName
            try {
              const r = await exportSentencesToAnki(cards, { ...cfg, deckName })
              alert(tr('anki.result').replace('{added}', String(r.added)).replace('{dup}', String(r.duplicated)).replace('{fail}', String(r.failed)))
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e))
            }
          }}
          onMakeCard={(sentence, title) => handleMakeCardFromExample(sentence, title)}
        />
      )}
    </div>
  )
}
function ViewShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="drawer-head">
        <h3 className="drawer-title">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-10 h-10 rounded-full bg-surface-muted flex items-center justify-center mb-3">
        <span className="block w-1.5 h-1.5 rounded-full bg-line-strong" />
      </div>
      <p className="text-[12px] text-ink-faint leading-relaxed max-w-[200px]">{text}</p>
    </div>
  )
}

// Renders assistant HTML and wires citation chips to jump back to the source
// block on the page (Feature ①). Uses event delegation so re-renders are cheap.
function CitationContent({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onClick = async (e: MouseEvent) => {
      const cite = (e.target as HTMLElement).closest<HTMLElement>('.lector-cite')
      if (!cite) return
      const blockId = cite.getAttribute('data-cite') || ''
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'lector-jump-to', blockId }, () => {
          void chrome.runtime.lastError
        })
      }
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [])
  return <div ref={ref} className="lector-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

// ---------------------------------------------------------------------------
// "/" template menu — floats above the composer
// ---------------------------------------------------------------------------
function SlashMenu({
  templates,
  activeIdx,
  titleFor,
  emptyText,
  onPick,
  onHover,
}: {
  templates: PromptTemplate[]
  activeIdx: number
  titleFor: (t: PromptTemplate) => string
  emptyText: string
  onPick: (t: PromptTemplate) => void
  onHover: (idx: number) => void
}) {
  return (
    <div
      role="listbox"
      aria-label="Templates"
      className="mb-2 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface shadow-md lector-anim-pop"
    >
      {templates.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-ink-faint">{emptyText}</div>
      ) : (
        templates.map((tpl, i) => (
          <button
            key={tpl.id}
            role="option"
            aria-selected={i === activeIdx}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(tpl)}
            className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors ${
              i === activeIdx ? 'bg-accent-softer' : 'hover:bg-surface-muted'
            } ${i === 0 ? '' : 'border-t border-line/50'}`}
          >
            <span className="text-[12px] font-medium text-ink flex items-center gap-1.5">
              {titleFor(tpl)}
              {tpl.builtIn && (
                <span className="chip-builtIn">{t('side.templates.builtIn', useStore.getState().byok.locale)}</span>
              )}
            </span>
            <span className="text-[10px] text-ink-faint truncate">
              {tpl.content.replace(/\n/g, ' ').slice(0, 60)}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vocabulary review drawer — list + SRS review + Anki export
// ---------------------------------------------------------------------------
interface VocabViewProps {
  vocab: VocabEntry[]
  revealedVocab: Set<string>
  ankiConfig?: { url: string; deckName: string; modelName: string; tags: string[] }
  tr: (key: StringKey) => string
  onToggleReveal: (id: string) => void
  onRemoveVocab: (id: string) => void
  onGradeVocab: (v: VocabEntry, grade: Grade) => void
  /** Persist the user-edited Anki config back into settings. */
  onSaveAnkiConfig: (cfg: { url: string; deckName: string; modelName: string; tags: string[] }) => void
  /** Generate a sentence card from this vocab entry's context sentence. */
  onExplainVocab: (v: VocabEntry) => void
}

function VocabView({
  vocab,
  revealedVocab,
  ankiConfig,
  tr,
  onToggleReveal,
  onRemoveVocab,
  onGradeVocab,
  onSaveAnkiConfig,
  onExplainVocab,
}: VocabViewProps) {
  // Anki export sub-panel state. `showPanel` toggles the form; `sending` and
  // `result` drive the UX during/after the POST.
  const [showPanel, setShowPanel] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<AnkiExportResult | null>(null)
  const defaults = withAnkiDefaults(ankiConfig)
  const [cfgUrl, setCfgUrl] = useState(defaults.url)
  const [cfgDeck, setCfgDeck] = useState(defaults.deckName)
  const [cfgModel, setCfgModel] = useState(defaults.modelName)
  const [cfgTags, setCfgTags] = useState(defaults.tags.join(', '))

  const handleSend = async () => {
    setSending(true)
    setResult(null)
    const tags = cfgTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const cfg: AnkiConfig = {
      url: cfgUrl.trim() || DEFAULT_ANKI_CONNECT_URL,
      deckName: cfgDeck.trim() || DEFAULT_DECK_NAME,
      modelName: cfgModel.trim() || DEFAULT_MODEL_NAME,
      tags: tags.length > 0 ? tags : ['lector'],
    }
    // Persist the (possibly edited) config so it sticks next time.
    onSaveAnkiConfig(cfg)
    try {
      const res = await exportVocabToAnki(vocab, cfg)
      setResult(res)
    } finally {
      setSending(false)
    }
  }

  return (
    <ViewShell title={tr('side.vocab.title')}>
      {vocab.length > 0 && <StatsBar stats={computeReviewStats(vocab)} tr={tr} />}
      {vocab.length === 0 ? (
        <Empty text={tr('side.vocab.empty')} />
      ) : (
        <>
          {/* Anki export action bar */}
          <div className="px-4 py-3 border-b border-line">
            {!showPanel ? (
              <button
                onClick={() => setShowPanel(true)}
                className="btn-add py-2 text-[12px]"
              >
                {tr('side.vocab.sendAnki')}
              </button>
            ) : (
              <div className="space-y-2.5 py-0.5">
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiUrl')}
                  </label>
                  <input
                    value={cfgUrl}
                    onChange={(e) => setCfgUrl(e.target.value)}
                    className="field-sm"
                  />
                </div>
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiDeck')}
                  </label>
                  <input
                    value={cfgDeck}
                    onChange={(e) => setCfgDeck(e.target.value)}
                    className="field-sm"
                  />
                </div>
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiModel')}
                  </label>
                  <input
                    value={cfgModel}
                    onChange={(e) => setCfgModel(e.target.value)}
                    className="field-sm"
                  />
                </div>
                <div>
                  <label className="label text-[10px] mb-1">
                    {tr('side.vocab.ankiTags')}
                  </label>
                  <input
                    value={cfgTags}
                    onChange={(e) => setCfgTags(e.target.value)}
                    placeholder="lector"
                    className="field-sm"
                  />
                </div>
                <div className="text-[10px] text-ink-faint pt-0.5">
                  {tr('side.vocab.ankiCount').replace('{n}', String(vocab.length))}
                </div>
                {result && (
                  <div className="text-[10px] text-success leading-relaxed bg-success-soft/50 rounded-md px-2 py-1.5">
                    {tr('side.vocab.ankiResult')
                      .replace('{added}', String(result.added))
                      .replace('{duplicated}', String(result.duplicated))
                      .replace('{failed}', String(result.failed))}
                    {result.errors.length > 0 && (
                      <div className="text-danger mt-1">
                        {result.errors.slice(0, 3).join(' ')}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="btn-primary flex-1 py-1.5 text-[11px]"
                  >
                    {sending ? tr('side.vocab.ankiSending') : tr('side.vocab.ankiSend')}
                  </button>
                  <button
                    onClick={() => {
                      setShowPanel(false)
                      setResult(null)
                    }}
                    className="btn-outline flex-1 py-1.5 text-[11px]"
                  >
                    {tr('side.vocab.ankiCancel')}
                  </button>
                </div>
                <p className="text-[10px] text-ink-faint leading-relaxed pt-1">
                  {tr('side.vocab.ankiHelp')}
                  <br />
                  {tr('side.vocab.ankiHelpOrigin')}
                </p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {vocab.slice(0, 200).map((v) => {
              const due = isDue(v.srs)
              const revealed = revealedVocab.has(v.id)
              return (
                <div key={v.id} className="group row">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-semibold ${due ? 'text-accent' : 'text-ink'}`}>
                      {v.word}
                    </span>
                    {due && (
                      <span className="chip-accent">
                        {tr('side.vocab.due')}
                      </span>
                    )}
                    <span className="text-[10px] text-ink-faint ml-auto">
                      {v.srs.reps} {tr('side.vocab.reviews')}
                    </span>
                    {v.context?.trim() && (
                      <button
                        onClick={() => onExplainVocab(v)}
                        title={tr('side.sentences.fromVocab')}
                        aria-label={tr('aria.makeCard')}
                        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                      >
                        <SparklesIcon size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => onRemoveVocab(v.id)}
                      aria-label={tr('aria.deleteWord')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                    >
                      <XIcon size={15} />
                    </button>
                  </div>
                  {v.context && (
                    <div className="text-[11px] text-ink-soft mt-1.5 leading-relaxed">{v.context}</div>
                  )}
                  {v.translation && (
                    <button
                      onClick={() => onToggleReveal(v.id)}
                      className="text-[10px] text-accent hover:text-accent-hover hover:underline mt-1.5 transition-colors"
                    >
                      {revealed ? v.translation : tr('side.vocab.showTranslation')}
                    </button>
                  )}
                  {due && (
                    <SrsGradeButtons
                      grades={['again', 'hard', 'good', 'easy']}
                      tr={tr}
                      onGrade={(g) => onGradeVocab(v, g)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </ViewShell>
  )
}

// ---------------------------------------------------------------------------
// Templates drawer — list, create, edit, delete, drag-reorder
// ---------------------------------------------------------------------------
interface TemplatesViewProps {
  templates: PromptTemplate[]
  titleFor: (t: PromptTemplate) => string
  tr: (key: StringKey) => string
  onAdd: (t: { title: string; content: string; titleKey?: StringKey }) => void
  onUpdate: (id: string, patch: Partial<PromptTemplate>) => void
  onRemove: (id: string) => void
  onReorder: (orderedIds: string[]) => void
}

function TemplatesView({
  templates,
  titleFor,
  tr,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
}: TemplatesViewProps) {
  const [editing, setEditing] = useState<{ id: string | null; title: string; content: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)

  const startNew = () => {
    setEditing({ id: null, title: '', content: '' })
    setErr(null)
  }
  const startEdit = (tpl: PromptTemplate) => {
    setEditing({ id: tpl.id, title: tpl.title, content: tpl.content })
    setErr(null)
  }

  const save = () => {
    if (!editing) return
    const v = validateTemplate(editing)
    if (!v.ok) {
      setErr(
        v.reason === 'empty-title'
          ? tr('side.templates.errTitle')
          : v.reason === 'empty-content'
            ? tr('side.templates.errContent')
            : (v.reason ?? '')
      )
      return
    }
    if (editing.id) {
      // Built-in templates: only allow editing the title (keep content + builtIn).
      const existing = templates.find((t) => t.id === editing.id)
      if (existing?.builtIn) {
        onUpdate(editing.id, { title: editing.title })
      } else {
        onUpdate(editing.id, { title: editing.title, content: editing.content })
      }
    } else {
      onAdd({ title: editing.title, content: editing.content })
    }
    setEditing(null)
  }

  const onDragStart = (id: string) => (e: DragEvent) => {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDrop = (targetId: string) => (e: DragEvent) => {
    e.preventDefault()
    const sourceId = dragId.current
    dragId.current = null
    if (!sourceId || sourceId === targetId) return
    const ids = templates.map((t) => t.id)
    const from = ids.indexOf(sourceId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    onReorder(ids)
  }

  return (
    <ViewShell title={tr('side.templates.title')}>
      {editing ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
          <div>
            <label htmlFor="lector-tpl-title" className="label mb-1.5">
              {tr('side.templates.titleField')}
            </label>
            <input
              id="lector-tpl-title"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="lector-tpl-content" className="label mb-1.5">
              {tr('side.templates.contentField')}
            </label>
            <textarea
              id="lector-tpl-content"
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              rows={6}
              disabled={editing.id ? templates.find((t) => t.id === editing.id)?.builtIn : false}
              className="field font-mono resize-none disabled:opacity-60"
            />
            <p className="text-[10px] text-ink-faint mt-1.5">{tr('side.templates.hint')}</p>
          </div>
          {err && <div className="text-[11px] text-danger bg-danger-soft/50 rounded-md px-2 py-1.5">{err}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="btn-primary flex-1 py-2 text-[12px]"
            >
              {tr('side.templates.save')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="btn-outline flex-1 py-2 text-[12px]"
            >
              {tr('side.templates.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-line">
            <button
              onClick={startNew}
              className="btn-add py-2 text-[12px]"
            >
              <PlusIcon size={14} />
              {tr('side.templates.add')}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {templates.length === 0 ? (
              <Empty text={tr('side.templates.empty')} />
            ) : (
              templates.map((tpl) => (
                <div
                  key={tpl.id}
                  draggable
                  onDragStart={onDragStart(tpl.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop(tpl.id)}
                  className="group row cursor-grab active:cursor-grabbing hover:bg-surface-muted/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ink-faint hover:text-ink-soft select-none flex-shrink-0">
                      <GripVerticalIcon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink flex items-center gap-1.5">
                        {titleFor(tpl)}
                        {tpl.builtIn && (
                          <span className="chip-builtIn">
                            {tr('side.templates.builtIn')}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-ink-faint truncate mt-0.5">
                        {tpl.content.replace(/\n/g, ' ').slice(0, 60)}
                      </div>
                    </div>
                    <button
                      onClick={() => startEdit(tpl)}
                      aria-label={tr('aria.edit')}
                      title={tr('aria.edit')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                    >
                      <PencilIcon size={14} />
                    </button>
                    {!tpl.builtIn && (
                      <button
                        onClick={() => onRemove(tpl.id)}
                        aria-label={tr('aria.delete')}
                        title={tr('aria.delete')}
                        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </ViewShell>
  )
}

// ---------------------------------------------------------------------------
// Glossary drawer — list, create, edit, delete, import/export (Feature: 术语表)
// ---------------------------------------------------------------------------
interface GlossaryViewProps {
  entries: GlossaryEntry[]
  tr: (key: StringKey) => string
  onAdd: (e: { source: string; target: string; note?: string; enabled: boolean }) => void
  onUpdate: (id: string, patch: Partial<GlossaryEntry>) => void
  onRemove: (id: string) => void
  onImport: (entries: GlossaryEntry[]) => void
}

function GlossaryView({
  entries,
  tr,
  onAdd,
  onUpdate,
  onRemove,
  onImport,
}: GlossaryViewProps) {
  const [editing, setEditing] = useState<{
    id: string | null
    source: string
    target: string
    note: string
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const startNew = () => {
    setEditing({ id: null, source: '', target: '', note: '' })
    setErr(null)
  }
  const startEdit = (e: GlossaryEntry) => {
    setEditing({ id: e.id, source: e.source, target: e.target, note: e.note || '' })
    setErr(null)
  }

  const save = () => {
    if (!editing) return
    const v = validateEntry({ source: editing.source, target: editing.target })
    if (!v.ok) {
      setErr(
        v.reason === 'empty-source'
          ? tr('side.glossary.errSource')
          : v.reason === 'empty-target'
            ? tr('side.glossary.errTarget')
            : (v.reason ?? '')
      )
      return
    }
    if (editing.id) {
      onUpdate(editing.id, {
        source: editing.source,
        target: editing.target,
        note: editing.note || undefined,
      })
    } else {
      onAdd({
        source: editing.source,
        target: editing.target,
        note: editing.note || undefined,
        enabled: true,
      })
    }
    setEditing(null)
  }

  const handleExport = () => {
    downloadBlob(
      `lector-glossary-${new Date().toISOString().slice(0, 10)}.json`,
      exportGlossary(entries),
      'application/json'
    )
  }

  const handleImport = async (file: File) => {
    const res = await readJsonFile(file, importGlossary)
    if (!res.ok || !res.entries) {
      setFlash(tr('side.glossary.importFail').replace('{msg}', res.reason || ''))
      return
    }
    onImport(res.entries)
    setFlash(tr('side.glossary.importOk').replace('{n}', String(res.entries.length)))
  }

  return (
    <ViewShell title={tr('side.glossary.title')}>
      {editing ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
          <div>
            <label htmlFor="lector-glos-source" className="label mb-1.5">
              {tr('side.glossary.sourceField')}
            </label>
            <input
              id="lector-glos-source"
              value={editing.source}
              onChange={(e) => setEditing({ ...editing, source: e.target.value })}
              placeholder="LLM"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="lector-glos-target" className="label mb-1.5">
              {tr('side.glossary.targetField')}
            </label>
            <input
              id="lector-glos-target"
              value={editing.target}
              onChange={(e) => setEditing({ ...editing, target: e.target.value })}
              placeholder="大语言模型"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="lector-glos-note" className="label mb-1.5">
              {tr('side.glossary.noteField')}
            </label>
            <textarea
              id="lector-glos-note"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              rows={2}
              className="field resize-none"
            />
          </div>
          {err && <div className="text-[11px] text-danger bg-danger-soft/50 rounded-md px-2 py-1.5">{err}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="btn-primary flex-1 py-2 text-[12px]"
            >
              {tr('side.glossary.save')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="btn-outline flex-1 py-2 text-[12px]"
            >
              {tr('side.glossary.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-line space-y-2">
            <button
              onClick={startNew}
              className="btn-add py-2 text-[12px]"
            >
              <PlusIcon size={14} />
              {tr('side.glossary.add')}
            </button>
            {entries.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="btn-outline flex-1 py-1.5 text-[11px]"
                >
                  <DownloadIcon size={12} />
                  {tr('side.glossary.export')}
                </button>
                <label className="btn-outline flex-1 py-1.5 text-[11px] cursor-pointer">
                  <UploadIcon size={12} />
                  {tr('side.glossary.import')}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleImport(f)
                      e.target.value = '' // allow re-importing the same file
                    }}
                  />
                </label>
              </div>
            )}
            {flash && <div className="text-[10px] text-accent text-center bg-accent-softer rounded-md py-1">{flash}</div>}
            <p className="text-[10px] text-ink-faint leading-relaxed">{tr('side.glossary.hint')}</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <Empty text={tr('side.glossary.empty')} />
            ) : (
              entries.map((e) => (
                <div key={e.id} className={`group row ${e.enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => onUpdate(e.id, { enabled: !e.enabled })}
                      role="switch"
                      aria-checked={e.enabled}
                      aria-label={tr('aria.enableGlossary')}
                      title={e.enabled ? tr('side.glossary.enabled') : tr('side.glossary.disabled')}
                      className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 transition-colors ${
                        e.enabled
                          ? 'bg-accent border-accent'
                          : 'bg-transparent border-line-strong'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink truncate">
                        {e.source} <span className="text-ink-faint mx-0.5">→</span> {e.target}
                      </div>
                      {e.note && (
                        <div className="text-[10px] text-ink-faint truncate mt-0.5">{e.note}</div>
                      )}
                    </div>
                    <button
                      onClick={() => startEdit(e)}
                      aria-label={tr('aria.edit')}
                      title={tr('aria.edit')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                    >
                      <PencilIcon size={14} />
                    </button>
                    <button
                      onClick={() => onRemove(e.id)}
                      aria-label={tr('aria.delete')}
                      title={tr('aria.delete')}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </ViewShell>
  )
}

// ---------------------------------------------------------------------------
// BYOK Settings drawer
// ---------------------------------------------------------------------------
// LanguageSelect — searchable language picker. 100+ langs are unwieldy in a
// flat <select>, so we render a search box + a filtered, scrollable list.
function LanguageSelect({
  value,
  locale,
  autoLabel,
  onChange,
}: {
  value: string
  locale: LocalePref
  autoLabel: string
  onChange: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const loc = resolveLocale(locale)
  const current = value === 'auto' ? null : getLanguage(value)
  const matches = useMemo(() => searchLanguages(query), [query])
  // Cap the rendered list for perf/snappiness on long queries.
  const shown = matches.slice(0, 60)
  return (
    <div className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="field w-full text-left flex items-center justify-between"
      >
        <span>{current ? (loc === 'zh' ? current.zh : current.en) : autoLabel}</span>
        <span className="text-ink-faint text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-surface border border-line rounded-lg shadow-lg max-h-64 flex flex-col">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.translation.languageSearch', locale)}
            className="px-2 py-1.5 text-[11px] border-b border-line outline-none bg-transparent"
          />
          <div className="overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange('auto'); setOpen(false); setQuery('') }}
              className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-surface-muted ${value === 'auto' ? 'text-accent font-medium' : 'text-ink-soft'}`}
            >
              {autoLabel}
            </button>
            {shown.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => { onChange(l.code); setOpen(false); setQuery('') }}
                className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-surface-muted ${value === l.code ? 'text-accent font-medium' : 'text-ink-soft'}`}
              >
                {loc === 'zh' ? l.zh : l.en} <span className="text-ink-faint">({l.en})</span>
              </button>
            ))}
            {matches.length > shown.length && (
              <p className="px-2 py-1 text-[10px] text-ink-faint">
                {t('settings.translation.languageMore', locale).replace('{n}', String(matches.length - shown.length))}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CacheControls — shows the saved-tokens/saved-$ readout and a Clear button.
// Reads the cache directly from chrome.storage.local; pure display + clear.
function CacheControls({ ttlDays, locale }: { ttlDays: number; locale: LocalePref }) {
  const [tokens, setTokens] = useState(0)
  const [cleared, setCleared] = useState(false)

  const refresh = useCallback(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return
    chrome.storage.local.get('lectorCache', (r) => {
      const raw = (r as Record<string, unknown>).lectorCache
      const store = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      setTokens(totalSavedTokens(store as never))
    })
  }, [])
  useEffect(() => { refresh() }, [refresh, ttlDays])

  const clear = () => {
    if (typeof chrome === 'undefined' || !chrome.storage) return
    chrome.storage.local.set({ lectorCache: {} }, () => {
      setTokens(0)
      setCleared(true)
      setTimeout(() => setCleared(false), 1500)
    })
  }
  const savedUsd = (tokens * 2) / 1_000_000
  return (
    <div className="flex items-center justify-between text-[10px] text-ink-faint mb-3">
      <span>
        {tokens > 0
          ? t('settings.translation.cacheStats', locale)
              .replace('{tokens}', tokens.toLocaleString())
              .replace('{usd}', savedUsd.toFixed(3))
          : t('settings.translation.cacheEmpty', locale)}
      </span>
      <button
        type="button"
        onClick={clear}
        className="px-2 py-0.5 rounded border border-line text-ink-soft hover:bg-surface-muted"
      >
        {cleared ? '✓' : t('settings.translation.cacheClear', locale)}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SiteRulesControls — editable list of per-domain rules + "add current site".
function SiteRulesControls({
  rules,
  locale,
  onChange,
}: {
  rules: SiteRule[]
  locale: LocalePref
  onChange: (next: SiteRule[]) => void
}) {
  const [currentHost, setCurrentHost] = useState('')
  useEffect(() => {
    // The side panel runs in its own origin; ask the active tab for its host.
    if (typeof chrome === 'undefined' || !chrome.tabs) return
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url
      if (url) {
        try { setCurrentHost(new URL(url).hostname) } catch { /* ignore */ }
      }
    })
  }, [])

  const addCurrent = (mode: 'always' | 'never') => {
    if (!currentHost) return
    // Replace any existing rule for the same host, then prepend.
    const filtered = rules.filter((r) => !matchHost(r.hostPattern, currentHost) || r.hostPattern !== currentHost)
    onChange([{ id: newSiteRuleId(), hostPattern: currentHost, mode, createdAt: Date.now() }, ...filtered])
  }
  const removeRule = (id: string) => onChange(rules.filter((r) => r.id !== id))
  const setMode = (id: string, mode: SiteRule['mode']) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, mode } : r)))

  const cleanRules = normalizeSiteRules(rules)
  return (
    <div className="mb-2">
      {currentHost && (
        <div className="flex gap-1.5 mb-2">
          <button
            type="button"
            onClick={() => addCurrent('always')}
            className="flex-1 px-1 py-1 text-[10.5px] font-medium rounded-lg border border-line text-ink-soft hover:border-accent hover:bg-accent-softer hover:text-accent"
          >
            + {t('settings.translation.siteRules.always', locale)} ({currentHost})
          </button>
          <button
            type="button"
            onClick={() => addCurrent('never')}
            className="flex-1 px-1 py-1 text-[10.5px] font-medium rounded-lg border border-line text-ink-soft hover:border-accent hover:bg-accent-softer hover:text-accent"
          >
            + {t('settings.translation.siteRules.never', locale)}
          </button>
        </div>
      )}
      {cleanRules.length === 0 ? (
        <p className="text-[10px] text-ink-faint mb-2">
          {t('settings.translation.siteRules.empty', locale)}
        </p>
      ) : (
        <ul className="space-y-1 mb-2">
          {cleanRules.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 text-[10.5px]">
              <span className="flex-1 truncate text-ink-soft" title={r.hostPattern}>{r.hostPattern}</span>
              <select
                value={r.mode}
                onChange={(e) => setMode(r.id, e.target.value as SiteRule['mode'])}
                className="field text-[10px] py-0.5"
              >
                <option value="always">{t('settings.translation.siteRules.always', locale)}</option>
                <option value="never">{t('settings.translation.siteRules.never', locale)}</option>
                <option value="customEngine">{t('settings.translation.siteRules.custom', locale)}</option>
              </select>
              <button
                type="button"
                onClick={() => removeRule(r.id)}
                className="text-ink-faint hover:text-danger"
                aria-label={t('settings.translation.siteRules.remove', locale)}
              >✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CurrentSiteChip — a header chip that cycles the active-tab host's translation
// rule: auto → always → never → auto. Writes a SiteRule (or removes it) via the
// parent's onToggle, which persists the whole siteRules list.
function CurrentSiteChip({
  host,
  rules,
  locale,
  onToggle,
}: {
  host: string
  rules: SiteRule[]
  locale: LocalePref
  onToggle: (next: SiteRule[]) => void
}) {
  const state = siteToggleState(rules, host)
  // Cycle auto → always → never → auto.
  const cycle = () => {
    const filtered = rules.filter((r) => r.hostPattern !== host)
    if (state === 'auto') {
      onToggle([{ id: newSiteRuleId(), hostPattern: host, mode: 'always', createdAt: Date.now() }, ...filtered])
    } else if (state === 'always') {
      onToggle([{ id: newSiteRuleId(), hostPattern: host, mode: 'never', createdAt: Date.now() }, ...filtered])
    } else {
      onToggle(filtered) // never → auto (remove rule)
    }
  }
  const label = t(`settings.translation.siteState.${state}` as StringKey, locale)
  const tone =
    state === 'always' ? 'text-accent' : state === 'never' ? 'text-danger' : 'text-ink-faint'
  return (
    <button
      type="button"
      onClick={cycle}
      title={t('settings.translation.siteState.cycle', locale)}
      className={`mt-1 inline-flex items-center gap-1 text-[10px] ${tone} hover:underline`}
    >
      <span className="truncate max-w-[160px]">{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
type SettingsViewProps = {
  byok: ByokSettings
  onChange: (next: Partial<ByokSettings>) => void
}

function SettingsView({ byok, onChange }: SettingsViewProps) {
  const [showKey, setShowKey] = useState(false)
  // When true, the model free-text input is shown even if byok.model happens
  // to match a list entry (the user explicitly chose "Custom model id…").
  const [customMode, setCustomMode] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const def = getProvider(byok.provider)
  // Resolve a localized provider description, falling back to the English
  // string baked into providers.ts if no i18n entry exists for this provider.
  const descKey = `provider.desc.${byok.provider}` as StringKey
  const providerDesc = t(descKey, byok.locale) === descKey ? def.description : t(descKey, byok.locale)

  const handleProviderChange = (id: ProviderId) => {
    const next = getProvider(id)
    const isCustom = id === 'custom' || id === 'openrouter-custom'
    // Switching provider leaves custom model mode (the new provider has its
    // own preset/fetched list to pick from).
    setCustomMode(false)
    onChange({
      provider: id,
      // Reset to the provider's default model/baseUrl; keep the key.
      model: next.defaultModel,
      baseUrl: isCustom ? byok.baseUrl : '',
    })
    setTestResult(null)
    setFetchedModels(null)
    setFetchError(null)
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    // Read the live store rather than the rendered `byok` prop: if the user
    // typed a key and immediately clicked Test before re-render propagated,
    // the prop could be one keystroke stale and we'd test the previous key.
    // useStore.getState() always returns the freshest committed value.
    const result = await testConnection({ ...useStore.getState().byok })
    setTestResult(result)
    setTesting(false)
  }

  const runFetch = async () => {
    setFetching(true)
    setFetchError(null)
    try {
      const live = useStore.getState().byok
      const models = await fetchModels({ ...live })
      setFetchedModels(models)
      if (models.length > 0) {
        // If the current model isn't in the fetched list, snap to the first.
        if (!models.some((m) => m.id === live.model)) {
          onChange({ model: models[0].id })
        }
      } else {
        setFetchError(t('settings.model.fetchEmpty', byok.locale))
      }
    } catch (e) {
      setFetchedModels(null)
      setFetchError(e instanceof Error ? e.message : t('settings.model.fetchFail', byok.locale))
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="drawer-head">
        <h3 className="drawer-title">{t('settings.title', byok.locale)}</h3>
      </div>

      <div className="overflow-y-auto px-4 py-3.5 space-y-3.5">
          <p className="text-[11px] text-ink-soft leading-relaxed bg-surface-muted/50 rounded-lg px-3 py-2">
            {t('settings.privacyNote', byok.locale)}
          </p>

          {/* Language */}
          <div>
            <label className="label mb-1.5">
              {t('settings.language', byok.locale)}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['auto', 'en', 'zh'] as LocalePref[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => onChange({ locale: opt })}
                  className={`px-2 py-2 text-[11px] font-medium rounded-lg border transition-colors duration-150 ease-out ${
                    byok.locale === opt
                      ? 'border-accent bg-accent-softer text-accent'
                      : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {opt === 'auto'
                    ? t('settings.language.auto', byok.locale)
                    : opt === 'en'
                      ? t('settings.language.en', byok.locale)
                      : t('settings.language.zh', byok.locale)}
                </button>
              ))}
            </div>
          </div>

          {/* Provider picker */}
          <div>
            <label className="label mb-1.5">{t('settings.provider', byok.locale)}</label>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.values(PROVIDERS).map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`px-1.5 py-2 text-[10.5px] font-medium rounded-lg border transition-colors duration-150 ease-out leading-tight ${
                    byok.provider === p.id
                      ? 'border-accent bg-accent-softer text-accent'
                      : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">{providerDesc}</p>
          </div>

          {/* Custom base URL */}
          {(byok.provider === 'custom' || byok.provider === 'openrouter-custom') && (
            <div>
              <label htmlFor="lector-base-url" className="label mb-1.5">
                {t('settings.baseUrl', byok.locale)} <span className="text-ink-faint font-normal">{t('settings.baseUrl.hint', byok.locale)}</span>
              </label>
              <input
                id="lector-base-url"
                type="url"
                value={byok.baseUrl}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="field"
              />
            </div>
          )}

          {/* API key */}
          <div>
            <label htmlFor="lector-api-key" className="label mb-1.5">{t('settings.apiKey', byok.locale)}</label>
            <div className="relative">
              <input
                id="lector-api-key"
                type={showKey ? 'text' : 'password'}
                value={byok.apiKey}
                onChange={(e) => {
                  onChange({ apiKey: e.target.value })
                  setTestResult(null)
                }}
                placeholder={t('settings.apiKey.placeholder', byok.locale)}
                autoComplete="off"
                spellCheck={false}
                className="field pr-16 font-mono"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint hover:text-ink-soft px-1.5 py-0.5 transition-colors"
              >
                {showKey ? t('settings.apiKey.hide', byok.locale) : t('settings.apiKey.show', byok.locale)}
              </button>
            </div>
            {def.keyUrl && (
              <a
                href={def.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1.5 text-[10px] text-accent hover:text-accent-hover hover:underline"
              >
                {t('settings.apiKey.getKey', byok.locale).replace('{label}', def.label)}
              </a>
            )}
          </div>

          {/* Model picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="lector-model" className="label">{t('settings.model', byok.locale)}</label>
              <button
                onClick={runFetch}
                disabled={fetching || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
                title={t('settings.model.fetch', byok.locale)}
                className="text-[10px] text-accent hover:text-accent-hover disabled:opacity-40 transition-colors"
              >
                {fetching ? t('settings.model.fetching', byok.locale) : fetchedModels ? t('settings.model.refetch', byok.locale) : t('settings.model.fetch', byok.locale)}
              </button>
            </div>

            {/* Dropdown: prefer fetched models, fall back to presets. */}
            {(() => {
              const list = fetchedModels && fetchedModels.length > 0
                ? fetchedModels.map((m) => ({ id: m.id, label: m.label || m.id }))
                : def.models.map((m) => ({ id: m.id, label: m.label || m.id }))
              const currentInList = list.some((m) => m.id === byok.model)
              if (list.length > 0) {
                return (
                  <select
                    id="lector-model"
                    value={currentInList && !customMode ? byok.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        // Reveal the free-text input WITHOUT discarding the
                        // current model. Previously this reset byok.model to
                        // the provider default (customModel was '' on first
                        // switch), silently losing whatever the user had set.
                        setCustomMode(true)
                      } else {
                        setCustomMode(false)
                        onChange({ model: e.target.value })
                      }
                    }}
                    className="field"
                  >
                    {list.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    <option value="__custom__">{t('settings.model.custom', byok.locale)}</option>
                  </select>
                )
              }
              return null
            })()}

            {fetchError && (
              <div className="mt-1.5 text-[10px] text-warn bg-warn-soft/50 rounded-md px-2 py-1">{fetchError}</div>
            )}
            {fetchedModels && fetchedModels.length > 0 && (
              <div className="mt-1 text-[10px] text-ink-faint">{t('settings.model.fetchedCount', byok.locale).replace('{n}', String(fetchedModels.length))}</div>
            )}

            {/* Free-text input: when custom mode is on, or no list matches. */}
            {(customMode ||
              !(fetchedModels && fetchedModels.length > 0 ? fetchedModels : def.models).some((m) => m.id === byok.model)
            ) && (
              <input
                type="text"
                aria-label={t('settings.model', byok.locale)}
                value={byok.model}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder={def.defaultModel || 'model id, e.g. gpt-4o-mini'}
                className="field mt-1.5 font-mono"
              />
            )}
          </div>

          {/* Test connection */}
          <div className="pt-0.5">
            <button
              onClick={runTest}
              disabled={testing || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
              className="btn-outline w-full py-2 text-[12px]"
            >
              {testing ? t('settings.testing', byok.locale) : t('settings.test', byok.locale)}
            </button>
            {testResult && (
              <div
                className={`mt-2 text-[11px] px-2.5 py-2 rounded-lg flex items-start gap-1.5 leading-relaxed ${
                  testResult.ok ? 'bg-success-soft/60 text-success' : 'bg-danger-soft/60 text-danger'
                }`}
              >
                <span className="mt-px flex-shrink-0">
                  {testResult.ok ? <CheckIcon size={13} /> : <XIcon size={13} />}
                </span>
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Translation settings */}
          {(() => {
            const ts = { ...DEFAULT_TRANSLATION_SETTINGS, ...normalizeTranslationSettings(byok.translation) }
            const setTs = (patch: Partial<TranslationSettings>) => {
              const next = { ...ts, ...patch }
              onChange({ translation: next })
              // Broadcast to content scripts so display mode updates live.
              if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.query({}).then((tabs) => {
                  for (const tab of tabs) {
                    if (tab.id !== undefined) {
                      chrome.tabs
                        .sendMessage(tab.id, { action: 'lector-translation-settings-changed' })
                        .catch(() => {})
                    }
                  }
                }).catch(() => {})
              }
            }
            return (
              <div className="pt-1 border-t border-line">
                <label className="label mb-1.5 block">{t('settings.translation.title', byok.locale)}</label>

                {/* Target language (searchable — 100+ langs need search) */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.targetLanguage', byok.locale)}</label>
                <LanguageSelect
                  value={ts.targetLanguage}
                  locale={byok.locale}
                  autoLabel={t('settings.translation.targetLanguage.auto', byok.locale)}
                  onChange={(code) => setTs({ targetLanguage: code as TranslationSettings['targetLanguage'] })}
                />

                {/* Display mode */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.displayMode', byok.locale)}</label>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {(['bilingual', 'translationOnly', 'hover'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setTs({ displayMode: m })}
                      className={`px-1 py-1.5 text-[10.5px] font-medium rounded-lg border transition-colors duration-150 ease-out leading-tight ${
                        ts.displayMode === m
                          ? 'border-accent bg-accent-softer text-accent'
                          : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                      }`}
                    >
                      {t(('settings.translation.displayMode.' + m) as StringKey, byok.locale)}
                    </button>
                  ))}
                </div>

                {/* Auto-translate toggle */}
                <label className="flex items-center gap-2 text-[11px] text-ink-soft mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ts.autoTranslate}
                    onChange={(e) => setTs({ autoTranslate: e.target.checked })}
                    className="accent-[#9C6B3C]"
                  />
                  {t('settings.translation.autoTranslate', byok.locale)}
                </label>

                {/* Concurrency slider */}
                <label className="text-[11px] text-ink-soft mb-1 block">
                  {t('settings.translation.concurrency', byok.locale)}: {ts.concurrency}
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={ts.concurrency}
                  onChange={(e) => setTs({ concurrency: Number(e.target.value) })}
                  className="w-full accent-[#9C6B3C]"
                />

                {/* Translation theme (style) picker — Immersive-parity */}
                <label className="text-[11px] text-ink-soft mb-1 mt-3 block">{t('settings.translation.theme', byok.locale)}</label>
                <select
                  value={ts.theme}
                  onChange={(e) => setTs({ theme: e.target.value })}
                  className="field w-full mb-2"
                >
                  {TRANSLATION_THEMES.map((th) => (
                    <option key={th.id} value={th.id}>
                      {byok.locale === 'zh' ? th.zh : th.en}
                    </option>
                  ))}
                </select>

                {/* Font size slider */}
                <label className="text-[11px] text-ink-soft mb-1 block">
                  {t('settings.translation.fontSize', byok.locale)}: {ts.fontSize.toFixed(2)}
                </label>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.02}
                  value={ts.fontSize}
                  onChange={(e) => setTs({ fontSize: Number(e.target.value) })}
                  className="w-full accent-[#9C6B3C] mb-2"
                />

                {/* Reading-focus toggle (surpass-feature) */}
                <label className="flex items-center gap-2 text-[11px] text-ink-soft mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ts.readingFocus}
                    onChange={(e) => setTs({ readingFocus: e.target.checked })}
                    className="accent-[#9C6B3C]"
                  />
                  {t('settings.translation.readingFocus', byok.locale)}
                </label>

                {/* AI Expert persona */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.persona', byok.locale)}</label>
                <select
                  value={ts.persona}
                  onChange={(e) => setTs({ persona: e.target.value })}
                  className="field w-full mb-2"
                >
                  {TRANSLATION_PERSONAS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {byok.locale === 'zh' ? p.zh : p.en}
                    </option>
                  ))}
                </select>

                {/* Page scope (smart vs whole) */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.pageScope', byok.locale)}</label>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {(['smart', 'whole'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setTs({ pageScope: s })}
                      className={`px-1 py-1.5 text-[10.5px] font-medium rounded-lg border transition-colors duration-150 ease-out leading-tight ${
                        ts.pageScope === s
                          ? 'border-accent bg-accent-softer text-accent'
                          : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink'
                      }`}
                    >
                      {t(('settings.translation.pageScope.' + s) as StringKey, byok.locale)}
                    </button>
                  ))}
                </div>

                {/* Custom CSS (advanced) */}
                <label className="text-[11px] text-ink-soft mb-1 block">{t('settings.translation.customCss', byok.locale)}</label>
                <textarea
                  value={ts.customCss}
                  onChange={(e) => setTs({ customCss: e.target.value })}
                  rows={2}
                  placeholder=".lector-bilingual { color: #c0392b; }"
                  className="field w-full mb-1 font-mono text-[10.5px]"
                />
                <p className="text-[10px] text-ink-faint mb-2">{t('settings.translation.customCssHint', byok.locale)}</p>

                {/* Translation cache */}
                <label className="text-[11px] text-ink-soft mb-1 block">
                  {t('settings.translation.cacheTtl', byok.locale)}: {ts.cacheTtlDays}
                </label>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={ts.cacheTtlDays}
                  onChange={(e) => setTs({ cacheTtlDays: Number(e.target.value) })}
                  className="w-full accent-[#9C6B3C] mb-1"
                />
                <p className="text-[10px] text-ink-faint mb-1">{t('settings.translation.cacheHint', byok.locale)}</p>
                <CacheControls ttlDays={ts.cacheTtlDays} locale={byok.locale} />

                {/* Site rules */}
                <label className="text-[11px] text-ink-soft mb-1 mt-1 block">{t('settings.translation.siteRules', byok.locale)}</label>
                <SiteRulesControls
                  rules={ts.siteRules}
                  locale={byok.locale}
                  onChange={(next) => setTs({ siteRules: next })}
                />
              </div>
            )
          })()}
        </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sentence Library drawer — paste-to-generate, search, group, SRS review
// ---------------------------------------------------------------------------
interface SentencesViewProps {
  sentences: SentenceCard[]
  revealed: Set<string>
  busyExample: string | null
  tr: (key: StringKey) => string
  onToggleReveal: (id: string) => void
  onRemove: (id: string) => void
  onPromote: (id: string) => void
  onGrade: (c: SentenceCard, grade: Grade) => void
  onViewSource: (blockId: string | undefined, url: string) => void
  /** Batch-export the given cards to Anki (caller resolves config + deck). */
  onAnkiExport: (cards: SentenceCard[]) => void
  onMakeCard: (sentence: string, title: string) => void
}

function SentencesView(props: SentencesViewProps) {
  const { sentences, revealed, tr } = props
  const [query, setQuery] = useState('')
  const [cefrFilter, setCefrFilter] = useState<string>('')
  const [pasteText, setPasteText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const searched = searchSentences(sentences, query)
  const filtered = cefrFilter ? searched.filter((c) => c.cefr === cefrFilter) : searched
  const groups = groupSentences(filtered)

  const handleGenerate = async () => {
    const text = pasteText.trim()
    if (!text) {
      setImportMsg({ ok: false, text: tr('side.sentences.pasteEmpty') })
      return
    }
    setGenerating(true)
    setImportMsg(null)
    try {
      const settings = useStore.getState().byok
      if (!settings.apiKey) {
        setImportMsg({ ok: false, text: tr('err.addKey') })
        return
      }
      await runSentenceAnalysis(text, '', tr('side.sentences.pasteTitle'))
      setPasteText('')
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setGenerating(false)
    }
  }

  const handleExport = () => {
    downloadBlob('lector-sentences.json', exportSentences(sentences), 'application/json')
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = importSentences(String(reader.result || ''))
      if (!result.ok) {
        setImportMsg({ ok: false, text: tr('side.sentences.importFail').replace('{msg}', result.reason || '') })
        return
      }
      useStore.getState().replaceSentences(result.cards || [])
      setImportMsg({ ok: true, text: tr('side.sentences.importOk').replace('{n}', String(result.cards?.length || 0)) })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <ViewShell title={tr('side.sentences.title')}>
      {sentences.filter((c) => c.srs).length > 0 && (
        <StatsBar stats={computeReviewStats(sentences)} tr={tr} />
      )}
      {sentences.length === 0 ? (
        <>
          <div className="px-4 py-3 border-b border-line">
            <PasteBox
              value={pasteText}
              onChange={setPasteText}
              onGenerate={handleGenerate}
              generating={generating}
              tr={tr}
            />
            {importMsg && <ImportMsg msg={importMsg} />}
          </div>
          <Empty text={tr('side.sentences.empty')} />
        </>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-line space-y-2">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('side.sentences.search')}
                className="field-sm flex-1"
              />
              <select
                value={cefrFilter}
                onChange={(e) => setCefrFilter(e.target.value)}
                className="field-sm w-auto flex-shrink-0"
                aria-label={tr('side.sentences.filterAll')}
              >
                <option value="">{tr('side.sentences.filterAll')}</option>
                {(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>
            <PasteBox
              value={pasteText}
              onChange={setPasteText}
              onGenerate={handleGenerate}
              generating={generating}
              tr={tr}
            />
            {importMsg && <ImportMsg msg={importMsg} />}
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={handleExport}
                className="btn-outline py-1.5 text-[11px]"
              >
                <DownloadIcon size={12} /> {tr('side.sentences.export')}
              </button>
              <label className="btn-outline py-1.5 text-[11px] cursor-pointer text-center">
                <UploadIcon size={12} /> {tr('side.sentences.import')}
                <input type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
              </label>
              <button
                onClick={() => props.onAnkiExport(filtered)}
                className="btn-outline py-1.5 text-[11px]"
              >
                {tr('side.sentences.toAnki')}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {[...groups.entries()].map(([key, cards]) => {
              const [title] = key.split('\u0000')
              return (
                <div key={key}>
                  <div className="px-4 py-1.5 bg-surface-muted/70 text-[10px] font-semibold text-ink-faint sticky top-0 uppercase tracking-wide backdrop-blur-sm">
                    {title || tr('side.sentences.pasteTitle')}
                  </div>
                  {cards.map((c) => {
                    const due = c.srs ? isDue(c.srs) : false
                    const isRevealed = revealed.has(c.id)
                    return (
                      <div key={c.id} className="group row">
                        <div className="flex items-start gap-2">
                          <span className={`text-[12px] font-semibold leading-relaxed flex-1 ${due ? 'text-accent' : 'text-ink'}`}>
                            {c.sentence}
                          </span>
                          <div className="flex items-center gap-0.5 flex-shrink-0 -mr-1">
                            {c.blockId || c.url ? (
                              <button
                                onClick={() => props.onViewSource(c.blockId, c.url)}
                                title={tr('side.sentences.viewSource')}
                                aria-label={tr('aria.viewSource')}
                                className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                              >
                                <SparklesIcon size={13} />
                              </button>
                            ) : null}
                            <button
                              onClick={() => props.onAnkiExport([c])}
                              title={tr('side.sentences.toAnkiOne')}
                              aria-label={tr('aria.sendToAnki')}
                              className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                            >
                              <DownloadIcon size={13} />
                            </button>
                            <button
                              onClick={() => props.onRemove(c.id)}
                              aria-label={tr('side.sentences.remove')}
                              className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                            >
                              <XIcon size={15} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {due && (
                            <span className="chip-accent">
                              {tr('side.sentences.due')}
                            </span>
                          )}
                          {c.cefr && (
                            <span className="chip-muted">
                              {c.cefr}
                            </span>
                          )}
                          {c.srs && (
                            <span className="text-[10px] text-ink-faint">
                              {c.srs.reps} {tr('side.sentences.reviews')}
                            </span>
                          )}
                          <button
                            onClick={() => (c.srs ? undefined : props.onPromote(c.id))}
                            className={`text-[10px] ml-auto ${c.srs ? 'text-accent' : 'text-ink-faint hover:text-accent'} transition-colors`}
                          >
                            {c.srs ? tr('side.sentences.inReview') : tr('side.sentences.addToReview')}
                          </button>
                        </div>
                        {(c.translation || c.analysis) && (
                          <button
                            onClick={() => props.onToggleReveal(c.id)}
                            className="text-[10px] text-accent hover:text-accent-hover hover:underline mt-1.5 transition-colors"
                          >
                            {isRevealed ? tr('side.sentences.hideAnalysis') : tr('side.sentences.showAnalysis')}
                          </button>
                        )}
                        {isRevealed && (c.translation || c.analysis) && (
                          <div
                            className="lector-prose mt-2 text-[11px] leading-relaxed bg-surface-muted/40 rounded-lg p-2.5"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(c.analysis || c.translation) }}
                          />
                        )}
                        {isRevealed && extractExamples(c.analysis).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {extractExamples(c.analysis).map((ex, i) => {
                              const busy = props.busyExample === ex
                              return (
                                <div key={i} className="flex items-center gap-2 text-[11px] bg-surface-muted/40 rounded-md px-2 py-1">
                                  <span className="text-ink-soft flex-1">{ex}</span>
                                  <button
                                    onClick={() => props.onMakeCard(ex, c.title)}
                                    disabled={busy}
                                    title={tr('side.sentences.makeCard')}
                                    aria-label={tr('aria.makeCard')}
                                    className="text-accent hover:text-accent-hover text-[10px] flex-shrink-0 font-medium flex items-center gap-1 disabled:opacity-60"
                                  >
                                    {busy ? (
                                      <>
                                        <span className="w-2.5 h-2.5 border-[1.5px] border-line border-t-accent rounded-full animate-spin" />
                                        {tr('side.sentences.makingCard')}
                                      </>
                                    ) : (
                                      tr('side.sentences.makeCard')
                                    )}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {due && c.srs && (
                          <SrsGradeButtons
                            grades={['again', 'hard', 'good', 'easy']}
                            tr={tr}
                            onGrade={(g) => props.onGrade(c, g)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </ViewShell>
  )
}

function PasteBox({
  value,
  onChange,
  onGenerate,
  generating,
  tr,
}: {
  value: string
  onChange: (v: string) => void
  onGenerate: () => void
  generating: boolean
  tr: (key: StringKey) => string
}) {
  return (
    <div className="space-y-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tr('side.sentences.pastePlaceholder')}
        rows={2}
        className="field-sm resize-none"
      />
      <button
        onClick={onGenerate}
        disabled={generating}
        className="btn-primary w-full py-1.5 text-[11px]"
      >
        {generating ? tr('side.sentences.generating') : tr('side.sentences.pasteGenerate')}
      </button>
    </div>
  )
}

function ImportMsg({ msg }: { msg: { ok: boolean; text: string } }) {
  return (
    <div className={`text-[10px] px-2 py-1 rounded-md ${msg.ok ? 'text-success bg-success-soft/50' : 'text-danger bg-danger-soft/50'}`}>
      {msg.text}
    </div>
  )
}

// Shared SRS grade buttons (Again / Hard / Good / Easy). Used by the Vocab
// and Sentence review drawers. "easy" is subtly emphasized as the positive
// path; "again" tinted toward danger since it resets the card.
function SrsGradeButtons({
  grades,
  tr,
  onGrade,
}: {
  grades: Grade[]
  tr: (key: StringKey) => string
  onGrade: (g: Grade) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2.5">
      {grades.map((g) => (
        <button
          key={g}
          onClick={() => onGrade(g)}
          className={
            'py-1.5 text-[10px] font-semibold rounded-md border transition-colors duration-150 ease-out ' +
            (g === 'again'
              ? 'border-line text-danger hover:bg-danger-soft/50 hover:border-danger/40'
              : g === 'easy'
                ? 'border-line text-success hover:bg-success-soft/50 hover:border-success/40'
                : 'border-line text-ink-soft hover:bg-surface-muted hover:text-ink')
          }
        >
          {tr(`side.vocab.${g}` as StringKey)}
        </button>
      ))}
    </div>
  )
}

// Compact 4-metric stats bar shown at the top of the SentencesView and
// VocabView. Renders the aggregated review stats (due / mastered / reviews /
// retention) computed from the view's items.
function StatsBar({ stats, tr }: { stats: ReviewStats; tr: (key: StringKey) => string }) {
  const Cell = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex flex-col items-center">
      <span className="text-[16px] font-bold text-accent leading-none font-serif">{value}</span>
      <span className="text-[9px] text-ink-faint mt-1 uppercase tracking-wide">{label}</span>
    </div>
  )
  return (
    <div className="flex justify-around px-4 py-3 border-b border-line bg-surface-muted/40">
      <Cell label={tr('stats.due')} value={stats.due} />
      <span className="w-px bg-line" />
      <Cell label={tr('stats.mastered')} value={stats.mastered} />
      <span className="w-px bg-line" />
      <Cell label={tr('stats.reviews')} value={stats.totalReviews} />
      <span className="w-px bg-line" />
      <Cell label={tr('stats.retention')} value={stats.avgEase.toFixed(1)} />
    </div>
  )
}
