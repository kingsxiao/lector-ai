import { describe, it, expect, vi } from 'vitest'
import handler from '../../api/chat'
import {
  createMockReq,
  createMockRes,
  mockStreamResponse,
  mockJsonResponse,
  parseSseEvents,
  setupApiEnv,
} from './_helpers'

// Build SSE frames the way OpenRouter streams chat completions:
// data: {"choices":[{"delta":{"content":"Hello"}}]}
function deltaFrame(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}

describe('POST /api/chat — SSE streaming protocol', () => {
  setupApiEnv(async () => {
    return mockStreamResponse([deltaFrame('Hello'), deltaFrame(' world'), 'data: [DONE]\n\n'])
  })

  it('returns 405 for non-POST', async () => {
    const res = createMockRes()
    await handler(createMockReq('GET') as never, res as never)
    expect(res.statusCode).toBe(405)
  })

  it('handles OPTIONS preflight (CORS + 204)', async () => {
    const res = createMockRes()
    await handler(createMockReq('OPTIONS') as never, res as never)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
  })

  it('returns 400 when message is missing', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST', {}) as never, res as never)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('message is required')
  })

  it('emits meta + token + done events in the correct order', async () => {
    const res = createMockRes()
    await handler(
      createMockReq('POST', { message: 'What is this about?', pageContent: 'An article about trust.' }) as never,
      res as never
    )
    expect(res.statusCode).toBe(200)
    // SSE response headers
    expect(res.headers['Content-Type']).toContain('text/event-stream')
    expect(res.headers['Cache-Control']).toContain('no-cache')
    expect(res.headers['Connection']).toBe('keep-alive')
    expect(res.ended).toBe(true)

    const events = parseSseEvents(res.body)
    const types = events.map((e) => e.type)
    // First event is always meta; then tokens; then a final done.
    expect(types[0]).toBe('meta')
    expect(types[types.length - 1]).toBe('done')
    const tokens = events.filter((e) => e.type === 'token')
    expect(tokens.length).toBe(2)
    expect((tokens[0] as { delta: string }).delta).toBe('Hello')
    expect((tokens[1] as { delta: string }).delta).toBe(' world')
  })

  it('includes the citation-grounded page content in the system prompt', async () => {
    let captured: RequestInit | undefined
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      captured = init
      return mockStreamResponse([deltaFrame('ok'), 'data: [DONE]\n\n'])
    })
    const res = createMockRes()
    await handler(
      createMockReq('POST', {
        message: 'summarize',
        pageBlocks: [
          { id: 'b0', text: 'First block about trust.', domSelector: 'p' },
          { id: 'b1', text: 'Second block.', domSelector: 'p' },
        ],
        pageMetadata: { url: 'https://x.com/a', title: 'Trust' },
      }) as never,
      res as never
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(String(captured?.body))
    const system = body.messages[0].content
    expect(system).toContain('PAGE TITLE: Trust')
    expect(system).toContain('PAGE URL: https://x.com/a')
    expect(system).toContain('[b0] First block about trust.')
    expect(system).toContain('[b1] Second block.')
    expect(system).toContain('cite ONLY these ids')
  })

  it('streams tokens then ends cleanly on [DONE] (no error)', async () => {
    vi.stubGlobal('fetch', async () =>
      mockStreamResponse([deltaFrame('partial'), deltaFrame(' done'), 'data: [DONE]\n\n'])
    )
    const res = createMockRes()
    await handler(createMockReq('POST', { message: 'hi' }) as never, res as never)
    expect(res.ended).toBe(true)
    const events = parseSseEvents(res.body)
    const tokens = events.filter((e) => e.type === 'token')
    expect(tokens.map((e) => (e as { delta: string }).delta).join('')).toBe('partial done')
    expect(events[events.length - 1].type).toBe('done')
    // No error emitted on a clean stream.
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('emits an error event when OpenRouter returns non-ok', async () => {
    vi.stubGlobal('fetch', async () => mockJsonResponse({ error: 'rate limited' }, 429))
    const res = createMockRes()
    await handler(createMockReq('POST', { message: 'hi' }) as never, res as never)
    expect(res.ended).toBe(true)
    const events = parseSseEvents(res.body)
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })

  it('returns 429 RATE_LIMITED shape — but limiter is disabled without Supabase', async () => {
    // With no Supabase configured the limiter returns allowed=true/enforced=false,
    // so a normal request still streams. Verify the meta event carries remaining:null.
    const res = createMockRes()
    await handler(createMockReq('POST', { message: 'hi' }) as never, res as never)
    const events = parseSseEvents(res.body)
    const meta = events.find((e) => e.type === 'meta') as { remaining: number | null } | undefined
    expect(meta).toBeDefined()
    expect(meta!.remaining).toBeNull() // not enforced in dev
  })

  it('caps carried history to the last 10 turns', async () => {
    let captured: RequestInit | undefined
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      captured = init
      return mockStreamResponse([deltaFrame('x'), 'data: [DONE]\n\n'])
    })
    const history = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `m${i}` }))
    const res = createMockRes()
    await handler(createMockReq('POST', { message: 'last', history }) as never, res as never)
    const body = JSON.parse(String(captured?.body))
    // system + last 10 history + current user message = 12
    expect(body.messages.length).toBe(12)
    expect(body.messages[body.messages.length - 1].content).toBe('last')
  })
})
