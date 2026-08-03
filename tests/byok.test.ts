import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { streamChat, completeOnce, fetchModels, type ByokSettings } from '../src/shared/byok'

/**
 * byok.ts is a zero-DOM pure module, but it calls global `fetch`. These tests
 * stub `fetch` to return hand-built SSE byte streams so we can exercise the
 * streaming parser (readSSE) and the two wire formats (openai / anthropic)
 * deterministically — including the edge cases that matter in production:
 * partial-JSON-across-chunks, mid-stream Anthropic error frames, [DONE],
 * and AbortSignal cancellation.
 *
 * `ByokSettings` here intentionally avoids any chrome.* API (the module reads
 * settings from chrome.storage.local only inside getSettings/saveSettings,
 * which are not exercised here).
 */
const anthropicSettings: ByokSettings = {
  provider: 'anthropic',
  apiKey: 'sk-test',
  model: 'claude-haiku-4-5-20251001',
  baseUrl: '',
  locale: 'en',
}

const openaiSettings: ByokSettings = {
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  baseUrl: '',
  locale: 'en',
}

const compatibleSettings: ByokSettings = {
  provider: 'deepseek',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  baseUrl: '',
  locale: 'en',
}

/** Build a ReadableStream<Uint8Array> from an array of string chunks. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

/** A provider stream that emits its frames but deliberately never closes.
 * `forceClose` only keeps a failing regression test from leaking the request
 * timeout; successful code must terminate by cancelling the reader instead. */
function neverClosingSseStream(chunks: string[]) {
  const enc = new TextEncoder()
  const canceled = vi.fn()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      for (const chunk of chunks) streamController.enqueue(enc.encode(chunk))
    },
    cancel() {
      canceled()
    },
  })
  return {
    body,
    canceled,
    forceClose: () => {
      try {
        controller?.close()
      } catch {
        // A successful parser already cancelled (and therefore closed) it.
      }
    },
  }
}

async function resolvesBeforeDeadline<T>(promise: Promise<T>, forceClose: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          forceClose()
          reject(new Error('stream did not settle after its terminal event'))
        }, 250)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** An SSE event frame: `data: <payload>\n\n`. */
const frame = (payload: string) => `data: ${payload}\n\n`
const anthropicTerminal = () => [
  frame(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })),
  frame(JSON.stringify({ type: 'message_stop' })),
]

