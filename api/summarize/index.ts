import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callOpenRouter, setCorsHeaders, handleOptions } from '../_lib/openrouter'

interface SummarizeRequest {
  url?: string
  text?: string
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

    const systemPrompt = `You are a helpful reading assistant. Summarize the following content in a concise way.

Your task:
- Provide a clear, informative summary (3-5 sentences)
- Extract 3-5 key points as bullet points
- Keep the summary accessible to general readers

Output format (ALWAYS use this exact JSON format):
{"summary": "...", "keyPoints": ["point 1", "point 2", "point 3"]}`

    const content = await callOpenRouter(
      systemPrompt,
      contentToSummarize?.slice(0, 20000) || '',
      { maxTokens: 1000, temperature: 0.7 }
    )

    try {
      const result = JSON.parse(content)
      return res.status(200).json(result)
    } catch {
      return res.status(200).json({ summary: content, keyPoints: [] })
    }

  } catch (error) {
    console.error('Summarize error:', error)
    if (error instanceof Error && error.message === 'API_KEY_NOT_CONFIGURED') {
      return res.status(500).json({ error: 'API key not configured' })
    }
    return res.status(500).json({ error: 'Failed to summarize' })
  }
}
