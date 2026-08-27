// Provider catalog for BYOK (Bring Your Own Key).
//
// The user supplies their own API key; the extension calls the provider
// directly. Model lists are fetched live from each provider's /models
// endpoint via the "Refresh" button — the preset models below are just
// convenient fallbacks for when the fetch fails or hasn't run yet.

import type { Locale, LocalePref } from './i18n'
export type { Locale, LocalePref }
import { isValidDisplayMode, isValidLangCode, type DisplayMode, type TargetLangCode } from './translation'
import { isValidThemeId, clampFontSize } from './translationThemes'
import { isValidPersonaId } from './translationPersonas'
import { normalizeSiteRules, type SiteRule } from './siteRules'
import { DEFAULT_THEME_ID, normalizeThemeId } from './themes'

export type ProviderId =
  // OpenAI-compatible hosts (overseas)
  | 'openai'
  | 'openrouter'
  | 'groq'
  | 'together'
  | 'mistral'
  | 'xai'
  | 'perplexity'
  | 'fireworks'
  // 国内厂商 (OpenAI 兼容)
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'siliconflow'
  | 'qwen'
  | 'ernie'
  | 'doubao'
  | 'minimax'
  | 'lingyi'
  | 'stepfun'
  // Different wire format
  | 'anthropic'
  // Any OpenAI-compatible host the user types in
  | 'openrouter-custom'
  | 'custom'

export interface ProviderModel {
  id: string
  label?: string
}

export type ProviderTransport =
  | 'openai-responses'
  | 'openai-chat-completions'
  | 'anthropic-messages'

