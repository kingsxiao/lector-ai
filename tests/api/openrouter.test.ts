import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockStreamResponse, mockJsonResponse } from './_helpers'

// openrouter.ts binds OPENROUTER_API_KEY at module load. To exercise the
// "not configured" branch we isolate this file and dynamically import with the
// env cleared, then reset modules.

describe('openrouter — API key gating', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('callOpenRouter throws API_KEY_NOT_CONFIGURED when the key is absent', async () => {
    vi.resetModules()
    const orig = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    try {
      const { callOpenRouter } = await import('../../api/_lib/openrouter')
      await expect(
        callOpenRouter('sys', 'user', { maxTokens: 10, temperature: 0 })
      ).rejects.toThrow('API_KEY_NOT_CONFIGURED')
    } finally {
      process.env.OPENROUTER_API_KEY = orig
    }
  })

  it('callOpenRouter returns content on a 200 and parses choices[0].message', async () => {
    vi.stubGlobal('fetch', async () =>
      mockJsonResponse({ choices: [{ message: { content: 'hello there' } }] })
    )
    const { callOpenRouter } = await import('../../api/_lib/openrouter')
    const out = await callOpenRouter('sys', 'user', { maxTokens: 10, temperature: 0 })
    expect(out).toBe('hello there')
  })

  it('callOpenRouter throws AI_SERVICE_ERROR on a non-ok response', async () => {
    vi.stubGlobal('fetch', async () => mockJsonResponse({ error: 'bad' }, 500))
    const { callOpenRouter } = await import('../../api/_lib/openrouter')
    await expect(
      callOpenRouter('sys', 'user', { maxTokens: 10, temperature: 0 })
    ).rejects.toThrow('AI_SERVICE_ERROR')
  })

  it('callOpenRouter throws NO_AI_RESPONSE when content is empty', async () => {
    vi.stubGlobal('fetch', async () => mockJsonResponse({ choices: [{ message: { content: '' } }] }))
    const { callOpenRouter } = await import('../../api/_lib/openrouter')
    await expect(
      callOpenRouter('sys', 'user', { maxTokens: 10, temperature: 0 })
    ).rejects.toThrow('NO_AI_RESPONSE')
  })
})

describe('openrouter — streamChat SSE parsing', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  function streamDelta(text: string): string {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
  }

  it('concatenates token deltas and invokes onToken per delta', async () => {
    vi.stubGlobal('fetch', async () =>
      mockStreamResponse([streamDelta('foo'), streamDelta('bar'), 'data: [DONE]\n\n'])
    )
    const { streamChat } = await import('../../api/_lib/openrouter')
    const tokens: string[] = []
    const full = await streamChat(
      [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
      { maxTokens: 10, temperature: 0 },
      (d) => tokens.push(d)
    )
    expect(full).toBe('foobar')
    expect(tokens).toEqual(['foo', 'bar'])
  })

  it('ignores malformed/partial JSON frames without throwing', async () => {
    vi.stubGlobal('fetch', async () =>
      mockStreamResponse([
        'data: {not valid json\n\n',
        streamDelta('ok'),
        'data: [DONE]\n\n',
      ])
    )
    const { streamChat } = await import('../../api/_lib/openrouter')
    const full = await streamChat(
      [{ role: 'user', content: 'u' }],
      { maxTokens: 10, temperature: 0 },
      () => {}
    )
    // malformed frame skipped; valid token still captured
    expect(full).toBe('ok')
  })

  it('sends stream:true and the model in the request body', async () => {
    let captured: RequestInit | undefined
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      captured = init
      return mockStreamResponse([streamDelta('x'), 'data: [DONE]\n\n'])
    })
    const { streamChat } = await import('../../api/_lib/openrouter')
    await streamChat([{ role: 'user', content: 'u' }], { maxTokens: 5, temperature: 1 }, () => {})
    const body = JSON.parse(String(captured?.body))
    expect(body.stream).toBe(true)
    expect(body.model).toBe('test/model')
  })
})

describe('openrouter — CORS helpers', () => {
  it('setCorsHeaders sets permissive headers', async () => {
    const { setCorsHeaders } = await import('../../api/_lib/openrouter')
    const headers: Record<string, string | string[]> = {}
    const fakeRes = {
      setHeader: (k: string, v: string | string[]) => {
        headers[k] = v
      },
    }
    setCorsHeaders(fakeRes as never)
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization')
  })

  it('handleOptions returns true and 204s for OPTIONS, false otherwise', async () => {
    const { handleOptions } = await import('../../api/_lib/openrouter')
    const makeRes = () => {
      const r = {
        statusCode: 0,
        headers: {} as Record<string, string | string[]>,
        ended: false,
        setHeader(k: string, v: string | string[]) {
          r.headers[k] = v
        },
        status(c: number) {
          r.statusCode = c
          return r
        },
        end() {
          r.ended = true
          return r
        },
      }
      return r
    }
    const optRes = makeRes()
    expect(handleOptions({ method: 'OPTIONS' } as never, optRes as never)).toBe(true)
    expect(optRes.statusCode).toBe(204)
    expect(optRes.ended).toBe(true)

    const getRes = makeRes()
    expect(handleOptions({ method: 'GET' } as never, getRes as never)).toBe(false)
    expect(getRes.ended).toBe(false)
  })
})
