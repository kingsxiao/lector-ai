import type { VercelRequest, VercelResponse } from '@vercel/node'
import { streamChat, setCorsHeaders, handleOptions, type ChatMessage } from '../_lib/openrouter'
import { checkRateLimit } from '../_lib/ratelimit'
import { buildCitedSystemPrompt, type PageBlock } from '../../src/shared/citations'

interface ChatRequestBody {
  message: string
  /** Cleaned page content supplied by the content script. */
  pageContent?: string
  pageMetadata?: { url?: string; title?: string }
  /** Explicit page blocks (id + text) from the content script, when available. */
  pageBlocks?: PageBlock[]
  /** Earlier turns, newest-last. Carried client-side to keep the API stateless. */
  history?: ChatMessage[]
}

/**
 * POST /api/chat
 * Server-Sent Events stream. Each token is emitted as an SSE `data:` line.
 * The final event is `data: [DONE]`. Errors are emitted as
 * `data: {"error": "..."}` then closed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = (req.headers.authorization as string) || ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  const rate = await checkRateLimit(new Headers(req.headers as Record<string, string>), accessToken, 1)
  if (!rate.allowed) {
    return res.status(429).json({
      error: 'RATE_LIMITED',
      limit: rate.limit,
      remaining: rate.remaining,
      message: 'Daily free limit reached. Sign in or upgrade to Pro.',
    })
  }

  const { message, pageContent, pageMetadata, history, pageBlocks } = (req.body || {}) as ChatRequestBody

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' })
  }

  // Cap page context so a huge page can't blow the context window.
  const trimmedPage = (pageContent || '').slice(0, 12000)

  // Build citation-grounded blocks: prefer explicit pageBlocks from the
  // client; otherwise split the trimmed page text on blank lines.
  let blocks: PageBlock[]
  if (Array.isArray(pageBlocks) && pageBlocks.length > 0) {
    blocks = pageBlocks.slice(0, 200)
  } else {
    blocks = trimmedPage
      .split(/\n{2,}/)
      .map((t, i) => ({ id: `b${i}`, text: t, domSelector: '' }))
      .filter((b) => b.text.trim().length > 0)
      .slice(0, 200)
  }

  const citedSection = buildCitedSystemPrompt(blocks)

  const systemPrompt = `You are Lector AI, a sharp reading companion embedded in the user's browser.

You answer questions about the article the user is reading, summarize, explain
concepts, translate, and draft. Be concise and information-dense. Use Markdown.
When the user asks about "the article", reason only from the provided PAGE
CONTENT; if it isn't covered there, say so rather than guessing. When you state
a fact from the article, append [bN] referencing the source block.

${pageMetadata?.title ? `PAGE TITLE: ${pageMetadata.title}` : ''}
${pageMetadata?.url ? `PAGE URL: ${pageMetadata.url}` : ''}

${citedSection}`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(history && Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: message },
  ]

  // Switch to SSE.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.writeHead(200)

  const send = (obj: unknown) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  // If the limiter isn't backed by a DB (local dev), still surface a soft
  // remaining count so the UI can warn.
  if (!rate.enforced) {
    send({ type: 'meta', remaining: null })
  } else {
    send({ type: 'meta', remaining: rate.remaining })
  }

  try {
    await streamChat(
      messages,
      { maxTokens: 1200, temperature: 0.4 },
      (delta) => send({ type: 'token', delta })
    )
    send({ type: 'done' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI_SERVICE_ERROR'
    send({ type: 'error', error: msg })
  } finally {
    res.end()
  }
}
