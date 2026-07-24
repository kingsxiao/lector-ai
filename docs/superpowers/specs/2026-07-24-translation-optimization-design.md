# 翻译功能全面优化设计

- **日期:** 2026-07-24
- **目标:** 对 Lector AI 的翻译功能进行全方位优化（交互、行为、页面呈现），对标市面上最好的翻译产品（沉浸式翻译 / DeepL 划词 / Google Translate），同时严格遵守项目的 BYOK 纯客户端定位与 `src/shared/*.ts` 纯逻辑分层规则。
- **状态:** 已确认，待实现

---

## 1. 背景与现状

当前翻译功能**不是一个独立模块**，而是散落在 4 个 LLM 调用点，全部走非流式 `completeOnce()`：

| 调用点 | 文件:行 | 现状问题 |
|--------|---------|---------|
| 划词工具栏翻译 | `src/content.ts:608` `runByokAction('translate')` | 非流式，转圈→一次性蹦出；目标语言写死 CJK↔英文；无朗读 |
| 沉浸式双语 | `src/content.ts:660` `toggleBilingual()` | 仅前 30 段；串行；无流式；无进度；无并发；无重试 |
| 存词自动翻译 | `src/background.ts:88` `handleSaveWordRelay` | 方向写死 |
| 长难句卡片 | `src/background.ts:136` `handleExplainSentenceRelay` | 译文是 6 段结构的一节 |

**关键约束（来自 CLAUDE.md，不可违反）：**
1. `src/shared/*.ts` 必须是**零 DOM、零 chrome API 的纯模块**——这条边界让逻辑能在 jsdom 单测。
2. content script 必须是**单个 IIFE 包**（`vite.content.config.ts` 用 `inlineDynamicImports`）——不能有 chunk import / dynamic import。
3. **无后端、无数据库、无账号**，纯 BYOK；密钥存 `chrome.storage.local`。
4. shell 里 `NODE_ENV=production` 会搞坏开发工具链——所有命令前置 `NODE_ENV=development`。
5. content script 无法直接碰 zustand store，知识采集走「content → background → `chrome.storage.local` 队列 → sidepanel 抽干」中继模式。

**已确认的产品决策（与用户 brainstorming 结论）：**
- 优化范围：✅ 沉浸式双语整页 ✅ 划词弹窗 ✅ 翻译设置与目标语言 ✅ 一致性与历史（四项全做）
- 目标语言：精选 **12 种常用语言**（中、英、日、韩、法、德、西、俄、葡、意、越南、阿拉伯）
- 性能策略：**激进并发 + 流式**（体验优先），并发数默认 5
- 引擎策略：**仅优化现有 LLM**，不引入外部 MT（架构不变、无新密钥）
- 双语显示：**译文在原文下方**（沉浸式默认），可切换「仅译文 / 双语对照 / 悬停」

---

## 2. 整体架构与分层

### 2.1 新增/改动文件

```
src/shared/
├── translation.ts        【新建】翻译子系统核心（纯逻辑，0 DOM/0 chrome API）
├── translation.test.ts   【新建】纯逻辑单测
├── store.ts              【改】新增 translationSettings + translationHistory 状态与 actions
├── providers.ts          【改】ByokSettings 增 translation 字段
├── i18n.ts               【改】新增翻译相关 UI 字符串
└── byok.ts               【不动】复用现有 streamChat 做流式

src/
├── content.ts            【改】划词弹窗流式化 + 整页双语并发流式化（消费 translation.ts）
├── background.ts         【改】存词/长难句翻译走新引擎 + 翻译历史中继 + 新快捷键转发
└── manifest.json         【改】新增 lector-translate 命令（Alt+T）

src/sidepanel/
├── App.tsx               【改】翻译设置 UI + 翻译历史抽屉 + 双语开关/进度
└── (翻译相关 UI 拆分到 App.tsx 内的子组件，保持单文件惯例)

tests/
├── translation.test.ts   【新建】纯逻辑单测
└── browser/run-browser-e2e.mjs  【改】新增翻译流式/并发/目标语言/快捷键 E2E
```

