# 信任与深度功能 实现计划

> **给 agentic worker：** 必需子技能：用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。步骤用复选框（`- [ ]`）语法跟踪。

**目标：** 把三个有竞争力的功能（引用溯源阅读、高亮→导出、SM-2 词汇本）落地进 Lector AI，配套纯逻辑单元测试（vitest），并保证扩展构建通过。

**架构：** 纯逻辑（citations、srs、highlights、vocabulary、exporters）抽成 `src/shared/` 下零 DOM 依赖的模块，配 vitest 单元测试。这些被 DOM/UI 层（`content.ts`、`sidepanel/App.tsx`、`store.ts`）消费。仅功能①触及后端，通过扩展现有 `/chat` 系统提示实现。不新增端点、不新增数据库表。

**技术栈：** TypeScript、React 18、Zustand、Vite（构建）、vitest（测试，新增）、jsdom（集成测试，新增）。

---

## 文件结构

**新增纯逻辑模块（零 DOM 依赖，配单元测试）：**
- `src/shared/citations.ts` — `[bN]` 解析 / 渲染 / 系统提示构建（功能①）
- `src/shared/srs.ts` — SM-2 调度纯函数（功能③）
- `src/shared/highlights.ts` — 高亮类型 + 序列化/去重/分组（功能②，③复用）
- `src/shared/vocabulary.ts` — 词条类型 + 存词/合并/校验（功能③）
- `src/shared/exporters.ts` — Markdown/Obsidian/Notion ExportProvider（功能②）

**新增测试（vitest + jsdom）：**
- `tests/citations.test.ts`、`tests/srs.test.ts`、`tests/highlights.test.ts`、`tests/vocabulary.test.ts`、`tests/exporters.test.ts`、`tests/content.test.ts`

**修改：**
- `src/content.ts` — 块锚点、高亮注入、vocab 存词、消息处理、jump-to
- `src/shared/store.ts` — 新增 `highlights[]`、`vocab[]` 状态与动作
- `src/sidepanel/App.tsx` — 高亮抽屉、词汇抽屉、引用角标渲染
- `api/chat/index.ts` — 系统提示嵌入带 `[bN]` 前缀的块
- `src/manifest.json` — 版本 0.3.0、commands
- `package.json` — 新增 vitest、jsdom、测试脚本
- `src/content.css` — 高亮 + 引用脉冲样式
- `src/sidepanel/index.css` — 角标 + 到期徽标样式

---

## 任务 0：测试脚手架（vitest + jsdom）

**文件：**
- 修改：`package.json`
- 新建：`vitest.config.ts`

- [x] **步骤 1：安装开发依赖**

执行：
```bash
npm install -D vitest@^2 jsdom@^25 @types/jsdom
```
预期：包加入 devDependencies。

> ⚠️ 实现注记：本机 shell 环境中 `NODE_ENV=production`，会导致 npm 跳过 devDependencies。
> 所有安装/测试/构建命令需前置 `NODE_ENV=development`，例如
> `NODE_ENV=development npm install`、`NODE_ENV=development node_modules/.bin/vitest run`。

- [x] **步骤 2：新建 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
})
```

- [x] **步骤 3：给 `package.json` 加测试脚本**

在 `"scripts"` 中加入：
```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit"
```

- [x] **步骤 4：冒烟测试验证脚手架**

执行：`NODE_ENV=development node_modules/.bin/vitest run`
预期：通过。

- [x] **步骤 5：提交**

```bash
git commit -m "chore(test): add vitest + jsdom test harness"
```

---

## 任务 1：citations 模块（功能①纯逻辑）

**文件：**
- 新建：`src/shared/citations.ts`
- 测试：`tests/citations.test.ts`

- [x] **步骤 1：写失败测试**（`tests/citations.test.ts`，含 parseCitations / buildCitedSystemPrompt / renderCitations 三组断言）

- [x] **步骤 2：运行确认失败**：`NODE_ENV=development node_modules/.bin/vitest run citations`

- [x] **步骤 3：实现 `src/shared/citations.ts`**

```ts
// 引用溯源纯函数，无 DOM 依赖。
export interface PageBlock {
  id: string        // "b0"，镜像到 DOM 节点的 data-lector-id
  text: string
  domSelector: string
}

