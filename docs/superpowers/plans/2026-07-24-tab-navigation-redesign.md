# 侧边栏 Tab 平铺化重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用单一 `activeView` 状态 + 顶部 TabBar 取代 8 个 `show*` 布尔遮罩抽屉/弹窗，彻底消除侧边栏（~310px）"弹窗套弹窗"的局促感。

**Architecture:** 在 `App.tsx` 内新增 `TabBar`（高频视图 Tab + `⋯` 更多菜单 + 设置）与全局 `ErrorBanner`；删除 `<Drawer/>` 通用壳、Library 内联抽屉壳、`SettingsDrawer` 的 z-50 modal 壳；把各抽屉的 `children` 内容提取为始终挂载的 View 组件，由 `activeView` 单一状态互斥渲染。业务逻辑（store / AI / SRS / 数据层）零改动。

**Tech Stack:** React 18 + TypeScript + Tailwind（含 `@layer components`）+ Zustand；测试用 Vitest（jsdom 单测）+ Playwright e2e（`tests/browser/run-sidepanel-e2e.mjs`，断言真实生产 bundle）。

## Global Constraints

- **i18n 双语**：所有新增用户可见文案必须在 `src/shared/i18n.ts` 的 `STRINGS` 中同时给出 `en` 和 `zh`（项目约定，`StringKey` 由 `STRINGS` 键派生，漏键是编译错误）。
- **类型安全**：`typecheck`（`tsc --noEmit`）必须零错误。不引入新依赖。
- **窄侧边栏约束**：TabBar 必须在 ~310px 宽度下不溢出；低频视图（Templates/Glossary/Library）收纳进 `⋯` 菜单。
- **不动数据层**：`src/shared/*`（sentences/srs/anki/store 等）、`src/content.ts`、`manifest.json` 本计划不修改。
- **命令约定**：类型检查 `npm run typecheck`；单测 `npm test`；扩展构建 `npm run build:extension`；侧边栏 e2e `node tests/browser/run-sidepanel-e2e.mjs`（需要本地 Chrome）。
- **视觉延续**：复用现有 CSS 类（`.icon-btn`/`.tools-item`/`.drawer-head`/`.drawer-title`/`.row`/`shadow-pop`/`lector-anim-*`），不引入新设计 token。

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `src/shared/i18n.ts` | 新增 TabBar/MoreMenu/ErrorBanner 的 en/zh 文案 | 修改 |
| `src/sidepanel/index.css` | 新增 `.tab-bar`/`.tab-item`/`.tab-item-active`/`.error-banner` 组件类 | 修改 |
| `src/sidepanel/App.tsx` | 状态模型替换、提取 View 组件、新增 TabBar/MoreMenu/ErrorBanner、删 Drawer/SettingsDrawer 外壳、报错改写、make-card 加 loading | 修改 |
| `tests/browser/run-sidepanel-e2e.mjs` | 更新 header 选择器断言 + 新增 tab 切换断言 | 修改 |

**不拆分 App.tsx 成多文件**：spec 明确把文件拆分列为非目标，本次仅在单文件内重构交互层。

---

## Task 1: 新增 i18n 文案（TabBar / MoreMenu / ErrorBanner）

**Files:**
- Modify: `src/shared/i18n.ts`（在 `STRINGS` 对象内，`popup.close` 键附近追加）

**Interfaces:**
- Produces: 新增字符串键 `side.tab.chat`、`side.tab.sentences`、`side.tab.highlights`、`side.tab.vocab`、`side.tab.more`、`side.tab.more.templates`、`side.tab.more.glossary`、`side.tab.more.library`、`side.error.banner`、`side.error.goSettings`、`side.error.dismiss`、`side.sentences.makingCard`。这些键的 `StringKey` 由 `STRINGS` 键自动派生，后续 Task 直接用 `tr('side.tab.chat')` 等引用。

- [ ] **Step 1: 在 `STRINGS` 内追加新键（en + zh）**

打开 `src/shared/i18n.ts`，定位到 `'popup.close'` 键（约 198 行附近）。在其**之后**插入以下条目（保持与周围键一致的缩进与对象字面量风格）：

```ts
  // --- side panel: tab navigation (flat views replace overlay drawers) ---
  'side.tab.chat': { en: 'Chat', zh: '对话' },
  'side.tab.sentences': { en: 'Sentences', zh: '句库' },
  'side.tab.highlights': { en: 'Highlights', zh: '高亮' },
  'side.tab.vocab': { en: 'Vocab', zh: '生词' },
  'side.tab.more': { en: 'More', zh: '更多' },
  'side.tab.more.templates': { en: 'Templates', zh: '模板' },
  'side.tab.more.glossary': { en: 'Glossary', zh: '术语表' },
  'side.tab.more.library': { en: 'Library', zh: '历史记录' },
  // --- error banner (replaces auto-popping Settings on API errors) ---
  'side.error.banner': { en: 'Something went wrong', zh: '出现问题' },
  'side.error.goSettings': { en: 'Open settings', zh: '打开设置' },
  'side.error.dismiss': { en: 'Dismiss', zh: '忽略' },
  // --- make-card inline loading (举一反三 → 生成卡片) ---
  'side.sentences.makingCard': { en: 'Generating…', zh: '生成中…' },
```

- [ ] **Step 2: 验证类型检查通过（StringKey 派生正常）**

Run: `npm run typecheck`
Expected: 零错误退出码 0。若报 `'side.tab.chat'` 未使用之类警告可忽略——`StringKey` 由 `keyof typeof STRINGS` 派生，新增键不会触发未使用错误。

- [ ] **Step 3: Commit**

```bash
git add src/shared/i18n.ts
git commit -m "feat(i18n): add tab/more-menu/error-banner/makingCard strings (en/zh)"
```

---

## Task 2: 新增 CSS 组件类（tab-bar / tab-item / error-banner）

**Files:**
- Modify: `src/sidepanel/index.css`（在 `@layer components` 块内，`.drawer-title` 之后追加）

**Interfaces:**
- Produces: CSS 类 `.tab-bar`、`.tab-item`、`.tab-item-active`、`.error-banner`、`.error-banner-actions`。Task 3+ 的 JSX 直接用这些类名。

- [ ] **Step 1: 在 `@layer components` 内、`.drawer-title` 规则之后插入新类**

定位到 `.drawer-title` 规则（约 106-108 行），在它的闭合 `}` 之后、`@layer components` 块闭合之前插入：

