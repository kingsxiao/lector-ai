# Lector AI — 句库与深度讲解卡片（Sentence Library）设计

**Date:** 2026-07-22
**Status:** Design
**对标产品:**
- 句子级语法/表达深度讲解 → Trancy「AI Grammar Analysis」、ReadSavor「AI 句法拆解」、
  Lingoku「沉浸式 AI 语法卡片」、Yolink「每句一张 AI 讲解卡」
- 带原文上下文沉淀 + 复习 → Language Reactor「phrasebook」、Trancy「学习卡组」
- 真实语料例句/搭配 → Ludwig.guru「基于语料的句子检索」

## Context

Lector AI 已具备较完整的「读 + 抓」能力：全文双语翻译、划词工具栏（翻译/解释/摘要/提问）、
高亮、生词本 + SM-2 复习、自定义术语表、Anki 一键制卡、引用式阅读（[bN] 可跳回原文）。

但**「学」这一环仍是短板**——竞品调研显示这是阅读类工具被诟病最多的缺口：

1. **LingQ 的「语法盲区」**：ReadSavor 的整个产品定位就是「消除 LingQ 的语法盲区」——
   一个阅读工具如果只有翻译 + 生词，没有句子级语法/表达拆解，中高级学习者会感到不完整。
2. **Trancy 的卖点验证**：Trancy 靠「逐词彩色词性标注 + 句法结构可视化」成为最被称赞的
   功能，证明用户愿意为「看懂一个句子为什么这么构造」付费（$8/月）。
3. **Language Reactor 的沉淀范式**：讲解用完即丢是半成品——必须带原文上下文保存进可复习、
   可导出的「句库」，才能把一次性阅读转化为长期习得。

Lector 现有的「💬 Explain」工具栏动作是**轻量速答**（一行 system prompt，无结构化输出、
无沉淀、无语法层），无法承担「深度学习」职责。本设计新增一个**结构化、可沉淀、可复习**的
重型卡片功能，与轻量 Explain 并存，把散落的生词本 / 高亮 / 翻译串成「以读促学」的闭环。

### 技术路线选择（方案对比）

| | A 纯 Markdown | B 严格 JSON + 渲染器 | **C 渐进式（选定）** |
|---|---|---|---|
| AI 输出 | 固定 H2 分节 Markdown | 严格 JSON，逐词带 pos | Phase1=Markdown；Phase2 局部词性标注 |
| 渲染 | 复用 `renderMarkdown` | 新建结构化卡片渲染器 | 复用 `renderMarkdown`；Phase2 加 1 条内联规则 |
| 跨 BYOK 提供商 | 全部稳定 | Anthropic 无 JSON mode，OpenRouter 不一致 | 全部稳定 |
| 实现量 | 最小 | 最大（含 JSON 修复器） | 中（Phase2 增量可控） |
| 视觉 | 缩进列表句法 | Trancy 式逐词彩色 | Phase1 缩进；Phase2 可选上色 |

**选定方案 C**：本期（完整版）的核心价值是**功能联动 + 可复习沉淀**，而非单纯视觉炫技。
纯 Markdown 让联动 / SRS / Anki 以最低风险快速落地；Trancy 式彩色词性标注留作 Phase 2
视觉增强，有清晰、低风险的升级路径（只动「句法结构」一节 + 加一条内联渲染规则）。

## 目标

1. 用户选中英文句子（或粘贴、或从生词本/高亮导入）→ 调 BYOK AI 生成**结构化深度讲解卡片**，
   含固定 6 节：译文 / 句法结构 / 关键词与搭配 / 地道表达 / 举一反三 / 记忆点
2. 卡片沉淀进侧栏新增的**句库（Sentences）抽屉**，可搜索、删除、跳回原文块
3. 卡片支持 **opt-in 的 SRS 复习**：默认为被动参考资料库，用户主动「加入复习」后进 SM-2
   队列；复习翻卡正面=原句，背面=译文 + 完整分析
