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
  'side.tools.title': { en: 'Tools', zh: '工具' },
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
  'toolbar.explainSentence': { en: '🃏 Explain sentence', zh: '🃏 讲解句子' },

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

  // --- side panel: review stats bar (Feature ④ Phase 3) ---
  'stats.due': { en: 'Due', zh: '待复习' },
  'stats.mastered': { en: 'Mastered', zh: '已掌握' },
  'stats.reviews': { en: 'Reviews', zh: '复习次数' },
  'stats.retention': { en: 'Avg ease', zh: '平均难度' },

  // --- side panel: sentence library drawer (Feature ④) ---
  'side.sentences.title': { en: 'Sentences', zh: '句库' },
  'side.sentences.empty': {
    en: 'Select a sentence on any page and tap "Explain sentence", or paste one here.',
    zh: '在页面选中句子点击"讲解句子"，或在此粘贴一句。',
  },
  'side.sentences.search': { en: 'Search sentence / word…', zh: '搜索句子或单词…' },
  'side.sentences.filterAll': { en: 'All levels', zh: '全部难度' },
  'side.sentences.export': { en: '⬇ Export', zh: '⬇ 导出' },
  'side.sentences.import': { en: '⬆ Import', zh: '⬆ 导入' },
  'side.sentences.importFail': { en: 'Import failed: {msg}', zh: '导入失败：{msg}' },
  'side.sentences.importOk': { en: 'Imported {n} cards', zh: '已导入 {n} 张卡片' },
  'side.sentences.viewSource': { en: 'View source', zh: '查看原文' },
  'side.sentences.addToReview': { en: 'Add to review', zh: '加入复习' },
  'side.sentences.inReview': { en: 'Reviewing', zh: '复习中' },
  'side.sentences.remove': { en: 'Remove', zh: '删除' },
  'side.sentences.generating': { en: 'Analyzing sentence…', zh: '分析句子中…' },
  'side.sentences.toAnki': { en: 'Send to Anki', zh: '发送到 Anki' },
  'side.sentences.toAnkiOne': { en: 'Send this card to Anki', zh: '这张卡片发送到 Anki' },
  'anki.result': { en: 'Added {added}, duplicated {dup}, failed {fail}', zh: '新增 {added}，重复 {dup}，失败 {fail}' },
  'side.sentences.due': { en: 'due', zh: '待复习' },
  'side.sentences.reviews': { en: 'reviews', zh: '次' },
  'side.sentences.showAnalysis': { en: 'Show analysis', zh: '显示讲解' },
  'side.sentences.hideAnalysis': { en: 'Hide', zh: '收起' },
  'side.sentences.pasteTitle': { en: 'Explain a sentence', zh: '讲解一个句子' },
  'side.sentences.pastePlaceholder': { en: 'Paste an English sentence…', zh: '粘贴一句英文…' },
  'side.sentences.pasteGenerate': { en: 'Generate card', zh: '生成卡片' },
  'side.sentences.pasteEmpty': { en: 'Enter a sentence first.', zh: '请先输入一个句子。' },
  'side.sentences.fromVocab': { en: 'Explain this word', zh: '讲解这个词' },
  'side.sentences.fromHighlight': { en: 'Explain this sentence', zh: '讲解这句话' },
  'side.sentences.makeCard': { en: 'Make card', zh: '生成卡片' },
  'side.sentences.examples': { en: 'Examples', zh: '举一反三' },
  'side.sentences.noContext': {
    en: 'This word has no saved sentence. Paste one to generate a card.',
    zh: '该词没有保存的例句，请在句库粘贴一句来生成卡片。',
  },

  // --- content script: popups ---
  'popup.loading': { en: 'AI processing…', zh: 'AI 处理中…' },
  'popup.result.translate': { en: '🌐 Translation', zh: '🌐 翻译结果' },
  'popup.result.summary': { en: '📄 Summary', zh: '📄 摘要结果' },
  'popup.result.explain': { en: '💡 Explanation', zh: '💡 解释' },
  'popup.result.explainSentence': { en: '🃏 Sentence card', zh: '🃏 讲解卡片' },
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

  // --- prompt templates ---
  'side.templates.title': { en: 'Templates', zh: '模板' },
  'side.templates.empty': {
    en: 'No custom templates yet. Tap + to create one.',
    zh: '还没有自定义模板，点击 + 创建。',
  },
  'side.templates.add': { en: '+ New template', zh: '+ 新建模板' },
  'side.templates.builtIn': { en: 'Built-in', zh: '内置' },
  'side.templates.titleField': { en: 'Template name', zh: '模板名称' },
  'side.templates.contentField': { en: 'Template content', zh: '模板内容' },
  'side.templates.hint': {
    en: 'Placeholders: {selection} {page} {lang}',
    zh: '可用占位符：{selection} {page} {lang}',
  },
  'side.templates.save': { en: 'Save', zh: '保存' },
  'side.templates.cancel': { en: 'Cancel', zh: '取消' },
  'composer.templates.hint': { en: 'Type / for templates', zh: '按 / 插入模板' },
  'side.templates.menuEmpty': { en: 'No matching templates', zh: '没有匹配的模板' },
  'side.templates.errTitle': { en: 'Name is required', zh: '请填写模板名称' },
  'side.templates.errContent': { en: 'Content is required', zh: '请填写模板内容' },

  // --- built-in template titles ---
  'tpl.summarize': { en: 'Summarize', zh: '总结全文' },
  'tpl.keypoints': { en: 'Key points', zh: '关键观点' },
  'tpl.eli5': { en: 'ELI5', zh: 'ELI5 解释' },
  'tpl.rewrite': { en: 'Rewrite', zh: '润色改写' },
  'tpl.translateZh': { en: 'Translate to 中文', zh: '翻译成中文' },
  'tpl.translateEn': { en: 'Translate to English', zh: '翻译成英文' },
  'tpl.expand': { en: 'Expand', zh: '续写扩写' },
  'tpl.email': { en: 'Email reply', zh: '邮件回复' },
  'tpl.extract': { en: 'Extract facts', zh: '提取要点' },
  'tpl.critique': { en: 'Critique', zh: '批判分析' },

  // --- glossary drawer (Feature: Custom Glossary) ---
  'side.glossary.title': { en: 'Glossary', zh: '术语表' },
  'side.glossary.empty': {
    en: 'No terms yet. Add source→target pairs to make translations consistent.',
    zh: '还没有术语。添加"原文→译文"对，让翻译更一致。',
  },
  'side.glossary.add': { en: '+ New term', zh: '+ 新建术语' },
  'side.glossary.sourceField': { en: 'Source (original)', zh: '原文' },
  'side.glossary.targetField': { en: 'Target (translation)', zh: '译文' },
  'side.glossary.noteField': { en: 'Note (optional)', zh: '备注（可选）' },
  'side.glossary.save': { en: 'Save', zh: '保存' },
  'side.glossary.cancel': { en: 'Cancel', zh: '取消' },
  'side.glossary.export': { en: '⬇ Export', zh: '⬇ 导出' },
  'side.glossary.import': { en: '⬆ Import', zh: '⬆ 导入' },
  'side.glossary.importFail': {
    en: 'Import failed: {msg}',
    zh: '导入失败：{msg}',
  },
  'side.glossary.importOk': {
    en: 'Imported {n} terms',
    zh: '已导入 {n} 条术语',
  },
  'side.glossary.enabled': { en: 'enabled', zh: '启用' },
  'side.glossary.disabled': { en: 'disabled', zh: '已停用' },
  'side.glossary.errSource': { en: 'Source is required', zh: '请填写原文' },
  'side.glossary.errTarget': { en: 'Target is required', zh: '请填写译文' },
  'side.glossary.hint': {
    en: 'Enabled terms are injected into translation prompts automatically.',
    zh: '已启用的术语会自动注入翻译 prompt。',
  },

  // --- Anki export (Feature: Anki 一键制卡) ---
  'side.vocab.sendAnki': { en: '📤 Send to Anki', zh: '📤 发送到 Anki' },
  'side.vocab.ankiTitle': { en: 'Send to Anki', zh: '发送到 Anki' },
  'side.vocab.ankiUrl': { en: 'AnkiConnect URL', zh: 'AnkiConnect 地址' },
  'side.vocab.ankiDeck': { en: 'Deck name', zh: '牌组名称' },
  'side.vocab.ankiModel': { en: 'Note type', zh: '笔记类型' },
  'side.vocab.ankiTags': { en: 'Tags (comma-separated)', zh: '标签（逗号分隔）' },
  'side.vocab.ankiCount': {
    en: '{n} cards will be sent',
    zh: '将发送 {n} 张卡片',
  },
  'side.vocab.ankiSend': { en: 'Send', zh: '发送' },
  'side.vocab.ankiCancel': { en: 'Cancel', zh: '取消' },
  'side.vocab.ankiSending': { en: 'Sending…', zh: '发送中…' },
  'side.vocab.ankiResult': {
    en: 'Added: {added} · Duplicated: {duplicated} · Failed: {failed}',
    zh: '新增：{added} · 重复：{duplicated} · 失败：{failed}',
  },
  'side.vocab.ankiHelp': {
    en: 'Need Anki desktop running with the AnkiConnect add-on (code 2058997622).',
    zh: '需在桌面端 Anki 启动并安装 AnkiConnect 插件（代码 2058997622）。',
  },
  'side.vocab.ankiHelpOrigin': {
    en: 'If connection fails: open AnkiConnect config and add this extension to webApiAllowedOrigins.',
    zh: '若连接失败：在 AnkiConnect 配置文件的 webApiAllowedOrigins 中添加本扩展。',
  },

  // --- sentence card section labels (optional structured render) ---
  'sentence.section.translation': { en: 'Translation', zh: '译文' },
  'sentence.section.syntax': { en: 'Syntax', zh: '句法结构' },
  'sentence.section.keywords': { en: 'Key words', zh: '关键词与搭配' },
  'sentence.section.idiom': { en: 'Native expression', zh: '地道表达' },
  'sentence.section.examples': { en: 'Examples', zh: '举一反三' },
  'sentence.section.takeaway': { en: 'Memory point', zh: '记忆点' },
  'sentence.err.emptyResponse': { en: '(empty analysis)', zh: '（分析为空）' },
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
