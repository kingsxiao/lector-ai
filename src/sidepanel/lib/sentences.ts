// Sidepanel-side sentence-analysis orchestration. May touch the zustand store
// + BYOK provider (unlike the pure src/shared/sentences.ts, which stays
// domain-only and testable).
import { useStore } from '../../shared/store'
import { completeOnce } from '../../shared/byok'
import {
  SENTENCE_CARD_SYSTEM_PROMPT,
  extractTranslation,
  extractKeywords,
  extractCefr,
} from '../../shared/sentences'

/**
 * Shared core: call AI + build + save a sentence card. Returns success boolean.
 * Callers wrap their own error UX (alert vs inline ImportMsg). Module-level
 * because it has no React closure deps.
 */
export async function runSentenceAnalysis(
  sentence: string,
  url: string,
  title: string
): Promise<boolean> {
  const settings = useStore.getState().byok
  if (!settings.apiKey) return false
  const analysis = await completeOnce(settings, SENTENCE_CARD_SYSTEM_PROMPT, sentence, {
    maxTokens: 1200,
    temperature: 0.4,
  })
  useStore.getState().addSentence({
    sentence,
    translation: extractTranslation(analysis),
    analysis: analysis || '',
    keywords: extractKeywords(analysis),
    quote: '',
    url,
    title,
    lang: 'en',
    cefr: extractCefr(analysis),
    srs: null,
  })
  return true
}
