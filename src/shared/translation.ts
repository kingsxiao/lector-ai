// Translation subsystem — pure logic, zero DOM, zero chrome API.
// All exports are unit-testable in jsdom. This module is the single source
// of truth for translation direction, language metadata, prompt building,
// concurrency control, block selection, and history LRU.

export type TargetLangCode =
  | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de'
  | 'es' | 'ru' | 'pt' | 'it' | 'vi' | 'ar'

export interface LanguageDef {
  code: TargetLangCode
  /** English name (also used as the translation target token in prompts). */
  en: string
  /** Chinese name. */
  zh: string
  /** BCP-47 tag for SpeechSynthesis (browser TTS, zero-dependency). */
  speechCode: string
}

// zh/en first (most common), then by usage frequency.
export const LANGUAGES: LanguageDef[] = [
  { code: 'zh', en: 'Chinese',    zh: '中文',     speechCode: 'zh-CN' },
  { code: 'en', en: 'English',    zh: '英语',     speechCode: 'en-US' },
  { code: 'ja', en: 'Japanese',   zh: '日语',     speechCode: 'ja-JP' },
  { code: 'ko', en: 'Korean',     zh: '韩语',     speechCode: 'ko-KR' },
  { code: 'fr', en: 'French',     zh: '法语',     speechCode: 'fr-FR' },
  { code: 'de', en: 'German',     zh: '德语',     speechCode: 'de-DE' },
  { code: 'es', en: 'Spanish',    zh: '西班牙语', speechCode: 'es-ES' },
  { code: 'ru', en: 'Russian',    zh: '俄语',     speechCode: 'ru-RU' },
  { code: 'pt', en: 'Portuguese', zh: '葡萄牙语', speechCode: 'pt-PT' },
  { code: 'it', en: 'Italian',    zh: '意大利语', speechCode: 'it-IT' },
  { code: 'vi', en: 'Vietnamese', zh: '越南语',   speechCode: 'vi-VN' },
  { code: 'ar', en: 'Arabic',     zh: '阿拉伯语', speechCode: 'ar-SA' },
]

const LANG_BY_CODE: Record<TargetLangCode, LanguageDef> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l])
) as Record<TargetLangCode, LanguageDef>

/** Look up a language def; falls back to English for unknown codes. */
export function getLanguage(code: TargetLangCode): LanguageDef {
  return LANG_BY_CODE[code] || LANGUAGES[1] // en
}

export type Script = 'cjk' | 'cyrillic' | 'arabic' | 'latin'

/**
 * Detect the dominant script of a text by counting characters in each range.
 * Used to pick a sensible default target language (the "opposite" of the
 * source), matching the pre-existing zh<->en heuristic intuition.
 */
export function detectScript(text: string): Script {
  let cjk = 0, cyrillic = 0, arabic = 0, latin = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
        (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3040 && c <= 0x30ff) ||
        (c >= 0xac00 && c <= 0xd7af)) {
      cjk++
    } else if (c >= 0x0400 && c <= 0x04ff) {
      cyrillic++
    } else if (c >= 0x0600 && c <= 0x06ff) {
      arabic++
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      latin++
    }
  }
  if (cjk >= cyrillic && cjk >= arabic && cjk > 0) return 'cjk'
  if (cyrillic >= arabic && cyrillic > 0) return 'cyrillic'
  if (arabic > 0) return 'arabic'
  return 'latin'
}

export type TargetLangSetting = TargetLangCode | 'auto'

/**
 * Resolve the final target language. An explicit user choice wins; 'auto'
 * picks the "opposite" of the detected source script (CJK -> English, else
 * Chinese), preserving the existing intuition.
 */
export function resolveTargetLang(setting: TargetLangSetting, sourceText: string): TargetLangCode {
  if (setting !== 'auto') return setting
  return detectScript(sourceText) === 'cjk' ? 'en' : 'zh'
}
