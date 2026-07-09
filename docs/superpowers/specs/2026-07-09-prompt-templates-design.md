# Lector AI — 自定义 Prompt 模板（完整版）设计

**Date:** 2026-07-09
**Status:** Design
**对标产品:** Sider AI（`/` 触发 + 模板库 + 拖拽排序）、MaxAI（可复用自定义 prompt）

## Context

竞品调研显示，自定义 Prompt 模板是 Sider 和 MaxAI 的标配功能，也是「让 AI
真正高效可用」的核心效率工具。当前 Lector 有 4 个固定的建议卡片（summary /
keyPoints / explain / followup），但用户无法自定义、无法扩展、无法在对话流中
快速调用。本设计补齐这个缺口，让 Lector 拥有与 Sider 同级的模板能力。

## 目标

1. 用户可在侧栏输入框打 `/` 触发模板选择菜单（对标 Sider 的核心交互）
2. 模板支持占位符（`{selection}` `{page}` `{lang}`），自动替换成上下文
3. 内置 8-10 个开箱即用的模板库（摘要/改写/翻译/解释/续写/邮件等）
4. 用户可增删改自定义模板，拖拽排序
5. 选中模板后填入输入框，用户可编辑后发送（不直接发送，保留灵活性）
6. 完全在 BYOK 架构内，纯前端，模板持久化在 chrome.storage

## 非目标（本次不做）

- 模板分享/导入导出（后续可加）
- content script 工具栏触发模板（工具栏已有 translate/explain/summarize，够用）
- 模板分类/文件夹（扁平列表 + 拖拽排序足够，YAGNI）
- 跨设备同步（BYOK 本地存储，和现有 highlights/vocab 一致）

## 架构

### 数据模型

新增 `src/shared/promptTemplates.ts`（纯逻辑模块，零依赖，可测试）：

```ts
export interface PromptTemplate {
  id: string
  /** 显示名（自定义模板用）。内置模板用 titleKey 走 i18n，title 为英文回退。*/
  title: string
  /** 内置模板的 i18n key，渲染时优先于 title。自定义模板为 undefined。*/
  titleKey?: StringKey
  /** 模板正文，含占位符。如 "Explain this like I'm 5:\n\n{selection}" */
  content: string
  /** 内置模板为 true，不可删除/编辑内容（但可拖拽排序）。*/
  builtIn: boolean
  /** 排序权重，越小越靠前。拖拽时重排。*/
  order: number
}

/** 占位符 → 实际值的映射上下文。*/
export interface TemplateContext {
  /** 当前选中的文本（来自 content script），无则为空串。*/
  selection: string
  /** 页面正文摘要（前 2000 字），无页面则为空串。*/
  page: string
  /** 页面语言代码，如 "en" "zh"。*/
  lang: string
}

/** 支持的占位符列表，用于校验和提示。*/
export const PLACEHOLDERS = ['{selection}', '{page}', '{lang}'] as const

/** 把模板 content 里的占位符替换成实际值。未知占位符原样保留。*/
export function fillTemplate(content: string, ctx: TemplateContext): string

/** 按顺序号排序模板列表（用于渲染）。*/
export function sortTemplates(list: PromptTemplate[]): PromptTemplate[]

/** 模糊匹配：标题或内容包含 query（大小写不敏感）。用于 / 菜单过滤。*/
export function filterTemplates(list: PromptTemplate[], query: string): PromptTemplate[]

/** 生成新 id。*/
export function newTemplateId(): string

/** 校验模板：title 和 content 非空，content 不超过 2000 字。*/
export function validateTemplate(t: { title: string; content: string }): ValidationResult
```

### 内置模板库

在 `promptTemplates.ts` 里定义 `BUILTIN_TEMPLATES: PromptTemplate[]`，开箱即用：

| title | content（占位符示意） | order |
|-------|----------------------|-------|
| 总结全文 | Summarize this page in 3-5 bullets and a one-line takeaway. | 0 |
| 关键观点 | What are the 3 most important points the author is making? | 1 |
| ELI5 解释 | Explain this like I'm 5 years old:\n\n{selection} | 2 |
| 润色改写 | Rewrite this to be clearer and more professional, keeping the meaning:\n\n{selection} | 3 |
| 翻译成中文 | Translate to 中文:\n\n{selection} | 4 |
| 翻译成英文 | Translate to English:\n\n{selection} | 5 |
| 续写扩写 | Expand on this with more detail and examples:\n\n{selection} | 6 |
| 邮件回复 | Draft a concise reply to this email:\n\n{selection} | 7 |
| 提取要点 | Extract the key facts and numbers from this as a bullet list:\n\n{selection} | 8 |
| 批判分析 | What are the weak points or assumptions in this argument?\n\n{selection} | 9 |

内置模板 `builtIn: true`。首次加载时，若 store 里没有任何模板，则写入这些内置
模板作为初始数据。

### Store 扩展

在 `src/shared/store.ts` 的 `AppState` 增加：

```ts
templates: PromptTemplate[]
addTemplate: (t: Omit<PromptTemplate, 'id' | 'builtIn' | 'order'>) => void
updateTemplate: (id: string, patch: Partial<PromptTemplate>) => void
removeTemplate: (id: string) => void  // 内置模板不可删（UI 层拦截）
reorderTemplates: (orderedIds: string[]) => void
```

`partialize` 增加 `templates: state.templates`。

初始状态：`templates: BUILTIN_TEMPLATES`（store 默认值）。

### i18n

在 `src/shared/i18n.ts` 增加：