export interface ProviderDef {
  id: ProviderId
  label: string
  description: string
  docsUrl: string
  /** Where the user obtains a key. */
  keyUrl: string
  /** Default base URL. */
  baseUrl: string
  /**
   * Path appended to baseUrl to list models. Almost every OpenAI-compatible
   * host uses '/models' (resolved to '{baseUrl}/models'). Anthropic uses
   * '/v1/models'.
   */
  modelsPath: string
  /** Concrete generation protocol used by this provider. Translation is the
   * product task; these names describe only the provider wire transport. */
  transport: ProviderTransport
  /** Sensible default model id. */
  defaultModel: string
  /** Convenience presets shown before the user fetches live models. */
  models: ProviderModel[]
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT-4o, o-series, and more.',
    docsUrl: 'https://platform.openai.com/docs',
    keyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    transport: 'openai-responses',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (cheap)' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models.',
    docsUrl: 'https://docs.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com',
    modelsPath: '/v1/models',
    transport: 'anthropic-messages',
    defaultModel: 'claude-haiku-4-5-20251001',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'One key, every model (GPT, Claude, Gemini, Llama, …). Recommended.',
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini (cheap)' },
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
      { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek-V3 / R1. Excellent value.',
    docsUrl: 'https://api-docs.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3 (chat)' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1 (reasoning)' },
    ],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    description: 'Ultra-fast Llama / Mixtral / Gemma inference.',
    docsUrl: 'https://console.groq.com/docs',
    keyUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (instant)' },
    ],
  },
  together: {
    id: 'together',
    label: 'Together AI',
    description: 'Open models at scale (Llama, Qwen, DeepSeek, …).',
    docsUrl: 'https://docs.together.ai',
    keyUrl: 'https://api.together.xyz/settings/api-keys',
    baseUrl: 'https://api.together.xyz/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
    ],
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral / La Plateforme',
    description: 'Mistral family (Large, Small, Codestral, …).',
    docsUrl: 'https://docs.mistral.ai',
    keyUrl: 'https://console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'mistral-small-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest', label: 'Codestral' },
    ],
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    description: 'Grok models.',
    docsUrl: 'https://docs.x.ai',
    keyUrl: 'https://console.x.ai',
    baseUrl: 'https://api.x.ai/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'grok-2-latest',
    models: [
      { id: 'grok-2-latest', label: 'Grok 2' },
      { id: 'grok-2-vision-latest', label: 'Grok 2 Vision' },
    ],
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    description: 'Kimi / Moonshot models (CJK-friendly).',
    docsUrl: 'https://platform.moonshot.cn/docs',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'moonshot-v1-8k',
    models: [
      { id: 'moonshot-v1-8k', label: 'Moonshot v1 8k' },
      { id: 'moonshot-v1-32k', label: 'Moonshot v1 32k' },
      { id: 'moonshot-v1-128k', label: 'Moonshot v1 128k' },
    ],
  },
  zhipu: {
    id: 'zhipu',
    label: 'Zhipu (智谱 GLM)',
    description: 'GLM-4 family (中文友好).',
    docsUrl: 'https://open.bigmodel.cn/dev/api',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'glm-4-flash',
    models: [
      { id: 'glm-4-plus', label: 'GLM-4-Plus' },
      { id: 'glm-4-flash', label: 'GLM-4-Flash (free tier)' },
      { id: 'glm-4-air', label: 'GLM-4-Air' },
    ],
  },
  siliconflow: {
    id: 'siliconflow',
    label: 'SiliconFlow (硅基流动)',
    description: 'Aggregator for many open models (Qwen, DeepSeek, GLM, …).',
    docsUrl: 'https://docs.siliconflow.cn',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
      { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B' },
    ],
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    description: 'Online models with web search (sonar).',
    docsUrl: 'https://docs.perplexity.ai',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    baseUrl: 'https://api.perplexity.ai',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'llama-3.1-sonar-small-128k-online',
    models: [
      { id: 'llama-3.1-sonar-large-128k-online', label: 'Sonar Large (online)' },
      { id: 'llama-3.1-sonar-small-128k-online', label: 'Sonar Small (online)' },
    ],
  },
  fireworks: {
    id: 'fireworks',
    label: 'Fireworks AI',
    description: 'Fast open-model inference.',
    docsUrl: 'https://docs.fireworks.ai',
    keyUrl: 'https://fireworks.ai/account/api-keys',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    models: [
      { id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 3.1 70B' },
      { id: 'accounts/fireworks/models/deepseek-v3', label: 'DeepSeek V3' },
    ],
  },
  qwen: {
    id: 'qwen',
    label: '通义千问 (阿里云百炼)',
    description: 'Qwen 系列，通过阿里云百炼 OpenAI 兼容入口。',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'qwen-plus',
    models: [
      { id: 'qwen-max', label: 'qwen-max' },
      { id: 'qwen-plus', label: 'qwen-plus' },
      { id: 'qwen-turbo', label: 'qwen-turbo' },
      { id: 'qwen-long', label: 'qwen-long (长文)' },
    ],
  },
  ernie: {
    id: 'ernie',
    label: '文心一言 (百度千帆)',
    description: 'ERNIE 系列，通过千帆 OpenAI 兼容入口。',
    docsUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/s/3lm3h2cbz',
    keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'ernie-4.0-8k-latest',
    models: [
      { id: 'ernie-4.0-turbo-8k', label: 'ERNIE 4.0 Turbo' },
      { id: 'ernie-4.0-8k-latest', label: 'ERNIE 4.0' },
      { id: 'ernie-3.5-8k', label: 'ERNIE 3.5' },
      { id: 'ernie-speed-8k', label: 'ERNIE Speed (免费)' },
    ],
  },
  doubao: {
    id: 'doubao',
    label: '豆包 (字节火山引擎)',
    description: 'Doubao 系列，通过火山方舟 OpenAI 兼容入口。模型填「接入点 id (ep-xxx)」，建议点「拉取模型列表」。',
    docsUrl: 'https://www.volcengine.com/docs/82379/1330626',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'doubao-pro-32k',
    models: [
      { id: 'doubao-pro-32k', label: 'Doubao Pro 32k' },
      { id: 'doubao-pro-128k', label: 'Doubao Pro 128k' },
      { id: 'doubao-lite-32k', label: 'Doubao Lite 32k' },
    ],
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    description: 'abab / MiniMax 系列。',
    docsUrl: 'https://platform.minimaxi.com/document/ChatCompletion%20v2',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    baseUrl: 'https://api.minimax.chat/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'abab6.5s-chat',
    models: [
      { id: 'abab6.5s-chat', label: 'abab6.5s' },
      { id: 'abab6.5-chat', label: 'abab6.5' },
    ],
  },
  lingyi: {
    id: 'lingyi',
    label: '零一万物 (01.AI)',
    description: 'Yi 系列。',
    docsUrl: 'https://platform.lingyiwanwu.com/docs',
    keyUrl: 'https://platform.lingyiwanwu.com/apikeys',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'yi-large',
    models: [
      { id: 'yi-large', label: 'Yi-Large' },
      { id: 'yi-medium', label: 'Yi-Medium' },
      { id: 'yi-lightning', label: 'Yi-Lightning' },
    ],
  },
  stepfun: {
    id: 'stepfun',
    label: '阶跃星辰 (Step)',
    description: 'Step 系列。',
    docsUrl: 'https://platform.stepfun.com/docs',
    keyUrl: 'https://platform.stepfun.com/interface-key',
    baseUrl: 'https://api.stepfun.com/v1',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: 'step-1-8k',
    models: [
      { id: 'step-1-8k', label: 'Step-1 8k' },
      { id: 'step-1-32k', label: 'Step-1 32k' },
      { id: 'step-1-128k', label: 'Step-1 128k' },
      { id: 'step-1-flash', label: 'Step-1 Flash (快)' },
    ],
  },
  'openrouter-custom': {
    id: 'openrouter-custom',
    label: 'Custom (OpenAI-compatible)',
    description: 'Any OpenAI-compatible host: Ollama, vLLM, LM Studio, LocalAI, your own gateway, …',
    docsUrl: '',
    keyUrl: '',
    baseUrl: '', // user supplies
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: '',
    models: [],
  },
  custom: {
    // Alias kept for backward-compat with stored settings — behaves like
    // openrouter-custom. New UI uses 'openrouter-custom'.
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    description: 'Any OpenAI-compatible host.',
    docsUrl: '',
    keyUrl: '',
    baseUrl: '',
    modelsPath: '/models',
    transport: 'openai-chat-completions',
    defaultModel: '',
    models: [],
  },
}

