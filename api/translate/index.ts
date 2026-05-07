import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callOpenRouter, setCorsHeaders, handleOptions } from '../_lib/openrouter'

interface TranslateRequest {
  text: string
  targetLang?: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  setCorsHeaders(res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text, targetLang = 'English' } = req.body as TranslateRequest

  if (!text) {
    return res.status(400).json({ error: 'Text is required' })
  }

  try {
    const systemPrompt = `You are a professional translator. Translate the following text to ${targetLang}.

Requirements:
- Maintain the original tone and style
- Keep formatting when possible
- Provide accurate, natural translation

Output format (ALWAYS use this exact JSON format):
{"translatedText": "..."}`

    const content = await callOpenRouter(systemPrompt, text, {
      maxTokens: 2000,
      temperature: 0.3,
    })

    try {
      const result = JSON.parse(content)
      return res.status(200).json(result)
    } catch {
      return res.status(200).json({ translatedText: content })
    }

  } catch (error) {
    console.error('Translate error:', error)
    if (error instanceof Error && error.message === 'API_KEY_NOT_CONFIGURED') {
      return res.status(500).json({ error: 'API key not configured' })
    }
    return res.status(500).json({ error: 'Failed to translate' })
  }
}