export interface Citation {
  raw: string       // 规范化 id，如 "b0"
  display: string   // 展示给用户的数字，如 "0"
}

// 解析模型文本里的 [N] 标记，只保留白名单内的 id。
// [0] 与 [b0] 都映射到 id "b0"。保留顺序与连续重复（模型常输出 [0][2]）。
export function parseCitations(text: string, validIds: Set<string>): Citation[] {
  const out: Citation[] = []
  const re = /\[(b?\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const display = m[1].replace(/^b/, '')
    const raw = `b${display}`
    if (validIds.has(raw)) out.push({ raw, display })
  }
  return out
}

// 构建系统提示的 PAGE CONTENT 段，每块前缀 [bN] 以便模型引用。
export function buildCitedSystemPrompt(blocks: PageBlock[]): string {
  const body = blocks.map((b) => `[${b.id}] ${b.text}`).join('\n')
  return [
    'PAGE CONTENT (each block prefixed [bN]; cite ONLY these ids):',
    body,
    '',
    'When you state a fact from the article, append [bN] referencing the block(s) it came from.',
    'If the answer is not covered in the page content, say so rather than guessing.',
    'Never cite an id not listed above.',
  ].join('\n')
}

// 把 HTML 片段里的 [bN] 标记替换为可点击角标。
// 非法 id 被完全剔除（无角标、无残留括号）。输入 HTML 假定已被 markdown 渲染器转义。
export function renderCitations(html: string, validIds: Set<string>): string {
  return html.replace(/\[(b?\d+)\]/g, (_full, inside: string) => {
    const display = inside.replace(/^b/, '')
    const raw = `b${display}`
    if (!validIds.has(raw)) return ''
    return `<sup class="lector-cite" data-cite="${raw}" title="Source block ${display}">[${display}]</sup>`
  })
}
```

- [x] **步骤 4：运行确认通过**
- [x] **步骤 5：提交**：`feat(citations): [bN] 解析/渲染/提示构建纯模块 + 测试`

---

## 任务 2：srs 模块（功能③纯逻辑）

**文件：**
- 新建：`src/shared/srs.ts`
- 测试：`tests/srs.test.ts`

- [x] **步骤 1：写失败测试**（scheduleSrs 全矩阵：again 重置+lapse、good/hard/easy 间隔增长、ease 下限≥1.3、isDue 边界）

- [x] **步骤 2：运行确认失败**

- [x] **步骤 3：实现 `src/shared/srs.ts`**

```ts
// 简化版 SM-2 间隔重复调度器。纯函数，零依赖。常量参考 Anki 公开 SM-2 默认值。

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  due: number       // 下次到期 epoch 毫秒
  interval: number  // 间隔（天）
  ease: number      // 难度系数，下限 1.3
  reps: number      // 成功复习次数
  lapses: number    // 遗忘（again）次数
}

const DAY = 86_400_000
const EASE_FLOOR = 1.3

export function newSrs(now: number = Date.now()): SrsState {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 }
}

// 根据评分推进卡片。SM-2 简化为 Anki 式 4 按钮。again 重置为短期再学并记一次 lapse；
// 其余按 ease 增长间隔并调整 ease。
export function scheduleSrs(card: SrsState, grade: Grade, now: number = Date.now()): SrsState {
  let { ease, interval, reps, lapses } = card

  if (grade === 'again') {
    ease = Math.max(EASE_FLOOR, ease - 0.2)
    lapses += 1
    return { due: now + 10 * 60 * 1000, interval: 0, ease, reps, lapses }
  }

  if (grade === 'hard') {
    ease = Math.max(EASE_FLOOR, ease - 0.15)
    interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2))
  } else if (grade === 'good') {
    interval = reps === 0 ? 1 : Math.round(interval * ease)
  } else {
    ease = ease + 0.15
    interval = reps === 0 ? 4 : Math.round(interval * ease * 1.3)
  }

  reps += 1
  interval = Math.max(1, interval)
  return { due: now + interval * DAY, interval, ease, reps, lapses }
}

