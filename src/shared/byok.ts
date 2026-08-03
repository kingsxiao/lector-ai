// BYOK client — talks directly to the provider from the extension.
//
// All AI calls originate from the side-panel page (and, for inline actions,
// the background worker), which has <all_urls> host access via the manifest.
// The key lives in chrome.storage.local and never leaves the browser.
//
// Provider transports:
//  - OpenAI official: /responses (current native API)
//  - OpenAI-compatible providers: /chat/completions (compatibility protocol)
//  - Anthropic: /v1/messages
//
// "Translation" is the product task implemented by prompts and output
// validation. Endpoint names describe provider transport only; there is no
// separate OpenAI text-translation endpoint.

import {
  getProvider,
  normalizeByokSettings,
  resolveBaseUrl,
  type ByokSettings,
  type ProviderDef,
} from './providers'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const REQUEST_TIMEOUT_MS = 60_000

async function withRequestTimeout<T>(
  externalSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  try {
    const value = await run(controller.signal)
    if (timedOut) throw new Error('Provider request timed out after 60 seconds.')
    return value
  } catch (e) {
    if (timedOut) throw new Error('Provider request timed out after 60 seconds.')
    throw e
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', forwardAbort)
  }
}

// --- settings persistence ---------------------------------------------------

const SETTINGS_KEY = 'lector_byok_settings'
let settingsWriteChain: Promise<void> = Promise.resolve()

export function getSettings(): Promise<ByokSettings> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([SETTINGS_KEY], (r) => {
        resolve(normalizeByokSettings(r[SETTINGS_KEY]))
      })
    } else {
      resolve(settingsWithDefaults())
    }
  })
}

export function saveSettings(s: ByokSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return Promise.resolve()
  const snapshot = normalizeByokSettings(s)
  // Settings inputs save on each change. Serialize writes so a slower earlier
  // callback can never land after a newer value and resurrect stale text.
  settingsWriteChain = settingsWriteChain
    .catch(() => {})
    .then(() => new Promise<void>((resolve) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: snapshot }, () => resolve())
    }))
  return settingsWriteChain
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
  if (def.transport !== 'anthropic-messages') {
    h.Authorization = `Bearer ${s.apiKey}`
    if (s.provider === 'openrouter') {
      h['HTTP-Referer'] = 'https://lector-ai.local'
      h['X-Title'] = 'Lector AI'
    }
  } else {
    // Anthropic requires the opt-in browser header for direct requests from a
    // browser/extension context in addition to the normal API headers.
    h['x-api-key'] = s.apiKey
    h['anthropic-version'] = '2023-06-01'
    h['anthropic-dangerous-direct-browser-access'] = 'true'
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
  onToken: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  assertConfigured(settings)
  const def = getProvider(settings.provider)

  if (def.transport === 'openai-responses') {
    return streamOpenAIResponses(settings, def, messages, opts, onToken, signal)
  }
  if (def.transport === 'openai-chat-completions') {
    return streamChatCompletions(settings, def, messages, opts, onToken, signal)
  }
  return streamAnthropic(settings, def, messages, opts, onToken, signal)
}

export class ProviderResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderResponseError'
  }
}

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code: string,
    readonly param: string,
    readonly errorType: string,
    message: string
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}

/** Models/endpoints that explicitly rejected the optional sampling parameter.
 * Remember this per session so a page with many chunks does not pay one HTTP
 * 400 round-trip for every request after the first capability probe. */
const responsesWithoutTemperature = new Set<string>()
const anthropicWithoutTemperature = new Set<string>()

function isUnsupportedParameterError(error: ProviderHttpError, parameter: string): boolean {
  if (error.status !== 400) return false
  const namedParameter = error.param.toLowerCase() === parameter.toLowerCase()
  const typedUnsupported = /unsupported_parameter|unsupported|not_supported/i.test(
    `${error.code} ${error.errorType}`
  )
  const detailNamesParameter = new RegExp(parameter, 'i').test(error.detail)
  const detailRejectsParameter = /unsupported|not supported|unknown|invalid|must not|cannot (?:be )?(?:set|specified)/i.test(
    error.detail
  )
  return (namedParameter && typedUnsupported) || (detailNamesParameter && detailRejectsParameter)
}

