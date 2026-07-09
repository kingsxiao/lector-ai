import { describe, it, expect, vi } from 'vitest'
import handler from '../../api/translate'
import {
  createMockReq,
  createMockRes,
  mockJsonResponse,
  setupApiEnv,
} from './_helpers'

setupApiEnv(async () => {
  return mockJsonResponse({
    choices: [{ message: { content: '这是翻译结果。' } }],
  })
})

describe('POST /api/translate', () => {
  it('returns 405 for non-POST methods', async () => {
    const res = createMockRes()
    await handler(createMockReq('PUT') as never, res as never)
    expect(res.statusCode).toBe(405)
  })

  it('handles OPTIONS preflight with CORS + 204', async () => {
    const res = createMockRes()
    await handler(createMockReq('OPTIONS') as never, res as never)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
  })

  it('returns 400 when text is missing', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST', {}) as never, res as never)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('Text is required')
  })

  it('returns translatedText', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'hello', targetLang: '中文' }) as never, res as never)
    expect(res.statusCode).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.translatedText).toContain('翻译结果')
  })

  it('includes the original when bilingual=true', async () => {
    const res = createMockRes()
    await handler(
      createMockReq('POST', { text: 'original text', targetLang: 'English', bilingual: true }) as never,
      res as never
    )
    expect(res.statusCode).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.original).toBe('original text')
    expect(data.translatedText).toBeDefined()
  })

  it('omits original when bilingual is false', async () => {
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'hi' }) as never, res as never)
    const data = JSON.parse(res.body)
    expect(data.original).toBeUndefined()
  })

  it('scales maxTokens with text length', async () => {
    let captured: RequestInit | undefined
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      captured = init
      return mockJsonResponse({ choices: [{ message: { content: 't' } }] })
    })
    const long = 'word '.repeat(500)
    const res = createMockRes()
    await handler(createMockReq('POST', { text: long }) as never, res as never)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(String(captured?.body))
    // text length ~2000 → maxTokens should be min(4000, max(500, 4000)) = 4000
    expect(body.max_tokens).toBe(4000)
  })

  it('returns 500 on upstream error', async () => {
    vi.stubGlobal('fetch', async () => mockJsonResponse({ error: 'x' }, 502))
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'hi' }) as never, res as never)
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toBe('Failed to translate')
  })

  it('surfaces a thrown upstream error as a 500', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('API_KEY_NOT_CONFIGURED')
    })
    const res = createMockRes()
    await handler(createMockReq('POST', { text: 'hi' }) as never, res as never)
    expect(res.statusCode).toBe(500)
  })
})