export function isDue(card: SrsState, now: number = Date.now()): boolean {
  return card.due <= now
}
```

- [x] **步骤 4：运行确认通过**
- [x] **步骤 5：提交**：`feat(srs): SM-2 间隔重复调度纯模块 + 测试`

---

## 任务 3：highlights 模块（功能②纯逻辑）

**文件：**
- 新建：`src/shared/highlights.ts`
- 测试：`tests/highlights.test.ts`

- [x] **步骤 1：写失败测试**（isDuplicateHighlight / groupHighlights / searchHighlights）

- [x] **步骤 2：运行确认失败**

- [x] **步骤 3：实现 `src/shared/highlights.ts`**

```ts
// 高亮领域逻辑（功能②，③复用）。纯函数。

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue'

export interface Highlight {
  id: string
  text: string       // 高亮的文本
  note: string       // 用户笔记（若有）
  quote: string      // 高亮前后±100 字的来源上下文
  url: string
  title: string
  blockId?: string   // 所在页面块 id（链接到①），若有
  createdAt: number
  color: HighlightColor
}

// 两条高亮当 text 与 url 都相同时判为重复。用于防止对同一段落重复高亮。
export function isDuplicateHighlight(a: Highlight, b: Highlight): boolean {
  return a.text === b.text && a.url === b.url
}

// 按来源（title + url）分组。组内按最新在前排序。
export function groupHighlights(hs: Highlight[]): Map<string, Highlight[]> {
  const map = new Map<string, Highlight[]>()
  for (const h of hs) {
    const key = `${h.title}\u0000${h.url}`
    const arr = map.get(key) ?? []
    arr.push(h)
    map.set(key, arr)
  }
  for (const arr of map.values()) arr.sort((a, b) => b.createdAt - a.createdAt)
  return map
}

// 跨 text/note/title 搜索高亮。大小写不敏感的子串匹配。
export function searchHighlights(hs: Highlight[], q: string): Highlight[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return hs
  return hs.filter(
    (h) =>
      h.text.toLowerCase().includes(needle) ||
      h.note.toLowerCase().includes(needle) ||
      h.title.toLowerCase().includes(needle)
  )
}
```

- [x] **步骤 4：运行确认通过**
- [x] **步骤 5：提交**：`feat(highlights): 高亮领域逻辑（去重/分组/搜索）+ 测试`

---

## 任务 4：vocabulary 模块（功能③纯逻辑）

**文件：**
- 新建：`src/shared/vocabulary.ts`
- 测试：`tests/vocabulary.test.ts`

- [x] **步骤 1：写失败测试**（mergeVocabEntry / validateWord / makeVocabEntry）

- [x] **步骤 2：运行确认失败**

- [x] **步骤 3：实现 `src/shared/vocabulary.ts`**

```ts
// 词汇领域逻辑（功能③）。纯函数。
import type { SrsState } from './srs'
import { newSrs } from './srs'

export interface VocabEntry {
  id: string
  word: string
  translation: string
  context: string   // 来源句子±80 字
  url: string
  title: string
  lang: string
  createdAt: number
  srs: SrsState
}

export interface ValidationResult {
  ok: boolean
  reason?: string
}

// 存词前校验。超过 60 字视为句子，拒绝（引导用户改用高亮）。
export function validateWord(word: string): ValidationResult {
  const trimmed = word.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length > 60) return { ok: false, reason: 'too-long-sentence' }
  return { ok: true }
}

// 把新来的重复条目合并进已存在条目。保留最早 createdAt、最新 context，且不重置 SRS 状态
// （复习进度得以保留）。
export function mergeVocabEntry(existing: VocabEntry, incoming: VocabEntry): VocabEntry {
  return {
    ...existing,
    context: incoming.context || existing.context,
    translation: incoming.translation || existing.translation,
    url: incoming.url || existing.url,
    title: incoming.title || existing.title,
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    srs: existing.srs,
  }
}