/** Normalize text across the small wire-format differences used by
 * OpenAI-compatible gateways. Modern endpoints may return a string, a
 * content-parts array, or nested `{ text }` / `{ content }` objects. Never
 * coerce unknown objects to strings — that previously produced
 * "[object Object]", which the translation guard then misreported as a
 * wrong-language answer. */
function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractTextContent).join('')
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.type === 'string' && /reasoning|thinking/i.test(record.type)) return ''
  if (typeof record.text === 'string') return record.text
  if (typeof record.output_text === 'string') return record.output_text
  if (record.content !== undefined) return extractTextContent(record.content)
  return ''
}

function providerStreamError(json: any): Error | null {
  if (!json?.error) return null
  const msg =
    (typeof json.error === 'object' && json.error && (json.error as { message?: unknown }).message) ||
    JSON.stringify(json.error).slice(0, 200)
  return new Error(`Provider stream error: ${msg}`)
}

function extractOpenAIText(json: any): string {
  const streamError = providerStreamError(json)
  if (streamError) throw streamError
  const choice = json?.choices?.[0]
  const refusal =
    extractTextContent(choice?.delta?.refusal) ||
    extractTextContent(choice?.message?.refusal)
  if (refusal) {
    throw new ProviderResponseError(`Provider refused the request: ${refusal.slice(0, 160)}`)
  }
  const finishReason = choice?.finish_reason ?? choice?.native_finish_reason
  if (typeof finishReason === 'string' && finishReason) {
    const normalized = finishReason.toLowerCase()
    if (!['stop', 'eos', 'end_turn', 'completed'].includes(normalized)) {
      throw new ProviderResponseError(
        `Provider returned an incomplete result (finish_reason: ${finishReason}).`
      )
    }
  }
  return (
    extractTextContent(choice?.delta?.content) ||
    extractTextContent(choice?.delta?.text) ||
    extractTextContent(choice?.message?.content) ||
    extractTextContent(choice?.text) ||
    extractTextContent(json?.output_text) ||
    extractTextContent(json?.output)
  )
}

function assertAnthropicStopReason(reason: unknown) {
  if (typeof reason !== 'string' || !reason) {
    throw new ProviderResponseError('Anthropic returned no terminal stop_reason.')
  }
  const normalized = reason.toLowerCase()
  if (normalized === 'end_turn' || normalized === 'stop_sequence') return
  throw new ProviderResponseError(
    `Anthropic returned an incomplete result (stop_reason: ${reason}).`
  )
}

function extractResponsesText(response: any): string {
  if (response?.error) {
    const message =
      (typeof response.error === 'object' && response.error?.message) ||
      JSON.stringify(response.error).slice(0, 200)
    throw new ProviderResponseError(`OpenAI Responses API failed: ${message}`)
  }
  if (typeof response?.status === 'string' && response.status !== 'completed') {
    const kind = response.status === 'failed' ? 'failed' : 'returned a non-completed result'
    throw new ProviderResponseError(
      `OpenAI Responses API ${kind} (${response.status}): ${responseFailureMessage({ response })}`
    )
  }
  if (response?.incomplete_details) {
    throw new ProviderResponseError(`OpenAI Responses API returned an incomplete result: ${responseFailureMessage({ response })}`)
  }

  let text = ''
  let refusal = ''
  const output = Array.isArray(response?.output) ? response.output : []
  for (const item of output) {
    if (!item || item.type !== 'message') continue
    if (item.role !== undefined && item.role !== 'assistant') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') text += part.text
      if (part?.type === 'refusal' && typeof part.refusal === 'string') refusal += part.refusal
    }
  }
  if (refusal) {
    throw new ProviderResponseError(`OpenAI Responses API refused the request: ${refusal.slice(0, 160)}`)
  }
  return text
}