```css
  /* —— 顶部 Tab 栏（平铺视图切换） —— */
  .tab-bar {
    @apply flex items-center gap-0.5 px-2 py-1.5 bg-surface border-b border-line;
  }
  .tab-item {
    @apply flex items-center justify-center gap-1 px-2.5 h-7 rounded-lg text-[12px] font-medium
           text-ink-faint transition-colors duration-150 ease-out
           hover:bg-surface-muted hover:text-ink-soft
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft;
  }
  .tab-item-active {
    @apply bg-accent-softer text-accent;
  }

  /* —— 错误提示条（取代报错自动弹设置窗） —— */
  .error-banner {
    @apply flex items-center gap-2 px-3.5 py-2 bg-danger-soft/50 border-b border-danger/30
           text-[11px] text-danger;
  }
  .error-banner-actions {
    @apply flex items-center gap-2 ml-auto;
  }
```

注意：`bg-accent-softer`、`text-accent`、`bg-danger-soft/50`、`border-danger/30`、`text-danger` 均为项目已有 token（见 `src/styles/tokens.css` 与 App.tsx 现有用法如 `bg-accent-softer`/`text-danger`）。`danger-soft` 若不存在则降级用 `bg-danger/10`——先构建验证。

- [ ] **Step 2: 验证扩展构建（Tailwind 编译新类无误）**

Run: `npm run build:extension`
Expected: 构建成功，无 Tailwind "class not found" 报错。若 `bg-danger-soft` 报错，把 `.error-banner` 中 `bg-danger-soft/50` 改为 `bg-danger/10`，重新构建确认。

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/index.css
git commit -m "style(ui): add tab-bar/tab-item/error-banner component classes"
```

---

## Task 3: 引入 `activeView` 状态，替换 8 个 `show*` 布尔

本任务**只替换状态声明**，不改 JSX 渲染（JSX 改在 Task 4）。这是一个安全中间态：状态被替换但渲染逻辑暂时还能引用新状态——因为 Task 4 会立即跟进。为避免中间态编译失败，本任务与 Task 4 在同一提交内完成。

**Files:**
- Modify: `src/sidepanel/App.tsx:122-143`（状态声明区）

**Interfaces:**
- Consumes: 无
- Produces: `type View`、`activeView` 状态、`errorBanner` 状态。后续 Task 4-7 全部消费这些。
  - `View = 'chat' | 'sentences' | 'highlights' | 'vocab' | 'settings' | 'templates' | 'glossary' | 'library'`
  - `const [activeView, setActiveView] = useState<View>('chat')`
  - `const [errorBanner, setErrorBanner] = useState<string | null>(null)`

- [ ] **Step 1: 替换状态声明块**

定位 `App.tsx:122-143`（从 `const [page, setPage] = ...` 到 `slashMenu` 声明）。把其中这 8 行替换：

```ts
  const [showSettings, setShowSettings] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showHighlights, setShowHighlights] = useState(false)
  const [showVocab, setShowVocab] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showGlossary, setShowGlossary] = useState(false)
  const [showSentences, setShowSentences] = useState(false)
  const [showTools, setShowTools] = useState(false)
```

替换为：

```ts
  // Flat view model: a single mutually-exclusive view replaces the 8 show*
  // booleans. Opening a view = setActiveView(...); only one can be active,
  // so stacked overlays are physically impossible. See
  // docs/superpowers/specs/2026-07-24-tab-navigation-redesign.md
  const [activeView, setActiveView] = useState<View>('chat')
  const [showTools, setShowTools] = useState(false) // MoreMenu 下拉开关（局部）
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
```

保留 `showTools`（它现在驱动 `⋯` MoreMenu 下拉，不再是视图开关）。删除其余 7 个 `show*`。

- [ ] **Step 2: 在文件顶部（`App` 函数之前，约 87 行 `export default function App()` 之前）定义 `View` 类型**

在 `runSentenceAnalysis` 函数（约 86 行）之后、`export default function App()` 之前插入：

```ts
/** Flat, mutually-exclusive side-panel views (replaces overlay drawers). */
type View =
  | 'chat'
  | 'sentences'
  | 'highlights'
  | 'vocab'
  | 'settings'
  | 'templates'
  | 'glossary'
  | 'library'
```

- [ ] **Step 3: 修复 `openSession`（引用了已删除的 `setShowLibrary`）**

定位 `openSession`（约 492-496 行），原代码：

```ts
  const openSession = (s: ChatSession) => {
    setMessages(s.messages)
    setActiveSessionId(s.id)
    setShowLibrary(false)
  }
```

改为打开会话后切回 chat 视图：

```ts
  const openSession = (s: ChatSession) => {
    setMessages(s.messages)
    setActiveSessionId(s.id)
    setActiveView('chat')
  }
```

- [ ] **Step 4: 修复 bilingual-error 监听器（不再弹设置窗 → 改为 ErrorBanner）**

定位 `App.tsx:252-264` 的 `useEffect`，原代码内：

```ts
        setError(message.message)
        // Key/quota errors mean the user should revisit settings.
        if (/401|key|quota|429|credit/i.test(message.message)) {
          setShowSettings(true)
        }
```

替换为（报错进 ErrorBanner，不切视图）：

```ts
        setError(message.message)
        // Key/quota errors surface in a top banner (no auto-opening Settings
        // on top of the current view — the user jumps to Settings themselves).
        if (/401|key|quota|429|credit/i.test(message.message)) {
          setErrorBanner(message.message)
        }