/** Minimal fetch stub returning an SSE body with the given ok/status. */
function stubFetch(
  body: ReadableStream<Uint8Array>,
  init: { ok?: boolean; status?: number } = {}
) {
  const ok = init.ok ?? true
  const status = init.status ?? 200
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    body,
    headers: { get: () => 'text/event-stream' },
    json: async () => ({}),
    text: async () => '',
  }))
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('streamChat — Anthropic', () => {
  const orig = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = orig
  })

  it('streams content_block_delta text deltas in order', async () => {
    stubFetch(
      sseStream([
        frame(JSON.stringify({ type: 'message_start' })),
        frame(JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hel' } })),
        frame(JSON.stringify({ type: 'content_block_delta', delta: { text: 'lo' } })),
        ...anthropicTerminal(),
      ])
    )
    const tokens: string[] = []
    const full = await streamChat(
      anthropicSettings,
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      { maxTokens: 10, temperature: 0 },
      (d) => tokens.push(d)
    )
    expect(tokens).toEqual(['Hel', 'lo'])
    expect(full).toBe('Hello')
  })

  it('returns and cancels a still-open stream immediately after message_stop', async () => {
    const stream = neverClosingSseStream([
      frame(JSON.stringify({ type: 'content_block_delta', delta: { text: '完整译文' } })),
      ...anthropicTerminal(),
    ])
    stubFetch(stream.body)

    const full = await resolvesBeforeDeadline(streamChat(
      anthropicSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0 },
      () => {}
    ), stream.forceClose)

    expect(full).toBe('完整译文')
    expect(stream.canceled).toHaveBeenCalledTimes(1)
  })

  // Regression (A5): Anthropic can return HTTP 200 and then emit an SSE frame
  // { "type":"error", "error":{...} } mid-stream (overloaded_error,
  // rate_limit_error, api_error). The extractor used to return '' for unknown
  // event types, so the error frame was silently skipped and streamChat
  // resolved with whatever partial text had arrived — the user saw a truncated
  // answer and believed it succeeded. The extractor must surface the error.
  it('throws when an Anthropic error event arrives mid-stream', async () => {
    stubFetch(
      sseStream([
        frame(JSON.stringify({ type: 'content_block_delta', delta: { text: 'partial ' } })),
        frame(
          JSON.stringify({
            type: 'error',
            error: { type: 'overloaded_error', message: 'Overloaded' },
          })
        ),
        frame(JSON.stringify({ type: 'content_block_delta', delta: { text: 'never' } })),
        'data: [DONE]\n\n',
      ])
    )
    await expect(
      streamChat(
        anthropicSettings,
        [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        { maxTokens: 10, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/Overloaded/i)
  })

  it('handles partial JSON split across chunk boundaries', async () => {
    // One event split across two enqueue calls; readSSE must buffer and parse
    // it on the next read rather than dropping it as malformed.
    const json = JSON.stringify({ type: 'content_block_delta', delta: { text: 'ok' } })
    stubFetch(sseStream(['data: ' + json.slice(0, 10), json.slice(10) + '\n\n', ...anthropicTerminal()]))
    const full = await streamChat(
      anthropicSettings,
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      { maxTokens: 10, temperature: 0 },
      () => {}
    )
    expect(full).toBe('ok')
  })

  it('accepts a normal JSON response when streaming is ignored', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '中文译文' }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch
    const full = await streamChat(
      anthropicSettings,
      [
        { role: 'system', content: 'translate' },
        { role: 'user', content: 'hello' },
      ],
      { maxTokens: 20, temperature: 0 },
      () => {}
    )
    expect(full).toBe('中文译文')
  })

  it('rejects an Anthropic JSON response stopped by the token limit', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '只有半截的译文' }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch
    await expect(
      streamChat(
        anthropicSettings,
        [{ role: 'user', content: 'translate' }],
        { maxTokens: 20, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/incomplete|stop_reason.*max_tokens/i)
  })

  it('rejects an Anthropic stream stopped by the token limit', async () => {
    stubFetch(sseStream([
      frame(JSON.stringify({ type: 'content_block_delta', delta: { text: '半截译文' } })),
      frame(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })),
    ]))
    await expect(
      streamChat(
        anthropicSettings,
        [{ role: 'user', content: 'translate' }],
        { maxTokens: 20, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/incomplete|stop_reason.*max_tokens/i)
  })

  it('rejects partial Anthropic text when the stream closes without terminal events', async () => {
    stubFetch(sseStream([
      frame(JSON.stringify({ type: 'content_block_delta', delta: { text: '半截译文' } })),
    ]))
    await expect(
      streamChat(
        anthropicSettings,
        [{ role: 'user', content: 'translate' }],
        { maxTokens: 20, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/message_delta|message_stop|terminal/i)
  })

  it('sends Anthropic browser opt-in headers', async () => {
    const fetchMock = stubFetch(sseStream([
      frame(JSON.stringify({ type: 'content_block_delta', delta: { text: '译文' } })),
      ...anthropicTerminal(),
    ]))
    await streamChat(
      anthropicSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0 },
      () => {}
    )
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(headers['x-api-key']).toBe('sk-test')
  })

  it('retries once without temperature when Anthropic explicitly rejects it', async () => {
    const modelSettings = { ...anthropicSettings, model: 'claude-opus-4-8-test-capability' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        body: sseStream([]),
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({
          error: { type: 'invalid_request_error', message: 'temperature cannot be set for this model' },
        }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: sseStream([
          frame(JSON.stringify({ type: 'content_block_delta', delta: { text: '译文' } })),
          ...anthropicTerminal(),
        ]),
        headers: { get: () => 'text/event-stream' },
        text: async () => '',
        json: async () => ({}),
      })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(streamChat(
      modelSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0.2 },
      () => {}
    )).resolves.toBe('译文')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(first.temperature).toBe(0.2)
    expect(second).not.toHaveProperty('temperature')
  })
})

