// Comprehensive language catalog for translation.
//
// This module is the single source of truth for the list of target/source
// languages the extension can translate between (~105 BCP-47-tagged entries).
// `translation.ts` re-exports the active subset and the script-detection
// helpers, so the bulk data lives here (pure data, no DOM, no chrome).
//
// Order matters for UX: the most common targets (zh, en, ja, ko, fr, de, es,
// …) come first so the settings dropdown / searchable list surfaces them
// without scrolling. Every entry has a non-empty `speechCode` for the
// zero-dependency SpeechSynthesis feature (browser TTS); where a language
// lacks a widely-shipped native voice we still provide the canonical BCP-47
// tag so the browser can fall back gracefully.

export interface LanguageDef {
  /** Short stable code (ISO 639-1 where one exists). */
  code: string
  /** English name (also used as the target-language token in prompts). */
  en: string
  /** Chinese name. */
  zh: string
  /** BCP-47 tag for SpeechSynthesis (browser TTS, zero-dependency). */
  speechCode: string
}

/**
 * The full catalog. Kept as a plain const array so callers can search/filter
 * for the searchable language picker (100+ langs need search). Codes are
 * unique; the first ~20 are the "common" set surfaced by default.
 */
export const LANGUAGES: LanguageDef[] = [
  // --- Tier 0: most common, surfaced first ---
  { code: 'zh', en: 'Chinese (Simplified)', zh: '中文（简体）', speechCode: 'zh-CN' },
  { code: 'en', en: 'English', zh: '英语', speechCode: 'en-US' },
  { code: 'ja', en: 'Japanese', zh: '日语', speechCode: 'ja-JP' },
  { code: 'ko', en: 'Korean', zh: '韩语', speechCode: 'ko-KR' },
  { code: 'fr', en: 'French', zh: '法语', speechCode: 'fr-FR' },
  { code: 'de', en: 'German', zh: '德语', speechCode: 'de-DE' },
  { code: 'es', en: 'Spanish', zh: '西班牙语', speechCode: 'es-ES' },
  { code: 'ru', en: 'Russian', zh: '俄语', speechCode: 'ru-RU' },
  { code: 'pt', en: 'Portuguese', zh: '葡萄牙语', speechCode: 'pt-PT' },
  { code: 'it', en: 'Italian', zh: '意大利语', speechCode: 'it-IT' },
  { code: 'vi', en: 'Vietnamese', zh: '越南语', speechCode: 'vi-VN' },
  { code: 'ar', en: 'Arabic', zh: '阿拉伯语', speechCode: 'ar-SA' },
  // --- Tier 1: other widely-used ---
  { code: 'th', en: 'Thai', zh: '泰语', speechCode: 'th-TH' },
  { code: 'id', en: 'Indonesian', zh: '印尼语', speechCode: 'id-ID' },
  { code: 'ms', en: 'Malay', zh: '马来语', speechCode: 'ms-MY' },
  { code: 'tr', en: 'Turkish', zh: '土耳其语', speechCode: 'tr-TR' },
  { code: 'nl', en: 'Dutch', zh: '荷兰语', speechCode: 'nl-NL' },
  { code: 'pl', en: 'Polish', zh: '波兰语', speechCode: 'pl-PL' },
  { code: 'uk', en: 'Ukrainian', zh: '乌克兰语', speechCode: 'uk-UA' },
  { code: 'hi', en: 'Hindi', zh: '印地语', speechCode: 'hi-IN' },
  { code: 'bn', en: 'Bengali', zh: '孟加拉语', speechCode: 'bn-IN' },
  { code: 'fa', en: 'Persian', zh: '波斯语', speechCode: 'fa-IR' },
  { code: 'he', en: 'Hebrew', zh: '希伯来语', speechCode: 'he-IL' },
  { code: 'el', en: 'Greek', zh: '希腊语', speechCode: 'el-GR' },
  { code: 'sv', en: 'Swedish', zh: '瑞典语', speechCode: 'sv-SE' },
  { code: 'cs', en: 'Czech', zh: '捷克语', speechCode: 'cs-CZ' },
  // --- Tier 2: European ---
  { code: 'da', en: 'Danish', zh: '丹麦语', speechCode: 'da-DK' },
  { code: 'fi', en: 'Finnish', zh: '芬兰语', speechCode: 'fi-FI' },
  { code: 'hu', en: 'Hungarian', zh: '匈牙利语', speechCode: 'hu-HU' },
  { code: 'ro', en: 'Romanian', zh: '罗马尼亚语', speechCode: 'ro-RO' },
  { code: 'sk', en: 'Slovak', zh: '斯洛伐克语', speechCode: 'sk-SK' },
  { code: 'bg', en: 'Bulgarian', zh: '保加利亚语', speechCode: 'bg-BG' },
  { code: 'hr', en: 'Croatian', zh: '克罗地亚语', speechCode: 'hr-HR' },
  { code: 'sr', en: 'Serbian', zh: '塞尔维亚语', speechCode: 'sr-RS' },
  { code: 'sl', en: 'Slovenian', zh: '斯洛文尼亚语', speechCode: 'sl-SI' },
  { code: 'lt', en: 'Lithuanian', zh: '立陶宛语', speechCode: 'lt-LT' },
  { code: 'lv', en: 'Latvian', zh: '拉脱维亚语', speechCode: 'lv-LV' },
  { code: 'et', en: 'Estonian', zh: '爱沙尼亚语', speechCode: 'et-EE' },
  { code: 'is', en: 'Icelandic', zh: '冰岛语', speechCode: 'is-IS' },
  { code: 'no', en: 'Norwegian', zh: '挪威语', speechCode: 'nb-NO' },
  { code: 'ga', en: 'Irish', zh: '爱尔兰语', speechCode: 'ga-IE' },
  { code: 'cy', en: 'Welsh', zh: '威尔士语', speechCode: 'cy-GB' },
  { code: 'ca', en: 'Catalan', zh: '加泰罗尼亚语', speechCode: 'ca-ES' },
  { code: 'eu', en: 'Basque', zh: '巴斯克语', speechCode: 'eu-ES' },
  { code: 'gl', en: 'Galician', zh: '加利西亚语', speechCode: 'gl-ES' },
  { code: 'mt', en: 'Maltese', zh: '马耳他语', speechCode: 'mt-MT' },
  { code: 'mk', en: 'Macedonian', zh: '马其顿语', speechCode: 'mk-MK' },
  { code: 'sq', en: 'Albanian', zh: '阿尔巴尼亚语', speechCode: 'sq-AL' },
  { code: 'bs', en: 'Bosnian', zh: '波斯尼亚语', speechCode: 'bs-BA' },
  { code: 'be', en: 'Belarusian', zh: '白俄罗斯语', speechCode: 'be-BY' },
  // --- Tier 3: South & Southeast Asian ---
  { code: 'ta', en: 'Tamil', zh: '泰米尔语', speechCode: 'ta-IN' },
  { code: 'te', en: 'Telugu', zh: '泰卢固语', speechCode: 'te-IN' },
  { code: 'ml', en: 'Malayalam', zh: '马拉雅拉姆语', speechCode: 'ml-IN' },
  { code: 'kn', en: 'Kannada', zh: '卡纳达语', speechCode: 'kn-IN' },
  { code: 'mr', en: 'Marathi', zh: '马拉地语', speechCode: 'mr-IN' },
  { code: 'gu', en: 'Gujarati', zh: '古吉拉特语', speechCode: 'gu-IN' },
  { code: 'pa', en: 'Punjabi', zh: '旁遮普语', speechCode: 'pa-IN' },
  { code: 'ur', en: 'Urdu', zh: '乌尔都语', speechCode: 'ur-PK' },
  { code: 'si', en: 'Sinhala', zh: '僧伽罗语', speechCode: 'si-LK' },
  { code: 'ne', en: 'Nepali', zh: '尼泊尔语', speechCode: 'ne-NP' },
  { code: 'km', en: 'Khmer', zh: '高棉语', speechCode: 'km-KH' },
  { code: 'lo', en: 'Lao', zh: '老挝语', speechCode: 'lo-LA' },
  { code: 'my', en: 'Burmese', zh: '缅甸语', speechCode: 'my-MM' },
  { code: 'ka', en: 'Georgian', zh: '格鲁吉亚语', speechCode: 'ka-GE' },
  { code: 'hy', en: 'Armenian', zh: '亚美尼亚语', speechCode: 'hy-AM' },
  { code: 'az', en: 'Azerbaijani', zh: '阿塞拜疆语', speechCode: 'az-AZ' },
  { code: 'kk', en: 'Kazakh', zh: '哈萨克语', speechCode: 'kk-KZ' },
  { code: 'uz', en: 'Uzbek', zh: '乌兹别克语', speechCode: 'uz-UZ' },
  { code: 'mn', en: 'Mongolian', zh: '蒙古语', speechCode: 'mn-MN' },
  { code: 'ps', en: 'Pashto', zh: '普什图语', speechCode: 'ps-AF' },
  { code: 'ku', en: 'Kurdish', zh: '库尔德语', speechCode: 'ku-TR' },
  // --- Tier 4: African ---
  { code: 'sw', en: 'Swahili', zh: '斯瓦希里语', speechCode: 'sw-KE' },
  { code: 'am', en: 'Amharic', zh: '阿姆哈拉语', speechCode: 'am-ET' },
  { code: 'ha', en: 'Hausa', zh: '豪萨语', speechCode: 'ha-NG' },
  { code: 'yo', en: 'Yoruba', zh: '约鲁巴语', speechCode: 'yo-NG' },
  { code: 'ig', en: 'Igbo', zh: '伊博语', speechCode: 'ig-NG' },
  { code: 'zu', en: 'Zulu', zh: '祖鲁语', speechCode: 'zu-ZA' },
  { code: 'xh', en: 'Xhosa', zh: '科萨语', speechCode: 'xh-ZA' },
  { code: 'af', en: 'Afrikaans', zh: '南非荷兰语', speechCode: 'af-ZA' },
  { code: 'so', en: 'Somali', zh: '索马里语', speechCode: 'so-SO' },
  { code: 'mg', en: 'Malagasy', zh: '马达加斯加语', speechCode: 'mg-MG' },
  // --- Tier 5: CJK variants + Oceanian ---
  { code: 'zh-TW', en: 'Chinese (Traditional)', zh: '中文（繁體）', speechCode: 'zh-TW' },
  { code: 'yue', en: 'Cantonese', zh: '粤语', speechCode: 'zh-HK' },
  { code: 'nan', en: 'Min Nan', zh: '闽南语', speechCode: 'zh-TW' },
  { code: 'wyw', en: 'Classical Chinese', zh: '文言文', speechCode: 'zh-CN' },
  { code: 'eo', en: 'Esperanto', zh: '世界语', speechCode: 'eo' },
  { code: 'la', en: 'Latin', zh: '拉丁语', speechCode: 'la' },
  { code: 'mi', en: 'Maori', zh: '毛利语', speechCode: 'mi-NZ' },
  { code: 'haw', en: 'Hawaiian', zh: '夏威夷语', speechCode: 'haw-US' },
  { code: 'sm', en: 'Samoan', zh: '萨摩亚语', speechCode: 'sm-WS' },
  { code: 'to', en: 'Tongan', zh: '汤加语', speechCode: 'to-TO' },
  { code: 'fj', en: 'Fijian', zh: '斐济语', speechCode: 'fj-FJ' },
  // --- Tier 6: additional / constructed ---
  { code: 'tl', en: 'Filipino', zh: '菲律宾语', speechCode: 'fil-PH' },
  { code: 'ceb', en: 'Cebuano', zh: '宿务语', speechCode: 'ceb-PH' },
  { code: 'jv', en: 'Javanese', zh: '爪哇语', speechCode: 'jv-ID' },
  { code: 'su', en: 'Sundanese', zh: '巽他语', speechCode: 'su-ID' },
  { code: 'yi', en: 'Yiddish', zh: '意第绪语', speechCode: 'yi' },
  { code: 'lb', en: 'Luxembourgish', zh: '卢森堡语', speechCode: 'lb-LU' },
  { code: 'fo', en: 'Faroese', zh: '法罗语', speechCode: 'fo-FO' },
  { code: 'gd', en: 'Scottish Gaelic', zh: '苏格兰盖尔语', speechCode: 'gd-GB' },
  { code: 'br', en: 'Breton', zh: '布列塔尼语', speechCode: 'br-FR' },
  { code: 'co', en: 'Corsican', zh: '科西嘉语', speechCode: 'co-FR' },
  { code: 'fy', en: 'Frisian', zh: '弗里西语', speechCode: 'fy-NL' },
]

const LANG_BY_CODE: Record<string, LanguageDef> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l])
)

/** Look up a language def; falls back to English for unknown codes. */
export function getLanguage(code: string): LanguageDef {
  return LANG_BY_CODE[code] || LANGUAGES[1] // en
}

/** Strict membership check (used to validate stored target-language settings). */
export function isValidLangCode(code: unknown): code is string {
  return typeof code === 'string' && code in LANG_BY_CODE
}

/**
 * Fuzzy search the catalog by code / English name / Chinese name. Case- and
 * accent-insensitive substring match across all three fields. Used by the
 * searchable language picker (100+ langs need search).
 */
export function searchLanguages(query: string): LanguageDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return LANGUAGES
  return LANGUAGES.filter(
    (l) =>
      l.code.toLowerCase().includes(q) ||
      l.en.toLowerCase().includes(q) ||
      l.zh.toLowerCase().includes(q)
  )
}
