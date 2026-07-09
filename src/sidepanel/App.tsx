import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, type ChatMessage, type ChatSession } from '../shared/store'
import { renderMarkdown } from './markdown'
import {
  PROVIDERS,
  getProvider,
  type ProviderId,
  type ByokSettings,
} from '../shared/providers'
import { streamChat, getSettings, saveSettings, testConnection, fetchModels, type ChatMessage as WireMessage, type FetchedModel } from '../shared/byok'

interface PageContext {
  title: string
  url: string
  text: string
  lang: string
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
  const { byok, setByok, sessions, addSession, updateSession, removeSession, clearSessions } =
    useStore()

  const [page, setPage] = useState<PageContext | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  const handleSend = useCallback(
    async (overrideInput?: string) => {
      const text = (overrideInput ?? input).trim()
      if (!text || streaming) return

      if (!byok.apiKey) {
        setError('Add your API key in Settings to start chatting.')
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
        const systemPrompt = `You are Lector AI, a sharp reading companion embedded in the user's browser.

You answer questions about the article the user is reading, summarize, explain
concepts, translate, and draft. Be concise and information-dense. Use Markdown.
When the user asks about "the article", reason only from the provided PAGE
CONTENT; if it isn't covered there, say so rather than guessing.

${page?.title ? `PAGE TITLE: ${page.title}` : ''}
${page?.url ? `PAGE URL: ${page.url}` : ''}

PAGE CONTENT (cleaned):
"""
${(page?.text || '').slice(0, 12000)}
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
            <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
              {providerConfigured
                ? `${getProvider(byok.provider).label} · ${byok.model || 'model'}`
                : 'No API key — tap settings'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowLibrary(true)}
            title="Library"
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center text-sm"
          >
            📚
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
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
            <div className="font-semibold mb-1">Bring your own key 🔑</div>
            Lector is free and private — you pay your AI provider directly. Open{' '}
            <button onClick={() => setShowSettings(true)} className="underline font-medium">
              Settings
            </button>{' '}
            to add a key (OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint).
          </div>
        )}

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
                  disabled={!page || !providerConfigured}
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
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] px-3 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-[13px] rounded-2xl rounded-br-md whitespace-pre-wrap break-words">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[92%] px-3.5 py-2.5 bg-white border border-slate-200 rounded-2xl rounded-bl-md shadow-sm">
                {m.content ? (
                  <div className="lector-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
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
            placeholder={providerConfigured ? 'Ask about this page…' : 'Add an API key in settings to begin…'}
            rows={1}
            className="flex-1 max-h-32 resize-none px-3 py-2 text-[13px] bg-slate-50 border border-transparent rounded-xl focus:outline-none focus:border-blue-400 focus:bg-white"
          />
          <button
            onClick={() => handleSend()}
            disabled={streaming || !input.trim() || !providerConfigured}
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
          <span className="text-[10px] text-slate-400">Enter to send · Shift+Enter for newline</span>
          {messages.length > 0 && (
            <button onClick={startNewChat} className="text-[10px] text-slate-400 hover:text-slate-600">
              + New chat
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
          className="absolute inset-0 bg-black/30 z-40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLibrary(false)
          }}
        >
          <div className="absolute right-0 top-0 bottom-0 w-[300px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
              <h3 className="text-[13px] font-semibold text-slate-800">Library</h3>
              <button onClick={() => setShowLibrary(false)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
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
                        <div className="text-[12px] font-medium text-slate-700 truncate">{s.title}</div>
                        <div className="text-[10px] text-slate-400">{new Date(s.createdAt).toLocaleString()}</div>
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
    </div>
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
        setFetchError('该接口未返回模型列表，请手动填写模型 id。')
      }
    } catch (e) {
      setFetchedModels(null)
      setFetchError(e instanceof Error ? e.message : '拉取失败')
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
          <h2 className="text-sm font-bold text-slate-800">🔑 Bring Your Own Key</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Lector is free and private. Your key is stored only in this browser and sent directly
            to your chosen provider — never to us.
          </p>

          {/* Provider picker */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Provider</label>
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
                Base URL <span className="text-slate-400 font-normal">(OpenAI-compatible)</span>
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
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={byok.apiKey}
                onChange={(e) => {
                  onChange({ apiKey: e.target.value })
                  setTestResult(null)
                }}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-2 pr-16 text-[12px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:bg-white font-mono"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600 px-1.5 py-0.5"
              >
                {showKey ? 'hide' : 'show'}
              </button>
            </div>
            {def.keyUrl && (
              <a
                href={def.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1 text-[10px] text-blue-500 hover:underline"
              >
                Get a key from {def.label} →
              </a>
            )}
          </div>

          {/* Model picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-semibold text-slate-600">Model</label>
              <button
                onClick={runFetch}
                disabled={fetching || !byok.apiKey || ((byok.provider === 'custom' || byok.provider === 'openrouter-custom') && !byok.baseUrl)}
                title="一键从厂商接口拉取可用模型列表"
                className="text-[10px] text-blue-500 hover:text-blue-700 disabled:opacity-40"
              >
                {fetching ? '拉取中…' : fetchedModels ? '↻ 重新拉取' : '⬇ 拉取模型列表'}
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
                    <option value="__custom__">自定义模型 id…</option>
                  </select>
                )
              }
              return null
            })()}

            {fetchError && (
              <div className="mt-1 text-[10px] text-amber-600">{fetchError}</div>
            )}
            {fetchedModels && fetchedModels.length > 0 && (
              <div className="mt-1 text-[10px] text-slate-400">已拉取 {fetchedModels.length} 个模型</div>
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
              {testing ? 'Testing…' : 'Test connection'}
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
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