4. 支持**联动现有数据**：生词本 / 高亮可一键「生成讲解」转为卡片
5. 支持 **Anki 一键导出**（复用现有 `anki.ts`）和 **JSON 导入导出**备份
6. 全 i18n（en/zh）；纯 shared 模块配单测，遵循「纯逻辑零 DOM」分层约定

## 非目标（本次不做）

- **逐词彩色词性标注**（Trancy 式）：列为 Phase 2 视觉增强，本期句法结构用 Markdown 缩进
  列表呈现
- **语料库真实例句检索**（Ludwig 式）：举一反三例句由 AI 生成，标注为 AI 生成即可
- **发音 / TTS / 音标**：听说维度，扩展内音频交互成本高，本期不做
- **跨设备云同步**：与现有 highlights/vocab/glossary 一致，本地存储
- **卡片编辑**：卡片由 AI 生成后只读（可删除/重新生成），不做手改 analysis 的编辑器
- **CEFR 难度分级**：进阶字段，本期不加

## 架构

遵循现有「纯函数 shared 模块 + 薄 UI 层」分层，每个 shared 模块配对单元测试。新增
`src/shared/sentences.ts` 镜像 `glossary.ts` / `highlights.ts` 的函数族。

### 数据模型 `SentenceCard`

```ts
// src/shared/sentences.ts（纯逻辑，零依赖，可测试）
import type { SrsState } from './srs'

export interface SentenceCard {
  /** 's' + base36(time) + random，镜像 vocab('v')/highlight('h') 的 id 前缀约定。*/
  id: string
  /** 原句，归一化（trim + 折叠内部空白）。用于去重键和翻卡正面。*/
  sentence: string
  /** 译文，从 analysis 正则提取为结构化字段。用于去重/搜索/翻卡正面补充。
   *  提取失败时为 ''，卡片照存（优雅降级）。*/
  translation: string
  /** AI 原始 Markdown（6 节 H2），renderMarkdown 直接渲染的唯一来源。
   *  选 Markdown 而非嵌套对象：见下方「存储策略」说明。*/
  analysis: string
  /** 关键词，从「关键词与搭配」节正则提取。用于标签式搜索。提取失败为 []。*/
  keywords: string[]
  /** 原文上下文 ±200 字符，镜像 Highlight.quote。*/
  quote: string
  url: string
  title: string
  /** data-lector-id，跳回原文复用 content.ts 现有滚动逻辑。*/
  blockId?: string
  lang: string
  createdAt: number
  /** null = 被动参考；opt-in「加入复习」后 newSrs()。选可空而非 inReview 布尔，
   *  避免两字段状态漂移（见「SRS 集成」说明）。*/
  srs: SrsState | null
}
```

**存储策略 = 混合**：以 `analysis`（Markdown 串）为单一渲染源，只把 `translation` /
`keywords` 提升为结构化字段（去重键、搜索索引、翻卡正面需要这三个机器操作）。
- 不选全嵌套对象：6 节长中文 JSON 在 BYOK（含 Anthropic、OpenRouter 透传）下不稳定，
  模型易吐非法 JSON；且需自建结构化渲染器，重复 `markdown.ts` 已有能力。
- 不选纯自由 Markdown：无去重键（同句重复保存无法合并）、无搜索索引、无翻卡正面。
- 先例：`VocabEntry` 已是「结构化 `word` + 自由文本 `translation`/`context`」的混合存储。

### 模块函数族（镜像 glossary.ts / highlights.ts）