### 2.2 设计原则（贯穿全部）

1. **可测逻辑全部进 `src/shared/translation.ts`**，零 DOM/零 chrome——满足项目硬约束，能在 jsdom 单测。
2. **统一翻译方向解析**：4 个调用点全部走 `resolveTargetLang(settings, sourceText)`，不再各自写正则。
3. **content.ts 只做 DOM 编排**（选块、并发调度、渲染），翻译决策全部委托给 `translation.ts`。
4. **复用已有 `streamChat`**（`byok.ts:79`）做流式——不新造 SSE 解析。
5. **遵循中继模式**：翻译历史走 content → background → storage → sidepanel，不破例。

---

## 3. `src/shared/translation.ts` — 翻译子系统核心

纯逻辑模块。所有导出函数可在 jsdom 单测，**禁止 import DOM 或 chrome API**。

### 3.1 语言表

```ts
export interface LanguageDef { code: TargetLangCode; en: string; zh: string; speechCode: string }
export type TargetLangCode = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru' | 'pt' | 'it' | 'vi' | 'ar'

export const LANGUAGES: LanguageDef[] = [ /* 12 种，含 speechSynthesis 用的 BCP-47 code */ ]
```

- `speechCode` 用于浏览器 TTS（如 `zh-CN`、`en-US`、`ja-JP`），无网零依赖。
- 排序：中、英在前（最常用），其余按使用频率。

### 3.2 方向解析（替代 4 处写死的正则）

```ts
/** 检测源文本的主导脚本。 */
export function detectScript(text: string): 'cjk' | 'cyrillic' | 'arabic' | 'latin'

/** 解析最终目标语言：用户显式选择优先，否则按源脚本推断（CJK→英文，其余→中文）。 */
export function resolveTargetLang(
  setting: TargetLangCode | 'auto',
  sourceText: string
): TargetLangCode
```

- `auto` 时：cjk → `en`；其余 → `zh`（保留现有"对立语言"直觉）。
- 非 auto：直接返回用户选择。

### 3.3 Prompt 构建（从 content.ts:473 迁出并增强）

```ts
export function buildTranslateSystemPrompt(
  targetLang: TargetLangCode,
  glossaryBlock: string
): string
```

- 基础 prompt 升级：明确指示「保留原文 markdown/HTML 结构、代码块不译、专有名词处理」。
- glossary 块非空时拼接（复用 `renderGlossaryPrompt`）。
- 方向感知 glossary：提供 `filterGlossaryForDirection(entries, targetLang)`——仅保留与方向相关的条目（避免污染）。首期按 source/target 文字脚本粗筛。

### 3.4 批量翻译（可选优化，用于段落合并以减请求数）

> 注：用户选了"激进并发+流式（体验优先）"，批量合并会牺牲逐段流式。**默认不启用批量**，但保留接口以备后续。本次实现以单段并发 + 流式为主。

```ts
export const BATCH_SEP = '\n\n@@@LECTOR_BATCH@@@\n\n'
export function buildBatchPrompt(items: string[], targetLang: TargetLangCode, glossaryBlock: string): { system: string; user: string }
export function parseBatchResult(raw: string, count: number): string[]
```

### 3.5 并发限流器（核心）

```ts
export interface ConcurrencyOptions { concurrency: number; signal?: AbortSignal }

/** 限流并发执行。保持最多 N 个 in-flight；支持中途 abort。 */
export async function runConcurrent<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: ConcurrencyOptions
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown; index: number }>>
```

- 纯逻辑（只依赖 Promise），可单测：用假 worker 验证并发上限、abort 行为、错误隔离。
- 返回值用 result 数组（不 throw），让调用方决定如何处理单块失败——契合双语模式"best-effort，单个失败不中断"。