describe('streamChat — OpenAI-compatible Chat Completions', () => {
  const orig = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = orig
  })

  it('streams choices[0].delta.content deltas', async () => {
    stubFetch(
      sseStream([
        frame(JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })),
        frame(JSON.stringify({ choices: [{ delta: { content: ' there' } }] })),
        'data: [DONE]\n\n',
      ])
    )
    const full = await streamChat(
      compatibleSettings,
      [{ role: 'user', content: 'hi' }],
      { maxTokens: 10, temperature: 0 },
      () => {}
    )
    expect(full).toBe('Hi there')
  })

  it('returns and cancels a still-open stream on a normal finish_reason', async () => {
    const stream = neverClosingSseStream([
      frame(JSON.stringify({
        choices: [{ delta: { content: '完成译文' }, finish_reason: 'stop' }],
      })),
    ])
    stubFetch(stream.body)

    const full = await resolvesBeforeDeadline(streamChat(
      compatibleSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0 },
      () => {}
    ), stream.forceClose)

    expect(full).toBe('完成译文')
    expect(stream.canceled).toHaveBeenCalledTimes(1)
  })

  it('rejects a final data frame without a terminal finish event', async () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: 'last token' } }] })
    stubFetch(sseStream([`data: ${payload}`]))
    await expect(streamChat(
      compatibleSettings,
      [{ role: 'user', content: 'hi' }],
      { maxTokens: 10, temperature: 0 },
      () => {}
    )).rejects.toThrow(/terminal finish/i)
  })

  it('extracts text from content-parts arrays without coercing objects', async () => {
    stubFetch(
      sseStream([
        frame(JSON.stringify({
          choices: [{ delta: { content: [
            { type: 'text', text: '中文' },
            { type: 'text', text: '译文' },
          ] } }],
        })),
        'data: [DONE]\n\n',
      ])
    )
    const full = await streamChat(
      compatibleSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0 },
      () => {}
    )
    expect(full).toBe('中文译文')
    expect(full).not.toContain('[object Object]')
  })

  it('accepts newline-delimited JSON from compatible gateways', async () => {
    stubFetch(
      sseStream([
        JSON.stringify({ choices: [{ delta: { text: '兼容译文' }, finish_reason: 'stop' }] }) + '\n',
      ])
    )
    const full = await streamChat(
      compatibleSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0 },
      () => {}
    )
    expect(full).toBe('兼容译文')
  })

  it('parses a standard SSE event whose JSON spans multiple data fields', async () => {
    stubFetch(sseStream([
      'data: {"choices":[{"delta":\n',
      'data: {"content":"多行事件译文"}}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const full = await streamChat(
      compatibleSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0 },
      () => {}
    )
    expect(full).toBe('多行事件译文')
  })

  it('accepts a normal JSON completion when a gateway ignores stream=true', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => ({
        choices: [{ message: { content: '普通 JSON 译文' } }],
      }),
      text: async () => '',
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const tokens: string[] = []
    const full = await streamChat(
      compatibleSettings,
      [{ role: 'user', content: 'translate' }],
      { maxTokens: 20, temperature: 0 },
      (token) => tokens.push(token)
    )
    expect(full).toBe('普通 JSON 译文')
    expect(tokens).toEqual(['普通 JSON 译文'])
  })

  it('rejects an explicitly truncated Chat Completions JSON response', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{
          finish_reason: 'length',
          message: { content: '只有半截的译文' },
        }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch
    await expect(
      streamChat(
        compatibleSettings,
        [{ role: 'user', content: 'translate' }],
        { maxTokens: 20, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/incomplete|finish_reason.*length/i)
  })

  it('rejects an explicitly truncated Chat Completions stream after partial text', async () => {
    stubFetch(sseStream([
      frame(JSON.stringify({ choices: [{ delta: { content: '半截译文' }, finish_reason: null }] })),
      frame(JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })),
      'data: [DONE]\n\n',
    ]))
    await expect(
      streamChat(
        compatibleSettings,
        [{ role: 'user', content: 'translate' }],
        { maxTokens: 20, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/incomplete|finish_reason.*length/i)
  })

  it('reports an unsupported empty stream as a provider response error', async () => {
    stubFetch(sseStream([frame(JSON.stringify({ choices: [{ delta: {} }] }))]))
    await expect(
      streamChat(
        compatibleSettings,
        [{ role: 'user', content: 'translate' }],
        { maxTokens: 20, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/empty|unsupported|terminal/i)
  })
})

describe('streamChat — native OpenAI Responses API', () => {
  const orig = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = orig
  })

  it('uses /responses with native request fields and typed output deltas', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        frame(JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } })),
        frame(JSON.stringify({ type: 'response.output_text.delta', delta: '中文' })),
        frame(JSON.stringify({ type: 'response.output_text.delta', delta: '译文' })),
        frame(JSON.stringify({ type: 'response.completed', response: { output: [] } })),
      ]),
      headers: { get: () => 'text/event-stream' },
      json: async () => ({}),
      text: async () => '',
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const full = await streamChat(
      openaiSettings,
      [
        { role: 'system', content: 'Translate into Chinese.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: '你好' },
        { role: 'user', content: 'World' },
      ],
      { maxTokens: 500, temperature: 0.2 },
      () => {}
    )

    expect(full).toBe('中文译文')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/responses$/)
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(request).toMatchObject({
      model: 'gpt-4o-mini',
      instructions: 'Translate into Chinese.',
      input: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: '你好' },
        { role: 'user', content: 'World' },
      ],
      max_output_tokens: 500,
      temperature: 0.2,
      stream: true,
      store: false,
    })
    expect(request).not.toHaveProperty('messages')
    expect(request).not.toHaveProperty('max_tokens')
  })

  it('extracts a final completed event when a gateway omits deltas', async () => {
    stubFetch(sseStream([
      frame(JSON.stringify({
        type: 'response.completed',
        response: {
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: '最终译文' }],
          }],
        },
      })),
    ]))
    const full = await streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      () => {}
    )
    expect(full).toBe('最终译文')
  })

  it('returns and cancels a still-open stream on response.completed', async () => {
    const stream = neverClosingSseStream([
      frame(JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '终态译文' }],
          }],
        },
      })),
    ])
    stubFetch(stream.body)

    const full = await resolvesBeforeDeadline(streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      () => {}
    ), stream.forceClose)

    expect(full).toBe('终态译文')
    expect(stream.canceled).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate a done snapshot when completed follows it', async () => {
    const tokens: string[] = []
    stubFetch(sseStream([
      frame(JSON.stringify({ type: 'response.output_text.done', text: '唯一译文' })),
      frame(JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '唯一译文' }],
          }],
        },
      })),
    ]))
    const full = await streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      (token) => tokens.push(token)
    )
    expect(full).toBe('唯一译文')
    expect(tokens).toEqual(['唯一译文'])
  })

  it('clamps max_output_tokens to the Responses API minimum', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        frame(JSON.stringify({ type: 'response.output_text.delta', delta: 'OK' })),
        frame(JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })),
      ]),
      headers: { get: () => 'text/event-stream' },
      json: async () => ({}),
      text: async () => '',
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await streamChat(
      openaiSettings,
      [{ role: 'user', content: 'OK' }],
      { maxTokens: 5, temperature: 0 },
      () => {}
    )
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(request.max_output_tokens).toBe(16)
    expect(request.temperature).toBe(0)
  })

  it('retries Responses once without temperature only when that parameter is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        body: sseStream([]),
        headers: { get: () => 'application/json' },
        json: async () => ({
          error: {
            code: 'unsupported_parameter',
            message: "Unsupported parameter: 'temperature' is not supported with this model.",
          },
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: sseStream([
          frame(JSON.stringify({ type: 'response.output_text.delta', delta: '译文' })),
          frame(JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })),
        ]),
        headers: { get: () => 'text/event-stream' },
        json: async () => ({}),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: sseStream([
          frame(JSON.stringify({ type: 'response.output_text.delta', delta: '第二段译文' })),
          frame(JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })),
        ]),
        headers: { get: () => 'text/event-stream' },
        json: async () => ({}),
        text: async () => '',
      })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const full = await streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      () => {}
    )
    expect(full).toBe('译文')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(first).toHaveProperty('temperature', 0)
    expect(second).not.toHaveProperty('temperature')
    expect(fetchMock.mock.calls.every((call) => String(call[0]).endsWith('/responses'))).toBe(true)

    const secondFull = await streamChat(
      openaiSettings,
      [{ role: 'user', content: 'World' }],
      { maxTokens: 50, temperature: 0.2 },
      () => {}
    )
    expect(secondFull).toBe('第二段译文')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const remembered = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))
    expect(remembered).not.toHaveProperty('temperature')
  })

  it('accepts a non-streaming JSON Responses payload', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '普通响应译文' }],
        }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch
    const full = await streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      () => {}
    )
    expect(full).toBe('普通响应译文')
  })

  it('rejects an incomplete JSON response even when it contains partial text', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '部分译文' }],
        }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch
    await expect(
      streamChat(
        openaiSettings,
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 50, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/incomplete/i)
  })

  it('rejects a JSON response that contains both partial text and a refusal', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({
        status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: '部分译文' },
            { type: 'refusal', refusal: 'Cannot comply.' },
          ],
        }],
      }),
      text: async () => '',
    })) as unknown as typeof fetch
    await expect(streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      () => {}
    )).rejects.toThrow(/refused/i)
  })

  it('rejects non-completed Responses JSON statuses', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'cancelled', output: [] }),
      text: async () => '',
    })) as unknown as typeof fetch
    await expect(streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      () => {}
    )).rejects.toThrow(/non-completed|cancelled/i)
  })

  it('does not silently fall back to Chat Completions when /responses is rejected', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      body: sseStream([]),
      headers: { get: () => 'application/json' },
      json: async () => ({ error: { message: 'This model does not support Responses.' } }),
      text: async () => '',
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(
      streamChat(
        { ...openaiSettings, model: 'legacy-chat-model' },
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 50, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/404/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.openai.com/v1/responses')
  })

  it('does not replay a request after partial Responses output', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        frame(JSON.stringify({ type: 'response.output_text.delta', delta: '部分译文' })),
        frame(JSON.stringify({
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'max_output_tokens' } },
        })),
      ]),
      headers: { get: () => 'text/event-stream' },
      json: async () => ({}),
      text: async () => '',
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(
      streamChat(
        openaiSettings,
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 50, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/incomplete/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a stream that ends after text without a terminal event', async () => {
    const tokens: string[] = []
    stubFetch(sseStream([
      frame(JSON.stringify({ type: 'response.output_text.delta', delta: '半截译文' })),
    ]))
    await expect(
      streamChat(
        openaiSettings,
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 50, temperature: 0 },
        (token) => tokens.push(token)
      )
    ).rejects.toThrow(/terminal event/i)
    expect(tokens).toEqual(['半截译文'])
  })

  it('surfaces refusal and error events without a second request', async () => {
    const fetchMock = stubFetch(sseStream([
      frame(JSON.stringify({ type: 'response.refusal.delta', delta: 'Cannot comply.' })),
    ]))
    await expect(
      streamChat(
        openaiSettings,
        [{ role: 'user', content: 'Hello' }],
        { maxTokens: 50, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/refused/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a final streaming snapshot that refuses after partial text', async () => {
    stubFetch(sseStream([
      frame(JSON.stringify({ type: 'response.output_text.delta', delta: '部分译文' })),
      frame(JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'refusal', refusal: 'Cannot comply.' }],
          }],
        },
      })),
    ]))
    await expect(streamChat(
      openaiSettings,
      [{ role: 'user', content: 'Hello' }],
      { maxTokens: 50, temperature: 0 },
      () => {}
    )).rejects.toThrow(/refused/i)
  })
})