```ts
/** 校验：10~1000 字符（真句子而非片段/整段）。*/
export function validateSentence(text: string): ValidationResult

/** 归一化：trim + 折叠内部空白。保留大小写（句首大小写有意义，假合并会丢信息）。*/
export function normalizeSentence(text: string): string

export function newCardId(): string

/** 工厂，镜像 makeVocabEntry。srs 默认 null（被动参考）。*/
export function makeSentenceCard(
  partial: Omit<SentenceCard, 'srs' | 'createdAt'> & { srs?: SrsState | null; createdAt?: number }
): SentenceCard

/** 重复合并：刷新 analysis/translation/keywords/quote，保留 srs 进度 + 最早 createdAt。
 *  镜像 mergeVocabEntry「永不清零复习进度」规则。*/
export function mergeSentenceCard(existing: SentenceCard, incoming: SentenceCard): SentenceCard

/** 去重键 = 归一化句子。不按 url——同句跨页即同卡。镜像 isDuplicateHighlight 但去掉 url 维度。*/
export function isDuplicateSentence(a: SentenceCard, b: SentenceCard): boolean

/** 列表去重，最早 createdAt 优先。镜像 glossary.dedupeEntries（Map + 稳定序）。*/
export function dedupeCards(cards: SentenceCard[]): SentenceCard[]

/** 跨 sentence/translation/keywords/title 搜索，大小写不敏感。镜像 searchHighlights。*/
export function searchSentences(cards: SentenceCard[], q: string): SentenceCard[]

/** 按来源（title + url）分组，组内最新优先。镜像 groupHighlights。*/
export function groupSentences(cards: SentenceCard[]): Map<string, SentenceCard[]>

/** 从 analysis 提取译文：锚定 `## 译文` 节，稳健到节内内容变化。失败返回 ''。*/
export function extractTranslation(analysis: string): string

/** 从「关键词与搭配」节提取加粗 headword（`**word**`）。失败返回 []。*/
export function extractKeywords(analysis: string): string[]

export function exportSentences(cards: SentenceCard[]): string
export function importSentences(json: string): { ok: boolean; cards?: SentenceCard[]; reason?: string }
```

### AI 输出格式（方案 C 核心）

固定 6 节 H2 的 Markdown，模型必须严格遵循分节顺序。System prompt（英文、指令式，对齐
`content.ts` 现有 prompt 风格）：

```text
You are Lector AI, an English-reading tutor for Chinese learners. The user gives
you ONE English sentence. Produce a structured "sentence card" that helps them
deeply understand and remember it.

Output ONLY clean Markdown with EXACTLY these H2 sections, in this order, and
NOTHING before the first "## " or after the last section:

## 译文
<faithful Chinese translation, one line>

## 句法结构
<break down 主谓宾 / clause structure / grammar points; 2-4 short lines or bullets>

## 关键词与搭配
- **<word>** — 搭配：<collocations>；辨析：<nuance vs near-synonyms>
(2-4 bullets; always bold the headword with **word**)

## 地道表达
<idioms / register / native phrasing; 1-3 lines; if none, write 无明显地道表达>

## 举一反三
1. <a fresh English example sentence reusing a key structure or word>
2. <another>
3. <another>

## 记忆点
<one punchy line: the single thing worth remembering>

Rules: explanations in Chinese, example sentences in English. No code fences,
no extra commentary, no leading/trailing prose.
```

**调用**：`completeOnce(settings, SENTENCE_CARD_SYSTEM_PROMPT, sentence, { maxTokens: 1200, temperature: 0.4 })`
（temperature 介于 translate 0.2 与 explain 0.5 之间：结构化但不机械）。

**提取器稳健性**：固定 H2 header 作为正则锚点（`## 译文` … `## 关键词与搭配`），
对节内内容变化容错；缺节时返回 `''`/`[]`，卡片照存——与 `vocabToAnkiNote` 填
`(暂无释义)` 同样的优雅降级哲学。

**Phase 2 视觉增强路径（本期不做，文档留存）**：在「句法结构」节让模型额外输出一个轻量
标记句（如 `[n]quick[/n] brown [v]jumps[/v]`），给 `markdown.ts` 加 1 条内联规则上色。
只动一节、只加一规则，风险可控。

### Store 扩展（`src/shared/store.ts`）

```ts
interface AppState {
  // ... existing
  sentences: SentenceCard[]   // 上限 1000（与 vocab/glossary 同量级）
  addSentence: (s: Omit<SentenceCard, 'id' | 'createdAt'> & { createdAt?: number }) => void
  updateSentence: (id: string, patch: Partial<SentenceCard>) => void
  removeSentence: (id: string) => void
  replaceSentences: (cards: SentenceCard[]) => void   // JSON 导入用，内部 dedupe
  /** 把被动参考卡片 opt-in 进 SRS 复习：null → newSrs()。*/
  promoteSentenceToReview: (id: string) => void
  /** 推进/惩罚已复习卡片的 SRS。srs 为 null 时 no-op。*/
  updateSentenceSrs: (id: string, srs: SrsState) => void
}
```

