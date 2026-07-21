# Lector AI — 自定义术语表（Glossary）+ Anki 一键制卡 设计

**Date:** 2026-07-21
**Status:** Design
**对标产品:**
- 术语表 → 沉浸式翻译「AI 术语库」（GitHub Issue #806，v1.16.5 上线）、腾讯云术语库
- Anki 制卡 → Saladict v7.13.1「Anki 自动制卡」（B站/知乎爆款教程，考研学生刚需）

## Context

基于对国内用户需求的系统调研（沉浸式翻译/Saladict/Sider/Monica/Kimi 的 GitHub
issues、知乎、V2EX、小红书），在剔除 Lector 已有能力（全文双语翻译、划词工具栏、
生词本+SM-2、国内大模型接入）后，需求量最高且与现有 BYOK 架构契合的两个功能是：

1. **自定义术语表（Glossary）**：沉浸式翻译 GitHub Issue #806 高赞需求，v1.16.5
   刚上线「AI 术语库」验证了付费意愿。考研/科研/技术读者刚需——人名、品牌、专有
   名词、技术术语在不同段落翻译不一致是当前最大的翻译质量痛点。
2. **生词本 Anki 一键制卡**：Lector 已有完整生词本 + SM-2 复习，但数据"出不去"。
   Saladict 的 Anki 自动制卡是其最被津津乐道的功能（B站/知乎爆款教程），考研学生
   强刚需。接入 AnkiConnect（localhost:8765）能立刻把已有 vocabulary 模块的价值
   放大数倍。

Lector 的 BYOK + 本地存储定位也恰好踩中 2025 年沉浸式翻译"暴雷"事件后用户对
隐私敏感、寻找开源/BYOK 替代品的市场窗口。

## 目标

### 功能 ①：自定义术语表（Glossary）

1. 用户可在侧栏新增 Glossary Drawer，增删改自定义术语条目（原文 → 译文，可选备注）
2. 翻译场景（划词翻译 / 双语翻译 / 翻译模板）自动把术语表注入 system prompt，
   要求模型严格遵守
3. 支持导入/导出 JSON，方便备份和迁移（参考 templates 的纯前端持久化）
4. 术语条目支持启用/禁用开关，灵活控制作用范围
5. 完全在 BYOK 架构内，纯前端，持久化在 chrome.storage

### 功能 ②：Anki 一键制卡（AnkiConnect）

1. 生词本 Drawer 新增"发送到 Anki"按钮，一键把当前生词（或全部）发送到 Anki 牌组
2. 通过 AnkiConnect（`http://localhost:8765`）调用 `addNote` action，本地通信
3. 卡片字段映射：正面=word，背面=translation，额外=context（例句）、source（url+title）
4. 用户可配置：AnkiConnect 地址、目标牌组名、是否包含已掌握（graduated）的卡片
5. 优雅处理 Anki 未启动 / 牌组不存在 / 字段缺失等错误
6. 完全在 BYOK 架构内，纯前端

## 非目标（本次不做）

- 术语表的正则/通配符匹配（`Transformer` → `变形金刚` 这种简单等值映射即可，
  复杂语义匹配交给模型理解 system prompt）
- 术语表的跨设备云同步（与现有 templates/highlights/vocab 一致，本地存储）
- Anki 模板（note type）自定义（用 Anki 默认 Basic 模型，YAGNI）
- Anki 媒体（音频/图片）制卡（仅文本，符合 BYOK 极简定位）
- AnkiConnect 之外的协议（如 Anki Sync API）

## 架构

遵循现有"纯函数 shared 模块 + 薄 UI 层"分层，每个 shared 模块配对单元测试。

### 功能 ①：术语表数据模型

新增 `src/shared/glossary.ts`（纯逻辑，零依赖，可测试）：

