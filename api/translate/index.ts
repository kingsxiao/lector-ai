import type { VercelRequest, VercelResponse } from '@vercel/node'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

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
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const systemPrompt = `You are a professional translator. Translate the following text to ${targetLang}.
            
Requirements:
- Maintain the original tone and style
- Keep formatting when possible
- Provide accurate, natural translation

Output format (ALWAYS use this exact JSON format):
{"translatedText": "..."}`

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: text }]
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json"
        }
      })
    })

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.text()
      console.error('Gemini API error:', errorData)
      return res.status(500).json({ error: 'AI service error' })
    }

    const data = await geminiResponse.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text

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
