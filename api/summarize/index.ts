import type { VercelRequest, VercelResponse } from '@vercel/node'

// OpenAI API call for summarization
// Note: In production, use environment variables for API keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

interface SummarizeRequest {
  url?: string
  text?: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url, text } = req.body as SummarizeRequest

  if (!url && !text) {
    return res.status(400).json({ error: 'URL or text is required' })
  }

  try {
    // If URL is provided, fetch the page content first
    let contentToSummarize = text
    
    if (url) {
      const response = await fetch(url)
      const html = await response.text()
      
      // Simple HTML to text conversion
      contentToSummarize = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 10000) // Limit content
    }

    // Call OpenAI API for summarization
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
            content: `You are a helpful reading assistant. Summarize the following content in a concise way.
            
Your task:
- Provide a clear, informative summary (3-5 sentences)
- Extract 3-5 key points as bullet points
- Keep the summary accessible to general readers

Output format (ALWAYS use this exact format):
{"summary": "...", "keyPoints": ["point 1", "point 2", "point 3"]}`
          },
          {
            role: 'user',
            content: contentToSummarize?.slice(0, 15000) || ''
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
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
      // If not valid JSON, return as summary
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