export interface TranslationSettings {
  /** Target language; 'auto' infers the opposite of the source script. */
  targetLanguage: TargetLangCode | 'auto'
  /** How bilingual translations are rendered on the page. */
  displayMode: DisplayMode
  /** Auto-translate the whole page on load when enabled. Default false. */
  autoTranslate: boolean
  /** Max in-flight translation requests for page mode. 1–10. Default 5. */
  concurrency: number
  /** Bilingual-translation visual theme id (see translationThemes.ts). Default 'default'. */
  theme: string
  /** Relative font size for bilingual translations (0.6–1.6). Default 0.92. */
  fontSize: number
  /** User-authored CSS appended verbatim to the injected theme stylesheet. */
  customCss: string
  /** Reading-focus mode: dims the source so the translation reads primary. */
  readingFocus: boolean
  /** Per-domain rules (always/never translate, custom selectors/engine). */
  siteRules: SiteRule[]
  /** Translation cache time-to-live in days; 0 disables cache. Default 30. */
  cacheTtlDays: number
  /** AI Expert persona id (see translationPersonas.ts). Default 'general'. */
  persona: string
  /** Scope page translation to the detected main content (smart) vs body (whole).
   *  Default 'whole' = translate every translatable block in the document
   *  (the long-standing behavior, and what Immersive Translate does). 'smart'
   *  is an opt-in that restricts to the detected main-content root — useful on
   *  noisy pages but can DROP text on list/app pages (e.g. GitHub repo lists),
   *  so it must NOT be the default. */
  pageScope: 'smart' | 'whole'
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  targetLanguage: 'auto',
  displayMode: 'bilingual',
  autoTranslate: false,
  concurrency: 5,
  theme: 'default',
  fontSize: 0.92,
  customCss: '',
  readingFocus: false,
  siteRules: [],
  cacheTtlDays: 30,
  persona: 'general',
  pageScope: 'whole',
}

/** Coerce arbitrary stored data into a valid TranslationSettings (migration-safe). */
export function normalizeTranslationSettings(raw: unknown): TranslationSettings {
  const base = { ...DEFAULT_TRANSLATION_SETTINGS }
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  if (r.targetLanguage === 'auto' || isValidLangCode(r.targetLanguage)) {
    base.targetLanguage = r.targetLanguage as TargetLangCode | 'auto'
  }
  if (isValidDisplayMode(r.displayMode)) base.displayMode = r.displayMode
  if (typeof r.autoTranslate === 'boolean') base.autoTranslate = r.autoTranslate
  if (typeof r.concurrency === 'number' && !Number.isNaN(r.concurrency)) {
    base.concurrency = Math.max(1, Math.min(10, Math.floor(r.concurrency)))
  }
  if (isValidThemeId(r.theme)) base.theme = r.theme
  if (typeof r.fontSize === 'number') base.fontSize = clampFontSize(r.fontSize)
  if (typeof r.customCss === 'string') base.customCss = r.customCss
  if (typeof r.readingFocus === 'boolean') base.readingFocus = r.readingFocus
  if (Array.isArray(r.siteRules)) base.siteRules = normalizeSiteRules(r.siteRules)
  if (typeof r.cacheTtlDays === 'number' && !Number.isNaN(r.cacheTtlDays)) {
    base.cacheTtlDays = Math.max(0, Math.floor(r.cacheTtlDays))
  }
  if (isValidPersonaId(r.persona)) base.persona = r.persona
  if (r.pageScope === 'smart' || r.pageScope === 'whole') base.pageScope = r.pageScope
  return base
}