function responseFailureMessage(json: any): string {
  const error = json?.response?.error || json?.error
  if (error) {
    return (
      (typeof error === 'object' && error && (error as { message?: unknown }).message as string) ||
      JSON.stringify(error).slice(0, 200)
    )
  }
  if (typeof json?.message === 'string') return json.message
  const reason = json?.response?.incomplete_details?.reason
  return typeof reason === 'string' ? reason : 'unknown response failure'
}

/** Native OpenAI Responses transport. The API separates top-level
 * `instructions` from conversational `input`, uses `max_output_tokens`, and
 * streams typed `response.output_text.delta` events. */
async function streamOpenAIResponses(
  settings: ByokSettings,
  def: ProviderDef,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number },
  onToken: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n\n')
  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }))
  const model = settings.model || def.defaultModel
  if (!Number.isFinite(opts.maxTokens) || opts.maxTokens <= 0) {
    throw new Error('maxTokens must be a positive finite number.')
  }
  if (!Number.isFinite(opts.temperature)) {
    throw new Error('temperature must be a finite number.')
  }
  const maxOutputTokens = Math.max(16, Math.floor(opts.maxTokens))
  const temperature = Math.max(0, Math.min(2, opts.temperature))

  return withRequestTimeout(signal, async (requestSignal) => {
    const url = `${resolveBaseUrl(settings, def)}/responses`
    const capabilityKey = `${url}\u0000${model}`
    const request = (includeTemperature: boolean) => fetch(url, {
      method: 'POST',
      headers: buildHeaders(settings, def),
      body: JSON.stringify({
        model,
        instructions: instructions || undefined,
        input,
        max_output_tokens: maxOutputTokens,
        temperature: includeTemperature ? temperature : undefined,
        stream: true,
        // Responses are stateless in this extension; do not retain page text
        // server-side for later response chaining.
        store: false,
      }),
      signal: requestSignal,
    })

    const includeTemperature = !responsesWithoutTemperature.has(capabilityKey)
    let res = await request(includeTemperature)
    if (!res.ok) {
      const firstError = await toError(res)
      const temperatureUnsupported =
        includeTemperature && isUnsupportedParameterError(firstError, 'temperature')
      if (!temperatureUnsupported) throw firstError
      // Some reasoning models reject sampling parameters. The first request
      // was rejected before generation, so retry the same Responses transport
      // exactly once without temperature and remember that capability.
      responsesWithoutTemperature.add(capabilityKey)
      res = await request(false)
      if (!res.ok) throw await toError(res)
    }

    const contentType = res.headers?.get?.('content-type')?.toLowerCase() || ''
    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      const text = extractResponsesText(await res.json())
      if (!text.trim()) {
        throw new ProviderResponseError('OpenAI Responses API returned no recognizable text content.')
      }
      onToken(text)
      return text
    }
    if (!res.body) {
      throw new ProviderResponseError('OpenAI Responses API returned an empty response body.')
    }

    let emittedText = false
    let terminal = false
    const { text } = await readSSE(res, (json) => {
      if (json?.type === 'error' || json?.type === 'response.failed') {
        terminal = true
        throw new ProviderResponseError(`OpenAI Responses API failed: ${responseFailureMessage(json)}`)
      }
      if (json?.type === 'response.incomplete') {
        terminal = true
        throw new ProviderResponseError(`OpenAI Responses API returned an incomplete result: ${responseFailureMessage(json)}`)
      }
      if (json?.type === 'response.refusal.delta' || json?.type === 'response.refusal.done') {
        throw new ProviderResponseError(
          `OpenAI Responses API refused the request: ${String(json.delta || json.refusal || '').slice(0, 160)}`
        )
      }
      if (json?.type === 'response.output_text.delta' && typeof json.delta === 'string') {
        emittedText = true
        return json.delta
      }
      // Standard streams emit deltas. These fallbacks cover an implementation
      // that sends only a final text snapshot.
      if (!emittedText && json?.type === 'response.output_text.done' && typeof json.text === 'string') {
        emittedText = true
        return json.text
      }
      if (json?.type === 'response.completed') {
        terminal = true
        // Validate the final response even when deltas were already emitted.
        // A terminal snapshot can still carry a refusal or non-completed
        // status; ignoring it would bless the earlier partial text.
        const completedText = extractResponsesText(json.response)
        if (!emittedText) {
          if (completedText) emittedText = true
          return { delta: completedText, terminal: true }
        }
        return { terminal: true }
      }
      return ''
    }, onToken, requestSignal)
    if (!terminal) {
      throw new ProviderResponseError('OpenAI Responses API stream ended before a terminal event.')
    }
    if (!text.trim()) {
      throw new ProviderResponseError('OpenAI Responses API returned an empty or unsupported stream.')
    }
    return text
  })
}