// 用默认 SRS 状态（due now）创建新词条。
export function makeVocabEntry(
  partial: Omit<VocabEntry, 'srs' | 'createdAt'> & { createdAt?: number }
): VocabEntry {
  return {
    ...partial,
    createdAt: partial.createdAt ?? Date.now(),
    srs: newSrs(),
  }
}
```

- [x] **步骤 4：运行确认通过**
- [x] **步骤 5：提交**：`feat(vocabulary): 词条合并/校验/创建纯模块 + 测试`

---

## 任务 5：exporters 模块（功能②纯逻辑）

**文件：**
- 新建：`src/shared/exporters.ts`
- 测试：`tests/exporters.test.ts`

- [x] **步骤 1：写失败测试**（toMarkdown / toObsidian / toNotionProperties）

- [x] **步骤 2：运行确认失败**

- [x] **步骤 3：实现 `src/shared/exporters.ts`**

```ts
// 功能②的导出 Provider。纯函数，产出 payload/字符串。
import type { Highlight } from './highlights'

export interface ExportOptions {
  vaultRoot?: string  // Obsidian 相对链接可选的 vault 根
}

// Markdown 导出：每条高亮一块，含笔记 + 来源。
export function toMarkdown(hs: Highlight[], _opts: ExportOptions = {}): string {
  return hs
    .map((h) => {
      const lines = [
        `### ${h.title}`,
        '',
        `> ${h.text}`,
        '',
        h.note ? `**Note:** ${h.note}` : '',
        '',
        `Source: [${h.title}](${h.url})`,
        '',
        '---',
        '',
      ]
      return lines.join('\n')
    })
    .join('\n')
}

// Obsidian 导出：front-matter + callout 友好的 markdown。
export function toObsidian(hs: Highlight[], opts: ExportOptions = {}): string {
  const bySource = new Map<string, Highlight[]>()
  for (const h of hs) {
    const k = h.title
    bySource.set(k, [...(bySource.get(k) ?? []), h])
  }
  const fm = [
    '---',
    `source: "${hs[0]?.url ?? ''}"`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    'tags: [lector, highlight]',
    '---',
    '',
  ].join('\n')
  const body = [...bySource.entries()]
    .map(([title, items]) => {
      const block = items
        .map(
          (h) =>
            `> [!quote] ${h.text}${h.note ? `\n> \n> **Note:** ${h.note}` : ''}\n> Source: [${title}](${h.url})`
        )
        .join('\n\n')
      return `## ${title}\n\n${block}`
    })
    .join('\n\n')
  void opts
  return `${fm}${body}\n`
}

// 单条高亮的 Notion "create page" 属性 payload。调用方用用户的 database id 投递。
export function toNotionProperties(h: Highlight): Record<string, unknown> {
  return {
    Title: { title: [{ text: { content: h.text.slice(0, 2000) } }] },
    Source: { url: h.url },
    Note: { rich_text: [{ text: { content: h.note || '' } }] },
  }
}
```

- [x] **步骤 4：运行确认通过**
- [x] **步骤 5：提交**：`feat(exporters): markdown/obsidian/notion 导出 Provider + 测试`

---

## 任务 6：store 扩展（功能②③ 状态）

**文件：** 修改 `src/shared/store.ts`

- [x] **步骤 1：加入高亮 + vocab 状态与动作**

顶部 import：
```ts
import type { Highlight } from './highlights'
import type { VocabEntry } from './vocabulary'
import type { SrsState } from './srs'
```

`AppState` 接口新增成员：
```ts
  highlights: Highlight[]
  vocab: VocabEntry[]
  addHighlight: (h: Highlight) => { duplicate: boolean }
  removeHighlight: (id: string) => void
  updateHighlight: (id: string, patch: Partial<Highlight>) => void
  addVocab: (v: VocabEntry) => void
  removeVocab: (id: string) => void
  updateVocabSrs: (id: string, srs: SrsState) => void
