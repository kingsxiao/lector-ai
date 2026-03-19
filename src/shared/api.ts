const API_BASE = 'https://your-app.vercel.app/api'

export interface SummarizeResponse {
  summary: string
  keyPoints: string[]
}

export async function summarizeUrl(url: string): Promise<SummarizeResponse> {
  const response = await fetch(`${API_BASE}/summarize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  })

  if (!response.ok) {
    throw new Error('Failed to summarize')
  }

  return response.json()
}

export async function translateText(text: string, targetLang: string = 'en'): Promise<string> {
  const response = await fetch(`${API_BASE}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, targetLang }),
  })

  if (!response.ok) {
    throw new Error('Failed to translate')
  }

  const data = await response.json()
  return data.translatedText
}