```
'side.templates.title'        — 模板 / Templates
'side.templates.empty'        — 还没有自定义模板，点击右上角 + 创建。
'side.templates.add'          — + 新建模板
'side.templates.edit'         — 编辑
'side.templates.delete'       — 删除
'side.templates.builtIn'      — 内置
'side.templates.title.label'  — 模板名称
'side.templates.content.label' — 模板内容
'side.templates.hint'         — 可用占位符：{selection} {page} {lang}
'side.templates.save'         — 保存
'side.templates.cancel'       — 取消
'composer.templates.hint'     — 按 / 插入模板
'side.templates.menuEmpty'    — 没有匹配的模板
```

内置模板的 `title` 需要 i18n——但内置模板存在 store 里是固定字符串。处理方式：
`PromptTemplate` 增加一个可选字段 `titleKey?: StringKey`。内置模板设置 `titleKey`
（如 `'tpl.summarize'`），渲染时优先用 `t(titleKey)`；自定义模板 `titleKey` 为空，
直接显示 `title` 原文。这样两种模板共用一个列表，显示逻辑统一。

### 与现有 SUGGESTIONS 的关系

当前 App.tsx 有一组硬编码的 `SUGGESTIONS`（summary/keyPoints/explain/followup），
显示在空状态的卡片网格里。引入模板后，**空状态卡片改为展示模板的前 4 个**
（即 `templates.slice(0, 4)`），不再用独立的 SUGGESTIONS 常量。这样空状态卡片和
`/` 菜单、模板抽屉共用同一数据源，用户调整模板顺序后空状态卡片也跟着变。原
`SUGGESTIONS` 常量删除。

### UI 交互（App.tsx）

**1. `/` 触发菜单（核心交互）**

在 composer 的 textarea `onChange` / `onKeyDown` 里监听：当输入框当前内容恰好
是 `/` 或以 `/` 开头且光标在末尾时，弹出模板选择浮层（绝对定位在输入框上方）。

浮层内容：
- 模板列表（过滤后），每项显示 title + content 预览（截断 60 字）
- 用户继续打字 → 实时过滤（`filterTemplates`，匹配 `/` 后的文字）
- 键盘：↑↓ 导航、Enter 选中、Esc 关闭
- 鼠标：点击选中

选中模板后：
- 把模板 `content` 经 `fillTemplate(content, ctx)` 替换占位符
- 填入输入框（`setInput(filled)`），清掉 `/` 前缀
- 关闭浮层，焦点回到输入框，用户可编辑后发送

**2. 模板管理抽屉**

header 新增一个模板按钮（用 `SparklesIcon` 或新增 `TemplateIcon`，带角标显示
自定义模板数）。点击打开抽屉（复用现有 `Drawer` 组件）：

- 列表区：所有模板（内置 + 自定义），按 order 排序，拖拽重排（HTML5 drag）
  - 内置模板：显示「内置」标签，不可删除，但可编辑标题外的内容禁用
  - 自定义模板：可编辑、可删除
- 顶部「+ 新建模板」按钮 → 打开编辑表单（标题输入 + 内容 textarea + 占位符提示）
- 编辑表单：模态/内联，保存调用 `addTemplate` / `updateTemplate`

**3. 占位符上下文来源**

`TemplateContext` 在 App.tsx 里组装：
- `selection`: 通过 `chrome.tabs.sendMessage(tabId, { action: 'lector-get-selection' })`
  向 content script 请求当前选中文本。content script 新增此 message handler。
- `page`: `page?.text?.slice(0, 2000) || ''`
- `lang`: `page?.lang || 'en'`

content script 需新增一个 message handler 返回 `window.getSelection().toString()`。

### 新增/修改文件清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/shared/promptTemplates.ts` | **新建** | 数据模型 + 纯函数 + 内置库 |
| `src/shared/store.ts` | 修改 | 增加 templates 状态和 actions |
| `src/shared/i18n.ts` | 修改 | 增加模板相关字符串 + 内置模板 title keys |
| `src/shared/icons.tsx` | 修改 | 增加 TemplateIcon |
| `src/content.ts` | 修改 | 新增 `lector-get-selection` message handler |
| `src/sidepanel/App.tsx` | 修改 | `/` 触发浮层 + 模板管理抽屉 + 占位符上下文 |
| `tests/promptTemplates.test.ts` | **新建** | 纯函数单测（fillTemplate、filter、sort、validate） |

## 错误处理

- 占位符替换时，若对应上下文为空（如无选中文本），`{selection}` 替换成空串——
  不报错，用户看到模板里缺了一段自然会去选中文字或编辑。
- 模板内容超长（>2000 字）由 `validateTemplate` 拦截，UI 显示错误提示。
- `/` 菜单在没有匹配模板时显示「没有匹配的模板」，不报错。

## 测试

`tests/promptTemplates.test.ts` 覆盖：
- `fillTemplate`：替换所有已知占位符、保留未知占位符、空上下文
- `filterTemplates`：标题匹配、内容匹配、大小写不敏感、空 query 返回全部
- `sortTemplates`：按 order 排序
- `validateTemplate`：空 title/content 拒绝、超长拒绝、正常通过
- `newTemplateId`：唯一性

## 构建顺序

1. `promptTemplates.ts` + 测试（纯逻辑，先验证正确性）
2. store 扩展 + i18n + icon
3. content script 的 selection handler
4. App.tsx：`/` 触发浮层
5. App.tsx：模板管理抽屉
6. 全量验证 + 提交
