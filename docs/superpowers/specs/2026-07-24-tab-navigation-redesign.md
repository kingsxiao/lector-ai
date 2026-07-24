# Lector AI — 侧边栏 Tab 平铺化重构（Tab Navigation Redesign）

**Date:** 2026-07-24
**Status:** Design

## Context

Lector AI 的侧边栏（Chrome side panel，~310px 宽）目前采用「聊天主区 + 遮罩式抽屉/弹窗」的交互模式。
用户反馈**「在弹窗里面还有弹窗，感觉非常局促」**。代码核查后，问题的真正来源有三：

1. **API 报错时设置窗叠加在抽屉之上**：`App.tsx:258` 处的错误监听在遇到 401/quota/429 时
   `setShowSettings(true)`，z-50 的居中设置 modal 会盖在任意已打开的 z-40 抽屉上，形成两层叠加。
2. **举一反三→生成卡片的深度内联嵌套**：Sentences 抽屉内「展开分析 → markdown → 举一反三例句列表
   → 每条生成卡片按钮」层层内联，全压在 310px 窄列里，视觉上等同弹窗套弹窗。且 `generateSentenceCard`
   fire-and-forget，无 loading 反馈，生成后无确认。
3. **每个抽屉都是全屏遮罩**：`absolute inset-0` 的 backdrop（`App.tsx:1029`）把底层聊天完全挡住，
   打开任意抽屉就像进入另一个应用，没有层次感。

### 根因

8 个独立的 `show*` 布尔状态（`App.tsx:128-135`）没有任何互斥约束，叠加在物理上完全可能；
而「遮罩 + 抽屉」的形态在 310px 窄侧边栏里天生局促——遮罩挡住一切，抽屉又只有 310px，再嵌套内容
必然拥挤。

### 技术路线选择（方案对比）

| | A 顶部 Tab 平铺（选定） | B 底部 Sheet 面板 | C 保留抽屉 + 去嵌套 |
|---|---|---|---|
| 形态 | 视图切换，各占满面板 | 聊天常驻 + 底部升起 sheet | 现有抽屉，仅修互斥/报错/分栏 |
| 消灭遮罩 | 彻底 | 部分（聊天可见） | 否（仍是遮罩抽屉） |
| 局促感根治 | 是 | 较好 | 否（本质仍局促） |
| 改动量 | 中 | 中 | 小 |
| 风险 | 中（涉及状态模型重构） | 中 | 低 |
| 与窄侧边栏契合 | 最佳 | 好 | 差 |

**选定方案 A**：用「视图切换」彻底取代「遮罩叠加」。所有功能成为平级视图，通过顶部 Tab 切换，
从物理上消灭嵌套叠加的可能。这是在 310px 窄侧边栏里最通透的形态。

## 目标

1. **用单一 `activeView` 状态取代 8 个 `show*` 布尔**，视图天然互斥，物理上不可能再叠两层
2. **高频功能（Chat / Sentences / Highlights / Vocab / Settings）成为顶部主 Tab**，直接占满面板，
   不再有遮罩抽屉、不再有居中设置 modal
3. **低频功能（Templates / Glossary / Library）收纳进 `⋯` 更多菜单**，点击后同样是全屏视图切换
   （与主 Tab 同构），只是入口在菜单里，避免 Tab 栏拥挤
4. **API 报错不再自动弹设置窗**：改为当前视图顶部显示错误提示条（ErrorBanner），带「去设置」
   按钮由用户主动跳转
5. **举一反三→生成卡片加 loading + 结果内联**：点例句的「生成卡片」后该行显示 loading 态，
   生成完成后新卡片直接出现在当前视图列表，不跳转、不弹窗
6. **业务逻辑零改动**：store、AI 调用、SR 算法、`extractExamples`/`mergeSentenceCard` 等数据层
   完全不动；content.ts 的页面内浮层（FAB/划词工具栏/结果弹窗）不动；SlashMenu 保留

## 非目标（本次不做）

- **大规模文件拆分**：App.tsx（2440 行）确实偏大，但本次仅在其中重构交互层（提取 View 组件函数），
  不强制拆成多文件——避免一次性改动过大、风险失控。文件拆分作为独立后续改进