`addSentence` 镜像 `addVocab`：按归一化句子去重，命中则 `mergeSentenceCard`（刷新
analysis、保留 srs + 最早 createdAt），未命中则前插 + `.slice(0, 1000)`。
`partialize` 加一行 `sentences: state.sentences`。

### SRS 集成：opt-in（参考优先，非复习优先）

卡片默认 `srs: null`（被动参考库）。用户点「加入复习」才 `null → newSrs()` 进队列。
- **理由**：句子卡片认知负荷约为单词的 10 倍，用户会存远多于能复习的句子。若像 vocab
  那样自动入队，复习队列会被淹没。vocab 自动入队是因为每个存词本就是复习项；句子更宽泛
  （有时只想看一次分析），opt-in 让 SRS 只服务「值得记住」的句子，契合间隔重复的本意。
- **成本**：抽屉需两种视图分支（全部卡片列表 + 顶部待复习区），但这是小 UI 成本，非数据
  模型成本。SRS 消费处加一行 `card.srs && isDue(card.srs)` 守卫即可。
- 「跳回原文」与 SRS 正交：每张卡片都能用 `url` + `blockId` 跳回，复用 content.ts 现有
  `data-lector-id` 滚动逻辑。

## 数据流

### 路径 A：网页选中（镜像 lectorVocab 中转流）

```
content.ts 工具栏按钮「🃏 讲解句子」→ handleExplainSentence
  → 取 sentence + quote(±200) + blockId + url + title
  → sendMessage({ action: 'lector-explain-sentence', sentence, quote, blockId, url, title })
background.ts 收到消息
  → completeOnce(settings, SENTENCE_CARD_SYSTEM_PROMPT, sentence, {maxTokens:1200,temp:0.4})
  → makeSentenceCard({ id, sentence, translation: extractTranslation(out), keywords: extractKeywords(out),
                       analysis: out, quote, url, title, blockId, lang, srs: null })
  → chrome.storage.local.lectorSentences = [card]（临时队列键）
sidepanel App.tsx onChanged 监听器
  → drain 进 useStore.addSentence（内部 dedupe/merge）
  → 删除 lectorSentences 临时键
```

### 路径 B：粘贴 / 联动入口（侧栏内直调）

```
句库抽屉顶部粘贴框
  → completeOnce(...) → useStore.addSentence(card)（同进程，不走中转）
生词本卡片菜单「生成讲解」
  → 输入句子 = vocab.context（存词时抓取的原句，通常非空）；若 context 为空则
    提示用户该词无原句、改走粘贴入口手输 → 走同一生成逻辑（不编造例句作为卡片主句）
高亮项菜单「生成讲解」
  → 用 highlight.quote + blockId → 走同一生成逻辑
```

### Anki 导出数据流

```
句库卡片菜单「导出到 Anki」或抽屉顶部批量按钮
  → sentenceToAnkiNote(card, opts)  // Front=sentence, Back=translation + analysis + 来源 url
  → exportToAnki([note], opts)       // 复用现有 anki.ts 的 createDeck + addNote
  → 显示 {added, duplicated, failed}
```

## 错误处理

- **AI 空响应**：`analysis` 为空时 `extractTranslation`/`extractKeywords` 返回 `''`/`[]`，
  卡片仍存（analysis 字段为空串），UI 显示「(分析为空)」占位，用户可删除或重新生成。
- **AI 节缺失**：某节没输出时提取器降级返回空值，其余节正常渲染（renderMarkdown 对
  缺失 H2 天然容错）。
- **未配置 API Key**：路径 A 在 background 调 `completeOnce` 前 `getSettings`，若无 key
  则 `open-side-panel` 引导用户配置（复用现有 save-word 流的同款兜底）。
