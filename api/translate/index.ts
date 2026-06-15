import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callOpenRouter, setCorsHeaders, handleOptions } from '../_lib/openrouter'
import { checkRateLimit } from '../_lib/ratelimit'

interface TranslateRequest {
  text: string
  targetLang?: string
  /** When true, return the original followed by the translation so the UI can
   * render a bilingual paragraph (Immersive-Translate style). */
  bilingual?: boolean
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

  const { text, targetLang = 'English', bilingual = false } = (req.body || {}) as TranslateRequest

  if (!text) {
    return res.status(400).json({ error: 'Text is required' })
  }

  try {
    const systemPrompt = `You are a professional translator. Translate the user text to ${targetLang}.

Requirements:
- Preserve the original meaning, tone, and formatting (Markdown, lists, paragraphs).
- Sound natural and fluent, not literal.
- Output ONLY the translation. Do not add notes, prefixes, or code fences.`

    const content = await callOpenRouter(systemPrompt, text, {
      maxTokens: Math.min(4000, Math.max(500, text.length * 2)),
      temperature: 0.2,
    })

    const payload: Record<string, unknown> = {
      translatedText: content.trim(),
      remaining: rate.enforced ? rate.remaining : null,
    }
    if (bilingual) {
      payload.original = text
    }

    return res.status(200).json(payload)
  } catch (error) {
    console.error('Translate error:', error)
    if (error instanceof Error && error.message === 'API_KEY_NOT_CONFIGURED') {
      return res.status(500).json({ error: 'API key not configured' })
    }
    return res.status(500).json({ error: 'Failed to translate' })
  }
}