```ts
/** 单条术语：原文 → 译文。*/
export interface GlossaryEntry {
  id: string
  /** 原文（key），如 "LLM" "RAG" "Hugging Face"。*/
  source: string
  /** 译文（value），如 "大语言模型" "检索增强生成" "抱抱脸"。*/
  target: string
  /** 可选说明（不注入 prompt，仅 UI 展示）。*/
  note?: string
  /** false 时该条不参与翻译注入。*/
  enabled: boolean
  /** 创建时间，用于稳定排序。*/
  createdAt: number
}

/** 校验：source/target 非空，长度限制。*/
export function validateEntry(e: { source: string; target: string }): ValidationResult

/** 生成新 id。*/
export function newEntryId(): string

/** 把术语列表渲染成可注入 system prompt 的纯文本块。禁用的条目被过滤。
 *  输出形如：
 *    GLOSSARY (must translate consistently):
 *    - LLM → 大语言模型
 *    - RAG → 检索增强生成
 *  空表返回空字符串，调用方据此决定是否拼入 prompt。*/
export function renderGlossaryPrompt(entries: GlossaryEntry[]): string

/** 导出为 JSON 字符串（备份/迁移）。*/
export function exportGlossary(entries: GlossaryEntry[]): string

/** 从 JSON 字符串导入，返回 { ok, entries | reason }。容忍脏数据。*/
export function importGlossary(json: string): { ok: boolean; entries?: GlossaryEntry[]; reason?: string }

/** 去重：相同 source（大小写不敏感）只保留最早创建的一条。*/
export function dedupeEntries(entries: GlossaryEntry[]): GlossaryEntry[]
```

**Store 扩展**（`src/shared/store.ts`）：

```ts
interface AppState {
  // ... existing
  glossary: GlossaryEntry[]
  addGlossaryEntry: (e: Omit<GlossaryEntry, 'id' | 'createdAt'>) => void
  updateGlossaryEntry: (id: string, patch: Partial<GlossaryEntry>) => void
  removeGlossaryEntry: (id: string) => void
  replaceGlossary: (entries: GlossaryEntry[]) => void  // 给导入用
}
```

`addGlossaryEntry` 在 store 内部去重（同 source 大小写不敏感则合并更新 target），
逻辑与现有 `addVocab` 保持一致风格。

**Prompt 注入点**（3 处，最小侵入）：

1. `src/sidepanel/App.tsx` handleSend → 仅在 chat 涉及翻译时才拼入（保守起见，
   所有 chat 都注入；术语量通常很少，token 成本可忽略）
2. `src/content.ts` `runByokAction('translate')` → 划词翻译注入
3. `src/content.ts` `toggleBilingual()` → 双语翻译注入

抽取一个共享 helper `buildTranslationSystemPrompt(targetLang, glossaryPrompt)`，
避免三处重复拼接。Glossary 数据需要从 chrome.storage 读取（content script 已有
`getSettings` 模式，复用同一思路读 zustand persist 的 `lector-ai-storage`）。

### 功能 ②：Anki 制卡数据模型

新增 `src/shared/anki.ts`（纯逻辑 + 网络层，可测试）：

```ts
/** AnkiConnect 默认地址。*/
export const DEFAULT_ANKI_CONNECT_URL = 'http://localhost:8765'
export const DEFAULT_DECK_NAME = 'Lector::Vocabulary'
export const DEFAULT_MODEL_NAME = 'Basic'

/** 单次制卡请求映射后的字段。*/
export interface AnkiNote {
  deckName: string
  modelName: string
  fields: {
    Front: string
    Back: string
    // Basic 模型默认没有 Extra 字段，所以 context/source 合并进 Back。
    // 若用户 Anki 里是 "Basic (and reversed card)" 等模型，自动忽略多余字段。
  }
  tags: string[]
}

/** 把 VocabEntry 转成 AnkiNote。纯函数。*/
export function vocabToAnkiNote(
  v: VocabEntry,
  opts: { deckName: string; modelName: string }
): AnkiNote

/** AnkiConnect 多 action 请求体。*/
export function buildAnkiConnectBody(actions: AnkiConnectAction[]): string

/** AnkiConnect 单个 action 的包装。*/
export interface AnkiConnectAction {
  action: string
  params: Record<string, unknown>
}

/** 调用 AnkiConnect：返回 { ok, result?, error? }。
 *  - 网络错误（Anki 未启动）→ ok=false, error='网络错误/Anki 未启动'
 *  - AnkiConnect 返回 error 字段 → ok=false, error=具体原因
 *  - 成功 → ok=true, result=AnkiConnect 返回的数据
 *  超时默认 5s。*/
export async function invokeAnkiConnect(
  url: string,
  actions: AnkiConnectAction | AnkiConnectAction[],
  timeoutMs?: number
): Promise<{ ok: boolean; result?: unknown; error?: string }>

/** 高阶 API：批量添加生词到 Anki。
 *  1. 先 createDeck（如果不存在）
 *  2. 逐个 addNote（AnkiConnect 不支持批量 addNote，但支持 multi action）
 *  返回 { added, duplicated, failed, errors[] }。*/
export async function exportVocabToAnki(
  vocab: VocabEntry[],
  opts: { url: string; deckName: string; modelName: string; tags?: string[] }
): Promise<AnkiExportResult>

export interface AnkiExportResult {
  added: number
  duplicated: number
  failed: number
  errors: string[]
}
```

