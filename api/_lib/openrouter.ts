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

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function buildHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': 'https://lector-ai.vercel.app',
    'X-Title': 'Lector AI',
  }
}

/**
 * Non-streaming completion. Returns the full assistant message string.
 */
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
    headers: buildHeaders(),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
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

/**
 * Streaming completion for arbitrary chat messages. Calls `onToken` with each
 * delta. Returns the full concatenated text once complete.
 */
export async function streamChat(
  messages: ChatMessage[],
  options: { maxTokens: number; temperature: number },
  onToken: (delta: string) => void
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('API_KEY_NOT_CONFIGURED')
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stream: true,
    }),
  })

  if (!response.ok || !response.body) {
    const errorData = await response.text().catch(() => '')
    console.error('OpenRouter stream error:', response.status, errorData)
    throw new Error('AI_SERVICE_ERROR')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by blank lines.
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || !line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return full

      try {
        const json = JSON.parse(payload)
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          full += delta
          onToken(delta)
        }
      } catch {
        // Partial JSON across chunks — ignore; next read completes it.
      }
    }
  }

  return full
}

export type { ChatMessage }