- **JSON 导入脏数据**：`importSentences` 容忍部分坏行，跳过并返回成功导入数（镜像
  `importGlossary`）。
- **重复句子**：`addSentence` 内部 merge，不报错、不重复入库，刷新 analysis 但保留 srs。
- **AnkiConnect 未启动**：复用现有 `anki.ts` 的网络错误提示（「请确认 Anki 已启动并
  安装 AnkiConnect 插件」）。

## 测试策略

每个 shared 模块配单元测试，覆盖：

**`tests/sentences.test.ts`**（镜像 glossary.test.ts / highlights.test.ts）：
- `validateSentence`：边界（空 / <10 / >1000 / 合法）
- `normalizeSentence`：折叠内部空白、保留大小写
- `dedupeCards`：归一化句子相同即合并，最早 createdAt 优先
- `mergeSentenceCard`：刷新 analysis/translation/keywords，**保留 srs 进度 + 最早 createdAt**
- `searchSentences`：大小写不敏感，覆盖 keywords 字段
- `extractTranslation` / `extractKeywords`：正常提取 + 缺节降级返回 `''`/`[]`
- `importSentences`：脏 JSON / 部分坏行容错，返回成功数
- `exportSentences` → `importSentences` 往返一致

**手动验证清单**（`docs/manual-verification-checklist.md` 追加 §14）：
1. 网页选中句子 → 点「讲解句子」→ 句库出现卡片，6 节齐全
2. 句库搜索（按句子/译文/关键词命中）
3. 跳回原文块（滚动定位）
4. 粘贴入口生成卡片（不开网页）
5. 标记「加入复习」→ 复习区出现 → 翻卡（正面原句/背面译文+分析）→ 四档评分
6. 联动：生词本/高亮「生成讲解」→ 句库出现卡片
7. Anki 导出单卡 + 批量
8. JSON 导出 → 清空 → 导入恢复
9. 重复句子保存 → merge 而非重复入库

## i18n 键（约 25 个，命名空间 `side.sentences.*`）

```ts
'toolbar.explainSentence': { en: '🃏 Explain sentence', zh: '🃏 讲解句子' }
'side.sentences.title':    { en: 'Sentences', zh: '句库' }
'side.sentences.empty':    { en: 'Select a sentence on any page and tap "Explain sentence", or paste one here.',
                             zh: '在页面选中句子点击"讲解句子"，或在此粘贴一句。' }
'side.sentences.search':   { en: 'Search sentence / word…', zh: '搜索句子或单词…' }
'side.sentences.export':   { en: '⬇ Export', zh: '⬇ 导出' }
'side.sentences.import':   { en: '⬆ Import', zh: '⬆ 导入' }
'side.sentences.importFail': { en: 'Import failed: {msg}', zh: '导入失败：{msg}' }
'side.sentences.importOk': { en: 'Imported {n} cards', zh: '已导入 {n} 张卡片' }
'side.sentences.viewSource': { en: 'View source', zh: '查看原文' }
'side.sentences.addToReview': { en: 'Add to review', zh: '加入复习' }
'side.sentences.inReview': { en: 'Reviewing', zh: '复习中' }
'side.sentences.remove':   { en: 'Remove', zh: '删除' }
'side.sentences.generating': { en: 'Analyzing sentence…', zh: '分析句子中…' }
'side.sentences.toAnki':   { en: 'Send to Anki', zh: '发送到 Anki' }
'side.sentences.due':      { en: 'due', zh: '待复习' }
'side.sentences.pasteTitle': { en: 'Explain a sentence', zh: '讲解一个句子' }
'side.sentences.pastePlaceholder': { en: 'Paste an English sentence…', zh: '粘贴一句英文…' }
'side.sentences.pasteGenerate': { en: 'Generate card', zh: '生成卡片' }
'side.sentences.pasteEmpty': { en: 'Enter a sentence first.', zh: '请先输入一个句子。' }
// SRS 四档评分复用现有 side.vocab.again/hard/good/easy
// 句子菜单「生成讲解」联动项
'side.sentences.fromVocab': { en: 'Explain this word', zh: '讲解这个词' }
'side.sentences.fromHighlight': { en: 'Explain this sentence', zh: '讲解这句话' }
// 卡片节标题（若单独渲染分节用；整体 renderMarkdown 则不需要）
'sentence.section.translation': { en: 'Translation', zh: '译文' }
'sentence.section.syntax':      { en: 'Syntax', zh: '句法结构' }
'sentence.section.keywords':    { en: 'Key words', zh: '关键词与搭配' }
'sentence.section.idiom':       { en: 'Native expression', zh: '地道表达' }
'sentence.section.examples':    { en: 'Examples', zh: '举一反三' }
'sentence.section.takeaway':    { en: 'Memory point', zh: '记忆点' }
'sentence.err.emptyResponse':   { en: '(empty analysis)', zh: '（分析为空）' }
```