**BYOK Settings 扩展**（`src/shared/providers.ts` 的 `ByokSettings`）：

```ts
interface ByokSettings {
  // ... existing
  /** AnkiConnect 配置；未配置时用默认值。*/
  anki?: {
    url: string        // 默认 'http://localhost:8765'
    deckName: string   // 默认 'Lector::Vocabulary'
    modelName: string  // 默认 'Basic'
    tags: string[]     // 默认 ['lector']
  }
}
```

（`anki?` 可选字段避免破坏现有用户的存储；读取时用 `withAnkiDefaults()` helper 补默认值。）

**UI 入口**：在生词本 Drawer 顶部加 "📤 发送到 Anki" 按钮，点击后弹出确认面板：
- 显示 AnkiConnect URL / 牌组名（可编辑）
- 显示待发送条数
- "发送" 按钮 → 调用 `exportVocabToAnki` → 显示成功/失败统计
- 失败时给出具体提示（"请确认 Anki 已启动并安装 AnkiConnect 插件"）

### 文件清单

**新增：**
- `src/shared/glossary.ts` — 术语表纯逻辑
- `src/shared/anki.ts` — AnkiConnect 客户端 + 字段映射
- `tests/glossary.test.ts` — 术语表单测
- `tests/anki.test.ts` — Anki 制卡纯函数单测（mock fetch）

**修改：**
- `src/shared/store.ts` — 增加 glossary 状态 + actions
- `src/shared/providers.ts` — `ByokSettings` 增加 `anki?` 字段
- `src/shared/i18n.ts` — 新增术语表/Anki 相关 i18n 字符串
- `src/shared/icons.tsx` — 新增 Glossary 图标（如尚无合适图标）
- `src/sidepanel/App.tsx` — 新增 GlossaryDrawer、VocabDrawer 内加 Anki 按钮 + 面板、
  顶部导航增加 Glossary 按钮
- `src/content.ts` — `runByokAction` + `toggleBilingual` 读取 glossary 并注入 prompt
- `src/background.ts` — 若需要注册 Glossary 抽屉的命令（评估后可能不需要）

## 数据流

### 术语表数据流

```
用户在 GlossaryDrawer 增删改
  → useStore.addGlossaryEntry / update / remove
  → zustand persist → chrome.storage.local['lector-ai-storage'].glossary

content script (translate / bilingual):
  await getSettings() 拿到 byok
  读 chrome.storage.local['lector-ai-storage'].glossary
  → renderGlossaryPrompt(enabled entries)
  → 拼进 systemPrompt
  → completeOnce(settings, systemPrompt, text)

side panel chat:
  直接从 useStore 读 glossary（同进程），同上注入
```

### Anki 制卡数据流

```
用户在 VocabDrawer 点 "发送到 Anki"
  → 弹出确认面板（编辑 deck / model / tags）
  → 点 "发送" 调用 exportVocabToAnki(vocab, opts)
    → createDeck (multi-action)
    → addNote × N (multi-action)
  → 显示 {added, duplicated, failed, errors}
  → 用户可点击"重试失败的"
```

