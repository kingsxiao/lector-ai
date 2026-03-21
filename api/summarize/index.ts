import type { VercelRequest, VercelResponse } from '@vercel/node'

// Gemini API call for summarization
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

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
        .slice(0, 15000) // Limit content
    }

    // Call Gemini API for summarization
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' })
    }

    const systemPrompt = `You are a helpful reading assistant. Summarize the following content in a concise way.
            
Your task:
- Provide a clear, informative summary (3-5 sentences)
- Extract 3-5 key points as bullet points
- Keep the summary accessible to general readers

Output format (ALWAYS use this exact JSON format):
{"summary": "...", "keyPoints": ["point 1", "point 2", "point 3"]}`

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: contentToSummarize?.slice(0, 20000) || '' }]
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.7,
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
