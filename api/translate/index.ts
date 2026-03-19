import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

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
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the following text to ${targetLang}.
            
Requirements:
- Maintain the original tone and style
- Keep formatting when possible
- Provide accurate, natural translation

Output format:
{"translatedText": "..."}`
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      })
    })

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text()
      console.error('OpenAI API error:', errorData)
      return res.status(500).json({ error: 'AI service error' })
    }

    const data = await openaiResponse.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return res.status(500).json({ error: 'No response from AI' })
    }

    // Parse the JSON response
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