```

`create(...)` 工厂中（`clearSessions` 之后）新增初始值与动作：`highlights: []`、`vocab: []`，
以及 addHighlight（去重返回 `{duplicate}`）、removeHighlight、updateHighlight、addVocab
（按词大小写不敏感合并，保留最早 createdAt、最新 context、不重置 srs）、removeVocab、
updateVocabSrs。

`partialize` 持久化新增 `highlights`、`vocab`。

- [x] **步骤 2：类型检查通过**
- [x] **步骤 3：提交**：`feat(store): 新增 highlights + vocab 集合与动作`

---

## 任务 7：后端 — 引用溯源 chat 提示（功能①）

**文件：** 修改 `api/chat/index.ts`

- [x] **步骤 1：import 并构建 blocks**

```ts
import { buildCitedSystemPrompt, type PageBlock } from '../../src/shared/citations'
```

`ChatRequestBody` 新增 `pageBlocks?: PageBlock[]`。系统提示构建改为：优先用客户端传入的
`pageBlocks`；否则把 `trimmedPage` 按空行切成伪块。用 `buildCitedSystemPrompt(blocks)`
产出引用段，拼进系统提示。

- [x] **步骤 2：类型检查（tsconfig 包含 api + src）通过**
- [x] **步骤 3：提交**：`feat(chat): 带 [bN] 块的引用溯源系统提示`

---

## 任务 8：content script — 块锚点、高亮、存词、jump-to

**文件：**
- 修改 `src/content.ts`、`src/content.css`、`src/background.ts`
- 新建：`tests/content.test.ts`

本任务最大。新增：extractPage 打 block id、工具栏高亮与存词动作、三个消息处理
（`lector-jump-to`、`lector-highlight`、`lector-save-word`）、background 中继与命令转发。

- [x] **步骤 1：写集成测试**（`tests/content.test.ts`，jsdom 验证 jump-to 定位 + 高亮注入不破坏 DOM；需 stub `scrollIntoView` 因 jsdom 未实现）

- [x] **步骤 2：运行确认行为**

- [x] **步骤 3：`src/content.css` 追加** 引用脉冲（`lector-pulse`）+ 高亮 mark 样式（含 green/pink/blue 变体）

- [x] **步骤 4：改 `extractPage`**：采集 live DOM 块时打 `data-lector-id="bN"`，输出
  `blocks: ExtractedPageBlock[]`，并保留 `text` 兼容字段。`ExtractedPage` 接口新增
  `blocks`。

- [x] **步骤 5：选择工具栏加高亮动作**：`createToolbar` 内追加 `🔖 高亮` 按钮 →
  `handleHighlight(text)`。用 `range.surroundContents(mark)` 包裹（失败则回退仅文本），
  记录最近的 `data-lector-id` 作 blockId，`chrome.runtime.sendMessage` 发
  `lector-highlight`。

- [x] **步骤 6：选择工具栏加存词动作**：追加 `★ 存词` 按钮 → `handleSaveWord(word)`。
  抓取锚点父元素的 blockId 与原句上下文，发 `lector-save-word`。

- [x] **步骤 7：消息处理 `lector-jump-to`**：查 `[data-lector-id="..."]` →
  `scrollIntoView` + 加 `lector-pulse` 类 2 秒后移除；找不到则 `sendResponse({ok:false,
  reason:'node-unavailable'})`。

- [x] **步骤 8：background 中继**：扩展 `open-side-panel` 监听器，处理 `lector-highlight`
  （unshift 进 `lectorHighlights` storage，上限 500）与 `lector-save-word`（先 fetch
  `/translate` 取翻译，再合并入 `lectorVocab` storage，上限 2000，按词大小写不敏感去重保
  留 srs）。新增 `chrome.commands.onCommand` 转发 `lector-command` 到活动标签页。

- [x] **步骤 9：类型检查 + 构建通过**
- [x] **步骤 10：全部测试通过**
- [x] **步骤 11：提交**：`feat(content): 块锚点、高亮+存词工具栏、jump-to、命令中继`

---

## 任务 9：侧栏 — 高亮抽屉、词汇抽屉、引用角标（功能①②③ UI）

**文件：**
- 修改 `src/sidepanel/markdown.ts`、`src/sidepanel/App.tsx`、`src/sidepanel/index.css`

- [x] **步骤 1：markdown.ts 不改**（引用渲染在调用处用 `renderCitations` 后处理）

- [x] **步骤 2：`src/sidepanel/index.css` 追加** `.lector-cite`（角标）+ `.lector-due-badge`（到期徽标）样式

- [x] **步骤 3：`App.tsx` 接入 page blocks + 引用渲染**：import `renderCitations`、
  `PageBlock`、`isDue`、`toMarkdown`、`Highlight`、`VocabEntry`、`scheduleSrs`、`Grade`；
  `PageContext` 加 `blocks`；`handleSend` 的 fetch body 加 `pageBlocks: page?.blocks`。

- [x] **步骤 4：assistant 消息渲染角标**：`validCiteIds = new Set(page?.blocks ids)`；
  `dangerouslySetInnerHTML` 的 html 用 `renderCitations(renderMarkdown(m.content),
  validCiteIds)`；`onClick` 委托捕获 `[data-cite]` → 向活动标签页发 `lector-jump-to`。

- [x] **步骤 5：高亮抽屉**：状态 `showHighlights`；store 选择器
  `highlights/addHighlight/removeHighlight`；`chrome.storage.onChanged` 监听同步
  `lectorHighlights`（drain 队列）；Header 加 🔖 按钮；抽屉列表 + "Export Markdown"。

- [x] **步骤 6：词汇抽屉**：状态 `showVocab`、`revealed`；store 选择器
  `vocab/updateVocabSrs`；Header 加 ★ 按钮（有到期时显示 `!` 徽标）；抽屉按
  `isDue` 显示复习卡片，翻面看翻译，4 档评分调 `scheduleSrs` 更新。

- [x] **步骤 7：类型检查 + 构建通过**
- [x] **步骤 8：提交**：`feat(sidepanel): 引用角标、高亮抽屉、词汇复习抽屉`

---

## 任务 10：manifest 版本 + 命令

**文件：** 修改 `src/manifest.json`

- [x] **步骤 1：版本 0.2.0 → 0.3.0，新增 `commands`**：
```json
  "commands": {
    "highlight-selection": { "suggested_key": { "default": "Alt+H" }, "description": "Highlight the current selection with Lector AI" },
    "save-word": { "suggested_key": { "default": "Alt+S" }, "description": "Save the current selection as a vocabulary word" }
  },
