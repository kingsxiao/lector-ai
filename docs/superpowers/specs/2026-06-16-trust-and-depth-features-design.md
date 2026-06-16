# Lector AI — 信任与深度功能设计

**日期：** 2026-06-16
**状态：** 已实现（构建通过、类型检查无错、37 个测试通过）
**目标 manifest 版本：** 0.3.0

## 背景

Lector AI 在 2026-06-15 的"竞争力升级"中补齐了相对于 Monica / Sider / Glasp /
Immersive Translate 的上线差距（侧栏、chat-with-page、服务端限流、双语翻译、阅读库、支付）。

对 8 款产品（Monica、Sider、Glasp、Wiseone、Harpa、MaxAI、Immersive Translate、
Perplexity/Comet）的竞品调研揭示出一个惊人且趋同的未满足需求模式，归为两类：

1. **信任危机（整个品类的致命伤）。** 计费欺诈（MaxAI 在 Trustpilot 仅 1.9★；
   Sider/Monica"积分凭空消失"的抱怨）、隐私入侵（UC Davis 2025 研究点名
   Monica/Sider 持续记录浏览行为，甚至在隐身模式下）、以及**无源、幻觉式的摘要**
   ——用户不信任 AI 输出。只有 Harpa 和 Wiseone 认真做了答案出处引用，但都不在
   "边读边问"的使用场景里。
2. **阅读深度（知识留不住）。** Glasp 的导出又 buggy 又手动；r/ObsidianMD 用户明确
   渴望免费版 Readwise 式同步。Immersive Translate 明确缺乏词汇学习/语法分析（对比
   Trancy）。阅读助手普遍"广而浅"——读完就忘。

**战略建议（已采纳）：** 不要正面硬刚 Monica 的 Agent 或 Harpa 的命令广度。在**信任**
与**阅读深度**上建立差异化。本规格定义三个功能，共同讲出一个竞争故事：

> *Lector 是你真正可以信任的阅读助手——答案有据可查，知识陪你留存。*

三个功能共享数据、互相强化：① 带引用的摘要可以被 ② 捕获为高亮，高亮的来源上下文又
喂给 ③ 词汇复习，复习时还能跳回原文段落。

## 三个功能

| # | 功能 | 攻克的痛点 | 竞品短板 | 架构契合 |
|---|------|-----------|---------|---------|
| 1 | **引用溯源阅读** | 无源、幻觉式摘要 | 仅 Harpa/Wiseone 做引用，且不在阅读场景 | 已有 `extractPage()` 端侧提取 |
| 2 | **高亮 → Notion / Obsidian / Markdown** | Glasp 导出 buggy 且手动 | Glasp 头号槽点；Readwise 收费 | 已有本地 reading library |
| 3 | **阅读词汇本 (SM-2)** | 翻译产品无词汇学习闭环 | Immersive Translate 缺此能力 | 已有双语翻译 |

## 共享架构

### 数据模型（轻量、类型安全、可独立测试）

```
src/shared/highlights.ts   ← ①②③ 都用：高亮 = {id,text,note,quote,url,...}
src/shared/vocabulary.ts   ← ③ 用：词条 = {id,word,translation,context,due,...}
src/shared/srs.ts          ← ③ 用：SM-2 调度（纯函数）
src/shared/exporters.ts    ← ② 用：ExportProvider（纯函数）
src/shared/citations.ts    ← ① 用：[bN] 解析/渲染/提示构建（纯函数）
src/shared/store.ts        ← 扩展：新增 highlights[]、vocab[]，持久化
```

### 贯穿原则

- **端侧优先。** 页面定位、高亮区间计算、SRS 复习调度都在内容脚本/前端完成。服务端
  只接收已清洗的最小文本片段（隐私差异化）。
- **绝不破坏页面。** 高亮注入用 `Range` + 文本节点包裹最小 `<mark>` 节点；绝不替换或
  覆盖页面 DOM 结构（吸取 Immersive Translate"只能看不能点"的教训）。
- **优雅降级。** 每个功能在缺少外部配置（Notion token、源页面已卸载）时仍可用，不抛
  硬错误。
- **可独立测试。** 纯逻辑（引用映射、SRS 调度、高亮序列化、导出格式）全部抽成无 DOM
  依赖的纯函数，配单元测试；DOM 交互做集成测试。

---

## 功能① — 引用溯源阅读

### 攻克的痛点
整个品类的头号抱怨是不信任 AI 输出。Monica/Sider/MaxAI 的摘要都是无源凭空生成，用户
无法验证。Lector 已有的端侧 `extractPage()` 是建立"答案 ↔ 原文段落"映射的天然基础。

### 机制

**1. 段落级锚点 ID（溯源基础）。**

`extractPage()` 从输出纯文本改造为输出 `text + blocks`，每个被采集的块级元素获得稳定
锚点：

