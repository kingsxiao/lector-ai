import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callOpenRouter, setCorsHeaders, handleOptions } from '../_lib/openrouter'
import { checkRateLimit } from '../_lib/ratelimit'

interface SummarizeRequest {
  url?: string
  text?: string
  /** Style: 'brief' (default) | 'detailed' | 'tldr' */
  style?: 'brief' | 'detailed' | 'tldr'
}

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

  const { url, text, style = 'brief' } = (req.body || {}) as SummarizeRequest

  if (!url && !text) {
    return res.status(400).json({ error: 'URL or text is required' })
  }

  try {
    let contentToSummarize = text

    if (url) {
      const response = await fetch(url)
      const html = await response.text()

      contentToSummarize = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 15000)
    }

    const styleGuides: Record<NonNullable<SummarizeRequest['style']>, string> = {
      tldr: 'Write a single punchy one-liner (max 25 words) that captures the takeaway.',
      brief:
        'Write a 3-5 sentence summary, then list 3-5 key points as bullet points.',
      detailed:
        'Write a structured summary in Markdown: a TL;DR line, a "## Summary" section (2 short paragraphs), and a "## Key Points" bullet list of 5-7 items.',
    }

    const systemPrompt = `You are Lector AI, a reading assistant. Summarize the user's content in ${style} style.
${styleGuides[style]}

Write the body directly in clean Markdown. Do NOT wrap the whole response in a code fence. Do NOT include a leading "# Summary" heading (the UI already shows a title).`

    const content = await callOpenRouter(
      systemPrompt,
      contentToSummarize?.slice(0, 20000) || '',
      { maxTokens: style === 'detailed' ? 1400 : 900, temperature: 0.5 }
    )

    return res.status(200).json({
      summary: content.trim(),
      keyPoints: [],
      style,
      remaining: rate.enforced ? rate.remaining : null,
    })
  } catch (error) {
    console.error('Summarize error:', error)
    if (error instanceof Error && error.message === 'API_KEY_NOT_CONFIGURED') {
      return res.status(500).json({ error: 'API key not configured' })
    }
    return res.status(500).json({ error: 'Failed to summarize' })
  }
}
