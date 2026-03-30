import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku'

interface TranslateRequest {
  text: string
  targetLang?: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text, targetLang = 'English' } = req.body as TranslateRequest

  if (!text) {
    return res.status(400).json({ error: 'Text is required' })
  }

  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const systemPrompt = `You are a professional translator. Translate the following text to ${targetLang}.
            
Requirements:
- Maintain the original tone and style
- Keep formatting when possible
- Provide accurate, natural translation

Output format (ALWAYS use this exact JSON format):
{"translatedText": "..."}`

    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://lector-ai.vercel.app',
        'X-Title': 'Lector AI',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        max_tokens: 2000,
        temperature: 0.3
      })
    })

    if (!openRouterResponse.ok) {
      const errorData = await openRouterResponse.text()
      console.error('OpenRouter API error:', errorData)
      return res.status(500).json({ error: 'AI service error' })
    }

    const data = await openRouterResponse.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return res.status(500).json({ error: 'No response from AI' })
    }

    try {
      const result = JSON.parse(content)
      return res.status(200).json(result)
    } catch {
      return res.status(200).json({
        translatedText: content
      })
    }

  } catch (error) {
    console.error('Translate error:', error)
    return res.status(500).json({ error: 'Failed to translate' })
  }
}
