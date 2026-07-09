// BYOK client — talks directly to the provider from the extension.
//
// All AI calls originate from the side-panel page (and, for inline actions,
// the background worker), which has <all_urls> host access via the manifest.
// The key lives in chrome.storage.local and never leaves the browser.
//
// Wire formats:
//  - openai    : /chat/completions with stream:true (OpenAI, OpenRouter, custom)
//  - anthropic : /v1/messages with stream:true

import { getProvider, resolveBaseUrl, type ByokSettings, type ProviderDef } from './providers'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// --- settings persistence ---------------------------------------------------

const SETTINGS_KEY = 'lector_byok_settings'

export function getSettings(): Promise<ByokSettings> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([SETTINGS_KEY], (r) => {
        const stored = r[SETTINGS_KEY] as Partial<ByokSettings> | undefined
        resolve({ ...settingsWithDefaults(), ...(stored || {}) })
      })
    } else {
      resolve(settingsWithDefaults())
    }
  })
}

export function saveSettings(s: ByokSettings): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [SETTINGS_KEY]: s }, () => resolve())
    } else {
      resolve()
    }
  })
}

function settingsWithDefaults(): ByokSettings {
  return {
    provider: 'openrouter',
    apiKey: '',
    model: getProvider('openrouter').defaultModel,
    baseUrl: '',
    locale: 'auto',
  }
}

// --- core request builders --------------------------------------------------

function buildHeaders(s: ByokSettings, def: ProviderDef): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (def.format === 'openai') {
    h.Authorization = `Bearer ${s.apiKey}`
    if (s.provider === 'openrouter') {
      h['HTTP-Referer'] = 'https://lector-ai.local'
      h['X-Title'] = 'Lector AI'
    }
  } else {
    // Anthropic requires these two headers.
    h['x-api-key'] = s.apiKey
    h['anthropic-version'] = '2023-06-01'
  }
  return h
}

// --- streaming chat ---------------------------------------------------------

/**
 * Stream a chat completion. Calls onToken with each text delta. Resolves with
 * the full text. Throws Error with a helpful message on failure.
 */
export async function streamChat(
  settings: ByokSettings,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number },
  onToken: (delta: string) => void
): Promise<string> {
  assertConfigured(settings)
  const def = getProvider(settings.provider)

  if (def.format === 'openai') {
    return streamOpenAI(settings, def, messages, opts, onToken)
  }
  return streamAnthropic(settings, def, messages, opts, onToken)
}

async function streamOpenAI(
  settings: ByokSettings,
  def: ProviderDef,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number },
  onToken: (delta: string) => void
): Promise<string> {
  const url = `${resolveBaseUrl(settings, def)}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(settings, def),
    body: JSON.stringify({
      model: settings.model || def.defaultModel,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      stream: true,
    }),
  })

  if (!res.ok || !res.body) {
    throw await toError(res)
  }

  return readSSE(res, (json) => {
    if (json.choices?.[0]?.delta?.content) return json.choices[0].delta.content
    return ''
  }, onToken)
}

async function streamAnthropic(
  settings: ByokSettings,
  def: ProviderDef,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number },
  onToken: (delta: string) => void
): Promise<string> {
  // Anthropic separates the system message from the conversation.
  const system = messages.find((m) => m.role === 'system')?.content || ''
  const convo = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const url = `${resolveBaseUrl(settings, def)}/v1/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(settings, def),
    body: JSON.stringify({
      model: settings.model || def.defaultModel,
      system,
      messages: convo,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      stream: true,
    }),
  })

  if (!res.ok || !res.body) {
    throw await toError(res)
  }

  return readSSE(res, (json) => {
    if (json.type === 'content_block_delta' && json.delta?.text) return json.delta.text
    return ''
  }, onToken)
}

/**
 * Read an SSE stream. `extractDelta(json)` returns the text fragment for one
 * event, or '' if the event carries none.
 */
async function readSSE(
  res: Response,
  extractDelta: (json: any) => string,
  onToken: (delta: string) => void
): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const t = line.trim()
      if (!t || !t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') return full
      try {
        const json = JSON.parse(payload)
        const delta = extractDelta(json)
        if (delta) {
          full += delta
          onToken(delta)
        }
      } catch {
        // partial JSON across chunks — next read completes it
      }
    }
  }
  return full
}