- **content.ts 页面内浮层改造**：FAB、划词工具栏、结果弹窗是独立 DOM 体系，与侧边栏嵌套问题无关
- **卡片视觉重新设计（如 Trancy 式逐词彩色词性标注）**：属于独立的视觉增强，见 sentence-library
  spec 的 Phase 2
- **云同步 / 数据迁移**：数据模型零改动，无迁移需求

## 架构

### 状态模型变化

```ts
// 之前：8 个独立布尔（App.tsx:128-135），无互斥约束，可叠加
const [showSettings, setShowSettings] = useState(false)
const [showLibrary, setShowLibrary] = useState(false)
const [showHighlights, setShowHighlights] = useState(false)
const [showVocab, setShowVocab] = useState(false)
const [showTemplates, setShowTemplates] = useState(false)
const [showGlossary, setShowGlossary] = useState(false)
const [showSentences, setShowSentences] = useState(false)
const [showTools, setShowTools] = useState(false)

// 之后：单一视图状态，天然互斥
type View =
  | 'chat'        // 💬 默认
  | 'sentences'   // 📖 例句
  | 'highlights'  // ✨ 高亮
  | 'vocab'       // 📚 词表
  | 'settings'    // ⚙ 设置
  | 'templates'   // 模板（低频，从 ⋯ 菜单进入）
  | 'glossary'    // 术语表（低频，从 ⋯ 菜单进入）
  | 'library'     // 文库（低频，从 ⋯ 菜单进入）

const [activeView, setActiveView] = useState<View>('chat')
```

切换视图 = `setActiveView('sentences')`，一次只能有一个视图激活，物理上不可能叠加。

### 组件结构

```
App.tsx (交互层重构)
├── 顶部: <TabBar activeView onChange={setActiveView} />
│         ├── 主 Tab: 💬 Chat | 📖 Sentences | ✨ Highlights | 📚 Vocab
│         ├── <MoreMenu/>  →  Templates / Glossary / Library（切换到对应视图）
│         └── ⚙ Settings 图标 → setActiveView('settings')
├── 中部: 根据 activeView 条件渲染对应视图组件（占满面板，无遮罩）:
│         - <ChatView/>        原聊天主区 + 输入框（默认）
│         - <SentencesView/>   原 SentencesDrawer 的 children 内容
│         - <HighlightsView/>  原 HighlightsDrawer 的 children 内容
│         - <VocabView/>       原 VocabDrawer 的 children 内容
│         - <SettingsView/>    原 SettingsDrawer 的 children 内容（去掉 modal 外壳）
│         - <TemplatesView/>   原 TemplatesDrawer 的 children 内容
│         - <GlossaryView/>    原 GlossaryDrawer 的 children 内容
│         - <LibraryView/>     原 LibraryDrawer 的 children 内容
└── 全局: <ErrorBanner message onDismiss onGoSettings/>
         API 报错时在当前视图顶部显示（不自动跳设置、不弹窗）
```

**关键**：每个 View 组件就是原来对应 Drawer 的 `children` 内容，业务逻辑几乎不动，只是把
「抽屉外壳 + onClose」换成「直接渲染」。`<Drawer/>` 通用壳（`App.tsx:1018`）和 `<SettingsDrawer/>`
的 modal 外壳删除。

**视图头部说明**：TabBar 始终可见，Chat 永远是一键可达（点 Chat Tab 即回），因此各 View **不需要**
单独的「返回 Chat」按钮——导航职责完全交给 TabBar。各 View 顶部仅保留一个轻量标题行（复用原
`.drawer-head` 样式去掉关闭按钮），用于标识当前视图、悬挂该视图自带的操作（如 Sentences 的
「生成讲解」入口）。这样避免「TabBar + 视图内返回按钮」的双层导航冗余。

### 交互改进细节

#### 1. TabBar 与 MoreMenu

- 主 Tab 横向排列（4 个），活跃 Tab 高亮（下划线或填充色）。
- `⋯` 更多菜单是下拉（复用原 z-30 工具菜单的形态，但只放低频视图入口），点击项 = `setActiveView`。
- 设置图标放最右，点击 = `setActiveView('settings')`。
- 原来的 Grid 工具菜单（`App.tsx:555-611`）替换为这套 TabBar + MoreMenu。

#### 2. ErrorBanner（取代报错自动弹设置）

