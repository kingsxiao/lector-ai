// Shared harness for end-to-end API handler tests.
//
// The three API endpoints (summarize/translate/chat) are pure handler functions
// that take (req, res). We drive them directly with minimal mock objects and
// stub globalThis.fetch so the OpenRouter call is intercepted (no network, no
// key needed). This exercises the REAL handler code: method checks, CORS,
// OPTIONS preflight, body validation, rate-limit branch, the SSE streaming
// protocol, and error handling — everything except the external AI round-trip.

import { vi, beforeEach, afterEach } from 'vitest'

export interface MockRes {
  statusCode: number
  ended: boolean
  headers: Record<string, string | string[]>
  body: string
  chunks: string[]
  setHeader(key: string, value: string | string[]): void
  writeHead(code: number): void
  write(chunk: string): boolean
  status(code: number): MockRes
  json(obj: unknown): MockRes
  end(): MockRes
}

export function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    ended: false,
    headers: {},
    body: '',
    chunks: [],
    setHeader(key, value) {
      res.headers[key] = value
    },
    writeHead(code) {
      res.statusCode = code
    },
    write(chunk) {
      res.chunks.push(String(chunk))
      res.body += String(chunk)
      return true
    },
    status(code) {
      res.statusCode = code
      return res
    },
    json(obj) {
      res.body = JSON.stringify(obj)
      res.statusCode = res.statusCode || 200
      res.ended = true
      return res
    },
    end() {
      res.ended = true
      return res
    },
  }
  return res
}

export interface MockReq {
  method: string
  headers: Record<string, string>
  body: unknown
}

export function createMockReq(
  method: string,
  body: unknown = {},
  headers: Record<string, string> = {}
): MockReq {
  return {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1', ...headers },
    body,
  }
}

/** Parse the buffered SSE body into a list of decoded event objects. */
export function parseSseEvents(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      events.push(JSON.parse(payload))
    } catch {
      // ignore partial frames
    }
  }
  return events
}

/**
 * Build a fake Response whose .body is a ReadableStream yielding the given
 * SSE-formatted chunks. Mimics what OpenRouter streams back for a chat request.
 */
export function mockStreamResponse(sseLines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of sseLines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** A non-streaming JSON response (summarize / translate path). */
export function mockJsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Install env + fetch stub before each test file's tests run.
export function setupApiEnv(
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
) {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OPENROUTER_MODEL = 'test/model'
    // Ensure the rate limiter is NOT enforced (no Supabase) → allowed: true.
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    delete process.env.SUPABASE_ANON_KEY
    vi.stubGlobal('fetch', fetchImpl)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })
}
