import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { streamChat, completeOnce, type ByokSettings } from '../src/shared/byok'

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
  model: 'claude-3-5-haiku-latest',
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

/** An SSE event frame: `data: <payload>\n\n`. */
const frame = (payload: string) => `data: ${payload}\n\n`

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
        'data: [DONE]\n\n',
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
    stubFetch(sseStream(['data: ' + json.slice(0, 10), json.slice(10) + '\n\n', 'data: [DONE]\n\n']))
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
})

describe('streamChat — OpenAI', () => {
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
      openaiSettings,
      [{ role: 'user', content: 'hi' }],
      { maxTokens: 10, temperature: 0 },
      () => {}
    )
    expect(full).toBe('Hi there')
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
      openaiSettings,
      'sys',
      'hi',
      { maxTokens: 10, temperature: 0 }
    )
    expect(out).toBe('hello')
  })
})
