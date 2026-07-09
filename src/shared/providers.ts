// Provider definitions for BYOK (Bring Your Own Key).
//
// The user supplies their own API key; the extension calls the provider
// directly. No backend, no registration, no payment. Model lists include
// sensible defaults but the UI always allows a custom model id so the list
// never goes stale.

export type ProviderId = 'openai' | 'anthropic' | 'openrouter' | 'custom'

export interface ProviderModel {
  id: string
  label: string
}

export interface ProviderDef {
  id: ProviderId
  label: string
  description: string
  docsUrl: string
  /** Where the user obtains a key. */
  keyUrl: string
  /** Default base URL for OpenAI-compatible providers. */
  baseUrl: string
  /** Wire format the client must speak. */
  format: 'openai' | 'anthropic'
  models: ProviderModel[]
  /** Placeholder shown in the custom-model input. */
  defaultModel: string
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT-4o and friends. Use a standard OpenAI API key.',
    docsUrl: 'https://platform.openai.com/docs',
    keyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    format: 'openai',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'o1-mini', label: 'o1-mini' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models. Needs an Anthropic API key.',
    docsUrl: 'https://docs.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com',
    format: 'anthropic',
    defaultModel: 'claude-3-5-haiku-latest',
    models: [
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (fast)' },
      { id: 'claude-3-opus-latest', label: 'Claude 3 Opus' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'One key, every model (GPT, Claude, Gemini, Llama, …). Recommended.',
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    format: 'openai',
    defaultModel: 'anthropic/claude-3.5-haiku',
    models: [
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (fast)' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini (cheap)' },
      { id: 'google/gemini-flash-1.5', label: 'Gemini 1.5 Flash' },
      { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B' },
    ],
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    description: 'Any OpenAI-compatible endpoint: DeepSeek, Groq, Together, Ollama, etc.',
    docsUrl: '',
    keyUrl: '',
    baseUrl: '', // user supplies
    format: 'openai',
    defaultModel: '',
    models: [],
  },
}

export interface ByokSettings {
  provider: ProviderId
  apiKey: string
  model: string
  /** Only used by the "custom" provider. */
  baseUrl: string
}

export const DEFAULT_BYOK_SETTINGS: ByokSettings = {
  provider: 'openrouter',
  apiKey: '',
  model: 'anthropic/claude-3.5-haiku',
  baseUrl: '',
}

export function getProvider(id: ProviderId): ProviderDef {
  return PROVIDERS[id] || PROVIDERS.openrouter
}