async function streamChatCompletions(
  settings: ByokSettings,
  def: ProviderDef,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number },
  onToken: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  return withRequestTimeout(signal, async (requestSignal) => {
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
      signal: requestSignal,
    })

    if (!res.ok) throw await toError(res)

    // Some compatible gateways ignore `stream:true` and return a normal JSON
    // completion. Parsing that body as SSE used to yield an empty translation.
    const contentType = res.headers?.get?.('content-type')?.toLowerCase() || ''
    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      const text = extractOpenAIText(await res.json())
      if (!text.trim()) throw new ProviderResponseError('Provider returned no recognizable text content.')
      onToken(text)
      return text
    }
    if (!res.body) {
      throw new ProviderResponseError('Provider returned an empty response body.')
    }

    let terminal = false
    const { text, sawDone } = await readSSE(res, (json) => {
      const choice = json?.choices?.[0]
      const finishReason = choice?.finish_reason ?? choice?.native_finish_reason
      // Extract first so non-success finish reasons (length, content_filter,
      // tool_calls, etc.) still fail instead of being treated as completion.
      const delta = extractOpenAIText(json)
      if (typeof finishReason === 'string' && finishReason) {
        terminal = true
        return { delta, terminal: true }
      }
      return delta
    }, onToken, requestSignal)
    if (!sawDone && !terminal) {
      throw new ProviderResponseError('Provider stream ended before a terminal finish event.')
    }
    if (!text.trim()) throw new ProviderResponseError('Provider returned an empty or unsupported streaming response.')
    return text
  })
}

async function streamAnthropic(
  settings: ByokSettings,
  def: ProviderDef,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number },
  onToken: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  // Anthropic separates the system message from the conversation.
  const system = messages.find((m) => m.role === 'system')?.content || ''
  const convo = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  return withRequestTimeout(signal, async (requestSignal) => {
    const url = `${resolveBaseUrl(settings, def)}/v1/messages`
    const model = settings.model || def.defaultModel
    const capabilityKey = `${url}\u0000${model}`
    const request = (includeTemperature: boolean) => fetch(url, {
      method: 'POST',
      headers: buildHeaders(settings, def),
      body: JSON.stringify({
        model,
        system,
        messages: convo,
        max_tokens: opts.maxTokens,
        temperature: includeTemperature ? opts.temperature : undefined,
        stream: true,
      }),
      signal: requestSignal,
    })

    const includeTemperature = !anthropicWithoutTemperature.has(capabilityKey)
    let res = await request(includeTemperature)
    if (!res.ok) {
      const firstError = await toError(res)
      if (!includeTemperature || !isUnsupportedParameterError(firstError, 'temperature')) {
        throw firstError
      }
      anthropicWithoutTemperature.add(capabilityKey)
      res = await request(false)
      if (!res.ok) throw await toError(res)
    }

    const contentType = res.headers?.get?.('content-type')?.toLowerCase() || ''
    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      const json = await res.json()
      if (json?.error) {
        const detail = json.error
        const msg =
          (detail && typeof detail === 'object' && (detail as { message?: unknown }).message) ||
          JSON.stringify(detail).slice(0, 200)
        throw new Error(`Anthropic error: ${msg || 'unknown error'}`)
      }
      assertAnthropicStopReason(json?.stop_reason)
      const text = extractTextContent(json?.content)
      if (!text.trim()) throw new ProviderResponseError('Provider returned no recognizable text content.')
      onToken(text)
      return text
    }
    if (!res.body) {
      throw new ProviderResponseError('Anthropic returned an empty response body.')
    }

    let sawStopReason = false
    let sawMessageStop = false
    const { text } = await readSSE(res, (json) => {
      // Anthropic can emit an `error` event mid-stream with HTTP 200
      // (overloaded_error, rate_limit_error, api_error).
      if (json.type === 'error') {
        const detail = json.error
        const msg =
          (detail && typeof detail === 'object' && (detail as { message?: unknown }).message) ||
          JSON.stringify(detail).slice(0, 200)
        throw new Error(`Anthropic stream error: ${msg || 'unknown error'}`)
      }
      if (json.type === 'message_delta') {
        const stopReason = json.delta?.stop_reason ?? json.stop_reason
        if (stopReason !== null && stopReason !== undefined) {
          assertAnthropicStopReason(stopReason)
          sawStopReason = true
        }
      }
      if (json.type === 'message_stop') {
        sawMessageStop = true
        return { terminal: true }
      }
      if (json.type === 'content_block_delta' && json.delta?.text) return json.delta.text
      return ''
    }, onToken, requestSignal)
    if (!sawStopReason || !sawMessageStop) {
      throw new ProviderResponseError('Anthropic stream ended before message_delta/message_stop.')
    }
    if (!text.trim()) throw new ProviderResponseError('Provider returned an empty or unsupported streaming response.')
    return text
  })
}

