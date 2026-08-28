// Shared i18n for all surfaces (side panel, content script, background).
//
// The language preference lives in ByokSettings.locale and flows to every
// surface through chrome.storage.local. t() takes a StringKey (a literal
// union derived from STRINGS), so a typo'd or missing key is a compile error.

export type Locale = 'en' | 'zh'
export type LocalePref = 'auto' | Locale

/** Read the browser locale and map it to one of our supported locales.
 *  Memoized: navigator.languages cannot change within a page/panel lifetime,
 *  and t() runs hundreds of times per render — re-probing per call rebuilt the
 *  language array each time for nothing. */
let detectedLocale: Locale | null = null
export function detectLocale(): Locale {
  if (detectedLocale !== null) return detectedLocale
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
    if (primary === 'zh') {
      detectedLocale = 'zh'
      return detectedLocale
    }
  }
  detectedLocale = 'en'
  return detectedLocale
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
  'side.onboard.title': { en: 'Bring your own key', zh: '自带密钥' },
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
  'settings.title': { en: 'Bring Your Own Key', zh: '自带密钥' },
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
  'settings.theme': { en: 'Appearance', zh: '外观' },
  'settings.theme.auto': { en: 'Auto', zh: '自动' },
  'settings.theme.light': { en: 'Light', zh: '浅色' },
  'settings.theme.dark': { en: 'Dark', zh: '深色' },
  'settings.palette': { en: 'Theme color', zh: '主题色' },

  // --- content script: toolbar ---
  'toolbar.translate': { en: 'Translate', zh: '翻译' },
  'toolbar.explain': { en: 'Explain', zh: '解释' },
  'toolbar.summarize': { en: 'Summarize', zh: '摘要' },
  'toolbar.ask': { en: 'Ask', zh: '提问' },
  'toolbar.highlight': { en: 'Highlight', zh: '高亮' },
  'toolbar.saveWord': { en: 'Save word', zh: '存词' },
  'toolbar.explainSentence': { en: 'Explain sentence', zh: '讲解句子' },

  // --- side panel: highlights drawer (Feature ②) ---
  'side.highlights.title': { en: 'Highlights', zh: '高亮收藏' },
  'side.highlights.empty': {
    en: 'Select text on any page and tap the highlight button to capture it.',
    zh: '在任意页面选中文字，点击高亮按钮即可收藏。',
  },
  'side.highlights.export': { en: 'Export Markdown', zh: '导出 Markdown' },
  'side.loadMore': { en: 'Load more ({n})', zh: '加载更多（{n}）' },

  // --- side panel: vocabulary review drawer (Feature ③) ---
  'side.vocab.title': { en: 'Vocabulary', zh: '生词本' },
  'side.vocab.empty': {
    en: 'Select a word on any page and tap the save-word button to review it.',
    zh: '在任意页面选中单词，点击存词按钮即可加入复习。',
  },
  'side.vocab.due': { en: 'due', zh: '待复习' },
  // Unit suffixes shared by the vocab + sentence review rows.
  'srs.reviews': { en: 'reviews', zh: '次' },
  'srs.review': { en: 'review', zh: '次' },
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
  'side.sentences.export': { en: 'Export', zh: '导出' },
  'side.sentences.import': { en: 'Import', zh: '导入' },
  'side.importFail': { en: 'Import failed: {msg}', zh: '导入失败：{msg}' },
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
  // --- side panel: tab navigation (flat views replace overlay drawers) ---
  'side.tab.chat': { en: 'Chat', zh: '对话' },
  'side.tab.highlights': { en: 'Highlights', zh: '高亮' },
  'side.tab.vocab': { en: 'Vocab', zh: '生词' },
  'side.tab.more': { en: 'More', zh: '更多' },
  // --- error banner (replaces auto-popping Settings on API errors) ---
  'side.error.banner': { en: 'Something went wrong', zh: '出现问题' },
  'side.error.goSettings': { en: 'Open settings', zh: '打开设置' },
  'side.error.dismiss': { en: 'Dismiss', zh: '忽略' },
  // --- make-card inline loading (举一反三 → 生成卡片) ---
  'side.sentences.makingCard': { en: 'Generating…', zh: '生成中…' },
  'popup.copy': { en: '📋 Copy', zh: '📋 复制' },
  'popup.copied': { en: '✅ Copied', zh: '✅ 已复制' },
  'popup.continueInPanel': {
    en: '🤖 Continue in side panel',
    zh: '🤖 在侧栏继续',
  },

  // --- content script: FAB & errors ---
  'fab.title': { en: 'Open Lector AI', zh: '打开 Lector AI' },
  // When the FAB opens Lector in a standalone window (the MV3 fallback, since
  // chrome.sidePanel.open can't be triggered reliably from a content-script
  // click), tell the user they can switch to the side-panel form via the
  // toolbar icon. Kept short to fit a small window.
  'fab.windowHint': {
    en: 'Tip: click the toolbar icon to use Lector as a side panel instead.',
    zh: '提示：点工具栏图标可切换为侧边栏形态。',
  },
  // FAB radial quick-action menu (page-level; there's no text selection).
  'fab.menu': { en: 'Quick actions', zh: '快捷操作' },
  'fab.menu.translatePage': { en: 'Translate page', zh: '翻译整页' },
  'fab.menu.summarizePage': { en: 'Summarize page', zh: '摘要整页' },
  'fab.menu.openPanel': { en: 'Open side panel', zh: '打开侧边栏' },
  'fab.menu.openStandalone': { en: 'Open in new window', zh: '单独打开页面' },
  // Side-panel header button that pops Lector out into its own window.
  'side.header.openStandalone': { en: 'Open in standalone window', zh: '单独窗口打开' },
  'highlight.markTitle': { en: 'Lector highlight', zh: 'Lector 高亮' },
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

  // --- chat: streaming controls (Stop / cancel / retry) ---
  'side.chat.stop': { en: 'Stop', zh: '停止' },
  'side.chat.canceled': { en: '(stopped)', zh: '（已停止）' },
  'side.chat.retry': { en: 'Retry', zh: '重试' },
  'side.chat.stoppedShort': {
    en: 'Response stopped — tap Retry to continue.',
    zh: '回答已停止 — 点「重试」继续。',
  },

  // --- onboarding (first-run hint + empty-state CTA) ---
  'side.onboard.cta': { en: 'Open Settings', zh: '打开设置' },
  'side.onboard.hintTitle': {
    en: 'Quick tour',
    zh: '快速上手',
  },
  'side.onboard.hintBody': {
    en: 'Select text on any page for the toolbar (translate / explain / highlight / save word), tap the language icon for bilingual page translation, or just chat here.',
    zh: '在任意网页选中文字即可呼出工具栏（翻译／解释／高亮／存词），点语言图标做整页双语翻译，或直接在此对话。',
  },
  'side.onboard.hintDismiss': { en: 'Got it', zh: '知道了' },

  // --- aria-labels / titles for icon-only controls (screen-reader names) ---
  'aria.views': { en: 'Views', zh: '视图' },
  'aria.replyReady': { en: 'Reply ready', zh: '回复已生成' },
  'aria.replyFailed': { en: 'Reply failed', zh: '回复失败' },
  'aria.replyStopped': { en: 'Reply stopped', zh: '回复已停止' },
  'aria.library': { en: 'Library', zh: '会话库' },
  'aria.translationHistory': { en: 'Translation history', zh: '翻译历史' },
  'aria.glossary': { en: 'Glossary', zh: '术语表' },
  'aria.templates': { en: 'Templates', zh: '模板' },
  'aria.deleteConversation': { en: 'Delete conversation', zh: '删除会话' },
  'aria.deleteHighlight': { en: 'Delete highlight', zh: '删除高亮' },
  'aria.deleteWord': { en: 'Delete word', zh: '删除词条' },
  'aria.makeCard': { en: 'Make sentence card', zh: '生成句卡' },
  'aria.viewSource': { en: 'View source on page', zh: '查看原文' },
  'aria.sendToAnki': { en: 'Send to Anki', zh: '发送到 Anki' },
  'aria.edit': { en: 'Edit', zh: '编辑' },
  'aria.delete': { en: 'Delete', zh: '删除' },
  'aria.enableGlossary': { en: 'Enable glossary entry', zh: '启用术语' },

  // --- provider descriptions (localized; providers.ts holds an English fallback) ---
  'provider.desc.openai': {
    en: 'GPT-4o, o-series, and more.',
    zh: 'GPT-4o、o 系列等。',
  },
  'provider.desc.anthropic': { en: 'Claude models.', zh: 'Claude 模型。' },
  'provider.desc.openrouter': {
    en: 'One key, every model (GPT, Claude, Gemini, Llama, …). Recommended.',
    zh: '一把钥匙，所有模型（GPT / Claude / Gemini / Llama …）。推荐。',
  },
  'provider.desc.deepseek': {
    en: 'DeepSeek-V3 / R1. Excellent value.',
    zh: 'DeepSeek-V3 / R1。性价比极高。',
  },
  'provider.desc.groq': {
    en: 'Ultra-fast Llama / Mixtral / Gemma inference.',
    zh: '极速 Llama / Mixtral / Gemma 推理。',
  },
  'provider.desc.together': {
    en: 'Open models at scale (Llama, Qwen, DeepSeek, …).',
    zh: '大规模开源模型（Llama / Qwen / DeepSeek …）。',
  },
  'provider.desc.mistral': {
    en: 'Mistral family (Large, Small, Codestral, …).',
    zh: 'Mistral 系列（Large / Small / Codestral …）。',
  },
  'provider.desc.xai': { en: 'Grok models.', zh: 'Grok 模型。' },
  'provider.desc.moonshot': {
    en: 'Kimi / Moonshot models (CJK-friendly).',
    zh: 'Kimi / Moonshot 模型（中文友好）。',
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
  'side.templates.add': { en: 'New template', zh: '新建模板' },
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
  'side.glossary.add': { en: 'New term', zh: '新建术语' },
  'side.glossary.sourceField': { en: 'Source (original)', zh: '原文' },
  'side.glossary.targetField': { en: 'Target (translation)', zh: '译文' },
  'side.glossary.noteField': { en: 'Note (optional)', zh: '备注（可选）' },
  'side.glossary.save': { en: 'Save', zh: '保存' },
  'side.glossary.cancel': { en: 'Cancel', zh: '取消' },
  'side.glossary.export': { en: 'Export', zh: '导出' },
  'side.glossary.import': { en: 'Import', zh: '导入' },
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
  'side.vocab.sendAnki': { en: 'Send to Anki', zh: '发送到 Anki' },
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

  // --- translation settings ---
  'settings.translation.title': { en: 'Translation', zh: '翻译' },
  'settings.translation.targetLanguage': { en: 'Target language', zh: '目标语言' },
  'settings.translation.targetLanguage.auto': { en: 'Auto (opposite of source)', zh: '自动（与源语言相反）' },
  'settings.translation.displayMode': { en: 'Bilingual display', zh: '双语显示' },
  'settings.translation.displayMode.bilingual': { en: 'Below original', zh: '译文在原文下方' },
  'settings.translation.displayMode.translationOnly': { en: 'Translation only', zh: '仅译文' },
  'settings.translation.displayMode.hover': { en: 'On hover', zh: '悬停显示' },
  'settings.translation.autoTranslate': { en: 'Auto-translate pages on load', zh: '打开页面自动整页翻译' },
  'settings.translation.concurrency': { en: 'Parallel requests', zh: '并发请求数' },
  // Immersive-parity translation settings (themes, persona, cache, site rules,
  // hover, input-box). Keys are surfaced in the Settings panel.
  'settings.translation.theme': { en: 'Translation style', zh: '译文样式' },
  'settings.translation.fontSize': { en: 'Translation font size', zh: '译文字号' },
  'settings.translation.customCss': { en: 'Custom CSS', zh: '自定义 CSS' },
  'settings.translation.customCssHint': { en: 'Appended to the page. Selector .lector-bilingual targets translations.', zh: '追加到页面。选择器 .lector-bilingual 指向译文。' },
  'settings.translation.readingFocus': { en: 'Reading focus (dim source)', zh: '专注阅读（弱化原文）' },
  'settings.translation.persona': { en: 'AI Expert style', zh: 'AI 专家风格' },
  'settings.translation.pageScope': { en: 'Page scope', zh: '翻译范围' },
  'settings.translation.pageScope.smart': { en: 'Main content', zh: '正文区域' },
  'settings.translation.pageScope.whole': { en: 'Whole page', zh: '整页' },
  'settings.translation.cacheTtl': { en: 'Cache translations (days)', zh: '翻译缓存（天）' },
  'settings.translation.cacheHint': { en: '0 disables. Cached locally — never sent anywhere.', zh: '0 为关闭。仅本地缓存，绝不上传。' },
  'settings.translation.cacheClear': { en: 'Clear cache', zh: '清除缓存' },
  'settings.translation.cacheCleared': { en: 'Cache cleared', zh: '缓存已清除' },
  'settings.translation.cacheEmpty': { en: 'No cached translations yet', zh: '暂无翻译缓存' },
  'settings.translation.cacheStats': {
    en: '≈ {tokens} tokens cached · ~${usd} saved',
    zh: '已缓存约 {tokens} tokens · 节省约 ${usd}',
  },
  'settings.translation.languageSearch': { en: 'Search languages…', zh: '搜索语言…' },
  'settings.translation.languageMore': {
    en: '{n} more — refine search',
    zh: '还有 {n} 项，请缩小搜索范围',
  },
  'settings.translation.siteRules': { en: 'Site rules', zh: '站点规则' },
  'settings.translation.siteRules.add': { en: 'Add current site', zh: '添加当前站点' },
  'settings.translation.siteRules.always': { en: 'Always translate', zh: '总是翻译' },
  'settings.translation.siteRules.never': { en: 'Never translate', zh: '从不翻译' },
  'settings.translation.siteRules.auto': { en: 'Auto', zh: '自动' },
  'settings.translation.siteRules.host': { en: 'Host', zh: '域名' },
  'settings.translation.siteRules.empty': {
    en: 'No site rules. Add the current site, or it follows your global setting.',
    zh: '暂无站点规则。可添加当前站点，否则沿用全局设置。',
  },
  'settings.translation.siteRules.remove': { en: 'Remove site rule', zh: '删除站点规则' },
  'settings.translation.siteRules.custom': { en: 'Custom engine', zh: '自定义引擎' },
  'settings.translation.siteState.always': { en: 'Site: always', zh: '本站：总是翻译' },
  'settings.translation.siteState.never': { en: 'Site: never', zh: '本站：从不翻译' },
  'settings.translation.siteState.auto': { en: 'Site: auto', zh: '本站：自动' },
  'settings.translation.siteState.cycle': {
    en: 'Click to cycle: auto → always → never',
    zh: '点击切换：自动 → 总是 → 从不',
  },
  'settings.translation.hoverToggle': { en: 'Shift+hover to translate a paragraph', zh: 'Shift+悬停翻译段落' },
  'settings.translation.inputToggle': { en: 'Input-box translation (triple-space)', zh: '输入框翻译（三连空格）' },

  // --- bilingual page translation ---
  'toolbar.bilingual': {
    en: 'Translate page paragraphs (bilingual)',
    zh: '整页双语翻译',
  },
  'toolbar.bilingual.disabledHint': {
    en: 'Open a page first',
    zh: '请先打开一个网页',
  },
  'bilingual.progress': { en: 'Translated {done}/{total}', zh: '已翻译 {done}/{total} 段' },
  'bilingual.cancel': { en: 'Cancel', zh: '取消' },
  'bilingual.retry': { en: 'Retry', zh: '重试' },
  'bilingual.copyTranslation': { en: 'Copy translation', zh: '复制译文' },
  'bilingual.blockError': { en: 'Translation failed', zh: '翻译失败' },
  'bilingual.qualityError': {
    en: 'The result is still not in the target language. Retry or switch models.',
    zh: '译文仍未转换为目标语言，请重试或更换模型。',
  },
  'bilingual.probeFailed': {
    en: 'The test paragraph failed, so the remaining requests were stopped to avoid further API usage.',
    zh: '测试段落翻译失败，已停止后续请求，避免继续消耗接口额度。',
  },
  'bilingual.circuitStopped': {
    en: 'Several paragraphs failed, so the remaining requests were stopped to avoid an error storm.',
    zh: '多个段落翻译失败，已停止剩余请求，避免继续产生错误和消耗额度。',
  },
  'bilingual.canceled': { en: 'Canceled', zh: '已取消' },
  'bilingual.unavailable': {
    en: 'This page cannot be translated. Refresh the page and try again.',
    zh: '当前页面无法翻译，请刷新页面后重试。',
  },
  'bilingual.noContent': {
    en: 'No translatable text was found on this page.',
    zh: '当前页面未找到可翻译文本。',
  },

  // --- selection popup (translate) ---
  'popup.result.speak': { en: 'Read aloud', zh: '朗读' },
  'popup.result.retranslate': { en: 'Retranslate', zh: '重新翻译' },
  'popup.result.targetLang': { en: 'Translate to', zh: '译为' },

  // --- translation history ---
  'side.translationHistory.title': { en: 'Translation history', zh: '翻译历史' },
  'side.translationHistory.empty': {
    en: 'Your translations will appear here.',
    zh: '你的翻译记录会出现在这里。',
  },
  'side.translationHistory.clear': { en: 'Clear all', zh: '清空' },
  'side.translationHistory.search': { en: 'Search translations…', zh: '搜索翻译…' },
  'side.translationHistory.kind.selection': { en: 'Selection', zh: '划词' },
  'side.translationHistory.kind.page': { en: 'Page', zh: '整页' },
  'side.translationHistory.kind.vocab': { en: 'Vocab', zh: '生词' },
  'side.translationHistory.kind.sentence': { en: 'Sentence', zh: '长难句' },
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
