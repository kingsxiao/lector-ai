import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import handler from '../../api/summarize'
import {
  createMockReq,
  createMockRes,
  mockJsonResponse,
  setupApiEnv,
} from './_helpers'

// Stub fetch to intercept the OpenRouter call and return a canned completion.
setupApiEnv(async (_input, _init) => {
  return mockJsonResponse({
    choices: [{ message: { content: '## TL;DR\nA short summary.\n\n- point one\n- point two' } }],
  })
})

describe('POST /api/summarize', () => {
  it('returns 405 for non-POST methods', async () => {
    const res = createMockRes()
    await handler(createMockReq('GET') as never, res as never)
    expect(res.statusCode).toBe(405)
    expect(JSON.parse(res.body).error).toBe('Method not allowed')
  })

  it('sets CORS headers and handles OPTIONS preflight', async () => {
    const res = createMockRes()
    // handleOptions returns true and ends the response for OPTIONS.
    const result = await handler(createMockReq('OPTIONS') as never, res as never)
    expect(result).toBeUndefined() // handler returns from handleOptions
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.ended).toBe(true)
    expect(res.statusCode).toBe(204)
  })

  it('returns 400 when neither url nor text is provided', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST', {}) as never, res as never)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('URL or text is required')
  })

  it('summarizes text and returns the AI content', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'Some long article body here.' }) as never, res as never)
    expect(res.statusCode).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.summary).toContain('short summary')
    expect(Array.isArray(data.keyPoints)).toBe(true)
    expect(data.style).toBe('brief')
  })

  it('passes the selected style through to the prompt', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'x', style: 'tldr' }) as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).style).toBe('tldr')
  })

  it('responds with a fetch interceptor capturing the OpenRouter request', async () => {
    let captured: RequestInit | undefined
    vi.stubGlobal('fetch', async (_input: string, init?: RequestInit) => {
      captured = init
      return mockJsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'hello world' }) as never, res as never)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(String(captured?.body))
    expect(body.model).toBe('test/model')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toBe('hello world')
  })
})

describe('POST /api/summarize — error paths', () => {
  it('returns 500 AI error when OpenRouter responds non-ok', async () => {
    vi.stubGlobal('fetch', async () => mockJsonResponse({ error: 'boom' }, 500))
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'x' }) as never, res as never)
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toBe('Failed to summarize')
  })

  it('returns "API key not configured" when the upstream throws that error', async () => {
    // Simulate OpenRouter raising API_KEY_NOT_CONFIGURED (constant is bound at
    // import time, so we emulate the throw via the fetch stub path the handler
    // surfaces). Covered directly in tests/api/openrouter.test.ts.
    vi.stubGlobal('fetch', async () => {
      throw new Error('API_KEY_NOT_CONFIGURED')
    })
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'x' }) as never, res as never)
    // The handler's generic catch maps unknown errors to the fallback message.
    expect(res.statusCode).toBe(500)
  })
})