/**
 * Read an SSE stream. The extractor returns either a text fragment or an
 * object that can additionally mark a protocol terminal event. Terminal
 * events end reading immediately and cancel the still-open network stream;
 * providers are not required to close the HTTP connection promptly.
 */
type SSEFrameResult = string | { delta?: string; terminal?: boolean }

async function readSSE(
  res: Response,
  extractDelta: (json: any) => SSEFrameResult,
  onToken: (delta: string) => void,
  signal?: AbortSignal
): Promise<{ text: string; sawDone: boolean }> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let eventData: string[] = []
  let reachedEof = false
  let sawDone = false

  const processPayload = (payload: string): boolean => {
    if (payload.trim() === '[DONE]') {
      sawDone = true
      return true
    }
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      // At an SSE event boundary the frame is complete. Silently skipping it
      // could turn a corrupted/truncated response into an apparently valid
      // partial translation that is later cached.
      throw new ProviderResponseError('Provider returned malformed streaming data.')
    }
    const result = extractDelta(json)
    const delta = typeof result === 'string' ? result : result.delta || ''
    if (delta) {
      full += delta
      onToken(delta)
    }
    return typeof result !== 'string' && result.terminal === true
  }

  const flushEvent = (): boolean => {
    if (eventData.length === 0) return false
    const payload = eventData.join('\n')
    eventData = []
    return processPayload(payload)
  }

  const processLine = (rawLine: string): boolean => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    // Per the SSE format, an empty line ends the current event. Multiple data
    // fields belong to one event and are joined with newlines before parsing.
    if (line === '') return flushEvent()
    if (line.startsWith('data:')) {
      const data = line.slice(5)
      eventData.push(data.startsWith(' ') ? data.slice(1) : data)
      return false
    }
    // A few local/custom compatible servers use NDJSON rather than SSE.
    if (eventData.length === 0 && line.trimStart().startsWith('{')) {
      return processPayload(line.trim())
    }
    // Ignore standard `event:`, `id:`, `retry:`, and comment fields.
    return false
  }

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) {
        reachedEof = true
        // Some compatible gateways close immediately after their final data
        // frame without a trailing newline or blank event delimiter.
        buffer += decoder.decode()
        if (buffer && processLine(buffer)) return { text: full, sawDone }
        if (flushEvent()) return { text: full, sawDone }
        break
      }
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (processLine(line)) return { text: full, sawDone }
      }
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return { text: full, sawDone }
  } finally {
    // `[DONE]`, parser errors, and aborts can all exit before EOF. Release the
    // network stream promptly instead of leaving a reader locked.
    if (!reachedEof) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
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

const NON_TEXT_GENERATION_MODEL_ID =
  /(?:^|[/_.:-])(?:embed(?:ding)?s?|rerank(?:er|ing)?|tts|whisper|transcri(?:b(?:e|er|ing)?|pt(?:ion)?)|moderation|realtime|audio)(?:$|[/_.:-])|gpt-image|dall-e|(?:^|[/_.:-])sora(?:$|[/_.:-])/i

/** The official OpenAI provider uses /responses, so hide catalog entries that
 * are text-capable but only support older endpoint families. Compatible
 * providers keep their own catalogs untouched. */
function isUnsupportedOpenAIResponsesModelId(id: string): boolean {
  const normalized = id.toLowerCase()
  return (
    /(?:^|:)o1-mini(?:-\d{4}-\d{2}-\d{2})?(?:$|:)/.test(normalized) ||
    /(?:^|:)(?:babbage-002|davinci-002)(?:$|:)/.test(normalized) ||
    /search-(?:preview|api)/.test(normalized) ||
    /(?:^|[/_.:-])instruct(?:$|[/_.:-])/.test(normalized) ||
    /(?:^|:)(?:text|code)-(?:ada|babbage|curie|davinci|cushman)(?:-|$|:)/.test(normalized) ||
    /^(?:ada|babbage|curie|davinci)$/i.test(normalized)
  )
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
    if (NON_TEXT_GENERATION_MODEL_ID.test(id)) continue
    if (def.transport === 'openai-responses' && isUnsupportedOpenAIResponsesModelId(id)) continue
    const architecture = row.architecture && typeof row.architecture === 'object'
      ? row.architecture as Record<string, unknown>
      : undefined
    const outputModalities = Array.isArray(row.output_modalities)
      ? row.output_modalities
      : Array.isArray(architecture?.output_modalities)
        ? architecture.output_modalities
        : null
    if (
      outputModalities &&
      outputModalities.length > 0 &&
      !outputModalities.some(
        (modality) => typeof modality === 'string' && modality.toLowerCase() === 'text'
      )
    ) continue
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
      // Responses counts reasoning and visible output in this budget and
      // requires at least 16. Leave enough room for a reasoning model to reach
      // the visible "OK" while still keeping the probe cheap.
      { maxTokens: 64, temperature: 0 }
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

async function toError(res: Response): Promise<ProviderHttpError> {
  // Read the body exactly once in real fetch implementations. Calling json()
  // first and text() after a parse failure loses plain-text/HTML provider
  // errors because the body has already been consumed.
  let raw = ''
  try {
    raw = await res.text()
  } catch { /* a test/polyfill may expose json() only */ }
  let data: any
  if (raw) {
    try { data = JSON.parse(raw) } catch { /* keep raw text below */ }
  }
  if (data === undefined && !raw) {
    try { data = await res.json() } catch { /* empty body */ }
  }
  const error = data?.error
  const message =
    (error && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof data?.message === 'string'
          ? data.message
          : '')
  const code =
    error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : ''
  const param =
    error && typeof error === 'object' && typeof error.param === 'string'
      ? error.param
      : ''
  const errorType =
    error && typeof error === 'object' && typeof error.type === 'string'
      ? error.type
      : ''
  const detail = [
    message || raw.slice(0, 200),
    code && `code=${code}`,
    param && `param=${param}`,
    errorType && `type=${errorType}`,
  ].filter(Boolean).join(' · ')
  const hint =
    res.status === 401
      ? ' (401 — check that your API key is correct and has credit)'
      : res.status === 404
        ? ' (404 — check the model id and base URL)'
        : res.status === 429
          ? ' (429 — rate limited; wait or use a different key)'
          : ''
  return new ProviderHttpError(
    res.status,
    detail,
    code,
    param,
    errorType,
    `Provider error ${res.status}${hint}${detail ? ': ' + detail : ''}`
  )
}
