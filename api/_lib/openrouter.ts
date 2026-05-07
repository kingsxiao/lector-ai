import type { VercelRequest, VercelResponse } from '@vercel/node'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku'

interface OpenRouterOptions {
  maxTokens: number
  temperature: number
}

export function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res)
    res.status(204).end()
    return true
  }
  return false
}

export async function callOpenRouter(
  systemPrompt: string,
  userContent: string,
  options: OpenRouterOptions
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('API_KEY_NOT_CONFIGURED')
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        { role: 'user', content: userContent }
      ],
      max_tokens: options.maxTokens,
      temperature: options.temperature,
    }),
  })

  if (!response.ok) {
    const errorData = await response.text()
    console.error('OpenRouter API error:', errorData)
    throw new Error('AI_SERVICE_ERROR')
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('NO_AI_RESPONSE')
  }

  return content
}