### 3.6 选块过滤（纯函数化 content.ts 的 querySelector 逻辑）

```ts
/** 判断一个候选元素是否应被翻译。DOM 依赖由调用方传入抽象输入。 */
export interface BlockCandidate {
  text: string
  tag: string
  isInsideExcluded: boolean        // script/style/code/pre/textarea/contenteditable 等
  isAlreadyTranslated: boolean     // 已含 .lector-bilingual
  textRatio: number                // 文本字数 / 元素总长度
}

export function shouldTranslateBlock(c: BlockCandidate): boolean
```

- 把"长度 1–2000、非排除标签、文本占比 ≥ 0.6、未译"规则纯函数化。
- content.ts 负责 DOM 查询并组装 `BlockCandidate`，翻译判定委托纯函数。

### 3.7 翻译历史数据结构

```ts
export type TranslationKind = 'selection' | 'page' | 'vocab' | 'sentence'

export interface TranslationHistoryEntry {
  id: string
  source: string        // 截断 200
  target: string        // 截断 200
  sourceLang: string    // 检测到的源（'auto' 或脚本描述）
  targetLang: TargetLangCode
  kind: TranslationKind
  url: string
  createdAt: number
}

/** LRU 去重 + 截断。上限 200 条；相同 source+targetLang 去重保留最新。 */
export function appendHistory(
  list: TranslationHistoryEntry[],
  entry: TranslationHistoryEntry,
  max = 200
): TranslationHistoryEntry[]
```

### 3.8 显示模式

```ts
export type DisplayMode = 'bilingual' | 'translationOnly' | 'hover'
```
纯类型 + 校验函数（`isValidDisplayMode`）。实际 DOM 渲染由 content.ts 完成。

---

## 4. 沉浸式双语整页翻译（content.ts 重构）

### 4.1 选块升级

- 选择器：`p, li, blockquote, h1-h6, td, th, dt, dd, figcaption, summary`。
- 过滤：`shouldTranslateBlock`（§3.6）+ 排除 `[data-lector-no-translate]`、`#lector-ai-result`、`#lector-ai-toolbar`、`#lector-ai-loading`、`#lector-ai-fab`。
- 排序：**视口内优先**（`getBoundingClientRect()` 与 viewport 相交者优先），不再硬切 30 个。
- 增量：`IntersectionObserver` 监听未译段落，滚动入视口时自动入队翻译。

### 4.2 并发 + 流式翻译

```
toggleBilingual() / translateVisible() 流程：
  1. 读 settings → resolveTargetLang(settings.translation.targetLanguage, pageLang)
  2. 选块（视口优先排序）→ 组装 BlockCandidate[] → 过滤
  3. 对每块立即插入译文容器（.lector-bilingual，含语言 spinner 占位）
  4. runConcurrent(blocks, worker, { concurrency: settings.translation.concurrency ?? 5, signal })
     worker = async (block) => {
       await streamChat(settings, [{role:'system',...},{role:'user',content:original}],
                        {maxTokens, temperature:0.2},
                        (delta) => { 追加 delta 到该块译文容器 })  // 流式出字
     }
  5. 失败块：重试 1 次（500ms 退避）；仍失败→译文容器显示错误标记，不中断其他块
  6. 首个全局错误 → sendMessage('lector-bilingual-error') 给 sidepanel（保留现有行为）
  7. 翻译成功 → sendMessage('lector-translation-history', entry) 中继入库
```

- AbortController：sidepanel「取消」按钮 → content 监听 `lector-cancel-bilingual` → abort。
- 进度上报：每块开始/完成 → `lector-bilingual-progress` {done, total} → sidepanel 显示「已翻译 X/Y 段」。

### 4.3 交互

- 开关：sidepanel 按钮（保留）+ 快捷键 `Alt+T`（manifest command `lector-translate`）。
- 显示模式切换：sidepanel 设置改 `displayMode` → content 监听 `lector-translation-settings-changed` → 即时切换容器 class，不重译。
- 段落 hover：译文区右上角浮现「重试 / 复制译文」操作条（仅该块）。

