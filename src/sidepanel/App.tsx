import { useEffect, useRef, useState, useCallback, useMemo, memo, lazy, Suspense } from 'react'
import { useStore, type ChatMessage, type ChatSession } from '../shared/store'
import { renderMarkdown } from './markdown'
import { renderCitations, type PageBlock } from '../shared/citations'
import { isDue, scheduleSrs, type Grade } from '../shared/srs'
import { toMarkdown, sessionToMarkdown } from '../shared/exporters'
import type { Highlight } from '../shared/highlights'
import type { VocabEntry } from '../shared/vocabulary'
import {
  type SentenceCard,
  extractTranslation,
  extractKeywords,
  extractCefr,
} from '../shared/sentences'
import {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon,
  SendIcon, XIcon, ClipboardListIcon, TrashIcon,
  BookMarkedIcon, DownloadIcon, CardsIcon, SparklesIcon,
  SettingsIcon, GridIcon, StopIcon, RotateIcon, ExpandIcon,
  FileTextIcon, ListIcon, PencilIcon, CheckIcon,
} from '../shared/icons'
import {
  getProvider,
  type ByokSettings,
  normalizeTranslationSettings,
} from '../shared/providers'
import { normalizeThemeId } from '../shared/themes'
import { streamChat, getSettings, saveSettings, type ChatMessage as WireMessage } from '../shared/byok'
import { t, resolveLocale, type StringKey } from '../shared/i18n'
import { getLanguage, type TranslationHistoryEntry } from '../shared/translation'
import {
  fillTemplate, filterTemplates, sortTemplates,
  type PromptTemplate, type TemplateContext,
} from '../shared/promptTemplates'
import {
  renderGlossaryPrompt,
} from '../shared/glossary'
import {
  exportSentencesToAnki, withAnkiDefaults,
  DEFAULT_DECK_NAME,
  DEFAULT_SENTENCE_DECK_NAME,
} from '../shared/anki'
import { isSameQueueSnapshot } from '../shared/storageQueue'
import { downloadBlob } from './lib/downloads'
import { runSentenceAnalysis } from './lib/sentences'
import { jumpToBlock } from './lib/chromeUtils'
import { formatAnkiResult } from './lib/ankiFormat'
import { formatListTimestamp } from './lib/format'
import { ViewShell, Empty } from './components/leaf'
import { usePagedList, LoadMore } from './components/paged'
import { CurrentSiteChip } from './views/CurrentSiteChip'
// Secondary views are lazy-loaded: the panel opens on the chat view, so the
// settings / vocab / templates / glossary / sentences UIs (and their deps,
// e.g. anki + glossary logic) are split into on-demand chunks. Only one view
// is mounted at a time, so each gets its own Suspense fallback. Chunks resolve
// under chrome-extension://<id>/chunks/... (base '/'), which the extension's
// own side-panel page can load without any web_accessible_resources entry.
const VocabView     = lazy(() => import('./views/VocabView').then(m => ({ default: m.VocabView })))
const TemplatesView = lazy(() => import('./views/TemplatesView').then(m => ({ default: m.TemplatesView })))
const GlossaryView  = lazy(() => import('./views/GlossaryView').then(m => ({ default: m.GlossaryView })))
const SentencesView = lazy(() => import('./views/SentencesView').then(m => ({ default: m.SentencesView })))
const SettingsView  = lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })))

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

// Initial rows rendered by the long-list views (highlights cap 500,
// translationHistory cap 200). A "Load more" button reveals the next batch so
// opening a large list doesn't mount hundreds of rows at once.
const LIST_PAGE_SIZE = 100

/** Minimum interval between streaming DOM flushes (~10Hz): the streaming
 *  bubble re-parses its whole growing Markdown text per render, so 60fps
 *  flushes dominated stream CPU on long replies. The final text lands once at
 *  stream end. */
const TOKEN_FLUSH_MIN_MS = 100

/**
 * Merge one content→background relay queue into the persisted zustand store.
 * Store actions are idempotent, so replaying a snapshot after a producer race
 * is safe. The queue is cleared only after an exact compare-and-swap check.
 */
