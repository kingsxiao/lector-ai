import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { useStore, type ChatMessage, type ChatSession } from '../shared/store'
import { renderMarkdown } from './markdown'
import { renderCitations, type PageBlock } from '../shared/citations'
import { isDue, scheduleSrs, type Grade } from '../shared/srs'
import { toMarkdown } from '../shared/exporters'
import type { Highlight } from '../shared/highlights'
import type { VocabEntry } from '../shared/vocabulary'
import {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon,
  SendIcon, XIcon,
} from '../shared/icons'
import {
  PROVIDERS,
  getProvider,
  type ProviderId,
  type ByokSettings,
} from '../shared/providers'
import { streamChat, getSettings, saveSettings, testConnection, fetchModels, type ChatMessage as WireMessage, type FetchedModel } from '../shared/byok'
import { t, type StringKey, type LocalePref } from '../shared/i18n'

interface PageContext {
  title: string
  url: string
  text: string
  lang: string
  blocks: PageBlock[]
}

const SUGGESTIONS: { label: StringKey; prompt: string }[] = [
  { label: 'side.suggest.summarize', prompt: 'Summarize this page in 3-5 bullets and a one-line takeaway.' },
  { label: 'side.suggest.keyPoints', prompt: 'What are the 3 most important points the author is making?' },
  { label: 'side.suggest.explain', prompt: 'Explain the most difficult concept on this page simply, with an example.' },
  { label: 'side.suggest.followup', prompt: 'What questions should I ask myself to test my understanding of this page?' },
]

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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

  const tr = (key: StringKey) => t(key, byok.locale)

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
  const [revealedVocab, setRevealedVocab] = useState<Set<string>>(new Set())
  const [bilingualBusy, setBilingualBusy] = useState(false)

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
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [addHighlight])

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

  // Inline bilingual translation — ask the active tab's content script to
  // inject paragraph-level translations. The content script tracks which
  // blocks it has already translated, so repeated toggles add new ones.
  const toggleBilingual = async () => {
    if (bilingualBusy) return
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return
      setBilingualBusy(true)
      await new Promise<void>((resolve) => {
        chrome.tabs.sendMessage(tab.id!, { action: 'lector-toggle-bilingual' }, () => {
          void chrome.runtime.lastError
          resolve()
        })
      })
    } finally {
      setBilingualBusy(false)
    }
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
"""`

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
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
          >
            <LibraryIcon />
          </button>
          <button
            onClick={() => setShowHighlights(true)}
            title="Highlights"
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
            className="lector-focus w-8 h-8 rounded-lg hover:bg-surface-muted text-ink-soft flex items-center justify-center relative"
          >
            <BookOpenIcon />
            {vocab.some((v) => isDue(v.srs)) && (
              <span className="lector-due-badge absolute -top-0.5 -right-1">!</span>
            )}
          </button>
          <button
            onClick={toggleBilingual}
            disabled={!page || bilingualBusy}
            title={page ? 'Translate page paragraphs (bilingual)' : 'Open a page first'}
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
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {!providerConfigured && (
          <div className="mx-1 p-3 rounded-xl bg-blue-50 border border-blue-100 text-[12px] text-blue-700">
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
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => handleSend(s.prompt)}
                  disabled={!page || !providerConfigured}
                  className="px-3 py-2.5 text-left text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  {tr(s.label)}
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
                    <div className="w-3 h-3 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
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
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
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
            className="w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center disabled:opacity-40"
          >
            {streaming ? (
              <div className="w-3.5 h-3.5 border-2 border-accent-on/40 border-t-accent-on rounded-full animate-spin" />
            ) : (
              <SendIcon size={16} />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-slate-400">{tr('side.composer.hint')}</span>
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
          await saveSettings({ ...byok, ...next })
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
              <button onClick={() => setShowLibrary(false)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
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
                      <button
                        onClick={() => removeHighlight(h.id)}
                        className="opacity-0 group-hover:opacity-100 text-meta text-ink-faint hover:text-danger"
                      >
                        <XIcon size={15} />
                      </button>
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
        <Drawer title={tr('side.vocab.title')} onClose={() => setShowVocab(false)}>
          {vocab.length === 0 ? (
            <Empty text={tr('side.vocab.empty')} />
          ) : (
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
                      <button
                        onClick={() => removeVocab(v.id)}
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
                        onClick={() => toggleReveal(v.id)}
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
                            onClick={() => gradeVocab(v, g)}
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
          )}
        </Drawer>
      )}
    </div>
  )
}

// --- small helpers used by the drawers --------------------------------------
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
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
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
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
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
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
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
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
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
              <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                {t('settings.baseUrl', byok.locale)} <span className="text-slate-400 font-normal">{t('settings.baseUrl.hint', byok.locale)}</span>
              </label>
              <input
                type="url"
                value={byok.baseUrl}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="w-full px-3 py-2 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:bg-white"
              />
            </div>
          )}

          {/* API key */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">{t('settings.apiKey', byok.locale)}</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={byok.apiKey}
                onChange={(e) => {
                  onChange({ apiKey: e.target.value })
                  setTestResult(null)
                }}
                placeholder={t('settings.apiKey.placeholder', byok.locale)}
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-2 pr-16 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:bg-white font-mono"
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
                className="inline-block mt-1 text-[10px] text-blue-500 hover:underline"
              >
                {t('settings.apiKey.getKey', byok.locale).replace('{label}', def.label)}
              </a>
            )}
          </div>

          {/* Model picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-semibold text-slate-600">{t('settings.model', byok.locale)}</label>
              <button
                onClick={runFetch}
                disabled={fetching || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
                title={t('settings.model.fetch', byok.locale)}
                className="text-[10px] text-blue-500 hover:text-blue-700 disabled:opacity-40"
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
                    value={currentInList ? byok.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomModel(byok.model)
                        onChange({ model: customModel || def.defaultModel })
                      } else {
                        onChange({ model: e.target.value })
                      }
                    }}
                    className="w-full px-3 py-2 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:bg-white"
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
                value={byok.model}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder={def.defaultModel || 'model id, e.g. gpt-4o-mini'}
                className="w-full mt-1.5 px-3 py-2 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:bg-white font-mono"
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
            className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-[13px] font-semibold"
          >
            {t('settings.done', byok.locale)}
          </button>
        </div>
      </div>
    </div>
  )
}