## 错误处理

- **术语表空**：`renderGlossaryPrompt([])` 返回 `''`，调用方完全不拼入 prompt（零开销）
- **术语表脏数据导入**：`importGlossary` 容忍部分坏行，跳过并返回成功导入数
- **AnkiConnect 网络错误**（最常见场景）：返回 `error='无法连接 AnkiConnect。
  请确认：1) Anki 桌面端已启动；2) 已安装 AnkiConnect 插件（代码 2058997622）；
  3) 浏览器允许访问 http://localhost:8765'`
- **Anki 牌组/模型不存在**：自动 `createDeck`；模型不存在则降级到 'Basic' 并提示
- **MV3 CSP 限制**：扩展页面访问 `http://localhost:8765` 需要在 manifest 的
  `host_permissions` 加 `http://localhost:*/*`（MV3 side panel 受 CSP 约束，
  需验证）
- **生词字段缺失**（translation 为空）：`vocabToAnkiNote` 仍生成卡片，Back 显示
  "(暂无释义)"

## 测试策略

每个 shared 模块配单元测试，覆盖：

**`tests/glossary.test.ts`**：
- validateEntry 拒绝空 source/target、过长输入
- renderGlossaryPrompt：空列表返回 ''；过滤 disabled；多行格式正确
- exportGlossary/importGlossary 往返一致
- importGlossary 容忍脏 JSON / 部分坏条目
- dedupeEntries 大小写不敏感去重，保留最早创建

**`tests/anki.test.ts`**：
- vocabToAnkiNote 字段映射正确（word→Front, translation+context+source→Back, tags）
- vocabToAnkiNote 字段缺失时优雅降级
- buildAnkiConnectBody 格式正确（multi action）
- invokeAnkiConnect mock fetch：成功/网络错误/AnkiConnect error 字段三种路径
- exportVocabToAnki 集成：createDeck + N×addNote，统计 added/duplicated/failed

**手动验证清单**（`docs/manual-verification-checklist.md` 追加）：
- 术语表：添加"LLM → 大语言模型"，访问英文页面点划词翻译"LLM"，验证译文一致
- 双语翻译注入术语，刷新页面后术语仍生效（持久化）
- 导出 JSON → 清空 → 导入 JSON 恢复
- Anki：启动 Anki 桌面端 + AnkiConnect 插件 → 一键发送 5 个生词 → 在 Anki
  桌面端看到新卡片 → 重发同样 5 个，验证 duplicated 计数

## 构建顺序

1. `glossary.ts` + `tests/glossary.test.ts`（纯逻辑先行，TDD）
2. store 扩展 glossary 状态 + actions
3. i18n 字符串 + 图标
4. GlossaryDrawer UI（参考 TemplatesDrawer 模式）
5. 三个 prompt 注入点改造
6. `anki.ts` + `tests/anki.test.ts`
7. providers.ts 加 anki? 字段 + withAnkiDefaults
8. VocabDrawer 内 Anki 按钮 + 确认面板
9. manifest.json host_permissions 加 localhost
10. 全量 typecheck + test + build
11. 更新手动验证清单 + README（如有必要）

## 风险

- **MV3 side panel 访问 localhost**：需在 `host_permissions` 显式声明。若仍被
  CSP 拦截，备选方案是让 background service worker 代为 fetch（content script
  本身有 `<all_urls>` 权限，可作第二备选）。
- **AnkiConnect 跨域**：AnkiConnect 默认仅允许 `http://127.0.0.1:*` Origin。
  Chrome 扩展页面的 Origin 是 `chrome-extension://<id>`，需用户在 AnkiConnect
  配置文件 `webApiAllowedOrigins` 添加扩展 id（文档中给出明确步骤）。
- **token 成本**：术语表注入会让每次翻译 prompt 略增。通过 disabled 条目过滤
  + 空表零开销设计来缓解。