```ts
interface PageBlock {
  id: string          // "b0","b1"… 稳定，对应 DOM 节点的 data-lector-id
  text: string
  domSelector: string // 回溯定位用
}
interface ExtractedPage {
  ...existing
  blocks: PageBlock[]   // 新增
  text: string          // 保留兼容旧字段（= blocks 拼接）
}
```

提取时在每个被采集的 DOM 块上打 `data-lector-id="bN"`，这样摘要里的引用就能滚动高亮到
原文段落。

**2. 后端：流式 + 引用指令（扩展现有 /chat，不新增端点）。**

`/chat` 系统提示把每个块用 `[bN]` 前缀嵌入，并约束模型只能引用这些 id：

```
PAGE CONTENT (each block prefixed [bN]; cite ONLY these ids):
[b0] First paragraph…
[b1] Second paragraph…
```

指令：*"当陈述文章中的事实时，附上 [bN] 标注来源块。若页中未覆盖，请说明而非猜测。
绝不引用上面未列出的 id。"*

端点原样流式透传模型输出（含 `[bN]` 标记）。**解析与渲染都在前端**（已采纳方案），保持
流式不中断、端点无状态。

**3. 前端：渲染 + 点击溯源。**

渲染 assistant 消息时，`[bN]` 被解析为可点击的上标角标 `[3]`。点击后：

```
侧栏 → content script: { action: 'lector-jump-to', blockId: 'b2' }
content script: 查询 [data-lector-id="b2"] → scrollIntoView + 2 秒琥珀色脉冲高亮
```

角标为上标、品牌色，hover 显示来源块前 60 字预览以防误点。

### 数据流

```
用户提问
  → 侧栏 fetch /chat（带 page.blocks + page.text）
  → 服务端系统提示嵌入带 [bN] 前缀的段落
  → 模型流式返回 "…延迟损害用户信任 [0][2]。"
  → 前端逐 token 渲染；完成后扫描 [bN] → <cite> 角标
  → 用户点击角标 → sendMessage('lector-jump-to', blockId)
  → content script 定位 data-lector-id 并高亮
```

### 错误处理与降级

| 场景 | 行为 |
|------|------|
| 模型未输出 `[bN]`（不遵守） | 无角标渲染，正常显示——绝不因缺引用报错 |
| 模型编造 id（如 `[b99]`） | 前端校验 id 是否在块范围内；非法 id 被丢弃，不渲染角标 |
| 页面已卸载 / SPA 跳转后点击 | content script 找不到节点 → 提示"原文节点已不可用" |
| 页面超长（>12000 字符截断） | 截断后的块仍带 id，引用只指向已发送块——天然安全 |

**关键安全特性：** id 白名单校验在前端；服务端绝不信任模型自报的 id。

### 测试

纯函数单元测试（无 DOM）：
- `parseCitations(text, validIds)` → 解析 `[bN]`，过滤非法 id，返回 ranges
- `buildCitedSystemPrompt(blocks)` → 正确拼接每段 `[bN]` 前缀
- `renderCitations(html, validIds)` → 输出角标 HTML，非法 id 被剔除

集成测试：
- content script `lector-jump-to`：注入带 `data-lector-id` 的 DOM，验证滚动 + 高亮被调用

---

## 功能② — 高亮 → Notion / Obsidian / Markdown

### 攻克的痛点
Glasp 用户明确渴望免费版 Readwise 式自动同步，但 Glasp 的导出又 buggy 又手动。Lector
已有的本地 reading library 自然能扩展为"边读边捕获 → 一键导出到知识库"。与 ① 协同：
被捕获的高亮还能带上原文出处与上下文——这是 Glasp 做不到的。

### 机制

**1. 高亮捕获（选择工具栏动作 + 快捷键）。**

高亮是现有选择工具栏上的一等动作，与翻译/解释/摘要/提问并列。选中任意文本：
- 工具栏显示 **高亮** 按钮（或 `Alt+H` 快捷键）

捕获后：
- 用 `Range` + 把起止文本节点包裹进 `<mark class="lector-hl">`；**绝不替换/覆盖页面
  DOM 结构**。
- 持久化：`Highlight { id, text, note, quote(原文上下文±100字), url, title, blockId?, createdAt, color }`。
- 若该高亮在某个 `data-lector-id` 块内，记录 `blockId`，使其与 ① 的引用溯源联动。

**2. 高亮管理面板（侧栏新增视图）。**

侧栏 Header 新增 **高亮** 入口（在 Library 旁），打开抽屉：
- 按页面/域名分组；支持搜索、编辑笔记、改颜色、删除
- 顶部 **导出** 按钮，下拉选格式：`Markdown` / `Notion` / `Obsidian`

**3. 统一 Provider 接口背后的三种导出。**