`StringKey` 编译期检查，缺 key 会 typecheck 失败。

## 文件改动清单

**新增：**
- `src/shared/sentences.ts` — 句库纯逻辑（接口 + 函数族 + prompt 常量 + 提取器）
- `tests/sentences.test.ts` — 单测

**修改：**
- `src/shared/store.ts` — `sentences` 状态 + 6 个 action + partialize 一行
- `src/shared/i18n.ts` — ~25 个 StringKey
- `src/shared/icons.tsx` — 1 个句库图标
- `src/shared/anki.ts` — 加 `sentenceToAnkiNote(card, opts)` 映射（复用现有 client）
- `src/background.ts` — `lector-explain-sentence` 消息处理 + completeOnce
- `src/content.ts` — 工具栏按钮 + `handleExplainSentence`（镜像 handleSaveWord）
- `src/sidepanel/App.tsx` — `SentencesDrawer` + header 按钮（带 due badge）+
  onChanged drain + 粘贴入口 + 生词本/高亮联动菜单项
- `docs/manual-verification-checklist.md` — 追加 §14 句库验收清单

## 构建顺序

1. `sentences.ts` + `tests/sentences.test.ts`（纯逻辑先行，TDD）
2. store 扩展 `sentences` 状态 + 6 个 action + partialize
3. i18n 字符串 + 句库图标
4. background `lector-explain-sentence` 处理 + content 工具栏按钮（路径 A 闭环）
5. `SentencesDrawer` UI + header 按钮 + onChanged drain（卡片列表/搜索/删除/跳回原文）
6. 粘贴生成入口（路径 B）
7. SRS opt-in：promoteSentenceToReview + 复习区翻卡 UI（复用 vocab 复习组件）
8. 联动：生词本 / 高亮「生成讲解」菜单项
9. Anki 导出（sentenceToAnkiNote + 复用 exportToAnki）
10. JSON 导入导出
11. 全量 `NODE_ENV=development typecheck` + `test` + `build`
12. 更新手动验证清单 §14

## 风险

- **AI 输出不遵循 6 节 schema**：小模型可能漏节或加前言。缓解——提取器对缺节降级返回
  空值；prompt 用「NOTHING before/after」强约束；maxTokens 1200 足够 6 节中文+英文。
  最坏情况卡片仍可用，用户可删除重生成。
- **token 成本**：每张卡片约 800-1200 token 输出。与现有划词翻译同量级，单次调用，无
  批量场景（句子讲解是低频主动行为，非自动注入每次翻译）。
- **侧栏 App.tsx 体积**：已 ~1700 行，再加一个 Drawer 会更大。缓解——SentencesDrawer
  作为独立子组件抽出（与 GlossaryDrawer/VocabDrawer 平级），不在主组件内联巨型 JSX。
- **复习队列淹没**：已通过 opt-in（srs 默认 null）设计规避——只有用户主动标记的卡片进队。
- **Phase 2 彩色词性标注的升级路径**：需修改 prompt（句法节加标记句输出）+ markdown.ts
  （加内联规则）。文档已留存路径，不在本期实现，避免阻塞核心闭环。