```

- [ ] **Step 5: 修复 `handleSend` 的无 key 分支（不再弹设置窗 → 改为 ErrorBanner）**

定位 `handleSend` 内 `if (!byok.apiKey) {`（约 385-389 行），原代码：

```ts
      if (!byok.apiKey) {
        setError(t('side.error.addKey', byok.locale))
        setShowSettings(true)
        return
      }
```

替换为：

```ts
      if (!byok.apiKey) {
        setError(t('side.error.addKey', byok.locale))
        setErrorBanner(t('side.error.addKey', byok.locale))
        return
      }
```

> ⚠️ 本任务结束后**先不要提交**——此时 JSX 仍引用已删除的 `setShowSettings`/`setShowLibrary` 等，编译会失败。Task 4 紧接着修复所有 JSX 引用，然后一并提交。继续 Task 4。

---

## Task 4: 重写 header + 用 TabBar/MoreMenu/ErrorBanner 替换工具下拉

**Files:**
- Modify: `src/sidepanel/App.tsx:500-614`（整个 `<header>` 块）

**Interfaces:**
- Consumes: Task 1 的 i18n 键、Task 2 的 CSS 类、Task 3 的 `activeView`/`setActiveView`/`errorBanner`/`setErrorBanner`。
- Produces: 新的 `<header>` 含 TabBar + MoreMenu + Bilingual + Settings。ErrorBanner 渲染在 header 下方。

- [ ] **Step 1: 替换整个 `<header>` 块为精简版（标题区 + Bilingual + Settings）**

定位 `App.tsx:502` 的 `{/* Header */}` 注释到 `</header>`（约 614 行）。整段 `<header>...</header>` 替换为：

```tsx
      {/* Header: app identity + page-bilingual toggle + settings */}
      <header className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-surface border-b border-line">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-accent text-accent-on font-bold flex items-center justify-center text-[15px] flex-shrink-0 shadow-sm font-serif">
            L
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink truncate leading-tight">
              {page?.title || tr('side.header.defaultTitle')}
            </div>
            <div className="text-[10px] text-ink-faint truncate max-w-[200px] mt-0.5">
              {providerConfigured
                ? `${getProvider(byok.provider).label} · ${byok.model || 'model'}`
                : tr('side.header.noKey')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={toggleBilingual}
            disabled={!page || bilingualBusy}
            title={page ? 'Translate page paragraphs (bilingual)' : 'Open a page first'}
            aria-label={page ? 'Translate page paragraphs (bilingual)' : 'Open a page first'}
            className="icon-btn"
          >
            {bilingualBusy ? (
              <span className="block w-3.5 h-3.5 border-2 border-line border-t-accent rounded-full animate-spin" />
            ) : (
              <LanguagesIcon size={17} />
            )}
          </button>
          <button
            onClick={() => setActiveView('settings')}
            title={tr('settings.title')}
            aria-label={tr('settings.title')}
            className={`icon-btn ${activeView === 'settings' ? 'text-accent' : ''}`}
          >
            <SettingsIcon size={17} />
          </button>
        </div>
      </header>
```

> 说明：原来的 GridIcon 工具菜单（含 6 个 `setShow*` 项）整体移除；导航职责移到下方的 TabBar。`toolsRef`/`showTools` 外部点击关闭逻辑（约 148-165 行）在本任务 Step 4 处理。

- [ ] **Step 2: 在 `</header>` 之后插入 `<TabBar>` + `<ErrorBanner>`**

紧接着 `</header>`（原 614 行后，原 `{/* Messages */}` 注释前）插入：

```tsx
      {/* TabBar: flat view switching (high-frequency tabs + MoreMenu). */}
      <nav className="tab-bar" aria-label="Views">
        <button
          onClick={() => setActiveView('chat')}
          className={`tab-item ${activeView === 'chat' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.chat')}
        >
          <SendIcon size={14} />
          <span>{tr('side.tab.chat')}</span>
        </button>
        <button
          onClick={() => setActiveView('sentences')}
          className={`tab-item relative ${activeView === 'sentences' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.sentences')}
        >
          <CardsIcon size={14} />
          <span>{tr('side.tab.sentences')}</span>
          {sentences.some((c) => c.srs && isDue(c.srs)) && (
            <span className="lector-due-badge">!</span>
          )}
        </button>
        <button
          onClick={() => setActiveView('highlights')}
          className={`tab-item relative ${activeView === 'highlights' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.highlights')}
        >
          <BookmarkIcon size={14} />
          <span>{tr('side.tab.highlights')}</span>
          {highlights.length > 0 && <span className="dot-badge" />}
        </button>
        <button
          onClick={() => setActiveView('vocab')}
          className={`tab-item relative ${activeView === 'vocab' ? 'tab-item-active' : ''}`}
          aria-label={tr('side.tab.vocab')}
        >
          <BookOpenIcon size={14} />
          <span>{tr('side.tab.vocab')}</span>
          {vocab.some((v) => isDue(v.srs)) && <span className="lector-due-badge">!</span>}
        </button>
        {/* ⋯ MoreMenu: low-frequency views (Templates / Glossary / Library) */}
        <div className="relative" ref={toolsRef}>
          <button
            onClick={() => setShowTools((v) => !v)}
            className={`tab-item ${activeView === 'templates' || activeView === 'glossary' || activeView === 'library' ? 'tab-item-active' : ''}`}
            aria-label={tr('side.tab.more')}
            aria-expanded={showTools}
          >
            <GridIcon size={14} />
            <span>{tr('side.tab.more')}</span>
          </button>
          {showTools && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-line rounded-xl shadow-pop z-30 py-1 lector-anim-fade">
              <button
                onClick={() => { setActiveView('library'); setShowTools(false) }}
                className="tools-item"
              >
                <LibraryIcon size={16} />
                <span className="flex-1 text-left">{tr('side.tab.more.library')}</span>
              </button>
              <button
                onClick={() => { setActiveView('glossary'); setShowTools(false) }}
                className="tools-item relative"
              >
                <BookMarkedIcon size={16} />
                <span className="flex-1 text-left">{tr('side.tab.more.glossary')}</span>
                {glossary.length > 0 && <span className="dot-badge" />}
              </button>
              <button
                onClick={() => { setActiveView('templates'); setShowTools(false) }}
                className="tools-item relative"
              >
                <ClipboardListIcon size={16} />
                <span className="flex-1 text-left">{tr('side.tab.more.templates')}</span>
                {templates.filter((tpl) => !tpl.builtIn).length > 0 && (
                  <span className="dot-badge" />
                )}
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ErrorBanner: API/key errors show here instead of auto-opening Settings. */}
      {errorBanner && (
        <div className="error-banner" role="alert">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" />
          <span className="flex-1 leading-relaxed">{errorBanner}</span>
          <div className="error-banner-actions">
            <button
              onClick={() => { setActiveView('settings'); setErrorBanner(null) }}
              className="font-medium underline hover:no-underline"
            >
              {tr('side.error.goSettings')}
            </button>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-ink-faint hover:text-ink"
              aria-label={tr('side.error.dismiss')}
            >
              <XIcon size={13} />
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 3: 把 Chat 视图内容用 `activeView === 'chat'` 守卫**

现在 Messages + Composer 两块（原 616-790 行）应只在 chat 视图显示。在 `{/* Messages */}` 那个 `<div ref={scrollRef} ...>` 之前包一层条件，并在 Composer 闭合 `</div>`（原 790 行）后闭合：

把原 `{/* Messages */}` 注释那行改为：

```tsx
      {activeView === 'chat' && (
        <>
      {/* Messages */}
```

并把 Composer 块结尾的 `</div>`（原 790 行，Composer 外层 div 闭合）之后加：

```tsx
        </>
      )}
```

> 精确位置：Composer 是 `{/* Composer */}` 注释下的 `<div className="px-3.5 py-2.5 bg-surface border-t border-line">...</div>`。在该 `</div>` 之后立即插入 `</>` + `)}`。用读文件确认缩进后编辑。

- [ ] **Step 4: 删除已废弃的 toolsRef 外部点击 useEffect（被 MoreMenu 复用，但 `setShowTools` 仍存在，保留即可）**

检查 `App.tsx:148-165` 的 useEffect——它引用 `showTools` 和 `setShowTools`，这两个仍存在（驱动 MoreMenu），**保留不动**。此步仅确认无需修改，跳过。

- [ ] **Step 5: 验证类型检查通过**

Run: `npm run typecheck`
Expected: 零错误。若报 `setShowSettings`/`setShowLibrary`/`setShowHighlights`/`setShowVocab`/`setShowTemplates`/`setShowGlossary`/`setShowSentences` undefined，说明 Task 4 漏改了某处 JSX——用 `grep -n "setShow\(Settings\|Library\|Highlights\|Vocab\|Templates\|Glossary\|Sentences\)" src/sidepanel/App.tsx` 定位，全部待 Task 5-7 处理（抽屉渲染块）。这些引用来自 792-1014 行的各抽屉渲染块，本任务不碰它们——**此时 typecheck 会失败是预期的**，Task 5 修复后通过。继续 Task 5（不提交）。

---

## Task 5: 把 SettingsDrawer 抽屉壳改为始终挂载的 SettingsView

**Files:**
- Modify: `src/sidepanel/App.tsx:792-802`（SettingsDrawer 调用处）
- Modify: `src/sidepanel/App.tsx:1794`（SettingsDrawer 函数签名与 1850-1865 外壳）

**Interfaces:**
- Consumes: `activeView`、`setActiveView`。
- Produces: `<SettingsView/>`——去掉 `open`/`onClose`，改为始终渲染（由父级 `activeView === 'settings'` 守卫）。

- [ ] **Step 1: 替换 SettingsDrawer 调用块（792-802 行）**

原代码：

```tsx
      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        byok={byok}
        onChange={async (next) => {
          setByok(next)
          // Read the latest store state rather than the render-captured `byok`,
          // so rapid sequential edits don't persist a stale snapshot.
          await saveSettings({ ...useStore.getState().byok, ...next })
        }}
      />
```

替换为（用 activeView 守卫，去掉 open/onClose）：

```tsx
      {activeView === 'settings' && (
        <SettingsView
          byok={byok}
          onChange={async (next) => {
            setByok(next)
            await saveSettings({ ...useStore.getState().byok, ...next })
          }}
        />
      )}
```

- [ ] **Step 2: 重命名 `SettingsDrawer` 函数为 `SettingsView` 并改签名/外壳**

定位 `function SettingsDrawer({ open, onClose, byok, onChange }: SettingsDrawerProps)`（1794 行）。

先定位 `SettingsDrawerProps` 类型定义（在 SettingsDrawer 函数之前，搜索 `type SettingsDrawerProps` 或 `interface SettingsDrawerProps`）。把它改为：

```ts
type SettingsViewProps = {
  byok: ByokSettings
  onChange: (next: Partial<ByokSettings>) => void
}
```

（删除 `open`/`onClose` 字段。）

然后改函数声明（1794 行）：

```tsx
function SettingsView({ byok, onChange }: SettingsViewProps) {
```

- [ ] **Step 3: 删除 SettingsView 的 modal 外壳 + 关闭按钮**

定位 1850-1865 行。原代码：

```tsx
  if (!open) return null

  return (
    <div
      className="absolute inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 lector-anim-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-surface w-full max-w-[340px] rounded-2xl shadow-pop flex flex-col max-h-[92vh] overflow-hidden lector-anim-pop">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-line">
          <h2 className="text-[14px] font-bold text-ink font-serif tracking-tight">{t('settings.title', byok.locale)}</h2>
          <button onClick={onClose} aria-label={t('popup.close', byok.locale)} className="icon-btn">
            <XIcon size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3.5 space-y-3.5">
```

替换为（去掉 modal 包裹层和关闭按钮，保留标题行与内容滚动区）：

```tsx
  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="drawer-head">
        <h3 className="drawer-title">{t('settings.title', byok.locale)}</h3>
      </div>

      <div className="overflow-y-auto px-4 py-3.5 space-y-3.5">
```

- [ ] **Step 4: 修复 SettingsView 的闭合标签（去掉两层 div 的多余闭合）**

原 SettingsDrawer 的 modal 有两层 `<div>`（外层遮罩 + 内层卡片），现在只剩一层（外层 `flex-1` + 标题行 + 滚动区）。定位函数结尾的闭合（搜索 SettingsView 内最后的 `</div>\n  )\n}`），原来大概有三层 `</div>` 闭合（遮罩 `</div>`、卡片 `</div>`、滚动区 `</div>`）。

现在结构是：
```
<div className="flex-1 ...">       ← 外层（Step 3 新增）
  <div className="drawer-head">...</div>
  <div className="overflow-y-auto ...">...</div>   ← 内容滚动区
</div>
```
所以末尾需要：滚动区 `</div>` + 外层 `</div>` 两层闭合。读 SettingsView 函数末尾，确保闭合层数匹配（原来多出的遮罩层 `</div>` 删除）。仔细核对：在原 modal 结构里，`onClick` 遮罩 div 对应一个 `</div>`，卡片 div 对应一个 `</div>`，滚动区 div 对应一个 `</div>`——共 3 个。现在去掉了遮罩和卡片两层，只保留外层 + 滚动区 = 2 个。删掉多余的 1 个 `</div>`。

- [ ] **Step 5: 验证类型检查（SettingsDrawer→SettingsView 引用全部更新）**

Run: `npm run typecheck`
Expected: SettingsView 相关错误清零。若仍有 `SettingsDrawerProps` 引用，全局替换为 `SettingsViewProps`；若 `open`/`onClose` 在 SettingsView 内部还有使用（搜索 `onClose`/`open` 在 1794-2076 范围内），删除或改写。

- [ ] **Step 6: 不提交，继续 Task 6**（其他抽屉调用块仍引用已删除的 setter）

---

## Task 6: 把 Library 内联抽屉改为 LibraryView（始终挂载 + activeView 守卫）

**Files:**
- Modify: `src/sidepanel/App.tsx:804-863`（Library 块）

**Interfaces:**
- Produces: Library 视图由 `activeView === 'library'` 守卫渲染，内容不变（会话列表 + 清空）。

- [ ] **Step 1: 替换 Library 块的外壳，改用 activeView 守卫**

定位 `{/* Library drawer */}` 注释（804 行）到对应闭合 `)}`（863 行）。原结构是 `{showLibrary && (<div 遮罩>...<div 抽屉>...</div></div>)}`。

改为：去掉遮罩层和 `w-[310px]` 抽屉壳，保留标题行（复用 `.drawer-head`，去关闭按钮）+ 内容，用 `activeView === 'library'` 守卫。

把原 805-863 整块替换为：

```tsx
      {/* Library view (flat — replaces the overlay drawer) */}
      {activeView === 'library' && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="drawer-head">
            <h3 className="drawer-title">{tr('side.library.title')}</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <Empty text={tr('side.library.empty')} />
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className="group row row-hover"
                  onClick={() => openSession(s)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-ink truncate">{s.title}</div>
                      <div className="text-[10px] text-ink-faint mt-0.5">{new Date(s.createdAt).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeSession(s.id)
                        if (activeSessionId === s.id) startNewChat()
                      }}
                      aria-label="Delete conversation"
                      className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                    >
                      <XIcon size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {sessions.length > 0 && (
            <button
              onClick={() => {
                clearSessions()
                startNewChat()
              }}
              className="px-4 py-2.5 text-meta text-ink-faint hover:text-danger hover:bg-danger-soft/40 border-t border-line transition-colors text-left"
            >
              {tr('side.library.clearAll')}
            </button>
          )}
        </div>
      )}