// --- non-streaming helpers (translate / summarize / explain) ----------------

export async function completeOnce(
  settings: ByokSettings,
  systemPrompt: string,
  userContent: string,
  opts: { maxTokens: number; temperature: number }
): Promise<string> {
  let out = ''
  await streamChat(
    settings,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    opts,
    (d) => (out += d)
  )
  return out.trim()
}

// --- fetch live model list (one-click) --------------------------------------

export interface FetchedModel {
  id: string
  /** Optional human label, e.g. "owned_by" or a cleaned id. */
  label?: string
}

/**
 * Fetch the provider's model catalog via `GET {baseUrl}{modelsPath}`.
 *
 * Almost every OpenAI-compatible host (OpenAI, DeepSeek, Groq, Together,
 * Mistral, xAI, Moonshot, Zhipu, SiliconFlow, Qwen, …) returns
 * `{ data: [{ id, ... }] }`. Anthropic's `/v1/models` returns the same shape.
 * We normalize to a plain string-id list and de-duplicate.
 *
 * Returns an empty array (not throwing) when the endpoint is unavailable so
 * the UI can fall back to the preset list.
 */
export async function fetchModels(settings: ByokSettings): Promise<FetchedModel[]> {
  assertConfigured(settings)
  const def = getProvider(settings.provider)
  const base = resolveBaseUrl(settings, def)
  if (!base) return []

  const url = `${base}${def.modelsPath}`
  const res = await fetch(url, { method: 'GET', headers: buildHeaders(settings, def) })

  if (!res.ok) {
    // Surface the error so the UI can tell the user why the fetch failed
    // (e.g. 401 wrong key, 404 no /models endpoint).
    throw await toError(res)
  }

  const json = await res.json()
  const rows: Array<Record<string, unknown>> = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : []

  const seen = new Set<string>()
  const out: FetchedModel[] = []
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id : undefined
    if (!id || seen.has(id)) continue
    // Skip obvious non-chat entries some hosts return (e.g. embedding/
    // audio/tts models) to keep the dropdown relevant. Conservative: only
    // filter when the id explicitly names a non-text modality.
    if (/embedding|tts|whisper|transcrib|moderation|realtime/i.test(id)) continue
    seen.add(id)
    const ownedBy = typeof row?.owned_by === 'string' ? row.owned_by : undefined
    out.push({ id, label: ownedBy ? `${id} · ${ownedBy}` : id })
  }

  // Sort alphabetically for a predictable dropdown.
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

// --- connection test --------------------------------------------------------

export interface TestResult {
  ok: boolean
  message: string
}

export async function testConnection(settings: ByokSettings): Promise<TestResult> {
  try {
    assertConfigured(settings)
    const reply = await completeOnce(
      settings,
      'Reply with the single word OK.',
      'OK',
      { maxTokens: 5, temperature: 0 }
    )
    return { ok: true, message: `Connected. Model replied: "${reply.slice(0, 20)}"` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// --- guards + errors --------------------------------------------------------

function assertConfigured(s: ByokSettings) {
  if (!s.apiKey) {
    throw new Error('No API key set. Open Settings to add your provider key.')
  }
  if ((s.provider === 'custom' || s.provider === 'openrouter-custom') && !s.baseUrl) {
    throw new Error('Custom provider needs a base URL.')
  }
}

async function toError(res: Response): Promise<Error> {
  let detail = ''
  try {
    const data = await res.json()
    detail =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      JSON.stringify(data).slice(0, 200)
  } catch {
    detail = await res.text().catch(() => '')
  }
  const hint =
    res.status === 401
      ? ' (401 — check that your API key is correct and has credit)'
      : res.status === 404
        ? ' (404 — check the model id and base URL)'
        : res.status === 429
          ? ' (429 — rate limited; wait or use a different key)'
          : ''
  return new Error(`Provider error ${res.status}${hint}${detail ? ': ' + detail : ''}`)
}
