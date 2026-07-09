// Shared i18n for all surfaces (side panel, content script, background).
//
// The language preference lives in ByokSettings.locale and flows to every
// surface through chrome.storage.local. t() takes a StringKey (a literal
// union derived from STRINGS), so a typo'd or missing key is a compile error.

export type Locale = 'en' | 'zh'
export type LocalePref = 'auto' | Locale

/** Read the browser locale and map it to one of our supported locales. */
export function detectLocale(): Locale {
  const langs =
    (typeof navigator !== 'undefined' &&
      (navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : [])) ||
    []
  for (const l of langs) {
    const primary = String(l || '').toLowerCase().split('-')[0]
    if (primary === 'zh') return 'zh'
  }
  return 'en'
}

/** Resolve a pref to a concrete locale, running detection for 'auto'. */
export function resolveLocale(pref: LocalePref): Locale {
  return pref === 'auto' ? detectLocale() : pref
}

export const STRINGS = {
  // --- side panel: header / empty state ---
  'side.header.defaultTitle': { en: 'Lector AI', zh: 'Lector AI' },
  'side.header.noKey': {
    en: 'No API key — tap settings',
    zh: '未设置 API Key — 点击设置',
  },
  'side.onboard.title': { en: 'Bring your own key 🔑', zh: '自带密钥 🔑' },
  'side.onboard.body': {
    en: 'Lector is free and private — you pay your AI provider directly. Open {settings} to add a key (OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint).',
    zh: 'Lector 免费且私密 —— 你直接向 AI 服务商付费。打开{settings}添加密钥（OpenAI、Anthropic、OpenRouter 或任意 OpenAI 兼容接口）。',
  },
  'side.onboard.settingsLink': { en: 'Settings', zh: '设置' },
  'side.empty.title': { en: 'Chat with this page', zh: '与本文对话' },
  'side.empty.subtitle': {
    en: "Ask anything about the article you're reading. Lector reads the page with you.",
    zh: '向正在阅读的文章提问，Lector 与你一起阅读。',
  },
  'side.empty.noPage': {
    en: 'Open a web article, then Lector can read along.',
    zh: '打开一篇网页文章，Lector 即可一同阅读。',
  },
  'side.composer.placeholder.ready': { en: 'Ask about this page…', zh: '向本文提问…' },
  'side.composer.placeholder.noKey': {
    en: 'Add an API key in settings to begin…',
    zh: '在设置中添加 API Key 以开始…',
  },
  'side.composer.hint': {
    en: 'Enter to send · Shift+Enter for newline',
    zh: '回车发送 · Shift+回车换行',
  },
  'side.composer.newChat': { en: '+ New chat', zh: '+ 新对话' },
  'side.error.addKey': {
    en: 'Add your API key in Settings to start chatting.',
    zh: '请在设置中添加 API Key 后开始对话。',
  },
  'side.thinking': { en: 'thinking…', zh: '思考中…' },

  // --- side panel: suggestions (label only; prompt stays English) ---
  'side.suggest.summarize': { en: 'Summarize', zh: '总结全文' },
  'side.suggest.keyPoints': { en: 'Key points', zh: '关键观点' },
  'side.suggest.explain': { en: 'Explain', zh: '解释难点' },
  'side.suggest.followup': { en: 'Follow-up', zh: '继续追问' },

  // --- side panel: library drawer ---
  'side.library.title': { en: 'Library', zh: '历史记录' },
  'side.library.empty': {
    en: 'Saved conversations will appear here.',
    zh: '保存的对话将显示在此。',
  },
  'side.library.clearAll': { en: 'Clear all', zh: '全部清除' },

  // --- settings drawer ---
  'settings.title': { en: '🔑 Bring Your Own Key', zh: '🔑 自带密钥' },
  'settings.privacyNote': {
    en: 'Lector is free and private. Your key is stored only in this browser and sent directly to your chosen provider — never to us.',
    zh: 'Lector 免费且私密。你的密钥仅存储在本浏览器中，并直接发送至你选择的服务商 —— 绝不发送给我们。',
  },
  'settings.provider': { en: 'Provider', zh: '服务商' },
  'settings.baseUrl': { en: 'Base URL', zh: 'Base URL' },
  'settings.baseUrl.hint': { en: '(OpenAI-compatible)', zh: '（OpenAI 兼容）' },
  'settings.apiKey': { en: 'API Key', zh: 'API Key' },
  'settings.apiKey.placeholder': { en: 'sk-…', zh: 'sk-…' },
  'settings.apiKey.show': { en: 'show', zh: '显示' },
  'settings.apiKey.hide': { en: 'hide', zh: '隐藏' },
  'settings.apiKey.getKey': { en: 'Get a key from {label} →', zh: '从 {label} 获取密钥 →' },
  'settings.model': { en: 'Model', zh: '模型' },
  'settings.model.fetch': { en: '⬇ Fetch models', zh: '⬇ 拉取模型列表' },
  'settings.model.refetch': { en: '↻ Refetch', zh: '↻ 重新拉取' },
  'settings.model.fetching': { en: 'Fetching…', zh: '拉取中…' },
  'settings.model.custom': { en: 'Custom model id…', zh: '自定义模型 id…' },
  'settings.model.fetchedCount': { en: 'Fetched {n} models', zh: '已拉取 {n} 个模型' },
  'settings.model.fetchEmpty': {
    en: 'This endpoint returned no model list; enter the model id manually.',
    zh: '该接口未返回模型列表，请手动填写模型 id。',
  },
  'settings.model.fetchFail': { en: 'Fetch failed', zh: '拉取失败' },
  'settings.test': { en: 'Test connection', zh: '测试连接' },
  'settings.testing': { en: 'Testing…', zh: '测试中…' },
  'settings.done': { en: 'Done', zh: '完成' },
  'settings.language': { en: 'Language', zh: '语言' },
  'settings.language.auto': { en: 'Auto', zh: '自动' },
  'settings.language.en': { en: 'English', zh: 'English' },
  'settings.language.zh': { en: '中文', zh: '中文' },

  // --- content script: toolbar ---
  'toolbar.translate': { en: '🌐 Translate', zh: '🌐 翻译' },
  'toolbar.explain': { en: '💬 Explain', zh: '💬 解释' },
  'toolbar.summarize': { en: '📄 Summarize', zh: '📄 摘要' },
  'toolbar.ask': { en: '🤖 Ask', zh: '🤖 提问' },
  'toolbar.highlight': { en: '🔖 Highlight', zh: '🔖 高亮' },
  'toolbar.saveWord': { en: '📚 Save word', zh: '📚 存词' },

  // --- side panel: highlights drawer (Feature ②) ---
  'side.highlights.title': { en: 'Highlights', zh: '高亮收藏' },
  'side.highlights.empty': {
    en: 'Select text on any page and tap the highlight button to capture it.',
    zh: '在任意页面选中文字，点击高亮按钮即可收藏。',
  },
  'side.highlights.export': { en: '⬇ Export Markdown', zh: '⬇ 导出 Markdown' },

  // --- side panel: vocabulary review drawer (Feature ③) ---
  'side.vocab.title': { en: 'Vocabulary', zh: '生词本' },
  'side.vocab.empty': {
    en: 'Select a word on any page and tap the save-word button to review it.',
    zh: '在任意页面选中单词，点击存词按钮即可加入复习。',
  },
  'side.vocab.due': { en: 'due', zh: '待复习' },
  'side.vocab.reviews': { en: 'reviews', zh: '次' },
  'side.vocab.showTranslation': { en: 'Show translation', zh: '显示释义' },
  'side.vocab.again': { en: 'Again', zh: '忘记' },
  'side.vocab.hard': { en: 'Hard', zh: '困难' },
  'side.vocab.good': { en: 'Good', zh: '良好' },
  'side.vocab.easy': { en: 'Easy', zh: '简单' },

  // --- content script: popups ---
  'popup.loading': { en: 'AI processing…', zh: 'AI 处理中…' },
  'popup.result.translate': { en: '🌐 Translation', zh: '🌐 翻译结果' },
  'popup.result.summary': { en: '📄 Summary', zh: '📄 摘要结果' },
  'popup.result.explain': { en: '💡 Explanation', zh: '💡 解释' },
  'popup.close': { en: 'Close', zh: '关闭' },
  'popup.copy': { en: '📋 Copy', zh: '📋 复制' },
  'popup.copied': { en: '✅ Copied', zh: '✅ 已复制' },
  'popup.continueInPanel': {
    en: '🤖 Continue in side panel',
    zh: '🤖 在侧栏继续',
  },

  // --- content script: FAB & errors ---
  'fab.title': { en: 'Open Lector AI', zh: '打开 Lector AI' },
  'err.addKey': {
    en: 'Add your API Key in Settings to use this.',
    zh: '请在侧栏设置中添加 API Key 后使用。',
  },
  'err.requestFailed': { en: 'Request failed', zh: '请求失败' },
  'err.failedPrefix': { en: 'Failed: {msg}', zh: '失败: {msg}' },
  'err.emptyResponse': { en: '(empty response)', zh: '(空响应)' },
  'err.extensionNotLoaded': {
    en: 'Extension not loaded; please refresh the page.',
    zh: '扩展未正确加载，请刷新页面。',
  },

  // --- background: context menus ---
  'menu.summarize': { en: 'Summarize with Lector AI', zh: '用 Lector AI 总结' },
  'menu.translate': { en: 'Translate with Lector AI', zh: '用 Lector AI 翻译' },
  'menu.explain': { en: 'Explain with Lector AI', zh: '用 Lector AI 解释' },
  'menu.ask': { en: 'Ask Lector AI about this…', zh: '向 Lector AI 提问…' },
} as const

export type StringKey = keyof typeof STRINGS

/**
 * Look up a localized string. Falls back to English, then to the key itself.
 * Because `key` is typed as StringKey, a missing key is impossible at runtime.
 */
export function t(key: StringKey, pref: LocalePref): string {
  const locale = resolveLocale(pref)
  const entry = STRINGS[key]
  return (entry && (entry[locale] || entry.en)) || key
}