### 4.4 CSS（`.lector-bilingual` 升级）

- 保持现有左侧色条风格，增强：流式光标动画（caret）、错误态红色边、hover 操作条、暗色页面适配（复用 `isDarkPage`）。
- 仅译文模式：隐藏原文（`display:none` 原文）；hover 模式：译文默认隐藏，hover 显示。

---

## 5. 划词翻译弹窗（content.ts 重构）

改 `runByokAction('translate')` + `showResult()`。

### 5.1 流式输出

```
handleAction('translate', text):
  1. 读 settings → resolveTargetLang
  2. 立即 showResult(空骨架, 'translate') —— 弹窗带骨架占位 + 目标语言选择器
  3. streamChat(..., onToken=(delta)=>{ 追加到 .result-content })  // 流式出字
  4. 完成后启用底部按钮
```
- 体验：划词后弹窗几乎瞬时出现，文字逐字流入（对标 DeepL）。
- 错误：catch → 弹窗内显示错误，不全局 alert。

### 5.2 弹窗增强

- **目标语言选择器**（顶部下拉）：12 种 + Auto，选择记入 `settings.translation.targetLanguage`（通过 background 中继持久化）。
- **朗读（TTS）**：原文/译文各一个 🔊 按钮，用 `window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))`，`utterance.lang = LANGUAGES[code].speechCode`。零依赖。
- **复制**（保留）+ **进入面板继续**（保留）+ **重新翻译**（用当前语言重发）。
- 定位：复用现有 right clamp + bottom flip 避让逻辑；深色页面复用 `isDarkPage`。

---

## 6. 翻译设置与目标语言

### 6.1 `ByokSettings.translation`（providers.ts 新增）

```ts
export interface TranslationSettings {
  targetLanguage: TargetLangCode | 'auto'   // 默认 'auto'
  displayMode: DisplayMode                    // 默认 'bilingual'
  autoTranslate: boolean                      // 整页自动翻译，默认 false
  concurrency: number                         // 默认 5，范围 1–10
}
```
`ByokSettings` 增可选字段 `translation?: TranslationSettings`；`DEFAULT_BYOK_SETTINGS` 带 `DEFAULT_TRANSLATION_SETTINGS`。双写 zustand + storage（沿用现有 `lector_byok_settings`）。

### 6.2 设置 UI（sidepanel Settings，不新建 options page）

- 目标语言：下拉（Auto + 12 种）。
- 显示模式：3 选 1（双语对照 / 仅译文 / 悬停）。
- 自动翻译：开关 + 说明（"打开页面自动整页翻译"）。
- 并发数：滑块 1–10。
- 改动 → `saveSettings()` 写 storage → content 监听 `lector-translation-settings-changed` 即时生效。

### 6.3 快捷键

`manifest.json` 新增：
```json
"lector-translate": { "suggested_key": { "default": "Alt+T" }, "description": "Translate this page (bilingual)" }
```
`background.ts` command handler 转发 `lector-toggle-bilingual`（沿用现有消息）给 content。

---

## 7. 翻译一致性与历史

### 7.1 Glossary 增强

- 现有 `renderGlossaryPrompt` 已注入 4 个调用点。经 translation.ts 统一入口后自动全覆盖。
- 新增 `filterGlossaryForDirection(entries, targetLang)`：方向感知过滤（中→英时只注入含中文 source 的条目方向相关者）。粗筛实现，避免污染。

### 7.2 翻译历史（新增）

- `store.ts` 增 `translationHistory: TranslationHistoryEntry[]` + `addTranslationHistory` / `clearTranslationHistory` actions。
- 中继：content/background 翻译成功 → `sendMessage('lector-translation-history', entry)` → background 写 `chrome.storage.local.lectorTranslationHistory` 队列 → sidepanel 监听 `storage.onChanged` 抽干入库（沿用 vocab/highlights 中继模式）。
- sidepanel 新增「翻译历史」抽屉：列表（源/译文摘要 + 时间 + kind 图标）+ 搜索框 + 点击「复制/重新翻译」+ 清空按钮。LRU 上限 200。

