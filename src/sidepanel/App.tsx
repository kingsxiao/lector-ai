import { useEffect, useRef, useState, useCallback, type ReactNode, type DragEvent } from 'react'
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
} from '../shared/icons'
import {
  PROVIDERS,
  getProvider,
  type ProviderId,
  type ByokSettings,
} from '../shared/providers'
import { streamChat, completeOnce, getSettings, saveSettings, testConnection, fetchModels, type ChatMessage as WireMessage, type FetchedModel } from '../shared/byok'
import { t, type StringKey, type LocalePref } from '../shared/i18n'
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

interface PageContext {
  title: string
  url: string
  text: string
  lang: string
  blocks: PageBlock[]
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

export default function App() {
  const { byok, setByok, sessions, addSession, updateSession, removeSession, clearSessions } =
    useStore()
  const highlights = useStore((s) => s.highlights)
  const vocab = useStore((s) => s.vocab)
  const addHighlight = useStore((s) => s.addHighlight)
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

  const tr = (key: StringKey) => t(key, byok.locale)
  // Resolve a template's display title (i18n key for built-ins, raw for custom).
  const tplTitle = (tpl: PromptTemplate) =>
    tpl.titleKey ? t(tpl.titleKey, byok.locale) : tpl.title

  const sortedTemplates = sortTemplates(templates)
  // Empty-state suggestion chips = the first 4 templates (same data source as
  // the "/" menu and the templates drawer).
  const suggestions = sortedTemplates.slice(0, 4)

  const [page, setPage] = useState<PageContext | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showHighlights, setShowHighlights] = useState(false)
  const [showVocab, setShowVocab] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showGlossary, setShowGlossary] = useState(false)
  const [showSentences, setShowSentences] = useState(false)
  const [revealedVocab, setRevealedVocab] = useState<Set<string>>(new Set())
  const [revealedSentences, setRevealedSentences] = useState<Set<string>>(new Set())
  const [bilingualBusy, setBilingualBusy] = useState(false)
  // "/" menu state
  const [slashMenu, setSlashMenu] = useState<{ open: boolean; query: string; activeIdx: number }>(
    { open: false, query: '', activeIdx: 0 }
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const assistantBuf = useRef<string>('')

  // Pull the page from the active tab's content script + read any seed.
  useEffect(() => {
    ;(async () => {
      // Settings are persisted by zustand, but the background/content scripts
      // also read them from chrome.storage; sync once on load.
      const stored = await getSettings()
      setByok(stored)

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'lector-get-page' }, (resp) => {
            if (chrome.runtime.lastError || !resp?.page) return
            setPage(resp.page)
          })
        }
      } catch {
        // ignore
      }

      const seed = (await chrome.storage.local.get('lectorSeed')) as {
        lectorSeed?: { kind: string; text: string }
      }
      if (seed.lectorSeed?.text) {
        const s = seed.lectorSeed
        chrome.storage.local.remove('lectorSeed')
        const seedPrompt =
          s.kind === 'summarize'
            ? 'Summarize this in a few bullets:\n\n'
            : s.kind === 'translate'
              ? 'Translate this to 中文:\n\n'
              : s.kind === 'explain'
                ? 'Explain this clearly:\n\n'
                : ''
        setInput(`${seedPrompt}${s.text}`.slice(0, 4000))
      }
    })()
  }, [setByok])

  // Sync knowledge captured by the content→background relay (chrome.storage)
  // into the zustand store so the Highlights / Vocab drawers stay live.
  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return
      if (changes.lectorHighlights) {
        const list = (changes.lectorHighlights.newValue as unknown as Highlight[]) || []
        for (const h of list) addHighlight(h)
        chrome.storage.local.remove('lectorHighlights')
      }
      if (changes.lectorVocab) {
        const list = (changes.lectorVocab.newValue as unknown as VocabEntry[]) || []
        const addVocab = useStore.getState().addVocab
        for (const v of list) addVocab(v)
        chrome.storage.local.remove('lectorVocab')
      }
      if (changes.lectorSentences) {
        const list = (changes.lectorSentences.newValue as unknown as SentenceCard[]) || []
        const addSentence = useStore.getState().addSentence
        for (const c of list) addSentence(c)
        chrome.storage.local.remove('lectorSentences')
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [addHighlight])

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

  // Surface bilingual translation errors reported by the content script. The
  // inline bilingual loop runs best-effort per block; if the FIRST block fails
  // (bad key, quota, network), the content script forwards the message here so
  // the user isn't left wondering why nothing happened.
  useEffect(() => {
    const onMessage = (message: { action?: string; message?: string }) => {
      if (message?.action === 'lector-bilingual-error' && message.message) {
        setError(message.message)
        // Key/quota errors mean the user should revisit settings.
        if (/401|key|quota|429|credit/i.test(message.message)) {
          setShowSettings(true)
        }
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  const downloadMarkdown = (hs: Highlight[]) => {
    const md = toMarkdown(hs)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lector-highlights.md'
    a.click()
    URL.revokeObjectURL(url)
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

  // Shared sentence-card generator. Lives at App scope so VocabDrawer and the
  // Highlights drawer (sibling components, not children of SentencesDrawer) can
  // fire it from their own item-level "explain this" buttons. Mirrors the
  // core of SentencesDrawer.handleGenerate but parameterizes the inputs
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

  // Inline bilingual translation — ask the active tab's content script to
  // inject paragraph-level translations. The content script tracks which
  // blocks it has already translated, so repeated toggles add new ones.
  //
  // The content script responds immediately (it can't hold the channel open
  // across its ~30-block loop under MV3), so we flip bilingualBusy on send
  // and clear it on a short timer rather than awaiting the full run. Errors
  // arrive later via the 'lector-bilingual-error' message handler below.
  const toggleBilingual = async () => {
    if (bilingualBusy) return
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    setBilingualBusy(true)
    chrome.tabs.sendMessage(tab.id, { action: 'lector-toggle-bilingual' }, () => {
      void chrome.runtime.lastError
    })
    // Clear after the first batch has had time to start injecting; the user
    // can toggle again for more blocks. The content script is best-effort.
    setTimeout(() => setBilingualBusy(false), 2500)
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
        setShowSettings(true)
        return
      }

      const userMsg: ChatMessage = { id: newId(), role: 'user', content: text }
      const assistantMsg: ChatMessage = { id: newId(), role: 'assistant', content: '' }
      const next = [...messages, userMsg]
      setMessages([...next, assistantMsg])
      setInput('')
      setStreaming(true)
      setError(null)
      assistantBuf.current = ''

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

        const history: WireMessage[] = next
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
            const snapshot = assistantBuf.current
            setMessages((cur) =>
              cur.map((m) => (m.id === assistantMsg.id ? { ...m, content: snapshot } : m))
            )
          }
        )

        const finalMessages = next.concat({
          ...assistantMsg,
          content: assistantBuf.current || '(no response)',
        })
        if (activeSessionId) {
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Request failed.'
        setError(msg)
        setMessages((cur) =>
          cur.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: `⚠️ ${msg}` } : m
          )
        )
      } finally {
        setStreaming(false)
      }
    },
    [input, streaming, messages, byok, page, activeSessionId, addSession, updateSession]
  )

  const startNewChat = () => {
    setMessages([])
    setActiveSessionId(null)
    setError(null)
  }

  const openSession = (s: ChatSession) => {
    setMessages(s.messages)
    setActiveSessionId(s.id)
    setShowLibrary(false)
  }

  const providerConfigured = Boolean(byok.apiKey)

  return (
    <div className="flex flex-col h-screen bg-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2.5 bg-surface border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-accent text-accent-on font-bold flex items-center justify-center text-sm flex-shrink-0">
            L
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate">
              {page?.title || tr('side.header.defaultTitle')}
            </div>
            <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
              {providerConfigured
                ? `${getProvider(byok.provider).label} · ${byok.model || 'model'}`
                : tr('side.header.noKey')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowLibrary(true)}
            title={tr('side.library.title')}
            aria-label={tr('side.library.title')}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
          >
            <LibraryIcon />
          </button>
          <button
            onClick={() => setShowHighlights(true)}
            title="Highlights"
            aria-label={tr('side.highlights.title')}
            className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center relative"
          >
            <BookmarkIcon />
            {highlights.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />
            )}
          </button>
          <button
            onClick={() => setShowVocab(true)}
            title="Vocabulary"
            aria-label={tr('side.vocab.title')}
            className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center relative"
          >
            <BookOpenIcon />
            {vocab.some((v) => isDue(v.srs)) && (
              <span className="lector-due-badge absolute -top-0.5 -right-1">!</span>
            )}
          </button>
          <button
            onClick={() => setShowGlossary(true)}
            title={tr('side.glossary.title')}
            aria-label={tr('side.glossary.title')}
            className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center relative"
          >
            <BookMarkedIcon />
            {glossary.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />
            )}
          </button>
          <button
            onClick={() => setShowSentences(true)}
            title={tr('side.sentences.title')}
            aria-label={tr('side.sentences.title')}
            className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center relative"
          >
            <CardsIcon />
            {sentences.some((c) => c.srs && isDue(c.srs)) && (
              <span className="lector-due-badge absolute -top-0.5 -right-1">!</span>
            )}
          </button>
          <button
            onClick={() => setShowTemplates(true)}
            title={tr('side.templates.title')}
            aria-label={tr('side.templates.title')}
            className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center relative"
          >
            <ClipboardListIcon />
            {templates.filter((t) => !t.builtIn).length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />
            )}
          </button>
          <button
            onClick={toggleBilingual}
            disabled={!page || bilingualBusy}
            title={page ? 'Translate page paragraphs (bilingual)' : 'Open a page first'}
            aria-label={page ? 'Translate page paragraphs (bilingual)' : 'Open a page first'}
            className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center disabled:opacity-40"
          >
            {bilingualBusy ? (
              <span className="block w-3 h-3 border-2 border-line border-t-accent rounded-full animate-spin" />
            ) : (
              <LanguagesIcon />
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title={tr('settings.title')}
            aria-label={tr('settings.title')}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {!providerConfigured && (
          <div className="mx-1 p-3 rounded-xl bg-accent-soft border border-accent-soft text-[12px] text-accent">
            <div className="font-semibold mb-1">{tr('side.onboard.title')}</div>
            {(() => {
              const body = tr('side.onboard.body')
              const [before, after] = body.split('{settings}')
              return (
                <>
                  {before}
                  <button onClick={() => setShowSettings(true)} className="underline font-medium">
                    {tr('side.onboard.settingsLink')}
                  </button>
                  {after}
                </>
              )
            })()}
          </div>
        )}

        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-lg bg-accent text-accent-on font-bold flex items-center justify-center text-xl mx-auto mb-3">
              L
            </div>
            <h2 className="text-sm font-semibold text-slate-700 mb-1">{tr('side.empty.title')}</h2>
            <p className="text-xs text-slate-400 mb-5 px-6">
              {tr('side.empty.subtitle')}
            </p>
            <div className="grid grid-cols-2 gap-2 px-2">
              {suggestions.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => sendTemplate(tpl)}
                  disabled={!page || !providerConfigured}
                  className="px-3 py-2.5 text-left text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:border-accent hover:bg-accent-soft transition-colors disabled:opacity-50"
                >
                  {tplTitle(tpl)}
                </button>
              ))}
            </div>
            {!page && (
              <p className="text-[11px] text-amber-600 mt-4 px-6">
                {tr('side.empty.noPage')}
              </p>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] px-3 py-2 bg-accent text-accent-on text-body rounded-lg rounded-br-sm whitespace-pre-wrap break-words">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[92%] px-3.5 py-2.5 bg-surface border border-line rounded-lg rounded-bl-sm shadow-sm">
                {m.content ? (
                  <CitationContent
                    html={renderCitations(
                      renderMarkdown(m.content),
                      new Set((page?.blocks ?? []).map((b) => b.id))
                    )}
                  />
                ) : (
                  <div className="flex items-center gap-2 text-[12px] text-slate-400">
                    <div className="w-3 h-3 border-2 border-slate-200 border-t-accent rounded-full animate-spin" />
                    {tr('side.thinking')}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="px-3 py-2.5 bg-white border-t border-slate-200">
        {error && <div className="text-[11px] text-red-500 mb-1.5 px-1">{error}</div>}

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
            className="flex-1 max-h-32 resize-none px-3 py-2 text-body bg-bg border border-transparent rounded-xl lector-focus focus:outline-none focus:bg-surface"
          />
          <button
            onClick={() => handleSend()}
            disabled={streaming || !input.trim() || !providerConfigured}
            aria-label={tr('side.composer.hint')}
            className="w-9 h-9 flex-shrink-0 rounded-xl bg-accent text-accent-on flex items-center justify-center disabled:opacity-40"
          >
            {streaming ? (
              <div className="w-3.5 h-3.5 border-2 border-accent-on/40 border-t-accent-on rounded-full animate-spin" />
            ) : (
              <SendIcon size={16} />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-slate-400">
            {tr('side.composer.hint')} · {tr('composer.templates.hint')}
          </span>
          {messages.length > 0 && (
            <button onClick={startNewChat} className="text-[10px] text-slate-400 hover:text-slate-600">
              {tr('side.composer.newChat')}
            </button>
          )}
        </div>
      </div>

      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        byok={byok}
        onChange={async (next) => {
          setByok(next)
          // Read the latest store state rather than the render-captured `byok`,
          // so rapid sequential edits don't persist a stale snapshot.
          await saveSettings({ ...useStore.getState().byok, ...next })
        }}
      />

      {/* Library drawer */}
      {showLibrary && (
        <div
          className="absolute inset-0 bg-ink/30 z-40 lector-anim-fade"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLibrary(false)
          }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-[300px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-800">{tr('side.library.title')}</h3>
              <button onClick={() => setShowLibrary(false)} aria-label={tr('popup.close')} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="text-center text-[12px] text-slate-400 py-8 px-4">
                  {tr('side.library.empty')}
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    className="group px-3 py-2.5 border-b border-line/60 hover:bg-surface-muted cursor-pointer"
                    onClick={() => openSession(s)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-slate-700 truncate">{s.title}</div>
                        <div className="text-[10px] text-slate-400">{new Date(s.createdAt).toLocaleString()}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeSession(s.id)
                          if (activeSessionId === s.id) startNewChat()
                        }}
                        aria-label="Delete conversation"
                        className="opacity-0 group-hover:opacity-100 text-meta text-ink-faint hover:text-danger"
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
                className="px-3 py-2 text-meta text-ink-faint hover:text-danger border-t border-line"
              >
                {tr('side.library.clearAll')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Highlights drawer */}
      {showHighlights && (
        <Drawer title={tr('side.highlights.title')} onClose={() => setShowHighlights(false)}>
          {highlights.length === 0 ? (
            <Empty text={tr('side.highlights.empty')} />
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                {highlights.map((h) => (
                  <div key={h.id} className="group px-3 py-2.5 border-b border-line/60">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-ink leading-relaxed">{h.text}</div>
                        {h.note && <div className="text-[11px] text-ink-faint mt-1">{h.note}</div>}
                        <div className="text-[10px] text-ink-faint mt-1 truncate">{h.title}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => generateSentenceCard(h.text, h.url, h.title)}
                          title={tr('side.sentences.fromHighlight')}
                          className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent"
                        >
                          <SparklesIcon size={13} />
                        </button>
                        <button
                          onClick={() => removeHighlight(h.id)}
                          aria-label="Delete highlight"
                          className="opacity-0 group-hover:opacity-100 text-meta text-ink-faint hover:text-danger"
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
                className="px-3 py-2 text-meta text-ink-soft hover:text-ink border-t border-line"
              >
                {tr('side.highlights.export')}
              </button>
            </>
          )}
        </Drawer>
      )}

      {/* Vocabulary review drawer */}
      {showVocab && (
        <VocabDrawer
          vocab={vocab}
          revealedVocab={revealedVocab}
          ankiConfig={byok.anki}
          tr={tr}
          onClose={() => setShowVocab(false)}
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

      {/* Templates drawer */}
      {showTemplates && (
        <TemplatesDrawer
          templates={sortedTemplates}
          titleFor={tplTitle}
          tr={tr}
          onClose={() => setShowTemplates(false)}
          onAdd={(t) => addTemplate(t)}
          onUpdate={(id, patch) => updateTemplate(id, patch)}
          onRemove={(id) => removeTemplate(id)}
          onReorder={reorderTemplates}
        />
      )}

      {/* Glossary drawer */}
      {showGlossary && (
        <GlossaryDrawer
          entries={glossary}
          tr={tr}
          onClose={() => setShowGlossary(false)}
          onAdd={(e) => addGlossaryEntry(e)}
          onUpdate={(id, patch) => updateGlossaryEntry(id, patch)}
          onRemove={(id) => removeGlossaryEntry(id)}
          onImport={(entries) => replaceGlossary(entries)}
        />
      )}

      {/* Sentence Library drawer */}
      {showSentences && (
        <SentencesDrawer
          sentences={sentences}
          revealed={revealedSentences}
          tr={tr}
          onClose={() => setShowSentences(false)}
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
          onMakeCard={(sentence, title) => generateSentenceCard(sentence, '', title)}
        />
      )}
    </div>
  )
}
function Drawer({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="absolute inset-0 bg-ink/30 z-40 lector-anim-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="absolute right-0 top-0 bottom-0 w-[300px] bg-white shadow-2xl flex flex-col lector-anim-slide">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
          <h3 className="text-[13px] font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
            <XIcon size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="text-center text-[12px] text-slate-400 py-8 px-4">{text}</div>
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
    <div className="mb-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg lector-anim-fade">
      {templates.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-ink-faint">{emptyText}</div>
      ) : (
        templates.map((tpl, i) => (
          <button
            key={tpl.id}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(tpl)}
            className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors ${
              i === activeIdx ? 'bg-accent-soft' : 'hover:bg-surface-muted'
            }`}
          >
            <span className="text-[12px] font-medium text-ink flex items-center gap-1.5">
              {titleFor(tpl)}
              {tpl.builtIn && (
                <span className="text-[9px] px-1 py-0.5 rounded-full bg-surface-muted text-ink-faint">
                  built-in
                </span>
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
interface VocabDrawerProps {
  vocab: VocabEntry[]
  revealedVocab: Set<string>
  ankiConfig?: { url: string; deckName: string; modelName: string; tags: string[] }
  tr: (key: StringKey) => string
  onClose: () => void
  onToggleReveal: (id: string) => void
  onRemoveVocab: (id: string) => void
  onGradeVocab: (v: VocabEntry, grade: Grade) => void
  /** Persist the user-edited Anki config back into settings. */
  onSaveAnkiConfig: (cfg: { url: string; deckName: string; modelName: string; tags: string[] }) => void
  /** Generate a sentence card from this vocab entry's context sentence. */
  onExplainVocab: (v: VocabEntry) => void
}

function VocabDrawer({
  vocab,
  revealedVocab,
  ankiConfig,
  tr,
  onClose,
  onToggleReveal,
  onRemoveVocab,
  onGradeVocab,
  onSaveAnkiConfig,
  onExplainVocab,
}: VocabDrawerProps) {
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
    <Drawer title={tr('side.vocab.title')} onClose={onClose}>
      {vocab.length > 0 && <StatsBar stats={computeReviewStats(vocab)} tr={tr} />}
      {vocab.length === 0 ? (
        <Empty text={tr('side.vocab.empty')} />
      ) : (
        <>
          {/* Anki export action bar */}
          <div className="px-3 py-2 border-b border-line">
            {!showPanel ? (
              <button
                onClick={() => setShowPanel(true)}
                className="w-full py-2 text-[12px] font-medium rounded-lg border border-dashed border-line text-accent hover:bg-accent-soft flex items-center justify-center gap-1"
              >
                {tr('side.vocab.sendAnki')}
              </button>
            ) : (
              <div className="space-y-2 py-1">
                <div>
                  <label className="block text-[10px] font-semibold text-ink-soft mb-0.5">
                    {tr('side.vocab.ankiUrl')}
                  </label>
                  <input
                    value={cfgUrl}
                    onChange={(e) => setCfgUrl(e.target.value)}
                    className="w-full px-2 py-1.5 text-[11px] bg-bg border border-line rounded-md focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-ink-soft mb-0.5">
                    {tr('side.vocab.ankiDeck')}
                  </label>
                  <input
                    value={cfgDeck}
                    onChange={(e) => setCfgDeck(e.target.value)}
                    className="w-full px-2 py-1.5 text-[11px] bg-bg border border-line rounded-md focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-ink-soft mb-0.5">
                    {tr('side.vocab.ankiModel')}
                  </label>
                  <input
                    value={cfgModel}
                    onChange={(e) => setCfgModel(e.target.value)}
                    className="w-full px-2 py-1.5 text-[11px] bg-bg border border-line rounded-md focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-ink-soft mb-0.5">
                    {tr('side.vocab.ankiTags')}
                  </label>
                  <input
                    value={cfgTags}
                    onChange={(e) => setCfgTags(e.target.value)}
                    placeholder="lector"
                    className="w-full px-2 py-1.5 text-[11px] bg-bg border border-line rounded-md focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="text-[10px] text-ink-faint">
                  {tr('side.vocab.ankiCount').replace('{n}', String(vocab.length))}
                </div>
                {result && (
                  <div className="text-[10px] text-accent leading-relaxed">
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
                    className="flex-1 py-1.5 text-[11px] font-medium rounded-md bg-accent text-accent-on disabled:opacity-50"
                  >
                    {sending ? tr('side.vocab.ankiSending') : tr('side.vocab.ankiSend')}
                  </button>
                  <button
                    onClick={() => {
                      setShowPanel(false)
                      setResult(null)
                    }}
                    className="flex-1 py-1.5 text-[11px] font-medium rounded-md border border-line text-ink-soft hover:bg-surface-muted"
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
                <div key={v.id} className="group px-3 py-2.5 border-b border-line/60">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-semibold ${due ? 'text-accent' : 'text-ink'}`}>
                      {v.word}
                    </span>
                    {due && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
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
                        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent"
                      >
                        <SparklesIcon size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => onRemoveVocab(v.id)}
                      aria-label="Delete word"
                      className="opacity-0 group-hover:opacity-100 text-meta text-ink-faint hover:text-danger"
                    >
                      <XIcon size={15} />
                    </button>
                  </div>
                  {v.context && (
                    <div className="text-[11px] text-ink-faint mt-1 leading-relaxed">{v.context}</div>
                  )}
                  {v.translation && (
                    <button
                      onClick={() => onToggleReveal(v.id)}
                      className="text-[10px] text-accent hover:underline mt-1"
                    >
                      {revealed ? v.translation : tr('side.vocab.showTranslation')}
                    </button>
                  )}
                  {due && (
                    <div className="flex gap-1.5 mt-2">
                      {(['again', 'hard', 'good', 'easy'] as Grade[]).map((g) => (
                        <button
                          key={g}
                          onClick={() => onGradeVocab(v, g)}
                          className="flex-1 py-1.5 text-[10px] font-medium rounded-md border border-line hover:bg-surface-muted text-ink-soft"
                        >
                          {tr(`side.vocab.${g}` as StringKey)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Templates drawer — list, create, edit, delete, drag-reorder
// ---------------------------------------------------------------------------
interface TemplatesDrawerProps {
  templates: PromptTemplate[]
  titleFor: (t: PromptTemplate) => string
  tr: (key: StringKey) => string
  onClose: () => void
  onAdd: (t: { title: string; content: string; titleKey?: StringKey }) => void
  onUpdate: (id: string, patch: Partial<PromptTemplate>) => void
  onRemove: (id: string) => void
  onReorder: (orderedIds: string[]) => void
}

function TemplatesDrawer({
  templates,
  titleFor,
  tr,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
}: TemplatesDrawerProps) {
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
    <Drawer title={tr('side.templates.title')} onClose={onClose}>
      {editing ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <div>
            <label htmlFor="lector-tpl-title" className="block text-[11px] font-semibold text-ink-soft mb-1">
              {tr('side.templates.titleField')}
            </label>
            <input
              id="lector-tpl-title"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              className="w-full px-3 py-2 text-[12px] bg-bg border border-line rounded-lg focus:outline-none focus:border-accent focus:bg-surface"
            />
          </div>
          <div>
            <label htmlFor="lector-tpl-content" className="block text-[11px] font-semibold text-ink-soft mb-1">
              {tr('side.templates.contentField')}
            </label>
            <textarea
              id="lector-tpl-content"
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              rows={6}
              disabled={editing.id ? templates.find((t) => t.id === editing.id)?.builtIn : false}
              className="w-full px-3 py-2 text-[12px] bg-bg border border-line rounded-lg focus:outline-none focus:border-accent focus:bg-surface font-mono resize-none disabled:opacity-60"
            />
            <p className="text-[10px] text-ink-faint mt-1">{tr('side.templates.hint')}</p>
          </div>
          {err && <div className="text-[11px] text-danger">{err}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="flex-1 py-2 text-[12px] font-medium rounded-lg bg-accent text-accent-on"
            >
              {tr('side.templates.save')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="flex-1 py-2 text-[12px] font-medium rounded-lg border border-line text-ink-soft hover:bg-surface-muted"
            >
              {tr('side.templates.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-line">
            <button
              onClick={startNew}
              className="w-full py-2 text-[12px] font-medium rounded-lg border border-dashed border-line text-accent hover:bg-accent-soft flex items-center justify-center gap-1"
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
                  className="group px-3 py-2.5 border-b border-line/60 cursor-grab active:cursor-grabbing"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ink-faint text-[12px] select-none">⋮⋮</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink flex items-center gap-1.5">
                        {titleFor(tpl)}
                        {tpl.builtIn && (
                          <span className="text-[9px] px-1 py-0.5 rounded-full bg-surface-muted text-ink-faint">
                            {tr('side.templates.builtIn')}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-ink-faint truncate">
                        {tpl.content.replace(/\n/g, ' ').slice(0, 60)}
                      </div>
                    </div>
                    <button
                      onClick={() => startEdit(tpl)}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent"
                    >
                      <PencilIcon size={14} />
                    </button>
                    {!tpl.builtIn && (
                      <button
                        onClick={() => onRemove(tpl.id)}
                        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger"
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
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Glossary drawer — list, create, edit, delete, import/export (Feature: 术语表)
// ---------------------------------------------------------------------------
interface GlossaryDrawerProps {
  entries: GlossaryEntry[]
  tr: (key: StringKey) => string
  onClose: () => void
  onAdd: (e: { source: string; target: string; note?: string; enabled: boolean }) => void
  onUpdate: (id: string, patch: Partial<GlossaryEntry>) => void
  onRemove: (id: string) => void
  onImport: (entries: GlossaryEntry[]) => void
}

function GlossaryDrawer({
  entries,
  tr,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
  onImport,
}: GlossaryDrawerProps) {
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
    const json = exportGlossary(entries)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lector-glossary-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    const text = await file.text()
    const res = importGlossary(text)
    if (!res.ok || !res.entries) {
      setFlash(tr('side.glossary.importFail').replace('{msg}', res.reason || ''))
      return
    }
    onImport(res.entries)
    setFlash(tr('side.glossary.importOk').replace('{n}', String(res.entries.length)))
  }

  return (
    <Drawer title={tr('side.glossary.title')} onClose={onClose}>
      {editing ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <div>
            <label htmlFor="lector-glos-source" className="block text-[11px] font-semibold text-ink-soft mb-1">
              {tr('side.glossary.sourceField')}
            </label>
            <input
              id="lector-glos-source"
              value={editing.source}
              onChange={(e) => setEditing({ ...editing, source: e.target.value })}
              placeholder="LLM"
              className="w-full px-3 py-2 text-[12px] bg-bg border border-line rounded-lg focus:outline-none focus:border-accent focus:bg-surface"
            />
          </div>
          <div>
            <label htmlFor="lector-glos-target" className="block text-[11px] font-semibold text-ink-soft mb-1">
              {tr('side.glossary.targetField')}
            </label>
            <input
              id="lector-glos-target"
              value={editing.target}
              onChange={(e) => setEditing({ ...editing, target: e.target.value })}
              placeholder="大语言模型"
              className="w-full px-3 py-2 text-[12px] bg-bg border border-line rounded-lg focus:outline-none focus:border-accent focus:bg-surface"
            />
          </div>
          <div>
            <label htmlFor="lector-glos-note" className="block text-[11px] font-semibold text-ink-soft mb-1">
              {tr('side.glossary.noteField')}
            </label>
            <textarea
              id="lector-glos-note"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 text-[12px] bg-bg border border-line rounded-lg focus:outline-none focus:border-accent focus:bg-surface resize-none"
            />
          </div>
          {err && <div className="text-[11px] text-danger">{err}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="flex-1 py-2 text-[12px] font-medium rounded-lg bg-accent text-accent-on"
            >
              {tr('side.glossary.save')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="flex-1 py-2 text-[12px] font-medium rounded-lg border border-line text-ink-soft hover:bg-surface-muted"
            >
              {tr('side.glossary.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-line space-y-2">
            <button
              onClick={startNew}
              className="w-full py-2 text-[12px] font-medium rounded-lg border border-dashed border-line text-accent hover:bg-accent-soft flex items-center justify-center gap-1"
            >
              <PlusIcon size={14} />
              {tr('side.glossary.add')}
            </button>
            {entries.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="flex-1 py-1.5 text-[11px] font-medium rounded-lg border border-line text-ink-soft hover:bg-surface-muted flex items-center justify-center gap-1"
                >
                  <DownloadIcon size={12} />
                  {tr('side.glossary.export')}
                </button>
                <label className="flex-1 py-1.5 text-[11px] font-medium rounded-lg border border-line text-ink-soft hover:bg-surface-muted flex items-center justify-center gap-1 cursor-pointer">
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
            {flash && <div className="text-[10px] text-accent text-center">{flash}</div>}
            <p className="text-[10px] text-ink-faint leading-relaxed">{tr('side.glossary.hint')}</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <Empty text={tr('side.glossary.empty')} />
            ) : (
              entries.map((e) => (
                <div key={e.id} className="group px-3 py-2.5 border-b border-line/60">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onUpdate(e.id, { enabled: !e.enabled })}
                      title={e.enabled ? tr('side.glossary.enabled') : tr('side.glossary.disabled')}
                      className={`w-3 h-3 rounded-full border flex-shrink-0 ${
                        e.enabled
                          ? 'bg-accent border-accent'
                          : 'bg-transparent border-line'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink truncate">
                        {e.source} <span className="text-ink-faint">→</span> {e.target}
                      </div>
                      {e.note && (
                        <div className="text-[10px] text-ink-faint truncate">{e.note}</div>
                      )}
                    </div>
                    <button
                      onClick={() => startEdit(e)}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent"
                    >
                      <PencilIcon size={14} />
                    </button>
                    <button
                      onClick={() => onRemove(e.id)}
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger"
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
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// BYOK Settings drawer
// ---------------------------------------------------------------------------
interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  byok: ByokSettings
  onChange: (patch: Partial<ByokSettings>) => void
}

function SettingsDrawer({ open, onClose, byok, onChange }: SettingsDrawerProps) {
  const [showKey, setShowKey] = useState(false)
  const [customModel, setCustomModel] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const def = getProvider(byok.provider)

  const handleProviderChange = (id: ProviderId) => {
    const next = getProvider(id)
    const isCustom = id === 'custom' || id === 'openrouter-custom'
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
    // The store persists async; test against the latest local view.
    const result = await testConnection({ ...byok })
    setTestResult(result)
    setTesting(false)
  }

  const runFetch = async () => {
    setFetching(true)
    setFetchError(null)
    try {
      const models = await fetchModels({ ...byok })
      setFetchedModels(models)
      if (models.length > 0) {
        // If the current model isn't in the fetched list, snap to the first.
        if (!models.some((m) => m.id === byok.model)) {
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

  if (!open) return null

  return (
    <div
      className="absolute inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white w-full max-w-[340px] rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800">{t('settings.title', byok.locale)}</h2>
          <button onClick={onClose} aria-label={t('popup.close', byok.locale)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {t('settings.privacyNote', byok.locale)}
          </p>

          {/* Language */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
              {t('settings.language', byok.locale)}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['auto', 'en', 'zh'] as LocalePref[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => onChange({ locale: opt })}
                  className={`px-2 py-2 text-[11px] font-medium rounded-lg border transition-colors ${
                    byok.locale === opt
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
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
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">{t('settings.provider', byok.locale)}</label>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.values(PROVIDERS).map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`px-2 py-2 text-[11px] font-medium rounded-lg border transition-colors ${
                    byok.provider === p.id
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">{def.description}</p>
          </div>

          {/* Custom base URL */}
          {(byok.provider === 'custom' || byok.provider === 'openrouter-custom') && (
            <div>
              <label htmlFor="lector-base-url" className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                {t('settings.baseUrl', byok.locale)} <span className="text-slate-400 font-normal">{t('settings.baseUrl.hint', byok.locale)}</span>
              </label>
              <input
                id="lector-base-url"
                type="url"
                value={byok.baseUrl}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="w-full px-3 py-2 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-accent focus:bg-white"
              />
            </div>
          )}

          {/* API key */}
          <div>
            <label htmlFor="lector-api-key" className="block text-[11px] font-semibold text-slate-600 mb-1.5">{t('settings.apiKey', byok.locale)}</label>
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
                className="w-full px-3 py-2 pr-16 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-accent focus:bg-white font-mono"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600 px-1.5 py-0.5"
              >
                {showKey ? t('settings.apiKey.hide', byok.locale) : t('settings.apiKey.show', byok.locale)}
              </button>
            </div>
            {def.keyUrl && (
              <a
                href={def.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1 text-[10px] text-accent hover:underline"
              >
                {t('settings.apiKey.getKey', byok.locale).replace('{label}', def.label)}
              </a>
            )}
          </div>

          {/* Model picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="lector-model" className="block text-[11px] font-semibold text-slate-600">{t('settings.model', byok.locale)}</label>
              <button
                onClick={runFetch}
                disabled={fetching || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
                title={t('settings.model.fetch', byok.locale)}
                className="text-[10px] text-accent hover:text-accent-hover disabled:opacity-40"
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
                    value={currentInList ? byok.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomModel(byok.model)
                        onChange({ model: customModel || def.defaultModel })
                      } else {
                        onChange({ model: e.target.value })
                      }
                    }}
                    className="w-full px-3 py-2 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-accent focus:bg-white"
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
              <div className="mt-1 text-[10px] text-amber-600">{fetchError}</div>
            )}
            {fetchedModels && fetchedModels.length > 0 && (
              <div className="mt-1 text-[10px] text-slate-400">{t('settings.model.fetchedCount', byok.locale).replace('{n}', String(fetchedModels.length))}</div>
            )}

            {/* Free-text input: when custom selected, or no list matches. */}
            {!(
              (fetchedModels && fetchedModels.length > 0 ? fetchedModels : def.models).some((m) => m.id === byok.model)
            ) && (
              <input
                type="text"
                aria-label={t('settings.model', byok.locale)}
                value={byok.model}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder={def.defaultModel || 'model id, e.g. gpt-4o-mini'}
                className="w-full mt-1.5 px-3 py-2 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-accent focus:bg-white font-mono"
              />
            )}
          </div>

          {/* Test connection */}
          <div className="pt-1">
            <button
              onClick={runTest}
              disabled={testing || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
              className="w-full py-2 text-[12px] font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              {testing ? t('settings.testing', byok.locale) : t('settings.test', byok.locale)}
            </button>
            {testResult && (
              <div
                className={`mt-1.5 text-[11px] px-2 py-1.5 rounded-lg ${
                  testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                }`}
              >
                {testResult.ok ? '✓ ' : '✕ '}
                {testResult.message}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-accent text-accent-on rounded-lg text-[13px] font-semibold"
          >
            {t('settings.done', byok.locale)}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sentence Library drawer — paste-to-generate, search, group, SRS review
// ---------------------------------------------------------------------------
interface SentencesDrawerProps {
  sentences: SentenceCard[]
  revealed: Set<string>
  tr: (key: StringKey) => string
  onClose: () => void
  onToggleReveal: (id: string) => void
  onRemove: (id: string) => void
  onPromote: (id: string) => void
  onGrade: (c: SentenceCard, grade: Grade) => void
  onViewSource: (blockId: string | undefined, url: string) => void
  /** Batch-export the given cards to Anki (caller resolves config + deck). */
  onAnkiExport: (cards: SentenceCard[]) => void
  onMakeCard: (sentence: string, title: string) => void
}

function SentencesDrawer(props: SentencesDrawerProps) {
  const { sentences, revealed, tr, onClose } = props
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
    const json = exportSentences(sentences)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lector-sentences.json'
    a.click()
    URL.revokeObjectURL(url)
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
    <Drawer title={tr('side.sentences.title')} onClose={onClose}>
      {sentences.filter((c) => c.srs).length > 0 && (
        <StatsBar stats={computeReviewStats(sentences)} tr={tr} />
      )}
      {sentences.length === 0 && !pasteText ? (
        <>
          <div className="px-3 py-2 border-b border-line">
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
          <div className="px-3 py-2 border-b border-line space-y-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('side.sentences.search')}
              className="w-full px-2 py-1.5 text-[12px] bg-bg border border-line rounded-md focus:outline-none focus:border-accent"
            />
            <select
              value={cefrFilter}
              onChange={(e) => setCefrFilter(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] bg-bg border border-line rounded-md focus:outline-none focus:border-accent"
              aria-label={tr('side.sentences.filterAll')}
            >
              <option value="">{tr('side.sentences.filterAll')}</option>
              {(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map((lvl) => (
                <option key={lvl} value={lvl}>{lvl}</option>
              ))}
            </select>
            <PasteBox
              value={pasteText}
              onChange={setPasteText}
              onGenerate={handleGenerate}
              generating={generating}
              tr={tr}
            />
            {importMsg && <ImportMsg msg={importMsg} />}
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="flex-1 py-1.5 text-[11px] font-medium rounded-md border border-line text-ink-soft hover:bg-surface-muted flex items-center justify-center gap-1"
              >
                <DownloadIcon size={12} /> {tr('side.sentences.export')}
              </button>
              <label className="flex-1 py-1.5 text-[11px] font-medium rounded-md border border-line text-ink-soft hover:bg-surface-muted flex items-center justify-center gap-1 cursor-pointer text-center">
                <UploadIcon size={12} /> {tr('side.sentences.import')}
                <input type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
              </label>
              <button
                onClick={() => props.onAnkiExport(filtered)}
                className="flex-1 py-1.5 text-[11px] font-medium rounded-md border border-line text-ink-soft hover:bg-surface-muted flex items-center justify-center gap-1"
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
                  <div className="px-3 py-1.5 bg-surface-muted text-[10px] font-medium text-ink-faint sticky top-0">
                    {title || tr('side.sentences.pasteTitle')}
                  </div>
                  {cards.map((c) => {
                    const due = c.srs ? isDue(c.srs) : false
                    const isRevealed = revealed.has(c.id)
                    return (
                      <div key={c.id} className="group px-3 py-2.5 border-b border-line/60">
                        <div className="flex items-center gap-2">
                          <span className={`text-[12px] font-semibold ${due ? 'text-accent' : 'text-ink'}`}>
                            {c.sentence}
                          </span>
                          {due && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                              {tr('side.sentences.due')}
                            </span>
                          )}
                          {c.cefr && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-ink/10 text-ink-soft font-medium">
                              {c.cefr}
                            </span>
                          )}
                          {c.srs && (
                            <span className="text-[10px] text-ink-faint">
                              {c.srs.reps} {tr('side.sentences.reviews')}
                            </span>
                          )}
                          <div className="ml-auto flex items-center gap-1">
                            {c.blockId || c.url ? (
                              <button
                                onClick={() => props.onViewSource(c.blockId, c.url)}
                                title={tr('side.sentences.viewSource')}
                                className="text-ink-faint hover:text-accent"
                              >
                                <SparklesIcon size={13} />
                              </button>
                            ) : null}
                            <button
                              onClick={() => (c.srs ? undefined : props.onPromote(c.id))}
                              className={`text-[10px] ${c.srs ? 'text-accent' : 'text-ink-faint hover:text-accent'}`}
                            >
                              {c.srs ? tr('side.sentences.inReview') : tr('side.sentences.addToReview')}
                            </button>
                            <button
                              onClick={() => props.onAnkiExport([c])}
                              title={tr('side.sentences.toAnkiOne')}
                              className="text-ink-faint hover:text-accent"
                            >
                              <DownloadIcon size={13} />
                            </button>
                            <button
                              onClick={() => props.onRemove(c.id)}
                              aria-label={tr('side.sentences.remove')}
                              className="text-ink-faint hover:text-danger"
                            >
                              <XIcon size={15} />
                            </button>
                          </div>
                        </div>
                        {(c.translation || c.analysis) && (
                          <button
                            onClick={() => props.onToggleReveal(c.id)}
                            className="text-[10px] text-accent hover:underline mt-1"
                          >
                            {isRevealed ? tr('side.sentences.hideAnalysis') : tr('side.sentences.showAnalysis')}
                          </button>
                        )}
                        {isRevealed && (c.translation || c.analysis) && (
                          <div
                            className="lector-prose mt-2 text-[11px] leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(c.analysis || c.translation) }}
                          />
                        )}
                        {isRevealed && extractExamples(c.analysis).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {extractExamples(c.analysis).map((ex, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px]">
                                <span className="text-ink-soft flex-1">{ex}</span>
                                <button
                                  onClick={() => props.onMakeCard(ex, c.title)}
                                  title={tr('side.sentences.makeCard')}
                                  className="text-accent hover:underline text-[10px] flex-shrink-0"
                                >
                                  {tr('side.sentences.makeCard')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {due && c.srs && (
                          <div className="flex gap-1.5 mt-2">
                            {(['again', 'hard', 'good', 'easy'] as Grade[]).map((g) => (
                              <button
                                key={g}
                                onClick={() => props.onGrade(c, g)}
                                className="flex-1 py-1.5 text-[10px] font-medium rounded-md border border-line hover:bg-surface-muted text-ink-soft"
                              >
                                {tr(`side.vocab.${g}` as StringKey)}
                              </button>
                            ))}
                          </div>
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
    </Drawer>
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
        className="w-full px-2 py-1.5 text-[12px] bg-bg border border-line rounded-md focus:outline-none focus:border-accent resize-none"
      />
      <button
        onClick={onGenerate}
        disabled={generating}
        className="w-full py-1.5 text-[11px] font-medium rounded-md bg-accent text-accent-on disabled:opacity-50"
      >
        {generating ? tr('side.sentences.generating') : tr('side.sentences.pasteGenerate')}
      </button>
    </div>
  )
}

function ImportMsg({ msg }: { msg: { ok: boolean; text: string } }) {
  return (
    <div className={`text-[10px] ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</div>
  )
}

// Compact 4-metric stats bar shown at the top of the SentencesDrawer and
// VocabDrawer. Renders the aggregated review stats (due / mastered / reviews /
// retention) computed from the drawer's items.
function StatsBar({ stats, tr }: { stats: ReviewStats; tr: (key: StringKey) => string }) {
  const Cell = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex flex-col items-center">
      <span className="text-[15px] font-bold text-accent leading-tight">{value}</span>
      <span className="text-[9px] text-ink-faint">{label}</span>
    </div>
  )
  return (
    <div className="flex justify-around px-3 py-2 border-b border-line">
      <Cell label={tr('stats.due')} value={stats.due} />
      <Cell label={tr('stats.mastered')} value={stats.mastered} />
      <Cell label={tr('stats.reviews')} value={stats.totalReviews} />
      <Cell label={tr('stats.retention')} value={stats.avgEase.toFixed(1)} />
    </div>
  )
}