```

（内容与原来逐字一致，仅去掉了遮罩 `<div className="absolute inset-0 ...">`、抽屉面板 `<div className="absolute right-0 ... w-[310px] ...">`、关闭按钮，加了 activeView 守卫。）

- [ ] **Step 2: 验证类型检查**

Run: `npm run typecheck`
Expected: 不再有 `setShowLibrary` 相关错误。`openSession`（已 Task 3 改为 `setActiveView('chat')`）正常。

- [ ] **Step 3: 不提交，继续 Task 7**

---

## Task 7: 把其余 5 个抽屉（Highlights/Vocab/Templates/Glossary/Sentences）改为 activeView 守卫

这 5 个抽屉用了 `<Drawer>` 通用壳或自定义 Drawer 组件（Vocab/Templates/Glossary/Sentences）。本任务把它们的外部调用从 `{showX && (<XDrawer onClose={...}/>)} ` 改为 `{activeView === 'x' && (<XDrawer/>...)}`，并删除这些 Drawer 组件内部的遮罩外壳。Vocab/Templates/Glossary/Sentences 各自定义的 Drawer 组件外壳处理统一放在 Step 2-3。

**Files:**
- Modify: `src/sidepanel/App.tsx:865-1014`（5 个抽屉调用块）
- Modify: `src/sidepanel/App.tsx:1018-1045`（`Drawer` 通用组件 → 改为 `ViewShell`）
- Modify: VocabDrawer/TemplatesDrawer/GlossaryDrawer/SentencesDrawer 各自的外壳

**Interfaces:**
- Produces: 5 个视图由对应 `activeView` 守卫；`<Drawer>` 重命名为 `<ViewShell>`（去掉遮罩/onClose，保留标题行）。

### 7a. Highlights（用通用 Drawer 壳）

- [ ] **Step 1: 替换 Highlights 调用块（865-911 行）**

原代码：

```tsx
      {/* Highlights drawer */}
      {showHighlights && (
        <Drawer title={tr('side.highlights.title')} onClose={() => setShowHighlights(false)}>
          {highlights.length === 0 ? (
            ...
          ) : (
            <>
              ...
            </>
          )}
        </Drawer>
      )}