---

## 8. i18n 字符串新增（i18n.ts）

新增 key（en/zh），举例：
- `settings.translation.title` / `.targetLanguage` / `.displayMode` / `.autoTranslate` / `.concurrency`
- `displayMode.bilingual` / `.translationOnly` / `.hover`
- `popup.result.speak` / `.retranslate` / `.targetLang`
- `side.translationHistory.title` / `.empty` / `.clear` / `.search` / `.copy` / `.retranslate`
- `toolbar.bilingual` / `bilingual.progress`（"已翻译 {done}/{total} 段"）/ `bilingual.cancel` / `bilingual.retry` / `bilingual.blockError`

---

## 9. 测试与验证

### 9.1 纯逻辑单测 `tests/translation.test.ts`（新建）

- `LANGUAGES` 完整性（12 条、code 唯一、speechCode 非空）
- `detectScript`（各脚本样本）
- `resolveTargetLang`（auto 各方向 / 用户覆盖）
- `buildTranslateSystemPrompt`（含/不含 glossary）
- `filterGlossaryForDirection`（方向过滤）
- `buildBatchPrompt` + `parseBatchResult`（分隔符解析、容错、乱序、数量不匹配）
- `runConcurrent`（并发上限不超 N、abort 中断、单任务错误隔离不传播、结果顺序）
- `shouldTranslateBlock`（各 tag/长度/文本比/已译/排除标签组合）
- `appendHistory`（LRU 去重、截断 200、顺序）

### 9.2 E2E `tests/browser/run-browser-e2e.mjs`（扩展）

- 划词翻译流式出字（mock SSE 分片 → 弹窗 `.result-content` 逐增）
- 整页双语并发（mock 多请求 → 多个 `.lector-bilingual` 注入）
- 目标语言切换（改 storage → 新翻译用新语言，验证 prompt 含目标语言）
- 快捷键 `Alt+T` 触发整页翻译

### 9.3 门禁（全部必须绿）

```bash
NODE_ENV=development npm run typecheck
NODE_ENV=development npm test
NODE_ENV=development npm run build:extension
NODE_ENV=development npm run build:extension && npm run test:browser
```

---

## 10. 实现顺序（分阶段，每阶段可独立验证）

1. **阶段 A · 纯逻辑核心**：`src/shared/translation.ts` + `tests/translation.test.ts`（TDD，先红后绿）。
2. **阶段 B · 类型与设置**：`providers.ts`（TranslationSettings）+ `store.ts`（history state）+ `i18n.ts`（新字符串）。
3. **阶段 C · 双语整页**：`content.ts` 重构 `toggleBilingual`（并发+流式+增量+进度+取消+显示模式）。
4. **阶段 D · 划词弹窗**：`content.ts` 重构 `runByokAction('translate')` + `showResult`（流式+语言选择+TTS）。
5. **阶段 E · 设置 UI + 历史**：`App.tsx`（设置区 + 历史抽屉）。
6. **阶段 F · 集成收尾**：`manifest.json`（Alt+T）+ `background.ts`（命令转发 + 历史中继）+ glossary 方向过滤。
7. **阶段 G · 验证**：typecheck + 单测 + build:extension + browser e2e 全绿。

---

## 11. 非目标 / YAGNI

- ❌ 不引入外部 MT（DeepL/Google/微软）——用户已确认仅优化 LLM。
- ❌ 不新建独立 options page——设置留在 sidepanel（遵循现状）。
- ❌ 不做翻译记忆库（TM）/ 翻译统计仪表盘——超出本次范围。
- ❌ 不做 PDF/视频字幕翻译——超出本次范围。
- ❌ 默认不启用批量合并（牺牲流式）——保留接口备用。
