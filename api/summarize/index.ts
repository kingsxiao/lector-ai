import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku'

interface SummarizeRequest {
  url?: string
  text?: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url, text } = req.body as SummarizeRequest

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

    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const systemPrompt = `You are a helpful reading assistant. Summarize the following content in a concise way.
            
Your task:
- Provide a clear, informative summary (3-5 sentences)
- Extract 3-5 key points as bullet points
- Keep the summary accessible to general readers

Output format (ALWAYS use this exact JSON format):
{"summary": "...", "keyPoints": ["point 1", "point 2", "point 3"]}`

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
          { role: 'user', content: contentToSummarize?.slice(0, 20000) || '' }
        ],
        max_tokens: 1000,
        temperature: 0.7
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
        summary: content,
        keyPoints: []
      })
    }

  } catch (error) {
    console.error('Summarize error:', error)
    return res.status(500).json({ error: 'Failed to summarize' })
  }
}