```ts
// src/shared/exporters.ts — 纯函数，易测
interface ExportProvider {
  format(highlights: Highlight[], opts: ExportOptions): ExportPayload
}
```

- **Markdown** — 本地文件下载，零配置。每条高亮含引用块（原文）、笔记、来源
  URL+标题。
- **Obsidian** — `.md` 带 front-matter（`source`、`created`、`tags`）和 `[[wikilinks]]`，
  用户拖进 vault 即可。
- **Notion** — 调用 Notion API 创建页面；需用户填 `NOTION_TOKEN` + 选 database，存入
  `chrome.storage.local`。失败时降级提示，不丢高亮。

**导出范围控制：** 当前页 / 全部 / 按标签——避免一次性灌入太多。

### 数据流

```
选中文本 → 工具栏/Alt+H → content script: Range 序列化 + mark 包裹 + 存 store
                                            ↓
侧栏高亮抽屉 ← chrome.storage 同步高亮列表
      ↓ 选导出 → 格式
Markdown: 浏览器 Blob 下载
Obsidian: Blob 下载 .md（front-matter）
Notion:   fetch Notion API（需 token）→ 失败则保留 + 提示重试
```

### 错误处理与降级

| 场景 | 行为 |
|------|------|
| Range 序列化失败（动态 DOM） | 回退为仅文本高亮——存 text+context，不在页面 mark，仍可导出 |
| 同段文本重复高亮 | 检测已存在相同 text+url，提示"已高亮"，不重复 |
| Notion token 缺失/失效 | 该格式置灰 + tooltip 引导填 token；其他格式不受影响 |
| Notion API 限流 (429) | 指数退避重试 1 次；仍失败则保留待导出队列 + 提示稍后 |
| 标记元素被 SPA 重渲染清除 | 下次 `lector-get-page` 时 best-effort 按文本锚点重打标 |

### 测试

纯函数单元测试：
- `isDuplicateHighlight` / `groupHighlights` / `searchHighlights` 去重、分组、搜索
- 三个 `toMarkdown` / `toObsidian` / `toNotionProperties` → 验证各格式结构

集成测试：
- content script 高亮注入：注入段落，触发高亮，验证 `<mark class="lector-hl">` 出现且其他
  页面节点未被破坏

---

## 功能③ — 阅读词汇本 (SM-2)

### 攻克的痛点
Immersive Translate 明确缺乏词汇学习；Trancy 在此占优。双语阅读者查过的词散落各处、很
快就忘。Lector 已有的双语翻译 + 选词工具栏，加一个"存词 → 间隔复习"的闭环，能把"阅读
翻译"升级为"阅读学习"。这正是翻译品类被诟病"浅尝辄止"的核心。

### 机制

**1. 零摩擦存词。**

在任何已翻译/选中的词或短语上：
- 工具栏显示 **★ 存词**（或 `Alt+S`）

存词时自动抓取上下文：
- `VocabEntry { id, word, translation(自动 /translate), partOfSpeech?, context(原句±80字), url, title, lang, createdAt, srs }`
- `srs = { due, interval, ease, reps, lapses }`（SM-2）

复用 ② 的高亮基础设施：存词本质是"带翻译与复习状态的高亮"。

**2. 间隔重复（SM-2，纯函数）。**

简化的 SuperMemo-2（Anki 同款核心，数十亿用户验证）——纯数学，极易单测：

```ts
// src/shared/srs.ts — 纯函数，零依赖
function scheduleSrs(card, grade: 'again'|'hard'|'good'|'easy'): SrsState
function isDue(card, now): boolean
```

复习通过 4 档评分驱动 interval/ease 更新。

**3. 复习面板（侧栏新增视图）。**

侧栏 Header 新增 **词汇** 入口，打开抽屉：
- **今日待复习** 计数徽标（基于 `isDue`）
- 复习卡片：正面 = 词 + 原句上下文（隐藏翻译）；背面 = 翻译 + 来源链接（跳回原 blockId，
  复用 ①）
- 四档评分按钮：Again / Hard / Good / Easy
- **全部词汇**列表，按到期/来源/语言筛选

**4. 闭环数据协同。**

```
阅读外文页 → 工具栏"翻译"(已有) → 看到"★ 存词" → 存词（blockId+原句）
                                                          ↓
                                  次日/按 SRS 到期 → 词汇抽屉提示"N 张待复习"
                                                          ↓
                                  复习卡 → 翻面看翻译 + 点击跳回原文出处（复用 ①）
```

三个功能形成闭环：**① 带引用阅读 → ② 高亮沉淀 → ③ 词汇复习回溯原文**。

### 数据流