```

改为（用 activeView 守卫，复用稍后定义的 `<ViewShell>`；因 ViewShell 在 Task 7 Step 2 才改名，这里先用 `<ViewShell>` 并在 Step 2 同步改名）：

```tsx
      {/* Highlights view (flat) */}
      {activeView === 'highlights' && (
        <ViewShell title={tr('side.highlights.title')}>
          {highlights.length === 0 ? (
            <Empty text={tr('side.highlights.empty')} />
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                {highlights.map((h) => (
                  <div key={h.id} className="group row">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-ink leading-relaxed border-l-2 border-accent/40 pl-2.5">{h.text}</div>
                        {h.note && <div className="text-[11px] text-ink-soft mt-1.5 pl-2.5">{h.note}</div>}
                        <div className="text-[10px] text-ink-faint mt-1.5 pl-2.5 truncate">{h.title}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => void handleMakeCardFromHighlight(h)}
                          title={tr('side.sentences.fromHighlight')}
                          className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-accent transition-opacity"
                        >
                          <SparklesIcon size={14} />
                        </button>
                        <button
                          onClick={() => removeHighlight(h.id)}
                          aria-label="Delete highlight"
                          className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity"
                        >
                          <XIcon size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => downloadMarkdown(highlights)}
                className="px-4 py-2.5 text-meta text-ink-soft hover:text-accent hover:bg-accent-softer border-t border-line transition-colors text-left flex items-center gap-1.5"
              >
                <DownloadIcon size={13} />
                {tr('side.highlights.export')}
              </button>
            </>
          )}
        </ViewShell>
      )}
```

> 注意：原 `onClick={() => generateSentenceCard(h.text, h.url, h.title)}` 改为 `handleMakeCardFromHighlight(h)`——见 Step 6（为加 loading 反馈，本任务先引入占位调用，Step 6 落实）。**暂时**先把 Step 1 的 onClick 保持为原样 `() => generateSentenceCard(h.text, h.url, h.title)`，Step 6 再统一改 loading 版本，避免 7a 引用未定义符号。

### 7b-e. Vocab / Templates / Glossary / Sentences 调用块

- [ ] **Step 2: 替换 Vocab 调用块（913-933 行）**

原 `{showVocab && (<VocabDrawer ... onClose={() => setShowVocab(false)} .../>)}` 改为：

```tsx
      {/* Vocabulary view (flat) */}
      {activeView === 'vocab' && (
        <VocabView
          vocab={vocab}
          revealedVocab={revealedVocab}
          ankiConfig={byok.anki}
          tr={tr}
          onToggleReveal={(id) => toggleReveal(id)}
          onRemoveVocab={removeVocab}
          onGradeVocab={(v, g) => gradeVocab(v, g)}
          onSaveAnkiConfig={(cfg) => setByok({ anki: cfg })}
          onExplainVocab={(v) => {
            if (!v.context?.trim()) {
              alert(tr('side.sentences.noContext'))
              return
            }
            void generateSentenceCard(v.context, v.url, v.title)
          }}
        />
      )}
```

（去掉了 `onClose`。）

- [ ] **Step 3: 替换 Templates 调用块（935-947 行）**

```tsx
      {/* Templates view (flat) */}
      {activeView === 'templates' && (
        <TemplatesView
          templates={sortedTemplates}
          titleFor={tplTitle}
          tr={tr}
          onAdd={(tpl) => addTemplate(tpl)}
          onUpdate={(id, patch) => updateTemplate(id, patch)}
          onRemove={(id) => removeTemplate(id)}
          onReorder={reorderTemplates}
        />
      )}
```

- [ ] **Step 4: 替换 Glossary 调用块（949-960 行）**

```tsx
      {/* Glossary view (flat) */}
      {activeView === 'glossary' && (
        <GlossaryView
          entries={glossary}
          tr={tr}
          onAdd={(e) => addGlossaryEntry(e)}
          onUpdate={(id, patch) => updateGlossaryEntry(id, patch)}
          onRemove={(id) => removeGlossaryEntry(id)}
          onImport={(entries) => replaceGlossary(entries)}
        />
      )}
```

- [ ] **Step 5: 替换 Sentences 调用块（962-1014 行）**

```tsx
      {/* Sentence Library view (flat) */}
      {activeView === 'sentences' && (
        <SentencesView
          sentences={sentences}
          revealed={revealedSentences}
          busyExample={busyExample}
          tr={tr}
          onToggleReveal={(id) =>
            setRevealedSentences((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
          onRemove={(id) => removeSentence(id)}
          onPromote={(id) => promoteSentenceToReview(id)}
          onGrade={(c, g) => {
            if (c.srs) updateSentenceSrs(c.id, scheduleSrs(c.srs, g))
            setRevealedSentences((prev) => {
              const next = new Set(prev)
              next.delete(c.id)
              return next
            })
          }}
          onViewSource={(blockId, url) => {
            if (blockId) {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tabId = tabs[0]?.id
                if (tabId !== undefined) {
                  chrome.tabs.sendMessage(tabId, { action: 'lector-jump-to', blockId }, () => {
                    void chrome.runtime.lastError
                  })
                }
              })
            } else if (url) {
              window.open(url, '_blank')
            }
          }}
          onAnkiExport={async (cards) => {
            const settings = useStore.getState().byok
            const cfg = withAnkiDefaults(settings.anki)
            const deckName = cfg.deckName === DEFAULT_DECK_NAME ? DEFAULT_SENTENCE_DECK_NAME : cfg.deckName
            try {
              const r = await exportSentencesToAnki(cards, { ...cfg, deckName })
              alert(tr('anki.result').replace('{added}', String(r.added)).replace('{dup}', String(r.duplicated)).replace('{fail}', String(r.failed)))
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e))
            }
          }}
          onMakeCard={(sentence, title) => handleMakeCardFromExample(sentence, title)}
        />
      )}