describe('streamChat — error handling', () => {
  const orig = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = orig
  })

  it('throws a Provider error with status on non-ok response', async () => {
    stubFetch(sseStream([]), { ok: false, status: 401 })
    await expect(
      streamChat(
        openaiSettings,
        [{ role: 'user', content: 'hi' }],
        { maxTokens: 10, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/Provider error 401/)
  })

  it('preserves a plain-text provider error body', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      body: sseStream([]),
      headers: { get: () => 'text/plain' },
      text: async () => 'upstream gateway exploded',
      json: async () => { throw new Error('not json') },
    })) as unknown as typeof fetch
    await expect(
      streamChat(
        compatibleSettings,
        [{ role: 'user', content: 'hi' }],
        { maxTokens: 10, temperature: 0 },
        () => {}
      )
    ).rejects.toThrow(/502.*upstream gateway exploded/i)
  })

  // AbortSignal cancellation is exercised end-to-end via the browser E2E
  // suite (real fetch semantics) rather than here: jsdom's hand-built
  // ReadableStream cannot reproduce fetch's "abort rejects the pending read"
  // behavior without contriving the timing, which would test the mock rather
  // than readSSE. readSSE's signal handling (check-at-loop-top + reader.cancel)
  // is simple and correct by inspection.
})

describe('completeOnce', () => {
  const orig = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = orig
  })

  it('aggregates the stream into a trimmed string', async () => {
    stubFetch(
      sseStream([
        frame(JSON.stringify({ choices: [{ delta: { content: '  hello  ' } }] })),
        'data: [DONE]\n\n',
      ])
    )
    const out = await completeOnce(
      compatibleSettings,
      'sys',
      'hi',
      { maxTokens: 10, temperature: 0 }
    )
    expect(out).toBe('hello')
  })
})

