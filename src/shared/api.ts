import { getApiBase } from './config'

export interface SummarizeResponse {
  summary: string
  keyPoints: string[]
}

export async function summarizeUrl(url: string): Promise<SummarizeResponse> {
  const apiBase = await getApiBase()
  const response = await fetch(`${apiBase}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })

  if (!response.ok) {
    throw new Error('Failed to summarize')
  }

  return response.json()
}

export async function summarizeText(text: string): Promise<SummarizeResponse> {
  const apiBase = await getApiBase()
  const response = await fetch(`${apiBase}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!response.ok) {
    throw new Error('Failed to summarize')
  }

  return response.json()
}

export async function translateText(text: string, targetLang: string = 'en'): Promise<string> {
  const apiBase = await getApiBase()
  const response = await fetch(`${apiBase}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLang }),
  })

  if (!response.ok) {
    throw new Error('Failed to translate')
  }

  const data = await response.json()
  return data.translatedText
}