```
选词 → 工具栏 ★ 存词
  → content script: 抓 context(原句) + 当前 blockId
  → 调 /translate 取翻译（复用现有端点）
  → store 新增 VocabEntry（srs 初始：due = now+1d）
侧栏词汇抽屉
  → 读 store，isDue() 计算今日队列
  → 复习 → scheduleSrs() 更新 → 持久化
```

### 错误处理与降级

| 场景 | 行为 |
|------|------|
| 取翻译失败（/translate 报错/限流） | 仍存词，translation 留空并标记"待翻译"，复习时提示用户补全 |
| 重复存同一词 | 合并：取最新 context，保留最早 createdAt，SRS 状态不重置 |
| SRS due 落在过去（时钟回拨） | `isDue` 用 `<=` 判断，自然归入到期队列 |
| 词汇量大（>2000） | 抽屉分页；复习队列单次上限 50 张防疲劳 |
| 词 >60 字或特殊字符 | 校验；>60 字提示"过长，疑似句子"，引导用高亮而非存词 |

### 测试

纯函数单元测试（重点——SM-2 正确性是可信度核心）：
- `scheduleSrs` 全矩阵：首卡 4 档评分、`again` 重置、连续 `easy` 间隔指数增长、`ease`
  下限保护（≥1.3）、`lapses` 累计
- `isDue` 边界：到期当天、时钟回拨、未来日期
- 存词去重合并逻辑

集成测试：
- 选词→存词→store 持久化→抽屉渲染→评分→srs 更新全链路

---

## 集成、文件清单、测试、交付边界

### 新增文件（纯逻辑，可独立单测，零 DOM 依赖）

- `src/shared/citations.ts` — `[bN]` 解析/渲染/系统提示构建纯函数（功能①）
- `src/shared/srs.ts` — SM-2 调度纯函数（功能③）
- `src/shared/highlights.ts` — 高亮类型 + 去重/分组/搜索（功能②，③复用）
- `src/shared/vocabulary.ts` — 词条类型 + 存词/合并/校验（功能③）
- `src/shared/exporters.ts` — 三种 ExportProvider 纯函数（功能②）

### 修改文件

- `src/content.ts` — `extractPage` 输出 blocks+锚点 id；高亮注入；vocab 存词；
  `lector-jump-to` / `lector-highlight` / `lector-save-word` 消息处理
- `src/shared/store.ts` — 新增 `highlights[]`、`vocab[]` 状态与动作，持久化
- `src/sidepanel/App.tsx` — 高亮抽屉、词汇抽屉、引用角标渲染
- `src/sidepanel/markdown.ts` — 引用渲染（角标替换）
- `api/chat/index.ts` — 系统提示嵌入带 `[bN]` 前缀的块（引用溯源）
- `src/manifest.json` — 版本 → 0.3.0；commands（Alt+H 高亮、Alt+S 存词）
- `src/content.css` — 高亮 + 引用脉冲样式
- `src/sidepanel/index.css` — 角标 + 到期徽标样式
- `package.json` — 新增 vitest、jsdom、测试脚本

### 测试框架

引入 **vitest**（项目原先无）。理由：SM-2、引用解析、导出格式都是纯逻辑，正确性只能靠
单元测试保证，手测无法覆盖矩阵。

```
纯函数单元测试（vitest，快速、CI 友好）
├── citations.test.ts   parseCitations / renderCitations / buildCitedSystemPrompt
├── srs.test.ts         scheduleSrs 全矩阵 / isDue 边界
├── highlights.test.ts  去重 / 分组 / 搜索
├── vocabulary.test.ts  存词合并 / 校验
└── exporters.test.ts   Markdown / Obsidian / Notion 输出

集成测试（jsdom，DOM 交互）
└── content.test.ts     jump-to 高亮、高亮注入不破坏 DOM
```

### 数据库 / 后端

无新增表，无新增端点。① 扩展现有 `/chat`；②③ 是纯客户端 + 复用现有 `/translate` 和
`/summarize`。服务端限流口径完全统一。

### 交付边界（明确范围，防膨胀）

**在范围内：** 全部纯逻辑 + 单元测试；三个功能的完整客户端链路；功能①后端提示增强；
Notion 导出（需用户填 token）；构建 + 类型检查 + 测试通过。

**不在范围内（YAGNI）：** OCR/PDF 解析；多标签批处理问答；TTS 朗读；Notion 后台自动
同步（仅手动一键导出）；Chrome Web Store 发布。

### 风险与缓解

- **DOM 注入稳定性（最大工程风险）：** 高亮/角标注入严格用 Range + 最小 `mark` 节点，
  绝不触碰页面结构；集成测试覆盖"注入后页面其他节点完好"。
- **模型不遵守 `[bN]` 引用：** 前端 id 白名单校验兜底，缺引用不报错。
- **SM-2 实现正确性：** 纯函数 + 全矩阵单测，常量参考 Anki 公开算法。