export interface ByokSettings {
  provider: ProviderId
  apiKey: string
  model: string
  /** Only used by the custom provider. */
  baseUrl: string
  /** UI language: 'auto' follows the browser locale. */
  locale: LocalePref
  /** Panel color scheme. 'auto' (default when unset) follows
   * prefers-color-scheme; light/dark pin it explicitly. */
  theme?: 'auto' | 'light' | 'dark'
  /** Panel color palette (paper tint + accent family, see shared/themes.ts).
   * Absent/invalid falls back to 'paper'. Independent of light/dark scheme. */
  palette?: string
  /** AnkiConnect config for the "send to Anki" feature. Optional — when unset
   * the UI uses defaults from src/shared/anki.ts via withAnkiDefaults(). */
  anki?: {
    url: string
    deckName: string
    modelName: string
    tags: string[]
  }
  /** Translation feature settings (target language, display mode, etc.). */
  translation?: TranslationSettings
}

export const DEFAULT_BYOK_SETTINGS: ByokSettings = {
  provider: 'openrouter',
  apiKey: '',
  model: PROVIDERS.openrouter.defaultModel,
  baseUrl: '',
  locale: 'auto',
  theme: 'auto',
  palette: DEFAULT_THEME_ID,
}

const RETIRED_MODEL_REPLACEMENTS: Partial<Record<ProviderId, Record<string, string>>> = {
  openai: {
    'o1-mini': 'gpt-4o-mini',
    'o1-mini-2024-09-12': 'gpt-4o-mini',
  },
  anthropic: {
    'claude-3-5-haiku-latest': 'claude-haiku-4-5-20251001',
    'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001',
    'claude-3-haiku-latest': 'claude-haiku-4-5-20251001',
    'claude-3-haiku-20240307': 'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-latest': 'claude-sonnet-4-6',
    'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
    'claude-3-opus-latest': 'claude-opus-4-8',
    'claude-3-opus-20240229': 'claude-opus-4-8',
  },
  openrouter: {
    'anthropic/claude-3.5-haiku': 'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet': 'anthropic/claude-sonnet-4.6',
    'google/gemini-flash-1.5': 'openai/gpt-4o-mini',
  },
}

function migrateRetiredModel(provider: ProviderId, model: string): string {
  return RETIRED_MODEL_REPLACEMENTS[provider]?.[model] || model
}

/** Coerce persisted/cross-context settings into a render-safe shape. */
export function normalizeByokSettings(raw: unknown): ByokSettings {
  const r = raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : {}
  const provider =
    typeof r.provider === 'string' && r.provider in PROVIDERS
      ? r.provider as ProviderId
      : DEFAULT_BYOK_SETTINGS.provider
  const locale: LocalePref =
    r.locale === 'en' || r.locale === 'zh' || r.locale === 'auto'
      ? r.locale
      : DEFAULT_BYOK_SETTINGS.locale
  const result: ByokSettings = {
    provider,
    apiKey: typeof r.apiKey === 'string' ? r.apiKey : '',
    model: typeof r.model === 'string'
      ? migrateRetiredModel(provider, r.model)
      : getProvider(provider).defaultModel,
    baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : '',
    locale,
    // Absent/invalid theme stays undefined — App treats undefined as 'auto'.
    theme:
      r.theme === 'dark' || r.theme === 'light' || r.theme === 'auto'
        ? r.theme
        : undefined,
    // Palette is always normalized to a valid theme id — every consumer
    // (dataset attribute, CSS selector) assumes it exists.
    palette: normalizeThemeId(r.palette),
  }
  if (r.translation !== undefined) {
    result.translation = normalizeTranslationSettings(r.translation)
  }
  if (r.anki && typeof r.anki === 'object') {
    const a = r.anki as Record<string, unknown>
    result.anki = {
      url: typeof a.url === 'string' ? a.url : '',
      deckName: typeof a.deckName === 'string' ? a.deckName : '',
      modelName: typeof a.modelName === 'string' ? a.modelName : '',
      tags: Array.isArray(a.tags)
        ? a.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
    }
  }
  return result
}

export function getProvider(id: ProviderId): ProviderDef {
  return PROVIDERS[id] || PROVIDERS.openrouter
}

/**
 * Resolve the effective baseUrl for a settings object. Custom providers use
 * the user-supplied URL; presets use their configured baseUrl. A trailing
 * slash is stripped so paths join cleanly.
 */
export function resolveBaseUrl(s: ByokSettings, def: ProviderDef): string {
  const raw = s.provider === 'custom' || s.provider === 'openrouter-custom' ? s.baseUrl : def.baseUrl
  return (raw || '').replace(/\/+$/, '')
}