describe('fetchModels', () => {
  const orig = globalThis.fetch
  afterEach(() => { globalThis.fetch = orig })

  it('filters non-generation modalities plus embed, rerank, and transcribe model ids', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '',
      json: async () => ({ data: [
        { id: 'gpt-4o-mini' },
        { id: 'gpt-image-1', output_modalities: ['image'] },
        { id: 'dall-e-3' },
        { id: 'sora-2' },
        { id: 'gpt-audio-1.5' },
        { id: 'gpt-4o-mini-transcribe' },
        { id: 'local-transcription-model' },
        { id: 'nomic-embed-text' },
        { id: 'vendor-embeddings-v2' },
        { id: 'Qwen/Qwen3-Reranker-8B' },
        { id: 'vendor-reranking-v1' },
        { id: 'custom-text-model', architecture: { output_modalities: ['text'] } },
      ] }),
    })) as unknown as typeof fetch
    const models = await fetchModels(openaiSettings)
    expect(models.map((model) => model.id)).toEqual(['custom-text-model', 'gpt-4o-mini'])
  })

  it('hides text models that cannot use the official OpenAI Responses API', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '',
      json: async () => ({ data: [
        { id: 'gpt-4.1' },
        { id: 'gpt-4o-mini' },
        { id: 'o1-mini' },
        { id: 'o1-mini-2024-09-12' },
        { id: 'babbage-002' },
        { id: 'davinci-002' },
        { id: 'ft:babbage-002:example:model' },
        { id: 'gpt-4o-search-preview' },
        { id: 'gpt-4o-mini-search-preview-2025-03-11' },
        { id: 'gpt-3.5-turbo-instruct' },
        { id: 'text-davinci-003' },
        { id: 'code-davinci-002' },
        { id: 'curie' },
      ] }),
    })) as unknown as typeof fetch

    const models = await fetchModels(openaiSettings)
    expect(models.map((model) => model.id)).toEqual(['gpt-4.1', 'gpt-4o-mini'])
  })

  it('does not apply OpenAI Responses-only filtering to compatible providers', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '',
      json: async () => ({ data: [
        { id: 'gpt-3.5-turbo-instruct' },
        { id: 'o1-mini' },
      ] }),
    })) as unknown as typeof fetch

    const models = await fetchModels(compatibleSettings)
    expect(models.map((model) => model.id)).toEqual(['gpt-3.5-turbo-instruct', 'o1-mini'])
  })
})