```ts
// 之前 App.tsx:252-264：报错直接弹设置窗
if (/401|key|quota|429|credit/i.test(message.message)) {
  setShowSettings(true)  // ← 叠在抽屉上的根源
}

// 之后：在当前视图顶部显示 banner，用户主动跳转
const [errorBanner, setErrorBanner] = useState<{ msg: string } | null>(null)
// ...
if (/401|key|quota|429|credit/i.test(message.message)) {
  setErrorBanner({ msg: message.message })  // ← 顶部提示条，不切视图
}
// ErrorBanner 内「去设置」按钮: onClick={() => setActiveView('settings')}
```

#### 3. 举一反三→生成卡片（内联 + loading）

```ts
// 之前 generateSentenceCard（App.tsx:304）fire-and-forget，无反馈
// 之后：跟踪每条例句的生成状态
const [busyExample, setBusyExample] = useState<string | null>(null)  // 正在生成的例句文本

async function handleMakeCard(ex: string, title: string) {
  setBusyExample(ex)
  try {
    await generateSentenceCard(ex, '', title)
  } finally {
    setBusyExample(null)
  }
}
// 渲染时：busyExample === ex ? 显示 spinner + 禁用 : 显示「生成卡片」
// 生成完成：新卡片自动出现在 SentencesView 列表顶部（store 驱动，无需额外处理）
```

#### 4. 卡片内容折叠（缓解 310px 局促）

- 卡片的「分析 / 翻译」默认折叠（保留现有 `onToggleReveal` 机制）。
- 展开后的 markdown 分析、举一反三例句列表用**缩进 + 左侧色条**做视觉层级，减少嵌套容器背景的
  堆叠感。每条例句的「生成卡片」做成行内轻量链接，不占额外高度。

## 改造范围

| 文件 | 改动 |
|------|------|
| `src/sidepanel/App.tsx` | 主要工作：状态模型替换（8 布尔 → 1 activeView）、提取 8 个 View 组件、新增 TabBar/MoreMenu/ErrorBanner、删 Drawer/SettingsDrawer 外壳、报错处理改写、generateSentenceCard 加 busyExample |
| `src/sidepanel/index.css` | 删不再用的抽屉遮罩动画（或保留复用）、加 `.tab-bar`/`.tab-item`/`.error-banner` 样式 |
| `src/shared/i18n.ts` | 加 Tab 标签、MoreMenu 项、ErrorBanner（去设置/关闭）文案，en/zh 双语 |

**不动**：`src/shared/sentences.ts`、`src/shared/srs.ts`、`src/shared/anki.ts` 等所有 shared 数据层；
`src/content.ts`；`manifest.json`；SlashMenu 逻辑。

## 风险与缓解

1. **状态迁移遗漏**：8 个布尔替换为 activeView，若有遗漏的 `setShow*` 调用会导致功能入口失效。
   **缓解**：全局搜索 `showSettings|showLibrary|showHighlights|showVocab|showTemplates|showGlossary|showSentences|showTools`
   确保每个调用点都改写为 `setActiveView`；构建 + 手动逐视图冒烟测试。
2. **报错流程体验回退**：报错不再自动跳设置，用户可能错过。**缓解**：ErrorBanner 持续显示直到
   用户主动关闭或成功重试，且「去设置」按钮醒目；仅对非致命提示降级为自动消失。
3. **Tab 栏在 310px 拥挤**：4 主 Tab + 更多菜单 + 设置图标。**缓解**：图标 + 极简文字（或纯图标 +
   tooltip），实测最窄 300px 仍可容纳；低频项已收纳进 `⋯`。

## 验证清单

- [ ] 6 个原抽屉功能 + 聊天 + 设置都能通过 Tab/菜单正确切换显示
- [ ] 任意时刻只有一个视图激活，无法叠两层（搜不到残留的 `setShow*` 叠加调用）
- [ ] API 报错（模拟 401）时显示 ErrorBanner，不自动弹设置窗；点「去设置」可跳转
- [ ] 举一反三点「生成卡片」显示 loading，完成后卡片出现在列表，无弹窗
- [ ] 各视图在 ~310px 宽度下不溢出、不拥挤
- [ ] en/zh 双语切换后 Tab/菜单/banner 文案正确
