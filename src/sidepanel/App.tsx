import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, type ChatMessage, type ChatSession } from '../shared/store'
import { getApiBase } from '../shared/config'
import { renderMarkdown } from './markdown'
import { renderCitations, type PageBlock } from '../shared/citations'
import { isDue } from '../shared/srs'
import { toMarkdown } from '../shared/exporters'
import type { Highlight } from '../shared/highlights'
import type { VocabEntry } from '../shared/vocabulary'
import { scheduleSrs, type Grade } from '../shared/srs'

interface PageContext {
  title: string
  url: string
  text: string
  lang: string
  blocks: PageBlock[]
}

interface StreamState {
  remaining: number | null
  error: string | null
}

const SUGGESTIONS = [
  { label: '总结全文', prompt: 'Summarize this page in 3-5 bullets and a one-line takeaway.' },
  { label: '关键观点', prompt: 'What are the 3 most important points the author is making?' },
  { label: '解释难点', prompt: 'Explain the most difficult concept on this page simply, with an example.' },
  { label: '继续追问', prompt: 'What questions should I ask myself to test my understanding of this page?' },
]

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export default function App() {
  const {
    user,
    accessToken,
    isPro,
    sessions,
    addSession,
    updateSession,
    removeSession,
    clearSessions,
    logout,
    setPro,
    setUser,
  } = useStore()
  const highlights = useStore((s) => s.highlights)
  const vocab = useStore((s) => s.vocab)
  const addHighlight = useStore((s) => s.addHighlight)
  const removeHighlight = useStore((s) => s.removeHighlight)
  const updateVocabSrs = useStore((s) => s.updateVocabSrs)

  const [page, setPage] = useState<PageContext | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [stream, setStream] = useState<StreamState>({ remaining: null, error: null })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showHighlights, setShowHighlights] = useState(false)
  const [showVocab, setShowVocab] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const assistantBuf = useRef<string>('')

  // Valid citation ids = the current page's block ids. Used to whitelist chips.
  const validCiteIds = new Set((page?.blocks ?? []).map((b) => b.id))

  // Load page context + any seed from the content script.
  useEffect(() => {
    ;(async () => {
      // Restore auth from chrome.storage (popup path already does this; side
      // panel shares the same storage).
      try {
        const stored = await chrome.storage.local.get(['user', 'accessToken'])
        if (stored.user) {
          const u = JSON.parse(stored.user as string)
          setUser(u, stored.accessToken as string | undefined)
          if (stored.accessToken) {
            const apiBase = await getApiBase()
            const r = await fetch(`${apiBase}/auth/me`, {
              headers: { Authorization: `Bearer ${stored.accessToken}` },
            })
            if (r.ok) {
              const d = await r.json()
              setPro(d.isPro || false)
            }
          }
        }
      } catch {
        // ignore
      }

      // Pull the page from the active tab's content script.
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

      // Read any seed the background script stashed.
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
  }, [setPro, setUser])

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
        // Drain the relay queue so we don't re-add on every change.
        chrome.storage.local.remove('lectorHighlights')
      }
      if (changes.lectorVocab) {
        // Vocab entries arrive with full SRS state from the background relay.
        const list = (changes.lectorVocab.newValue as unknown as VocabEntry[]) || []
        // Merge each into the store via addVocab (dedupe + preserve srs).
        const addVocab = useStore.getState().addVocab
        for (const v of list) addVocab(v)
        chrome.storage.local.remove('lectorVocab')
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => chrome.storage.onChanged.removeListener(onStorage)
  }, [addHighlight])

  // Autoscroll on new tokens.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  const handleSend = useCallback(
    async (overrideInput?: string) => {
      const text = (overrideInput ?? input).trim()
      if (!text || streaming) return

      const userMsg: ChatMessage = { id: newId(), role: 'user', content: text }
      const assistantMsg: ChatMessage = { id: newId(), role: 'assistant', content: '' }
      const next = [...messages, userMsg]
      setMessages([...next, assistantMsg])
      setInput('')
      setStreaming(true)
      setStream({ remaining: null, error: null })
      assistantBuf.current = ''

      try {
        const apiBase = await getApiBase()
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`

        const history = next
          .filter((m) => m.content.trim().length > 0)
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content }))

        const res = await fetch(`${apiBase}/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: text,
            pageContent: page?.text,
            pageMetadata: { url: page?.url, title: page?.title },
            pageBlocks: page?.blocks,
            history,
          }),
        })

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}))
          setStream({ remaining: 0, error: data.message || 'Daily free limit reached.' })
          setStreaming(false)
          setMessages((cur) =>
            cur.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: `⏸️ ${data.message || 'Daily free limit reached.'}\n\nSign in or upgrade to Pro for more.` }
                : m
            )
          )
          return
        }
        if (!res.ok || !res.body) {
          setStream({ remaining: null, error: 'Service unavailable.' })
          setStreaming(false)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith('data:')) continue
            const payload = t.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const evt = JSON.parse(payload)
              if (evt.type === 'token' && typeof evt.delta === 'string') {
                assistantBuf.current += evt.delta
                const snapshot = assistantBuf.current
                setMessages((cur) =>
                  cur.map((m) => (m.id === assistantMsg.id ? { ...m, content: snapshot } : m))
                )
              } else if (evt.type === 'meta' && typeof evt.remaining === 'number') {
                setStream((s) => ({ ...s, remaining: evt.remaining }))
              } else if (evt.type === 'error') {
                setStream((s) => ({ ...s, error: evt.error }))
              }
            } catch {
              // partial JSON, ignore
            }
          }
        }

        // Persist the conversation to the library.
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
        setStream({ remaining: null, error: 'Network error.' })
        setMessages((cur) =>
          cur.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: '⚠️ Network error. Please retry.' }
              : m
          )
        )
      } finally {
        setStreaming(false)
      }
    },
    [input, streaming, messages, accessToken, page, activeSessionId, addSession, updateSession]
  )

  const startNewChat = () => {
    setMessages([])
    setActiveSessionId(null)
    setStream({ remaining: null, error: null })
  }

  const openSession = (s: ChatSession) => {
    setMessages(s.messages)
    setActiveSessionId(s.id)
    setShowLibrary(false)
  }

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
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
    try {
      const apiBase = await getApiBase()
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      })
      const data = await response.json()
      if (!response.ok) {
        setAuthError(data.error || 'Authentication failed')
        return
      }
      if (authMode === 'login') {
        setUser({ id: data.user.id, email: data.user.email }, data.accessToken)
        const me = await fetch(`${apiBase}/auth/me`, {
          headers: { Authorization: `Bearer ${data.accessToken}` },
        })
        if (me.ok) {
          const d = await me.json()
          setPro(d.isPro || false)
        }
        setShowAuth(false)
      } else {
        setAuthError('Account created! Please log in.')
        setAuthMode('login')
      }
    } catch {
      setAuthError('Network error. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const remainingLabel =
    isPro || stream.remaining === null
      ? ''
      : `${stream.remaining} free left today`

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2.5 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white font-bold flex items-center justify-center text-sm flex-shrink-0">
            L
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-800 truncate">
              {page?.title || 'Lector AI'}
            </div>
            {page?.url && (
              <div className="text-[10px] text-slate-400 truncate max-w-[220px]">
                {page.url}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isPro && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white">
              Pro
            </span>
          )}
          <button
            onClick={() => setShowLibrary(true)}
            title="Library"
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
          >
            📚
          </button>
          <button
            onClick={() => setShowHighlights(true)}
            title="Highlights"
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm relative"
          >
            🔖
            {highlights.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>
          <button
            onClick={() => setShowVocab(true)}
            title="Vocabulary"
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm relative"
          >
            ★
            {vocab.some((v) => isDue(v.srs)) && (
              <span className="lector-due-badge absolute -top-0.5 -right-1">!</span>
            )}
          </button>
          {user ? (
            <button
              onClick={() => {
                logout()
                startNewChat()
              }}
              title="Sign out"
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
            >
              ⎋
            </button>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white font-bold flex items-center justify-center text-xl mx-auto mb-3">
              L
            </div>
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Chat with this page</h2>
            <p className="text-xs text-slate-400 mb-5 px-6">
              Ask anything about the article you're reading. Lector reads the page with you.
            </p>
            <div className="grid grid-cols-2 gap-2 px-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => handleSend(s.prompt)}
                  disabled={!page}
                  className="px-3 py-2.5 text-left text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
            {!page && (
              <p className="text-[11px] text-amber-600 mt-4 px-6">
                Open a web article, then Lector can read along.
              </p>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.role === 'user' ? (
              <div className="max-w-[85%] px-3 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-[13px] rounded-2xl rounded-br-md whitespace-pre-wrap break-words">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[92%] px-3.5 py-2.5 bg-white border border-slate-200 rounded-2xl rounded-bl-md shadow-sm">
                {m.content ? (
                  <div
                    className="lector-prose"
                    dangerouslySetInnerHTML={{
                      __html: renderCitations(renderMarkdown(m.content), validCiteIds),
                    }}
                    onClick={(e) => {
                      const target = e.target as HTMLElement
                      const cite = target.closest('[data-cite]') as HTMLElement | null
                      if (!cite) return
                      const blockId = cite.getAttribute('data-cite') || ''
                      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        const tabId = tabs[0]?.id
                        if (tabId !== undefined) {
                          chrome.tabs.sendMessage(
                            tabId,
                            { action: 'lector-jump-to', blockId },
                            () => {
                              void chrome.runtime.lastError
                            }
                          )
                        }
                      })
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-2 text-[12px] text-slate-400">
                    <div className="w-3 h-3 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                    thinking…
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="px-3 py-2.5 bg-white border-t border-slate-200">
        {stream.error && (
          <div className="text-[11px] text-red-500 mb-1.5 px-1">{stream.error}</div>
        )}
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
            placeholder="Ask about this page…"
            rows={1}
            className="flex-1 max-h-32 resize-none px-3 py-2 text-[13px] bg-slate-50 border border-transparent rounded-xl focus:outline-none focus:border-blue-400 focus:bg-white"
          />
          <button
            onClick={() => handleSend()}
            disabled={streaming || !input.trim()}
            className="w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center disabled:opacity-40"
          >
            {streaming ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <span className="text-sm">↑</span>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-slate-400">
            {remainingLabel || 'Enter to send · Shift+Enter for newline'}
          </span>
          {messages.length > 0 && (
            <button
              onClick={startNewChat}
              className="text-[10px] text-slate-400 hover:text-slate-600"
            >
              + New chat
            </button>
          )}
        </div>
      </div>

      {/* Library drawer */}
      {showLibrary && (
        <div
          className="absolute inset-0 bg-black/30 z-40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLibrary(false)
          }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-[300px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-800">Library</h3>
              <button
                onClick={() => setShowLibrary(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="text-center text-[12px] text-slate-400 py-8 px-4">
                  Saved conversations will appear here.
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    className="group px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => openSession(s)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-slate-700 truncate">
                          {s.title}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(s.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeSession(s.id)
                          if (activeSessionId === s.id) startNewChat()
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[11px] text-slate-400 hover:text-red-500"
                      >
                        ✕
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
                className="px-3 py-2 text-[11px] text-slate-400 hover:text-red-500 border-t border-slate-200"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Highlights drawer (Feature ②) */}
      {showHighlights && (
        <div
          className="absolute inset-0 bg-black/30 z-40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowHighlights(false)
          }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-[320px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-800">
                Highlights
                <span className="text-[10px] font-normal text-slate-400 ml-1">
                  ({highlights.length})
                </span>
              </h3>
              <button
                onClick={() => setShowHighlights(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {highlights.length === 0 ? (
                <div className="text-center text-[12px] text-slate-400 py-8 px-4">
                  Select text on any page and click 🔖 to capture highlights.
                </div>
              ) : (
                highlights.map((h) => (
                  <div key={h.id} className="group px-3 py-2.5 border-b border-slate-100">
                    <div className="text-[11px] text-slate-400 truncate mb-0.5">{h.title}</div>
                    <div className="text-[12px] text-slate-700 leading-snug">{h.text}</div>
                    {h.note && <div className="text-[11px] text-slate-500 mt-0.5">{h.note}</div>}
                    <button
                      onClick={() => removeHighlight(h.id)}
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-red-500 mt-1"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            {highlights.length > 0 && (
              <button
                onClick={() => downloadMarkdown(highlights)}
                className="px-3 py-2 text-[11px] text-blue-600 hover:text-blue-800 border-t border-slate-200"
              >
                Export Markdown
              </button>
            )}
          </div>
        </div>
      )}

      {/* Vocab drawer (Feature ③) */}
      {showVocab && (
        <div
          className="absolute inset-0 bg-black/30 z-40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowVocab(false)
          }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-[320px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-800">
                Vocabulary
                <span className="lector-due-badge">
                  {vocab.filter((v) => isDue(v.srs)).length}
                </span>
              </h3>
              <button
                onClick={() => setShowVocab(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {vocab.length === 0 ? (
                <div className="text-center text-[12px] text-slate-400 py-8 px-4">
                  Select a word on any page and click ★ to save it for review.
                </div>
              ) : (
                vocab.slice(0, 200).map((v) => {
                  const due = isDue(v.srs)
                  return (
                    <div key={v.id} className="px-3 py-2.5 border-b border-slate-100">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-medium text-slate-800">{v.word}</div>
                        {due && <span className="text-[9px] text-red-500 font-medium">due</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 italic mt-0.5">{v.context}</div>
                      {revealed === v.id ? (
                        <div className="text-[12px] text-slate-700 mt-1">
                          {v.translation || '(no translation yet)'}
                        </div>
                      ) : (
                        <button
                          onClick={() => setRevealed(v.id)}
                          className="text-[10px] text-blue-500 mt-1"
                        >
                          Show translation
                        </button>
                      )}
                      {due && revealed === v.id && (
                        <div className="flex gap-1 mt-2">
                          {(['again', 'hard', 'good', 'easy'] as const).map((g) => (
                            <button
                              key={g}
                              onClick={() => gradeVocab(v, g)}
                              className="flex-1 py-1 text-[10px] rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Auth modal */}
      {showAuth && (
        <div
          className="absolute inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAuth(false)
          }}
        >
          <div className="bg-white w-full max-w-[300px] p-4 rounded-2xl shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-bold text-slate-800">
                {authMode === 'login' ? 'Welcome back' : 'Create account'}
              </h2>
              <button
                onClick={() => setShowAuth(false)}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAuth} className="space-y-3">
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-transparent rounded-lg focus:outline-none focus:border-blue-400 focus:bg-white"
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-transparent rounded-lg focus:outline-none focus:border-blue-400 focus:bg-white"
              />
              {authError && <p className="text-[11px] text-red-500 text-center">{authError}</p>}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-[13px] font-semibold disabled:opacity-50"
              >
                {authLoading ? 'Please wait…' : authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
            <button
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login')
                setAuthError('')
              }}
              className="block mx-auto mt-3 text-[11px] text-blue-500 hover:text-blue-700"
            >
              {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