function consumeRelayQueue(key: RelayQueueKey, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return
  const state = useStore.getState()
  // Batch merges: one set()/persist per queue. The per-item loop used to fire
  // N full-state persist writes (N MB-sized stringify+localStorage writes for
  // a 20-item queue) and N App re-renders.
  if (key === 'lectorHighlights') {
    state.addHighlights(raw as Highlight[])
  } else if (key === 'lectorVocab') {
    state.addVocabs(raw as VocabEntry[])
  } else if (key === 'lectorSentences') {
    state.addSentences(raw as SentenceCard[])
  } else {
    state.addTranslationHistoryBatch(raw as TranslationHistoryEntry[])
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

// Marker prefixes the catch paths in handleSend write onto a failed/stopped
// assistant turn. Drives both the Retry affordance and the provider-history
// filter (a ⚠️/stopped placeholder must never be sent back to the model as
// conversation context, nor duplicated into a retried request).
const FAILED_TURN_RE = /^(⚠️|\(stopped\)|（已停止）)/

/** Key/quota/provider-account errors get the top banner treatment (shared by
 *  the bilingual error listener and handleSend's catch). */
const isKeyQuotaError = (msg: string) => /401|key|quota|429|credit/i.test(msg)


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

// Suspense fallback shown while a lazy secondary view's chunk loads. Matches
// the in-app spinner style; no text so it has no i18n dependency.
function ViewLoading() {
  return (
    <div className="flex-1 grid place-items-center">
      <div className="w-4 h-4 border-2 border-line border-t-accent rounded-full animate-spin" />
    </div>
  )
}

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
  const removeTranslationHistory = useStore((s) => s.removeTranslationHistory)
  const hasOpened = useStore((s) => s.hasOpened)
  const markOpened = useStore((s) => s.markOpened)
  const [hintDismissed, setHintDismissed] = useState(false)
  // BYOK onboarding strip dismiss (session-only; unlike the quick tour this
  // isn't persisted — the strip returns next session until a key is set).
  const [byokBannerDismissed, setByokBannerDismissed] = useState(false)
  const [histSearch, setHistSearch] = useState('')
  // Inline rename in the Library view: the session id being edited + its draft
  // title. Null when no row is in edit mode.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Stable across renders (they depend only on locale) so memoized child views
  // don't re-render on every unrelated App state change.
  const tr = useCallback((key: StringKey) => t(key, byok.locale), [byok.locale])
  // Resolve a template's display title (i18n key for built-ins, raw for custom).
  const tplTitle = useCallback(
    (tpl: PromptTemplate) => (tpl.titleKey ? t(tpl.titleKey, byok.locale) : tpl.title),
    [byok.locale]
  )

  const sortedTemplates = useMemo(() => sortTemplates(templates), [templates])
  // Empty-state suggestion chips = the first 4 templates (same data source as
  // the "/" menu and the templates drawer).
  const suggestions = sortedTemplates.slice(0, 4)

  // Normalized translation settings, once per settings change. The inline call
  // rebuilt the whole site-rules array on every render — including every rAF
  // token frame of a live stream.
  const translationSettings = useMemo(
    () => normalizeTranslationSettings(byok.translation),
    [byok.translation]
  )
  // Tab badges as booleans: a bare `sentences`/`vocab` subscription re-ran
  // these full-list scans (up to 1000 + 2000 items) on every render; memoizing
  // on the list references keeps them to actual list changes.
  const sentencesHasDue = useMemo(
    () => sentences.some((c) => c.srs !== null && isDue(c.srs)),
    [sentences]
  )
  // Due count for the vocab tab corner badge: the actual number (capped at
  // 99+) tells the user how big today's review session is — a bare "!" gives
  // no size signal and trains users to ignore it.
  const vocabDueCount = useMemo(() => vocab.reduce((n, v) => n + (isDue(v.srs) ? 1 : 0), 0), [vocab])

  const [page, setPage] = useState<PageContext | null>(null)
  // Stable joined key of the active page's citation block ids. Used by
  // AssistantBubble (memoized) so unchanged bubbles skip re-parsing during a
  // stream. Computed once here, not per-message-per-render.
  const blockIdsKey = useMemo(
    () => (page?.blocks ?? []).map((b) => b.id).join('\u0000'),
    [page]
  )
  // Translation-history rows filtered by the search box. Memoized so an
  // unrelated re-render (e.g. chat streaming) doesn't re-filter while the
  // history view is open.
  const filteredHistory = useMemo(() => {
    const q = histSearch.trim().toLowerCase()
    if (!q) return translationHistory
    return translationHistory.filter(
      (e) => e.source.toLowerCase().includes(q) || e.target.toLowerCase().includes(q)
    )
  }, [translationHistory, histSearch])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  // Per-message copy feedback: id of the message whose text was just copied;
  // its button flashes "Copied" for ~1.2s (timer cleared on unmount below).
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyMessage = useCallback((m: ChatMessage) => {
    navigator.clipboard.writeText(m.content).catch(() => {})
    setCopiedMsgId(m.id)
    if (copyResetTimerRef.current !== null) clearTimeout(copyResetTimerRef.current)
    copyResetTimerRef.current = setTimeout(() => setCopiedMsgId(null), 1200)
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  // Flat view model: a single mutually-exclusive view replaces the 8 show*
  // booleans. Opening a view = setActiveView(...); only one can be active,
  // so stacked overlays are physically impossible. See
  // docs/superpowers/specs/2026-07-24-tab-navigation-redesign.md
  const [activeView, setActiveView] = useState<View>('chat')
  // Reset the long-list "load more" limits whenever the user switches views,
  // so re-opening a list after expanding it once doesn't mount hundreds of
  // rows up front. History also resets on search-query change.
  const highlightPage = usePagedList(LIST_PAGE_SIZE, activeView)
  const historyPage = usePagedList(
    LIST_PAGE_SIZE,
    activeView === 'translationHistory' ? histSearch : activeView
  )
  const [showTools, setShowTools] = useState(false) // MoreMenu 下拉开关（局部）
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  // Screen-reader announcement for finalized chat turns. The transcript
  // itself is NOT an aria-live region: with aria-relevant="text" the whole
  // streaming bubble re-announces on every token batch, drowning the user
  // in chatter. Instead this single status region receives one short notice
  // when a reply completes, fails, or is stopped.
  const [liveNotice, setLiveNotice] = useState('')
  // Hostname of the active tab, for the current-site rule chip in the header.
  const [currentHost, setCurrentHost] = useState('')
  // Inline loading for the 举一反三 → make-card action: tracks the exact
  // example sentence currently being turned into a card, so its row shows a
  // spinner and the others stay clickable. Null when nothing is generating.
  const [busyExample, setBusyExample] = useState<string | null>(null)
  const [bilingualBusy, setBilingualBusy] = useState(false)
  // Live bilingual translation progress ({done,total}) reported by the content
  // script via lector-bilingual-progress. Shown on the header button; cleared
  // when the run completes, is cancelled, or errors.
  const [bilingualProgress, setBilingualProgress] = useState<{ done: number; total: number } | null>(null)
  // "/" menu state
  const [slashMenu, setSlashMenu] = useState<{ open: boolean; query: string; activeIdx: number }>(
    { open: false, query: '', activeIdx: 0 }
  )
  // Slash-menu matches, memoized so SlashMenu's memo isn't defeated by a fresh
  // array identity on every render (it re-renders during token streaming).
  const slashMatches = useMemo(
    () => filterTemplates(sortedTemplates, slashMenu.query),
    [sortedTemplates, slashMenu.query]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  // The "⋯ More" trigger — refocused when its dropdown closes via item pick or
  // Escape, so keyboard users don't get dropped to <body> when the focused
  // menu item unmounts.
  const toolsTriggerRef = useRef<HTMLButtonElement>(null)
  const assistantBuf = useRef<string>('')
  const tokenFrameRef = useRef<number | null>(null)
  /** Timestamp of the last streaming DOM flush; see the onToken batching note. */
  const lastTokenFlushRef = useRef(0)
  // Tab hosting the in-flight bilingual run; consumed by the lifetime watchdog
  // effect (tabs.onRemoved / onUpdated) so a closed/navigated tab can't leave
  // the header button spinning forever.
  const bilingualTabIdRef = useRef<number | null>(null)
  // Pending "clear the {done/total} readout" timer. Tracked so a new run can
  // cancel it — an untracked stale timer would fire mid-run and wipe the new
  // run's live progress badge.
  const progressClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // AbortController for the in-flight chat stream. Lets the user Stop a long
  // response, and lets us abort cleanly on unmount / session switch so the
  // stream can't write into the wrong session or an unmounted component.
  const abortRef = useRef<AbortController | null>(null)
  // Set by abortActiveStream (session switch / New chat) so the stream's catch
  // can tell a navigation-caused abort from a user Stop: a switched-away stream
  // must not create a phantom session or hijack activeSessionId on persist.
  const switchAbortRef = useRef(false)
  // Abort the in-flight stream when the panel unmounts (close / Chrome
  // teardown / strict-mode remount) — otherwise streamChat keeps running and
  // its onToken setMessages fires on a gone component. The progress-clear
  // timer is cancelled for the same reason (setState after unmount).
  useEffect(() => () => {
    abortRef.current?.abort()
    if (tokenFrameRef.current !== null) cancelAnimationFrame(tokenFrameRef.current)
    if (progressClearTimerRef.current !== null) clearTimeout(progressClearTimerRef.current)
    if (copyResetTimerRef.current !== null) clearTimeout(copyResetTimerRef.current)
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
      if (e.key === 'Escape') {
        setShowTools(false)
        // Restore focus to the trigger: the previously focused menu item just
        // unmounted, which would otherwise drop keyboard focus to <body>.
        toolsTriggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showTools])

  // Seed the composer from a one-shot relay value (selection-toolbar or
  // context-menu translate/explain/summarize/ask → panel opens with a
  // prefilled prompt). Shared by the mount-time read AND the live storage
  // listener below: the background writes lectorSeed unconditionally, and
  // chrome.sidePanel.open() is a no-op when the panel is already open —
  // without the live path, a docked panel would silently ignore the action
  // and replay the stale seed on its next (possibly days-later) reload.
  const applySeed = useCallback(
    (seed: { kind: string; text: string }, stored: ByokSettings | null) => {
      chrome.storage.local.remove('lectorSeed')
      // The translate seed follows the user's CONFIGURED translation target
      // (the same direction bilingual mode uses), not the inverse of the UI
      // locale — a zh-locale user translating INTO Chinese used to get
      // "Translate this to English". 'auto' falls back to the locale heuristic.
      const storedTranslation = stored ? normalizeTranslationSettings(stored.translation) : null
      const translateTarget =
        storedTranslation && storedTranslation.targetLanguage !== 'auto'
          ? getLanguage(storedTranslation.targetLanguage).en
          : resolveLocale(stored?.locale ?? useStore.getState().byok.locale) === 'zh'
            ? 'English'
            : '中文'
      const seedPrompt =
        seed.kind === 'summarize'
          ? 'Summarize this in a few bullets:\n\n'
          : seed.kind === 'translate'
            ? `Translate this to ${translateTarget}:\n\n`
            : seed.kind === 'explain'
              ? 'Explain this clearly:\n\n'
              : ''
      setInput(`${seedPrompt}${seed.text}`.slice(0, 4000))
      // Make the prefilled prompt visible: on the live path the user may be in
      // any view when they trigger a toolbar/context-menu action.
      setActiveView('chat')
    },
    []
  )

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
      let storedSettings: ByokSettings | null = null
      try {
        const stored = await settingsP
        storedSettings = stored
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
          applySeed(seed.lectorSeed, storedSettings)
        }
      } catch {
        // ignore
      }
    })()
    return () => { cancelled = true }
  }, [setByok, applySeed])

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
      // Background writes lector_byok_settings directly (e.g. the selection
      // popup's language selector persists via 'lector-set-translation-target').
      // Without this, the panel's zustand copy goes stale and the next settings
      // save would silently clobber the user's choice.
      if (changes.lector_byok_settings?.newValue) {
        setByok(changes.lector_byok_settings.newValue as ByokSettings)
      }
      // Live seed relay: consumed at mount too, but when this panel is already
      // open the page does NOT reload — without this branch a toolbar/context-
      // menu action would visibly do nothing and the stale seed would replay
      // on the next panel open.
      if (changes.lectorSeed?.newValue) {
        const seed = changes.lectorSeed.newValue as { kind: string; text: string }
        if (seed.text) {
          void (async () => {
            let stored: ByokSettings | null = null
            try { stored = await getSettings() } catch { stored = null }
            applySeed(seed, stored)
          })()
        }
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
  }, [setByok, applySeed])

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
    const onMessage = (
      message: {
        action?: string
        message?: string
        done?: number
        total?: number
        complete?: boolean
        /** Structural cancel flag from the content script's cancelBilingual. */
        canceled?: boolean
        /** Enrich relay payloads from the background worker. */
        kind?: string
        id?: string
        translation?: string
        analysis?: string
      },
      _sender: unknown,
      sendResponse: (response: unknown) => void
    ) => {
      // Background relay enrichments. The panel drains the storage queue into
      // zustand almost immediately, so the multi-second provider result must
      // be merged HERE (matched by id) — a storage-only enrich writes to a
      // row that no longer exists and the paid result is dropped.
      if (message?.action === 'lector-has-entry') {
        const id = typeof message.id === 'string' ? message.id : ''
        const st = useStore.getState()
        const has =
          message.kind === 'lectorVocab'
            ? st.vocab.some((v) => v.id === id)
            : message.kind === 'lectorSentences'
              ? st.sentences.some((c) => c.id === id)
              : false
        sendResponse({ ok: has })
        return
      }
      if (message?.action === 'lector-vocab-enrich') {
        const { id, translation } = message
        if (typeof id === 'string' && typeof translation === 'string' && translation) {
          const st = useStore.getState()
          const v = st.vocab.find((x) => x.id === id)
          // addVocab merges by word with fill-empty semantics: keeps srs and
          // never clobbers a translation that arrived concurrently.
          if (v && !v.translation) st.addVocab({ ...v, translation })
        }
        sendResponse({ ok: true })
        return
      }
      if (message?.action === 'lector-sentence-enrich') {
        const { id, analysis } = message
        if (typeof id === 'string' && typeof analysis === 'string' && analysis) {
          const st = useStore.getState()
          const card = st.sentences.find((c) => c.id === id)
          if (card && !card.analysis) {
            st.addSentence({
              ...card,
              translation: extractTranslation(analysis),
              analysis,
              keywords: extractKeywords(analysis),
              cefr: extractCefr(analysis),
            })
          }
        }
        sendResponse({ ok: true })
        return
      }
      if (message?.action === 'lector-bilingual-progress') {
        const done = message.done ?? 0
        const total = message.total ?? 0
        setBilingualProgress({ done, total })
        // The content script sends a final progress with done===total when the
        // run completes; release the busy state then so the button resets.
        if (message.complete || (total > 0 && done >= total)) {
          setBilingualBusy(false)
          bilingualTabIdRef.current = null
          // Keep the {total/total} readout briefly so the user sees completion,
          // then clear it. Cancel any pending clear first: an untracked stale
          // timer would fire during a freshly started run and wipe its badge.
          if (progressClearTimerRef.current !== null) clearTimeout(progressClearTimerRef.current)
          progressClearTimerRef.current = setTimeout(() => {
            progressClearTimerRef.current = null
            setBilingualProgress(null)
          }, 1200)
        }
        return
      }
      if (message?.action === 'lector-bilingual-error' && message.message) {
        // Both hard errors and user-cancel send this. Cancel is identified by
        // the structural `canceled` flag the content script sets — NOT by
        // string-matching the message: English words such as "stopped" appear
        // in genuine provider errors that must stay visible.
        setBilingualBusy(false)
        setBilingualProgress(null)
        bilingualTabIdRef.current = null
        if (message.canceled !== true) {
          setError(message.message)
          // Key/quota errors surface in a top banner (no auto-opening Settings
          // on top of the current view — the user jumps to Settings themselves).
          if (isKeyQuotaError(message.message)) {
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

  // Bilingual-run lifetime watchdog. The busy state is normally released by the
  // content script's terminal progress/error messages — but if the run's tab is
  // closed or navigates away mid-run, that report never arrives and the header
  // button would spin forever (recoverable only by clicking it as cancel). A
  // full navigation tears the content script down (tabs.onUpdated fires with
  // status 'loading'); SPA route changes don't fire it, correctly matching the
  // run's own lifetime (the script — and its in-flight run — survive those).
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.onRemoved?.addListener) return
    const release = () => {
      bilingualTabIdRef.current = null
      setBilingualBusy(false)
      setBilingualProgress(null)
    }
    const onRemoved = (tabId: number) => {
      if (bilingualTabIdRef.current === tabId) release()
    }
    const onUpdated = (tabId: number, changeInfo: { status?: string }) => {
      if (bilingualTabIdRef.current === tabId && changeInfo.status === 'loading') release()
    }
    chrome.tabs.onRemoved.addListener(onRemoved)
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => {
      chrome.tabs.onRemoved.removeListener(onRemoved)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [])

  useEffect(() => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = requestAnimationFrame(() => {
      const node = scrollRef.current
      // Empty transcript (onboarding hero): keep the top anchored — scrolling
      // to the bottom would clip the BYOK banner above the fold on short panels.
      if (node && messages.length > 0) {
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

  // Color scheme: settings.theme pins light/dark; 'auto' (default) follows
  // the OS live — the matchMedia listener keeps following scheme changes
  // until the user pins a side. The .dark class flips every token in
  // tokens.css; components never branch on theme themselves.
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = (byok.theme ?? 'auto') === 'dark' || ((byok.theme ?? 'auto') === 'auto' && mq.matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [byok.theme])

  // Palette (paper tint + accent family): main.tsx injects the per-theme token
  // overrides and sets the attribute synchronously before first paint; this
  // effect keeps it in sync when the user switches themes live in settings.
  useEffect(() => {
    document.documentElement.dataset.palette = normalizeThemeId(byok.palette)
  }, [byok.palette])

  const downloadMarkdown = (hs: Highlight[]) => {
    downloadBlob('lector-highlights.md', toMarkdown(hs), 'text/markdown')
  }
  const downloadSessionMarkdown = (s: ChatSession) => {
    const slug = (s.title || 'conversation')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
    downloadBlob(`lector-${slug || 'chat'}.md`, sessionToMarkdown(s), 'text/markdown')
  }
  /** Finish an inline Library rename. Enter and blur both land here; Escape
   *  cancels first (renamingId cleared), making this a no-op. Empty titles
   *  are ignored — a session must never become nameless. */
  const commitRename = (id: string) => {
    if (renamingId !== id) return
    setRenamingId(null)
    const title = renameDraft.trim()
    if (title) updateSession(id, { title })
  }
  /** Hostname for the translation-history source link; '' for urls the URL
   *  parser can't make sense of (the anchor then simply isn't rendered). */
  const safeHost = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }

  // (gradeVocab + toggleReveal moved into VocabView — reveal-set is single-consumer.)

  // Shared sentence-card generator. Lives at App scope so VocabView and the
  // Highlights view (sibling components, not children of SentencesView) can
  // fire it from their own item-level "explain this" buttons. Mirrors the
  // core of SentencesView.handleGenerate but parameterizes the inputs
  // (sentence / url / title) so callers don't need their own closure.
  const generateSentenceCard = useCallback(async (sentence: string, url: string, title: string) => {
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
  }, [tr])

  // make-card from a 举一反三 example sentence (inside SentencesView).
  // Wraps generateSentenceCard with per-example busy state so the row shows
  // a spinner; the new card appears at the top of the list via the store.
  // Wrap generateSentenceCard with per-item busy state keyed on the trigger
  // text so the firing row can show a spinner. The two callers below differ
  // only in how they unpack their argument.
  const withBusyExample = useCallback((key: string, run: () => Promise<void>) => {
    setBusyExample(key)
    run().finally(() => setBusyExample(null))
  }, [])

  // make-card from a 举一反三 example sentence (inside SentencesView); the new
  // card appears at the top of the list via the store.
  const handleMakeCardFromExample = useCallback(
    (sentence: string, title: string) =>
      withBusyExample(sentence, () => generateSentenceCard(sentence, '', title)),
    [withBusyExample, generateSentenceCard]
  )

  // make-card from a Highlight's "explain" (Sparkles) button. No per-row busy
  // state here (highlights list is short and the action is secondary); we just
  // surface a lightweight inline state by reusing busyExample keyed on text.
  const handleMakeCardFromHighlight = useCallback(
    (h: { text: string; url: string; title: string }) =>
      withBusyExample(h.text, () => generateSentenceCard(h.text, h.url, h.title)),
    [withBusyExample, generateSentenceCard]
  )

  // ---- Stable handlers for the memoized secondary views -------------------
  // Each wraps a stable store action (Zustand actions keep their identity), so
  // these callbacks are stable too. Combined with React.memo on the views and
  // the stable `tr`/`tplTitle` above, an unrelated store change (e.g. a chat
  // message streaming in while the user sits on Vocab view) no longer
  // re-renders the currently-mounted view.

  // Apply a partial byok patch + persist it. Reads the base from
  // useStore.getState() so a patch computed from a stale render can never
  // resurrect older fields. Single implementation — header chip, quick
  // toggles and the Settings form all delegate here.
  const saveByok = useCallback(async (patch: Partial<ByokSettings>) => {
    const next = { ...useStore.getState().byok, ...patch }
    setByok(next)
    await saveSettings(next)
  }, [setByok])

  const handleByokChange = useCallback(
    async (next: Partial<ByokSettings>) => saveByok(next),
    [saveByok]
  )

  const handleGradeVocab = useCallback(
    (v: VocabEntry, g: Grade) => updateVocabSrs(v.id, scheduleSrs(v.srs, g)),
    [updateVocabSrs]
  )

  const handleSaveAnkiConfig = useCallback(
    (cfg: { url: string; deckName: string; modelName: string; tags: string[] }) =>
      setByok({ anki: cfg }),
    [setByok]
  )

  const handleExplainVocab = useCallback(
    (v: VocabEntry) => {
      if (!v.context?.trim()) {
        alert(tr('side.sentences.noContext'))
        return
      }
      void generateSentenceCard(v.context, v.url, v.title)
    },
    [tr, generateSentenceCard]
  )

  const handleSentenceGrade = useCallback(
    (c: SentenceCard, g: Grade) => {
      if (c.srs) updateSentenceSrs(c.id, scheduleSrs(c.srs, g))
    },
    [updateSentenceSrs]
  )

  const handleViewSource = useCallback((blockId: string | undefined, url: string) => {
    if (blockId) {
      void jumpToBlock(blockId)
    } else if (url) {
      window.open(url, '_blank')
    }
  }, [])

  const handleSentenceAnkiExport = useCallback(
    async (cards: SentenceCard[]) => {
      const settings = useStore.getState().byok
      const cfg = withAnkiDefaults(settings.anki)
      const deckName = cfg.deckName === DEFAULT_DECK_NAME ? DEFAULT_SENTENCE_DECK_NAME : cfg.deckName
      try {
        const r = await exportSentencesToAnki(cards, { ...cfg, deckName })
        alert(formatAnkiResult(tr('anki.result'), r))
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
      }
    },
    [tr]
  )

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
      bilingualTabIdRef.current = null
      return
    }
    setBilingualBusy(true)
    setBilingualProgress(null)
    bilingualTabIdRef.current = tab.id
    if (progressClearTimerRef.current !== null) {
      clearTimeout(progressClearTimerRef.current)
      progressClearTimerRef.current = null
    }
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
      // Freeze the owning session at send time: the user may switch sessions
      // (or start a new chat) while this stream is in flight — the turn still
      // belongs to the session it was sent from.
      const sendSessionId = activeSessionId

      // Persist the finalized turn into the session the stream STARTED in —
      // not the live activeSessionId, which may already point elsewhere (the
      // user switched sessions / started a new chat while the stream ran).
      // Guarded against the session being deleted while the stream was running
      // (user removed it from the Library mid-response): updateSession on a
      // missing id is a silent no-op, but the user would lose the answer —
      // fall back to creating a fresh session so the exchange isn't dropped.
      // allowCreate=false marks a navigation-caused abort: the user abandoned
      // that fresh-chat exchange, so persisting it as a surprise new session
      // (and stealing activeSessionId from the chat they switched to) is
      // worse than dropping the partial. Used by the success AND the
      // abort/error paths: a stopped or failed turn must not silently diverge
      // from the Library copy (it would vanish on reopen).
      const persistTurn = (finalMessages: ChatMessage[], allowCreate = true) => {
        if (sendSessionId) {
          const stillExists = useStore
            .getState()
            .sessions.some((s) => s.id === sendSessionId)
          if (stillExists) {
            updateSession(sendSessionId, { messages: finalMessages })
            return
          }
        }
        if (!allowCreate) return
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
${(() => { const gp = renderGlossaryPrompt(glossary); return gp ? `\n${gp}\n` : '' })()}`

        // Provider history: drop empty turns AND failed/stopped marker turns —
        // sending "⚠️ Provider error …" back as assistant context poisons the
        // next request (and a retry's re-sent user turn would sit next to it).
        const history: WireMessage[] = messages
          .filter(
            (m) =>
              m.content.trim().length > 0 &&
              !(m.role === 'assistant' && FAILED_TURN_RE.test(m.content))
          )
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
            // React updates to at most ~10Hz instead of rerendering for every
            // token: the streaming bubble re-parses its whole (growing)
            // Markdown text on each render, and 60fps re-parsing of a long
            // reply's tail dominated the stream's CPU cost. The final text is
            // set once when the stream completes, so nothing is lost.
            if (
              tokenFrameRef.current === null &&
              performance.now() - lastTokenFlushRef.current >= TOKEN_FLUSH_MIN_MS
            ) {
              tokenFrameRef.current = requestAnimationFrame(() => {
                tokenFrameRef.current = null
                lastTokenFlushRef.current = performance.now()
                const snapshot = assistantBuf.current
                setMessages((cur) =>
                  cur.map((m) => (m.id === assistantMsg.id ? { ...m, content: snapshot } : m))
                )
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
        // cur.map, not setMessages(final): if the user switched sessions and
        // the final frame raced the abort, the visible transcript belongs to
        // the NEW session and must not be clobbered — map is a no-op when the
        // bubble id is absent.
        setMessages((cur) =>
          cur.map((m) => (m.id === assistantMsg.id ? finalAssistant : m))
        )
        setLiveNotice(tr('aria.replyReady'))
        persistTurn(finalMessages)
      } catch (e) {
        if (tokenFrameRef.current !== null) {
          cancelAnimationFrame(tokenFrameRef.current)
          tokenFrameRef.current = null
        }
        // Abort (Stop / unmount / session switch) is intentional: keep whatever
        // streamed so far and don't show an error. A genuine failure surfaces
        // inline + (for key/quota errors) in the banner with an Open-settings link.
        const switchAborted = switchAbortRef.current
        switchAbortRef.current = false
        const aborted =
          abortRef.current?.signal.aborted ||
          (e instanceof DOMException && e.name === 'AbortError')
        if (aborted) {
          const partial = assistantBuf.current
          // cur.map (not setMessages(final)): if the user switched sessions
          // mid-stream, the visible transcript belongs to the NEW session and
          // must not be clobbered — map is a no-op when the bubble id is absent.
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: partial || tr('side.chat.canceled') }
                : m
            )
          )
          setLiveNotice(tr('aria.replyStopped'))
          // A switch/New-chat abort must not conjure a phantom session (and
          // steal activeSessionId from the chat the user moved to); it may
          // still update the session the stream started in.
          persistTurn(
            next.concat({ ...assistantMsg, content: partial || tr('side.chat.canceled') }),
            !switchAborted
          )
        } else {
          const msg = e instanceof Error ? e.message : tr('err.requestFailed')
          setError(msg)
          // Key/quota/auth errors also surface in the banner (with the
          // Open-settings shortcut) so they're not buried in the inline line.
          if (isKeyQuotaError(msg)) setErrorBanner(msg)
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: `⚠️ ${msg}` } : m
            )
          )
          setLiveNotice(tr('aria.replyFailed'))
          persistTurn(next.concat({ ...assistantMsg, content: `⚠️ ${msg}` }), !switchAborted)
        }
      } finally {
        abortRef.current = null
        setStreaming(false)
      }
    },
    [input, streaming, messages, byok, page, activeSessionId, addSession, updateSession, glossary, tr]
  )

  /** Tear down the active stream's transport + pending frame + buffer. Shared
   *  by startNewChat and openSession: a stream from another session must not
   *  bleed into the chat being switched to. Flags the abort as navigation-
   *  caused so the stream's catch suppresses its phantom-session persist. */
  const abortActiveStream = () => {
    switchAbortRef.current = true
    abortRef.current?.abort()
    abortRef.current = null
    if (tokenFrameRef.current !== null) cancelAnimationFrame(tokenFrameRef.current)
    tokenFrameRef.current = null
    assistantBuf.current = ''
    setStreaming(false)
  }

  const startNewChat = () => {
    // Abort any in-flight stream so it can't finish and write its answer into
    // this fresh (empty) chat, and reset streaming state so the composer isn't
    // left disabled. Without this, a stream started in session A could land in
    // the new chat or vanish entirely.
    abortActiveStream()
    setMessages([])
    setActiveSessionId(null)
    setError(null)
  }

  const openSession = (s: ChatSession) => {
    abortActiveStream()
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
          <div className="flex items-center gap-1.5 text-[10px] text-ink-faint mt-0.5 max-w-[200px]">
            <span
              aria-hidden="true"
              className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${providerConfigured ? 'bg-success' : 'bg-warn'}`}
            />
            <span className="truncate">
              {providerConfigured
                ? `${getProvider(byok.provider).label} · ${byok.model || 'model'}`
                : tr('side.header.noKey')}
            </span>
          </div>
          {/* Current-site quick toggle (Immersive-parity site rules). Cycles
              auto → always → never for the active tab's host. */}
          {currentHost && (
            <CurrentSiteChip
              host={currentHost}
              rules={translationSettings.siteRules}
              locale={byok.locale}
              onToggle={(next) => {
                void saveByok({ translation: { ...translationSettings, siteRules: next } })
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

      {/* TabBar: flat view switching (high-frequency tabs + MoreMenu). Plain
          nav + aria-current rather than role=tablist: the "⋯" trigger controls
          a menu, not a tab, so the full tabs pattern (tabpanel linkage, roving
          tabindex) can't be completed without splitting the bar. */}
      <nav className="tab-bar" aria-label={tr('aria.views')}>
        <div className="tab-scroll">
          <button
            onClick={() => setActiveView('chat')}
            aria-current={activeView === 'chat' ? 'page' : undefined}
            className={`tab-item ${activeView === 'chat' ? 'tab-item-active' : ''}`}
            aria-label={tr('side.tab.chat')}
          >
            <SendIcon size={14} />
            <span>{tr('side.tab.chat')}</span>
          </button>
          <button
            onClick={() => setActiveView('sentences')}
            aria-current={activeView === 'sentences' ? 'page' : undefined}
            className={`tab-item relative ${activeView === 'sentences' ? 'tab-item-active' : ''}`}
            aria-label={tr('side.sentences.title')}
          >
            <CardsIcon size={14} />
            <span>{tr('side.sentences.title')}</span>
            {sentencesHasDue && (
              <span className="lector-due-badge tab-corner-badge">!</span>
            )}
          </button>
          <button
            onClick={() => setActiveView('highlights')}
            aria-current={activeView === 'highlights' ? 'page' : undefined}
            className={`tab-item relative ${activeView === 'highlights' ? 'tab-item-active' : ''}`}
            aria-label={tr('side.tab.highlights')}
          >
            <BookmarkIcon size={14} />
            <span>{tr('side.tab.highlights')}</span>
            {highlights.length > 0 && <span className="dot-badge tab-corner-badge" />}
          </button>
          <button
            onClick={() => setActiveView('vocab')}
            aria-current={activeView === 'vocab' ? 'page' : undefined}
            className={`tab-item relative ${activeView === 'vocab' ? 'tab-item-active' : ''}`}
            aria-label={tr('side.tab.vocab')}
          >
            <BookOpenIcon size={14} />
            <span>{tr('side.tab.vocab')}</span>
            {vocabDueCount > 0 && (
              <span className="lector-due-badge tab-corner-badge" aria-label={tr('side.vocab.due')}>
                {vocabDueCount > 99 ? '99+' : vocabDueCount}
              </span>
            )}
          </button>
        </div>
        {/* ⋯ MoreMenu: low-frequency views (Templates / Glossary / Library).
            Outside .tab-scroll: the dropdown overflows below the bar, and a
            scroll container ancestor would clip it (see index.css .tab-bar). */}
        <div className="relative flex-shrink-0" ref={toolsRef}>
          <button
            ref={toolsTriggerRef}
            onClick={() => setShowTools((v) => !v)}
            className={`tab-item ${activeView === 'templates' || activeView === 'glossary' || activeView === 'library' || activeView === 'translationHistory' ? 'tab-item-active' : ''}`}
            aria-label={tr('side.tab.more')}
            aria-expanded={showTools}
            aria-haspopup="menu"
          >
            <GridIcon size={14} />
            <span>{tr('side.tab.more')}</span>
          </button>
          {showTools && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-48 bg-surface border border-line rounded-xl shadow-pop z-30 py-1 lector-anim-fade">
              <button
                onClick={() => { setActiveView('library'); setShowTools(false); toolsTriggerRef.current?.focus() }}
                role="menuitem"
                aria-label={tr('aria.library')}
                className="tools-item"
              >
                <LibraryIcon size={16} />
                <span className="flex-1 text-left">{tr('side.library.title')}</span>
              </button>
              <button
                onClick={() => { setActiveView('translationHistory'); setShowTools(false); toolsTriggerRef.current?.focus() }}
                role="menuitem"
                aria-label={tr('aria.translationHistory')}
                className="tools-item relative"
              >
                <LanguagesIcon size={16} />
                <span className="flex-1 text-left">{tr('side.translationHistory.title')}</span>
                {translationHistory.length > 0 && <span className="dot-badge" />}
              </button>
              <button
                onClick={() => { setActiveView('glossary'); setShowTools(false); toolsTriggerRef.current?.focus() }}
                role="menuitem"
                aria-label={tr('aria.glossary')}
                className="tools-item relative"
              >
                <BookMarkedIcon size={16} />
                <span className="flex-1 text-left">{tr('side.glossary.title')}</span>
                {glossary.length > 0 && <span className="dot-badge" />}
              </button>
              <button
                onClick={() => { setActiveView('templates'); setShowTools(false); toolsTriggerRef.current?.focus() }}
                role="menuitem"
                aria-label={tr('aria.templates')}
                className="tools-item relative"
              >
                <ClipboardListIcon size={16} />
                <span className="flex-1 text-left">{tr('side.templates.title')}</span>
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
      {/* Single polite status region for finalized turns — see liveNotice.
          Kept OUTSIDE the scrolling transcript so streaming token updates in
          the transcript are never announced token-by-token. */}
      <div role="status" className="sr-only">{liveNotice}</div>
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3.5"
      >
        {!providerConfigured && !byokBannerDismissed && (
          <div className="relative p-3 pr-8 rounded-xl bg-accent-softer border border-accent-soft text-[12px] text-accent-hover leading-relaxed">
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
            <button
              onClick={() => setByokBannerDismissed(true)}
              aria-label={tr('side.error.dismiss')}
              className="absolute top-2 right-2 p-1 rounded-md text-accent-hover/70 hover:text-accent-hover hover:bg-accent-soft/60 transition-colors"
            >
              <XIcon size={12} />
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="min-h-full flex flex-col py-6 pb-10">
            {/* my-auto: vertically centers the hero group when there's room,
                and collapses to zero margin when the content is taller than
                the viewport (justify-center would clip the top instead). */}
            <div className="my-auto text-center">
            <div className="w-14 h-14 rounded-2xl bg-accent text-accent-on font-bold flex items-center justify-center text-2xl mx-auto mb-4 shadow-md font-serif">
              L
            </div>
            <h2 className="text-[22px] leading-snug font-semibold text-ink mb-1.5 font-serif tracking-[-0.015em]">{tr('side.empty.title')}</h2>
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
              <div className="mx-2 mb-5 text-left p-3 rounded-xl bg-surface border border-line shadow-sm">
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
                  className="group flex items-center gap-2.5 px-3 py-2.5 text-left text-[12px] font-medium text-ink-soft bg-surface border border-line rounded-lg shadow-sm hover:border-accent/60 hover:bg-accent-softer hover:text-accent transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:text-ink-faint/80 disabled:shadow-none disabled:hover:border-line disabled:hover:bg-surface disabled:hover:text-ink-faint/80"
                >
                  {/* Leading icon tile replaces the old left accent bar: keeps
                      each suggestion scannable without the stripe decoration. */}
                  <span
                    aria-hidden="true"
                    className="flex-shrink-0 w-7 h-7 rounded-md bg-accent-softer border border-accent-soft/70 text-accent flex items-center justify-center group-hover:bg-accent group-hover:border-accent group-hover:text-accent-on group-disabled:bg-surface-sunken group-disabled:border-line group-disabled:text-ink-faint transition-colors duration-150"
                  >
                    {templateIcon(tpl.id, 14)}
                  </span>
                  <span className="truncate">{tplTitle(tpl)}</span>
                </button>
              ))}
            </div>
            {!page && (
              <p className="text-[11px] text-warn mt-5 px-6">
                {tr('side.empty.noPage')}
              </p>
            )}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === 'user'
          const failed = !!m.content && FAILED_TURN_RE.test(m.content)
          const copied = copiedMsgId === m.id
          return (
          <div key={m.id} className={`group flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start items-start'}`}>
            {isUser ? (
              <div className="max-w-[85%] flex flex-col items-end">
                <div className="px-3.5 py-2 bg-accent text-accent-on text-body rounded-lg whitespace-pre-wrap break-words shadow-sm">
                  {m.content}
                </div>
                <button
                  onClick={() => copyMessage(m)}
                  aria-label={tr('aria.copy')}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-accent transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  {copied ? <CheckIcon size={12} /> : <ClipboardListIcon size={12} />}
                  {copied ? tr('side.chat.copied') : tr('side.chat.copy')}
                </button>
              </div>
            ) : (
              <>
                {/* Avatar aligns with the first text line, not the bubble edge:
                    the bubble's top padding (10px) pushes the first line down,
                    so an edge-aligned avatar floats ~7px high. mt-2.5 matches
                    the padding, centering the 22px avatar on the 22px line box. */}
                <div
                  aria-hidden="true"
                  className="flex-shrink-0 w-[22px] h-[22px] mt-2.5 rounded-lg bg-accent-softer border border-accent-soft text-accent font-serif font-bold text-[13px] flex items-center justify-center select-none"
                >
                  L
                </div>
                {/* flex-1: assistant replies are markdown documents — a fixed
                    right edge reads as intentional, content-hugging bubbles
                    leave a ragged staircase between short and long replies. */}
                <div className="min-w-0 flex-1 px-3.5 py-2.5 bg-surface border border-line rounded-lg shadow-sm">
                  {m.content ? (
                    <AssistantBubble content={m.content} blockIdsKey={blockIdsKey} />
                  ) : (
                    <div className="flex items-center gap-2 text-[12px] text-ink-faint">
                      <div className="w-3.5 h-3.5 border-2 border-line border-t-accent rounded-full animate-spin" />
                      {tr('side.thinking')}
                    </div>
                  )}
                  {/* Message action row: Copy on every finalized reply, plus
                      Retry when the turn failed/was stopped. The row is
                      hover-revealed normally, but stays pinned on a failed
                      turn — the stopped-copy tells the user to tap Retry, so
                      that button must be findable without hovering. */}
                  {m.content && (
                    <div
                      className={`mt-1.5 pt-1.5 border-t border-line/60 flex items-center gap-4 ${
                        failed ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'
                      }`}
                    >
                      <button
                        onClick={() => copyMessage(m)}
                        aria-label={tr('aria.copy')}
                        className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-accent transition-colors"
                      >
                        {copied ? <CheckIcon size={12} /> : <ClipboardListIcon size={12} />}
                        {copied ? tr('side.chat.copied') : tr('side.chat.copy')}
                      </button>
                      {failed && !streaming && (
                        <button
                          onClick={retryLast}
                          className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover transition-colors"
                        >
                          <RotateIcon size={12} />
                          {tr('side.chat.retry')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )
        })}
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
            templates={slashMatches}
            activeIdx={slashMenu.activeIdx}
            titleFor={tplTitle}
            builtInLabel={tr('side.templates.builtIn')}
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
            className="flex-1 max-h-32 resize-none px-3.5 py-2.5 text-body bg-bg border border-line rounded-2xl leading-relaxed placeholder:text-ink-faint focus:outline-none focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft transition-colors duration-150 ease-out"
          />
          <button
            onClick={() => (streaming ? stopStreaming() : handleSend())}
            disabled={!streaming && (!input.trim() || !providerConfigured)}
            aria-label={streaming ? tr('side.chat.stop') : tr('side.composer.hint')}
            className="btn-primary w-10 h-10 flex-shrink-0 rounded-2xl !p-0 disabled:opacity-100 disabled:bg-surface-sunken disabled:text-ink-faint disabled:shadow-none disabled:hover:bg-surface-sunken"
          >
            {streaming ? <StopIcon size={14} /> : <SendIcon size={17} />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span
            aria-hidden={!providerConfigured}
            className={`text-[10px] leading-relaxed transition-colors ${providerConfigured ? 'text-ink-faint' : 'text-ink-faint/0 select-none'}`}
          >
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
        <Suspense fallback={<ViewLoading />}>
        <SettingsView
          byok={byok}
          onChange={handleByokChange}
        />
        </Suspense>
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
              sessions.map((s) => {
                const renaming = renamingId === s.id
                return (
                <div
                  key={s.id}
                  className="group row row-hover"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (renaming) return
                    openSession(s)
                  }}
                  onKeyDown={(e) => {
                    if (renaming) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openSession(s)
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {renaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') commitRename(s.id)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          onBlur={() => commitRename(s.id)}
                          aria-label={tr('aria.rename')}
                          className="field-sm w-full"
                        />
                      ) : (
                        <div className="text-[12px] font-medium text-ink truncate">{s.title}</div>
                      )}
                      <div className="text-[10px] text-ink-faint mt-0.5">{formatListTimestamp(s.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId(s.id)
                          setRenameDraft(s.title)
                        }}
                        aria-label={tr('aria.rename')}
                        disabled={renaming}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-accent transition-opacity disabled:hidden"
                      >
                        <PencilIcon size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          downloadSessionMarkdown(s)
                        }}
                        aria-label={tr('aria.download')}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                      >
                        <DownloadIcon size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeSession(s.id)
                          if (activeSessionId === s.id) startNewChat()
                        }}
                        aria-label={tr('aria.deleteConversation')}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                      >
                        <XIcon size={15} />
                      </button>
                    </div>
                  </div>
                </div>
                )
              })
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
                {highlights.slice(0, highlightPage.limit).map((h) => (
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
                          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                        >
                          <SparklesIcon size={14} />
                        </button>
                        <button
                          onClick={() => removeHighlight(h.id)}
                          aria-label={tr('aria.deleteHighlight')}
                          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                        >
                          <XIcon size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {highlights.length > highlightPage.limit && (
                  <LoadMore
                    remaining={highlights.length - highlightPage.limit}
                    onMore={highlightPage.more}
                    tr={tr}
                  />
                )}
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
                {filteredHistory
                  .slice(0, historyPage.limit)
                  .map((e) => (
                    <div key={e.id} className="group row">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-ink-faint bg-surface-muted px-1.5 py-0.5 rounded">
                              {tr(('side.translationHistory.kind.' + e.kind) as StringKey)}
                            </span>
                            <span className="text-[10px] text-ink-faint">
                              {getLanguage(e.targetLang)[resolveLocale(byok.locale) === 'zh' ? 'zh' : 'en']}
                            </span>
                            <span className="text-[10px] text-ink-faint">
                              {formatListTimestamp(e.createdAt)}
                            </span>
                            {/* The source url is captured but was invisible —
                                show it as a host link so a history row can
                                take you back to the page it came from. */}
                            {e.url && (
                              <a
                                href={e.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-[10px] text-accent/80 hover:text-accent hover:underline truncate max-w-[120px]"
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                {safeHost(e.url)}
                              </a>
                            )}
                          </div>
                          <div className="text-[12px] text-ink leading-relaxed border-l-2 border-accent/40 pl-2.5">{e.source}</div>
                          <div className="text-[12px] text-ink-soft leading-relaxed mt-1 pl-2.5">{e.target}</div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => navigator.clipboard.writeText(e.target).catch(() => {})}
                            aria-label={tr('bilingual.copyTranslation')}
                            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                          >
                            <ClipboardListIcon size={14} />
                          </button>
                          <button
                            onClick={() => removeTranslationHistory(e.id)}
                            aria-label={tr('aria.delete')}
                            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                          >
                            <XIcon size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                {filteredHistory.length > historyPage.limit && (
                  <LoadMore
                    remaining={filteredHistory.length - historyPage.limit}
                    onMore={historyPage.more}
                    tr={tr}
                  />
                )}
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
        <Suspense fallback={<ViewLoading />}>
        <VocabView
          vocab={vocab}
          ankiConfig={byok.anki}
          tr={tr}
          onRemoveVocab={removeVocab}
          onGradeVocab={handleGradeVocab}
          onSaveAnkiConfig={handleSaveAnkiConfig}
          onExplainVocab={handleExplainVocab}
          onAddToGlossary={(v) => {
            if (!v.translation?.trim()) return
            addGlossaryEntry({ source: v.word, target: v.translation.trim(), enabled: true })
          }}
        />
        </Suspense>
      )}

      {/* Templates view (flat) */}
      {activeView === 'templates' && (
        <Suspense fallback={<ViewLoading />}>
        <TemplatesView
          templates={sortedTemplates}
          titleFor={tplTitle}
          tr={tr}
          onAdd={addTemplate}
          onUpdate={updateTemplate}
          onRemove={removeTemplate}
          onReorder={reorderTemplates}
        />
        </Suspense>
      )}

      {/* Glossary view (flat) */}
      {activeView === 'glossary' && (
        <Suspense fallback={<ViewLoading />}>
        <GlossaryView
          entries={glossary}
          tr={tr}
          onAdd={addGlossaryEntry}
          onUpdate={updateGlossaryEntry}
          onRemove={removeGlossaryEntry}
          onImport={replaceGlossary}
        />
        </Suspense>
      )}

      {/* Sentence Library view (flat) */}
      {activeView === 'sentences' && (
        <Suspense fallback={<ViewLoading />}>
        <SentencesView
          sentences={sentences}
          busyExample={busyExample}
          tr={tr}
          onRemove={removeSentence}
          onPromote={promoteSentenceToReview}
          onGrade={handleSentenceGrade}
          onViewSource={handleViewSource}
          onAnkiExport={handleSentenceAnkiExport}
          onMakeCard={handleMakeCardFromExample}
        />
        </Suspense>
      )}
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
    const jump = (target: HTMLElement) => {
      const blockId = target.getAttribute('data-cite') || ''
      void jumpToBlock(blockId)
    }
    const onClick = (e: MouseEvent) => {
      const cite = (e.target as HTMLElement).closest<HTMLElement>('.lector-cite')
      if (cite) jump(cite)
    }
    // Chips carry tabindex="0" + role="button" (renderCitations); activate
    // them with Enter/Space so "jump to source" is not mouse-only.
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const cite = (e.target as HTMLElement).closest<HTMLElement>('.lector-cite')
      if (cite) {
        e.preventDefault()
        jump(cite)
      }
    }
    root.addEventListener('click', onClick)
    root.addEventListener('keydown', onKeydown)
    return () => {
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeydown)
    }
  }, [])
  return <div ref={ref} className="lector-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * Assistant chat bubble. Memoizes the markdown→HTML→citations pipeline on
 * `content` + `blockIdsKey` so previously-finished bubbles don't re-parse on
 * every rAF token frame during a live stream (only the actively-streaming
 * bubble's content changes frame-to-frame). `blockIdsKey` is a stable joined
 * string so the useMemo dep is a primitive, not a fresh Set each render.
 */
const AssistantBubble = memo(function AssistantBubble({
  content,
  blockIdsKey,
}: {
  content: string
  blockIdsKey: string
}) {
  const html = useMemo(() => {
    const blockIds = new Set(blockIdsKey ? blockIdsKey.split('\u0000') : [])
    return renderCitations(renderMarkdown(content), blockIds)
  }, [content, blockIdsKey])
  return <CitationContent html={html} />
})

/** Icon for a suggestion/template card — keyed by built-in template ids, with
 *  a neutral sparkle for user-defined templates. */
function templateIcon(id: string, size: number) {
  switch (id) {
    case 'tpl_builtin_summarize':
      return <FileTextIcon size={size} />
    case 'tpl_builtin_keypoints':
      return <ListIcon size={size} />
    case 'tpl_builtin_eli5':
      return <SparklesIcon size={size} />
    case 'tpl_builtin_rewrite':
      return <PencilIcon size={size} />
    default:
      if (id.startsWith('tpl_builtin_translate')) return <LanguagesIcon size={size} />
      return <SparklesIcon size={size} />
  }
}

// ---------------------------------------------------------------------------
// "/" template menu — floats above the composer
// ---------------------------------------------------------------------------
// memo: the menu re-renders on every App render (it sits in the chat tree that
// streams at ~10Hz); with a memoized `templates` prop it now skips those.
const SlashMenu = memo(function SlashMenu({
  templates,
  activeIdx,
  titleFor,
  builtInLabel,
  emptyText,
  onPick,
  onHover,
}: {
  templates: PromptTemplate[]
  activeIdx: number
  titleFor: (t: PromptTemplate) => string
  builtInLabel: string
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
              {tpl.builtIn && <span className="chip-builtIn">{builtInLabel}</span>}
            </span>
            <span className="text-[10px] text-ink-faint truncate">
              {tpl.content.replace(/\n/g, ' ').slice(0, 60)}
            </span>
          </button>
        ))
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Vocabulary review drawer — list + SRS review + Anki export
// ---------------------------------------------------------------------------
// (VocabView moved to src/sidepanel/views/VocabView.tsx)

// ---------------------------------------------------------------------------
// Templates drawer — list, create, edit, delete, drag-reorder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Glossary drawer — list, create, edit, delete, import/export (Feature: 术语表)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sentence Library drawer — paste-to-generate, search, group, SRS review
// ---------------------------------------------------------------------------

// Shared SRS grade buttons (Again / Hard / Good / Easy). Used by the Vocab
// and Sentence review drawers. "easy" is subtly emphasized as the positive
// path; "again" tinted toward danger since it resets the card.
// (SrsGradeButtons + StatsBar moved to src/sidepanel/components/leaf.tsx)