```

> 新增两个 prop：`busyExample`（Task 8 引入）和 `onMakeCard` 指向 `handleMakeCardFromExample`（Task 8 引入）。本任务先这样写，Task 8 补这两个符号定义，否则编译失败——**预期**，Task 8 修复。

### 7f. 把通用 `Drawer` 组件重命名为 `ViewShell` 并去外壳

- [ ] **Step 6: 重写 `Drawer` 组件（1018-1045 行）为 `ViewShell`**

原 `function Drawer({ title, onClose, children }: {...})`（1018-1045）替换为：

```tsx
function ViewShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="drawer-head">
        <h3 className="drawer-title">{title}</h3>
      </div>
      {children}
    </div>
  )
}
```

（去掉遮罩层、`w-[310px]`、`onClose`、关闭按钮、`lector-anim-*`。保留 `.drawer-head` 标题行供复用。）

- [ ] **Step 7: 重命名 VocabDrawer/TemplatesDrawer/GlossaryDrawer/SentencesDrawer 为 *View 并去外壳**

这 4 个组件各有自己的 props 类型（含 `onClose`）和内部遮罩壳。逐个处理：

**VocabDrawer → VocabView**（1148 行起）：
1. 找到 `VocabDrawerProps` 类型，删除 `onClose` 字段。
2. `function VocabDrawer({...})` → `function VocabView({...})`，从解构中删 `onClose`。
3. 找到组件返回的 JSX——它内部用了 `<Drawer title={...} onClose={onClose}>` 包裹。把 `<Drawer ...>` 改为 `<ViewShell title={...}>`，`</Drawer>` 改为 `</ViewShell>`。

**TemplatesDrawer → TemplatesView**（1373 行起）：同上模式（改 props 类型删 onClose、函数名、内部 `<Drawer>` → `<ViewShell>`）。

**GlossaryDrawer → GlossaryView**（1564 行起）：同上。

**SentencesDrawer → SentencesView**（2096 行起）：同上。注意 SentencesView 还要接收新 prop `busyExample` 并在例句"生成卡片"按钮上用它——这部分留给 Task 8，本任务只做壳与命名。

> 用 `grep -n "function VocabDrawer\|function TemplatesDrawer\|function GlossaryDrawer\|function SentencesDrawer\|DrawerProps\|onClose" src/sidepanel/App.tsx` 逐个定位，确保 4 个组件的 props 类型、函数名、内部 `<Drawer>`/`</Drawer>` 标签全部更新，`onClose` 全部删除。

- [ ] **Step 8: 全局搜索确认无残留 `setShow*` 与 `Drawer`（通用壳）引用**

Run:
```bash
grep -nE "setShow(Settings|Library|Highlights|Vocab|Templates|Glossary|Sentences)\b|showSettings|showLibrary|showHighlights|showVocab|showTemplates|showGlossary|showSentences" src/sidepanel/App.tsx
grep -n "<Drawer\b\|function Drawer\b" src/sidepanel/App.tsx
```
Expected: 第一条应无输出（只剩 `showTools` 是允许的——它驱动 MoreMenu，不在此列表）；第二条无输出（Drawer 已全部改名 ViewShell）。

- [ ] **Step 9: 验证类型检查（此时应只剩 busyExample/handleMakeCard* 未定义错误）**

Run: `npm run typecheck`
Expected: 仅剩 `busyExample`、`handleMakeCardFromExample`、`handleMakeCardFromHighlight`、`ViewShell` 在 SentencesView 的 `busyExample` prop 未定义/未声明错误——Task 8 修复。其余全通过。

- [ ] **Step 10: 不提交，继续 Task 8**

---

## Task 8: make-card 内联 loading（busyExample + handleMakeCard*）

**Files:**
- Modify: `src/sidepanel/App.tsx`（App 内新增 `busyExample` 状态与两个 handler；SentencesView 组件接收 `busyExample` 并渲染 loading）
- Modify: `src/sidepanel/App.tsx`（Highlights 调用块的 onClick 改用 `handleMakeCardFromHighlight`）

**Interfaces:**
- Consumes: Task 1 的 `side.sentences.makingCard`。
- Produces: `busyExample` 状态（`string | null`）、`handleMakeCardFromExample(sentence, title)`、`handleMakeCardFromHighlight(h)`。SentencesView 新 prop `busyExample: string | null`。

- [ ] **Step 1: 在 App 内（`generateSentenceCard` 之后，约 315 行）新增 busyExample 状态与两个 handler**

先在 App 状态声明区（Task 3 改过的区域，紧接 `errorBanner` 声明）追加：

```ts
  // Inline loading for the 举一反三 → make-card action: tracks the exact
  // example sentence currently being turned into a card, so its row shows a
  // spinner and the others stay clickable. Null when nothing is generating.
  const [busyExample, setBusyExample] = useState<string | null>(null)
```

然后在 `generateSentenceCard` 函数（304-315 行）之后新增两个 handler：

```ts
  // make-card from a 举一反三 example sentence (inside SentencesView).
  // Wraps generateSentenceCard with per-example busy state so the row shows
  // a spinner; the new card appears at the top of the list via the store.
  const handleMakeCardFromExample = async (sentence: string, title: string) => {
    setBusyExample(sentence)
    try {
      await generateSentenceCard(sentence, '', title)
    } finally {
      setBusyExample(null)
    }
  }

  // make-card from a Highlight's "explain" (Sparkles) button. No per-row busy
  // state here (highlights list is short and the action is secondary); we just
  // surface a lightweight inline state by reusing busyExample keyed on text.
  const handleMakeCardFromHighlight = async (h: { text: string; url: string; title: string }) => {
    setBusyExample(h.text)
    try {
      await generateSentenceCard(h.text, h.url, h.title)
    } finally {
      setBusyExample(null)
    }
  }