```

- [x] **步骤 2：background 命令监听**（任务 8 已加）→ content 处理 `lector-command`（任务 8 已加）

- [x] **步骤 3：构建通过；`dist/manifest.json` 显示 0.3.0**
- [x] **步骤 4：提交**：`feat: 键盘命令（Alt+H 高亮、Alt+S 存词），v0.3.0`

---

## 任务 11：最终验证

- [x] **步骤 1：全量类型检查** `NODE_ENV=development node_modules/.bin/tsc --noEmit` → exit 0
- [x] **步骤 2：全量测试** `NODE_ENV=development node_modules/.bin/vitest run` → 37/37 通过
- [x] **步骤 3：扩展构建** `NODE_ENV=development npm run build:extension` → 构建成功
- [x] **步骤 4：校验 dist 布局** → manifest 0.3.0、content.js/background.js/sidepanel.js/popup.js + content.css 齐全
- [x] **步骤 5：更新设计文档状态** → "已实现"

---

## 自检

**1. 规格覆盖：**
- ① 块锚点 → 任务 8 步骤 4；后端提示 → 任务 7；角标渲染+点击 → 任务 9 步骤 3-4；jump-to → 任务 8 步骤 7 + 任务 9 步骤 4 ✓
- ② 高亮捕获 → 任务 8 步骤 5；抽屉 → 任务 9 步骤 5；exporters → 任务 5；导出按钮 → 任务 9 步骤 5 ✓
- ③ 存词 → 任务 8 步骤 6 + background 步骤 8；SRS → 任务 2；复习抽屉 → 任务 9 步骤 6 ✓
- store → 任务 6；manifest/命令 → 任务 10；测试 → 任务 1-5、8 ✓

**2. 占位符扫描：** 无"TBD/TODO/处理边界情况"等无代码内容；每个代码步骤都有真实代码。

**3. 类型一致性：** `PageBlock`、`Highlight`、`VocabEntry`、`SrsState`、`Grade` 在各模块与
任务间命名一致。`scheduleSrs(card, grade, now)` 签名在测试、store、UI 中一致。
`renderCitations(html, validIds)` 在测试、citations.ts、App 中一致。

---

## 验证证据（实现后）

- **类型检查**：`tsc --noEmit` → exit 0
- **单元测试**：`vitest run` → 37/37 通过（citations 8、srs 9、highlights 7、vocabulary 6、exporters 4、content 3）
- **构建**：`npm run build:extension` → 成功，`dist/manifest.json` 版本 0.3.0