```

- [ ] **Step 2: 修复 Highlights 调用块（7a Step 1 暂留的原 onClick）改用 handler**

在 Task 7a 的 Highlights 块里，把 SparklesIcon 按钮的 `onClick={() => generateSentenceCard(h.text, h.url, h.title)}` 改为：

```tsx
                          onClick={() => void handleMakeCardFromHighlight(h)}
```

- [ ] **Step 3: 让 SentencesView 接收并使用 busyExample**

定位 `function SentencesView(...)`（原 SentencesDrawer，约 2096 行）。在其 props 类型（`SentencesViewProps` 或原 `SentencesDrawerProps`）中新增：

```ts
  busyExample: string | null
```

并在解构参数中加入 `busyExample`。

- [ ] **Step 4: 在 SentencesView 的"生成卡片"按钮上用 busyExample 显示 loading**

定位例句列表渲染（原 2307-2322 行附近，`extractExamples(c.analysis).map(...)` 块）。原代码：

```tsx
                        {isRevealed && extractExamples(c.analysis).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {extractExamples(c.analysis).map((ex, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px] bg-surface-muted/40 rounded-md px-2 py-1">
                                <span className="text-ink-soft flex-1">{ex}</span>
                                <button
                                  onClick={() => props.onMakeCard(ex, c.title)}
                                  title={tr('side.sentences.makeCard')}
                                  className="text-accent hover:text-accent-hover text-[10px] flex-shrink-0 font-medium"
                                >
                                  {tr('side.sentences.makeCard')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
```

替换为（busyExample === ex 时显示 spinner + 禁用）：

```tsx
                        {isRevealed && extractExamples(c.analysis).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {extractExamples(c.analysis).map((ex, i) => {
                              const busy = props.busyExample === ex
                              return (
                                <div key={i} className="flex items-center gap-2 text-[11px] bg-surface-muted/40 rounded-md px-2 py-1">
                                  <span className="text-ink-soft flex-1">{ex}</span>
                                  <button
                                    onClick={() => props.onMakeCard(ex, c.title)}
                                    disabled={busy}
                                    title={tr('side.sentences.makeCard')}
                                    className="text-accent hover:text-accent-hover text-[10px] flex-shrink-0 font-medium flex items-center gap-1 disabled:opacity-60"
                                  >
                                    {busy ? (
                                      <>
                                        <span className="w-2.5 h-2.5 border-[1.5px] border-line border-t-accent rounded-full animate-spin" />
                                        {tr('side.sentences.makingCard')}
                                      </>
                                    ) : (
                                      tr('side.sentences.makeCard')
                                    )}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
```

- [ ] **Step 5: 验证类型检查全通过**

Run: `npm run typecheck`
Expected: 零错误。所有 Task 3-7 引入的符号现在都有定义。

- [ ] **Step 6: 验证扩展构建**

Run: `npm run build:extension`
Expected: 构建成功，产出 `dist/sidepanel.js` + css。

- [ ] **Step 7: 一次性提交 Task 3-8 的全部改动**

由于 Task 3-8 是一个原子重构（中间态不可编译），统一提交：

```bash
git add src/sidepanel/App.tsx
git commit -m "refactor(ui): replace 8 overlay drawers with flat activeView + TabBar

- Single mutually-exclusive activeView state replaces show* booleans;
  stacked overlays now physically impossible.
- TabBar (Chat/Sentences/Highlights/Vocab) + MoreMenu (Templates/Glossary/
  Library) + Settings as a flat view — no more inset-0 backdrops.
- API/key errors show in a top ErrorBanner instead of auto-opening the
  z-50 Settings modal over the current view.
- 举一反三 → make-card gets per-example busy state + inline spinner;
  result lands at the top of the Sentences view list (no popup).
- Drawer/SettingsDrawer shells removed; views use ViewShell / flat render.

Implements docs/superpowers/specs/2026-07-24-tab-navigation-redesign.md"
```

---

## Task 9: 更新侧边栏 e2e 断言（header 选择器 + tab 切换）

**Files:**
- Modify: `tests/browser/run-sidepanel-e2e.mjs:174-223`（header 断言 + library 打开断言）

**Interfaces:**
- Consumes: Task 4 的 TabBar/MoreMenu 结构（`.tab-bar`、`.tab-item`、MoreMenu 内 Library 按钮）。

**背景**：旧 e2e 在 174-176 行断言 `header button >= 6`（原 GridIcon 菜单展开才有），221 行用 `aria-label === 'Library'` 找按钮。重构后 Library 进了 MoreMenu（默认折叠），且 header 按钮数变化。需更新断言匹配新结构。

- [ ] **Step 1: 更新 header button 数量断言 + 注释**

定位 174-176 行：

```js
    // Header has: Library, Highlights, Vocab, Templates, Bilingual, Settings (6).
    const headerBtns = await evalIn(page, `document.querySelectorAll('header button').length`)
    check('§sidepanel header buttons render (Library/Highlights/Vocab/Templates/Bilingual/Settings)', headerBtns >= 6, `buttons=${headerBtns}`)
```

替换为（新结构：Bilingual + Settings 在 header；Tabs 在 `.tab-bar`；Library 在 MoreMenu 折叠）：

```js
    // Header holds: Bilingual + Settings (2). Tabs (Chat/Sentences/Highlights/
    // Vocab/More) live in the .tab-bar nav below the header.
    const headerBtns = await evalIn(page, `document.querySelectorAll('header button').length`)
    check('§sidepanel header buttons render (Bilingual/Settings)', headerBtns >= 2, `buttons=${headerBtns}`)
    const tabBtns = await evalIn(page, `document.querySelectorAll('.tab-bar button').length`)
    check('§sidepanel tab-bar renders (Chat/Sentences/Highlights/Vocab/More)', tabBtns >= 5, `tabs=${tabBtns}`)
```

- [ ] **Step 2: 更新 bilingual 按钮查找（仍在 header，不变，确认 title 选择器有效）**

179-180 行的 `header button[title*="bilingual" i]` 选择器仍有效（bilingual 按钮还在 header）。无需改动，跳过。

- [ ] **Step 3: 更新 Library 打开断言（先点 More 展开，再点 Library）**

定位 220-223 行：

```js
    // ---- §7 session library: after a chat, the Library drawer lists it ----
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('header button')].find(x=>(x.getAttribute('aria-label')||'')==='Library'); if(b){b.click(); return 'opened'} return 'no-btn'})()`)
    await sleep(400)
    check('§7 library drawer opens after a chat', await evalIn(page, `document.body.innerText.includes('Library')`))
```

替换为（Library 现在在 MoreMenu：先点 `.tab-bar` 的 More 按钮，再点 aria-label 为 Library 的项）：

```js
    // ---- §7 session library: open via More menu → Library (flat view) ----
    await evalIn(page, `(()=>{const more=[...document.querySelectorAll('.tab-bar button')].find(b=>/more/i.test(b.getAttribute('aria-label')||'')); if(!more) return 'no-more'; more.click(); return 'opened-more'})()`)
    await sleep(200)
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Library'); if(b){b.click(); return 'opened'} return 'no-btn'})()`)
    await sleep(400)
    check('§7 library view opens after a chat', await evalIn(page, `document.body.innerText.includes('Library')`))
```

- [ ] **Step 4: 新增 tab 切换断言（验证互斥视图）**

在 Library 断言之后（Step 3 替换块之后、`await cleanup()` 之前）新增：

```js
    // ---- tab switching is mutually exclusive (flat views) ----
    await evalIn(page, `(()=>{const b=[...document.querySelectorAll('.tab-bar button')].find(x=>(x.getAttribute('aria-label')||'')==='Sentences'); if(b){b.click(); return 'clicked'} return 'no-btn'})()`)
    await sleep(200)
    const sentencesActive = await evalIn(page, `!!document.querySelector('.tab-bar button[aria-label="Sentences"].tab-item-active')`)
    check('§tab: clicking Sentences activates its tab (flat, no overlay)', sentencesActive)
    // No z-40/z-50 overlay should exist when a tab is active.
    const overlayGone = await evalIn(page, `document.querySelectorAll('.absolute.inset-0').length === 0`)
    check('§tab: no absolute inset-0 overlay present (stacking eliminated)', overlayGone)
```

- [ ] **Step 5: 运行 e2e（需本地 Chrome；若无则跳过并在 commit message 注明）**

Run: `node tests/browser/run-sidepanel-e2e.mjs`
Expected: 全部 check 通过（`=== X/Y passed ===`，无 Failures）。若本地无 Chrome 或环境受限，至少跑 `npm run build:extension` 确认产物正确，并在提交信息注明 e2e 未本地验证。

- [ ] **Step 6: Commit**

```bash
git add tests/browser/run-sidepanel-e2e.mjs
git commit -m "test(e2e): update sidepanel header/tab selectors for flat view nav

- Header now holds Bilingual+Settings; tabs live in .tab-bar.
- Library opens via More menu (was a direct header button).
- Add assertions: Sentences tab activates; no absolute inset-0 overlay
  remains (stacking eliminated)."
```

---

## Task 10: 最终验证 + 手动冒烟清单

**Files:** 无修改（纯验证）

- [ ] **Step 1: 全量类型检查 + 单测 + 构建**

Run:
```bash
npm run typecheck
npm test
npm run build:extension
```
Expected: 三项全部成功退出码 0。

- [ ] **Step 2: 全局确认无残留遮罩/抽屉符号**

Run:
```bash
grep -nE "setShow(Settings|Library|Highlights|Vocab|Templates|Glossary|Sentences)|function Drawer\b|SettingsDrawer\b|VocabDrawer\b|TemplatesDrawer\b|GlossaryDrawer\b|SentencesDrawer\b|z-40|z-50" src/sidepanel/App.tsx
```
Expected: 无输出（`z-30` 的 MoreMenu 下拉是允许的，不在列表）。

- [ ] **Step 3: 手动冒烟（加载扩展到 Chrome，逐项确认）**

在 Chrome `chrome://extensions` 加载 `dist/`，打开侧边栏，确认：

- [ ] 默认显示 Chat 视图，TabBar 在 header 下方，Chat Tab 高亮
- [ ] 点 Sentences/Highlights/Vocab Tab → 视图切换，对应 Tab 高亮，**底下的聊天区被替换**（不叠加遮罩）
- [ ] 点 `⋯` More → 出现 Library/Glossary/Templates 三项；点 Library → 切到 Library 视图
- [ ] 点 header 设置图标 → 切到 Settings 视图（无居中弹窗、无遮罩）
- [ ] 模拟 API 报错（临时填错 key 发消息）→ 顶部出现红色 ErrorBanner，含"打开设置"和 X 关闭；点"打开设置"切到 Settings 视图并清除 banner
- [ ] 在 Sentences 视图展开卡片分析 → 举一反三例句出现；点"生成卡片" → 按钮变 spinner+"生成中…"；完成后新卡片出现在列表顶部
- [ ] 切换 en/zh locale → Tab/More/banner 文案正确切换
- [ ] 任意时刻浏览器 DevTools 元素面板看不到 `absolute inset-0 z-40`/`z-50` 的遮罩层

- [ ] **Step 4: 标记完成**

所有 spec 验证清单项（见 spec 文档末尾）逐条 ✅。若无新改动则无需提交；如有冒烟发现的微调，单独提交。

---

## Self-Review（计划作者已执行）

**1. Spec 覆盖检查：**
- ✅ 单一 activeView 取代 8 布尔 → Task 3
- ✅ 高频功能主 Tab → Task 4（TabBar）
- ✅ 低频功能进 MoreMenu → Task 4（MoreMenu 部分）
- ✅ 设置变 Tab → Task 5（SettingsView）+ Task 4（Settings 图标切视图）
- ✅ API 报错不再弹设置 → Task 3 Step 4 + Task 4（ErrorBanner）
- ✅ 举一反三 loading + 内联 → Task 8
- ✅ 业务逻辑零改动 → 全程不动 shared/content；Generate handler 复用 runSentenceAnalysis
- ✅ 改动文件范围（App.tsx/index.css/i18n/e2e）→ 与 spec「改造范围」一致
- ✅ 卡片折叠（缩进+左色条）→ 现有代码已用 `border-l-2 border-accent/40 pl-2.5`，Task 6/7 保留

**2. 占位符扫描：** 无 TBD/TODO；每步含具体代码或精确 grep 定位命令。Task 7 的"占位调用→Task 8 落实"是显式跨任务依赖，已标注预期中间态编译失败。

**3. 类型一致性：** `View` 类型在 Task 3 定义后，Task 4-7 全部用相同字面量值；`busyExample: string | null` 在 Task 8 定义，Task 7 Step 5/Task 8 Step 3 引用一致；`ViewShell`（Task 7 Step 6）在 7a/7b-e 引用一致；`SettingsView`/`VocabView` 等命名全文统一。

**4. 中间态编译失败说明：** Task 3-8 为原子重构，Task 3 结束即不可编译（JSX 残留旧 setter），直到 Task 8 Step 5 才恢复绿色，统一在 Task 8 Step 7 提交。这是有意设计——分任务提交会产生不可编译的中间 commit，违背 frequent-commits 的"可工作"前提。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-tab-navigation-redesign.md`.
