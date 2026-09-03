# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Lector AI 是一个 **Chrome 扩展（Manifest V3）**——**纯客户端、BYOK（Bring Your Own Key）**。扩展读取当前页面，提供 AI 辅助阅读：与页面对话（SSE 流式）、摘要、翻译、沉浸式双语翻译，外加三个离线"知识"功能——引用溯源阅读、高亮→导出、SM-2 词汇本间隔重复。

**没有后端、没有数据库、没有账号。** 用户在扩展设置里填自己的 provider key（OpenAI / Anthropic / OpenRouter / DeepSeek / Groq / 任意 OpenAI 兼容入口……），密钥存在 `chrome.storage.local`，请求从浏览器**直接**发往用户选择的 provider——绝不经过我们。所有 AI 调用都在客户端（sidepanel 或 content script）发起。

## 常用命令

> ⚠️ **`NODE_ENV` 陷阱（务必先读）：** 本机 shell 以 `NODE_ENV=production` 运行，会让 `npm` 跳过 `devDependencies`（vitest、jsdom、typescript、vite、playwright 全在这里）。**所有** install/test/build 都要前置 `NODE_ENV=development`，例如 `NODE_ENV=development npm install`。否则 `vitest`/`vite` 根本解析不到。

| 任务 | 命令 |
|------|---------|
| 类型检查 | `npm run typecheck`（或 `NODE_ENV=development node_modules/.bin/tsc --noEmit`） |
| 构建扩展 | `NODE_ENV=development npm run build:extension` |
| Web 开发（sidepanel HTML） | `npm run dev` |
| 扩展监听器（按 `r` 重建） | `NODE_ENV=development npm run dev:extension` |
| 单元/集成测试 | `NODE_ENV=development npm test` |
| 监听模式测试 | `NODE_ENV=development npm run test:watch` |
| 跑单个测试文件/名称 | `NODE_ENV=development node_modules/.bin/vitest run <pattern>` |
| 真机浏览器 E2E | `NODE_ENV=development npm run build:extension && npm run test:browser` |

构建产物是 `dist/`——通过 `chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序` 加载。`build:extension` 先跑 `vite build`（sidepanel + background 两个 ES 入口），再用独立配置 `vite.content.config.ts` 把 content script 重新打成**单个自包含 IIFE 包**（MV3 content script 不能是 ES module），接着把 sidepanel 的应用 CSS **内联进面板 HTML**（Chrome 侧栏要等所有 render-blocking 资源加载完才首绘——chromium 40915514；外链样式表一旦加载停滞，面板就纯白卡住，连 HTML 内联的 boot 壳都画不出来；内联后首绘只依赖 HTML 自身。MV3 CSP 禁内联 `<script>` 但允许内联 `<style>`），最后把 `manifest.json`/icons/`content.css` 拷进 `dist/` 根、把 sidepanel HTML 挪到根（见 `scripts/build-extension.mjs`）。构建末尾还会自动产出**根目录的 `dist.zip`**（Chrome 应用商店上传用）：zip 的是 `dist/` 的**内容**而非 `dist` 文件夹本身——商店要求 `manifest.json` 位于 zip 根目录，0.4.0 曾因嵌套 `dist/` 的 zip 被拒（"未提供所承诺的功能"）。脚本打包后会自检（manifest 在根、无 `dist/` 前缀、无 `.DS_Store`/`__MACOSX`、manifest 引用的文件都在包内），失败即 `exit 1`。

## 架构

### 纯逻辑 / DOM 分层（核心设计规则）

可复用的领域逻辑放在 **`src/shared/*.ts`**，是**零 DOM、零依赖的纯模块**，每个都配一个 vitest 测试：

- `citations.ts`——`[bN]`/`[N]` 引用的解析 / 渲染 / 跳转白名单
- `srs.ts`——SM-2 间隔重复调度器
- `highlights.ts`——高亮类型 + 去重 / 分组 / 搜索
- `vocabulary.ts`——词条类型 + 校验 / 合并 / 创建
- `exporters.ts`——Markdown/Obsidian/Notion 导出 Provider
- `promptTemplates.ts`——"/" 菜单模板的填充 / 过滤 / 校验
- `i18n.ts`——`StringKey` 强类型的双语（en/zh）字符串表
- `providers.ts`——19 家 provider 预设（baseUrl / modelsPath / 默认模型）+ `ByokSettings`
- `byok.ts`——**唯一的 AI 客户端**。`streamChat`（SSE 流式）、`completeOnce`（非流式包装）、`fetchModels`（一键拉取 `/models`）、`testConnection`、`getSettings`/`saveSettings`（读写 `chrome.storage.local`）
- `radialMenu.ts`——FAB 径向菜单的纯三角几何（`fanOutPositions`）
- `color.ts`——`parseCssRgb` + `relativeLuminance`（content script 暗/亮玻璃判定用）
- `readability.ts`——`scoreNodeFromStats` + `NOISE_SELECTORS`（页面抽取打分，纯函数版）
- `siteRules.ts`（扩展）——除原有 `matchHost`/`findRuleForHost`/`shouldAutoTranslatePage` 外，还持有 `INPUT_BLACKLIST` + `inputBoxDisabledForHost`（用 `matchHost` 做主机后缀匹配，**不是** `includes` 子串匹配）
- `dictionary.ts`——查词卡片纯逻辑：`isWordLookupQuery`（选区是否单词/短语，句末标点与 >3 词排除）、`buildDictionarySystemPrompt`/`buildDictionaryUserPrompt`（严格 JSON 词典输出，释义/例句译文必须用目标语言）、`parseDictionaryCard`（容忍 markdown 围栏与前后杂文，无可用义项返回 null 让调用方回退整句翻译弹窗）

这些被 DOM/UI 层（`content.ts`、`sidepanel/*`、`background.ts`）消费。**禁止在 `src/shared/` 里 import DOM API 或 Chrome API**——正是这条边界让逻辑能在 jsdom 里做单元测试。新增领域逻辑先以纯函数形式落在这里。`content.ts` 里曾经内联的纯逻辑（脚本检测、抽取打分、径向几何、颜色阈值）已全部迁出，content.ts 现在只是"DOM 粘合层"。

### 扩展各面（`src/`）

- `background.ts`——MV3 service worker。职责（BYOK 下刻意最小）：右键菜单（标题按存储的语言偏好 i18n）、键盘命令（`Alt+H` 高亮、`Alt+S` 存词）转发给 content script、打开 side panel，以及**知识采集中继**（content script → `chrome.storage.local` 队列 `lectorHighlights`/`lectorVocab` → sidepanel 抽干并入 zustand）。存词时用用户自己的 key 调一次翻译（BYOK）。
- `content.ts`——注入到所有页面（单个 IIFE 包）。页面抽取（迷你 Readability 式打分器，挑文字最密集的文章容器并剥离噪声）、选择工具栏（翻译/解释/摘要/提问/高亮/存词）、悬浮 FAB、内联双语翻译（逐段，best-effort，首个错误回报给 sidepanel）。给 live DOM 节点打 `data-lector-id="bN"` 标签，让引用能跳回原处。**纯逻辑已全部迁出到 `src/shared/`**；content.ts 内部统一了若干 helper：`requireApiKey`（集中 3 处 no-key UX）、`clearPopups`（集中 3 处 popup 清场）、`isLectorUiTarget` + `LECTOR_UI_SELECTOR`（集中 3 处"点击是否落在自己 UI 上"判定）、`SUMMARIZE_SYSTEM_PROMPT`（共享摘要 prompt）、`tryOpenSidePanel`/`tryOpenSidePanelWithSeed`（用 try/catch 包裹 `sendMessage`，捕获 orphaned content script 的同步 "Extension context invalidated" 抛错——裸 `.catch()` 抓不到）、`safeRuntimeSend`（所有 fire-and-forget 中继——进度/历史/错误回报——都必须走它：扩展重载后旧标签页里的 content script 变孤儿，`chrome.runtime.id` 为 undefined 且 `sendMessage` **同步**抛错，裸 `.catch()` 抓不到，逃出 async 函数就是 uncaught promise rejection）。
- `sidepanel/`——主 React 界面（对话、会话库、高亮抽屉、词汇 SRS 抽屉、模板抽屉、BYOK 设置）。目录拆分（god-component 已拆解）：
  - `App.tsx`——路由/shell（header + tabbar + activeView 路由到各视图 + chat 子系统）。原来 ~3400 行，现在 ~1600 行。
  - `views/`——各全屏视图：`VocabView`、`TemplatesView`、`GlossaryView`、`SentencesView`、`SettingsView`（含 `LanguageSelect`/`CacheControls`/`SiteRulesControls`/`CurrentSiteChip`）。每个视图是 props 驱动的纯组件，单消费者状态（如 `revealedVocab`/`revealedSentences`）已下沉到对应视图而非 App。
  - `components/`——`Primitives.tsx`（`<Row>`/`<IconButton>`/`StatsCell`）、`leaf.tsx`（`ViewShell`/`Empty`/`SrsGradeButtons`/`StatsBar`）。
  - `lib/`——`downloads.ts`（`downloadBlob`/`readJsonFile`）、`chromeUtils.ts`（`jumpToBlock`/`useCurrentHost`）、`ankiFormat.ts`（`formatAnkiResult`）、`sentences.ts`（`runSentenceAnalysis`——sidepanel 侧的句子编排，依赖 store + byok，**不是** shared 纯模块）。
  - `markdown.ts`——Markdown→HTML 渲染（`renderMarkdown`），引用角标由 `renderCitations` 叠加，角标点击通过 `jumpToBlock` 跳回页面原块。
- `manifest.json`——MV3，v0.3.0，`sidePanel` + `activeTab` + `storage` + `contextMenus` + `<all_urls>` host（`minimum_chrome_version` 114，WAR 带 `use_dynamic_url`）。`action.default_icon` 指向 `icons/`。

### 状态与存储

- **Zustand store**（`src/shared/store.ts`）配 `persist` 中间件 → `localStorage`（`lector-ai-storage`）。持有 BYOK 设置、用量提示、对话会话、高亮、词汇、模板。
- **知识同步是队列式，不是共享 store：** content script 无法直接碰 zustand，所以它 `sendMessage` 给 background worker，后者把 `lectorHighlights`/`lectorVocab` 写入 `chrome.storage.local`；sidepanel 监听 `chrome.storage.onChanged`，合并进 zustand（去重、保留 SRS 进度），然后抽干队列。新增"采集物"时务必沿用这个中继模式。
- **BYOK 设置双写：** zustand（UI 用）+ `chrome.storage.local.lector_byok_settings`（content/background 读）。sidepanel 启动时从 storage 拉一次同步进 zustand；设置改动时 `saveSettings` 写回 storage（注意从 `useStore.getState()` 读最新值，避免闭包陈旧）。

### BYOK / SSE 协议

所有 AI 调用走 `src/shared/byok.ts`。两种 wire format：
- **openai**：`POST {baseUrl}/chat/completions`，`stream:true`，解析 `data:` 行里的 `choices[0].delta.content`（OpenAI / OpenRouter / DeepSeek / Groq / 自定义兼容入口）。
- **anthropic**：`POST {baseUrl}/v1/messages`，`stream:true`，system 单独传，解析 `content_block_delta` 里的 `delta.text`。

`readSSE` 把 SSE 字节流按 `\n` 切行、`data:` 取载荷、`[DONE]` 结束，跨 chunk 的半截 JSON 靠 try/catch + 下一轮补全。`streamChat(onToken)` 把增量回调给 UI 做流式渲染；`completeOnce` 是它的非流式包装（translate/summarize/explain/testConnection 用）。

引用溯源：content script 抽取的块带 `b0/b1/…` id；sidepanel 的系统提示把块编号成 `[0] [1] …`，要求模型只引用这些编号；`renderCitations` 把 `[N]`/`[bN]` 角标白名单限制在当前页的块 id（`b${N}`），点击发 `lector-jump-to` 消息让 content script 滚动到对应 `data-lector-id` 节点（每次 `extractPage` 重打标签前先清掉全文档旧标签，SPA 路由切换后不会跳到旧文章的节点）。

### 整页双语翻译管线（content.ts `runBilingualTranslation`）

- **toggle 语义（沉浸式翻译式）：** `lector-toggle-bilingual`（Alt+A / FAB 首项 / 侧栏按钮）是真正的开关——页面已有译文且无 run 进行中时再触发 = `restorePageTranslations()`（还原整页、清理 body 展示类、释放侧栏 busy、发「已恢复原文」toast）。还原是**全局清理**（所有 `.lector-bilingual` / source 包裹 / host 类），不是逐 host 的 `:scope >` 走查——页面脚本（如高亮 `<mark>`）会把译文 span 重新挂父节点，`:scope` 走查会漏掉它们，导致 `pageHasTranslations()` 永真、后续 toggle 永远走还原分支。E2E 各 §9 子测试自行清理 DOM 时同样必须全局清理。
- **页内状态浮条（`.lector-tstatus`）：** 翻译运行时页面上有独立于侧栏的进度 UI——运行中「正在翻译 N/M + 进度条 + 取消」（250ms 节流、原位更新避免重启动画）、完成「✓ 已翻译 N 段 + 显示原文 + 显示模式切换」6s 自动收起、失败「⚠ + 原因」9s。FAB 同步加 `is-translating`（字母隐藏、spinner 环）。侧栏关闭时（FAB/Alt+A 触发的常见态）不再黑盒。
- **显示模式页内切换：** FAB 径向菜单与完成态浮条都能循环 双语→仅译文→hover；持久化走 background 的 `lector-set-translation-display-mode`（读改写 `lector_byok_settings` + 广播 `lector-translation-settings-changed`，与 `lector-set-translation-target` 同模式；侧栏监听 storage 变化同步 zustand，不会回写覆盖）。
- **控制器先行：** run 在任何 `await` 之前同步创建并持有 `AbortController`（赋给模块级 `bilingualAbort`），设置尚未加载完就取消也能命中本次 run。
- **探测优先（probe-first）：** 先只翻译第一个候选块。质量重试仍失败（`TranslationQualityError`）→ 发一条 `bilingual.probeFailed` 并停止整页（其余块不变成 host、零请求）；探测成功 → 该块保留译文（不重复请求），其余块并发。单块页面 = 探测 = 唯一一次付费请求。
- **结构化翻译请求：** 每块 user turn 走 `buildTranslateUserPrompt(text, target, strictRetry)`——目标语言在 user turn 重复一遍（兼容弱化 system 角色的入口），页面文本包成 `SOURCE_JSON:` JSON 字符串字面量（页面内容永远不可能注入指令）。
- **取消语义：** `lector-cancel-bilingual` 打 `canceled: true` 结构化标志（不要用消息文本判断取消——"stopped" 是合法错误文案）；run 在 finally 里恢复本次触碰过的所有块（拆掉译文/解包 source 标记/去 host 类），晚到的普通错误不再覆盖取消提示；run 结束不发多余的 complete。
- **run-active：** run 进行中 `body.lector-bilingual-run-active` 隐藏所有块级 Retry/Copy（CSS `!important`），防止与 run 抢块所有权；错误块的 Retry 按钮常显（`.lector-bilingual.is-error .lector-bi-actions`），Copy 隐藏。
- **同脚本语言对（如 西→英）：** 纯脚本/相似度判不出"已翻译 vs 换说法"，输入侧（候选过滤）与输出侧（质量门）都用 `chrome.i18n.detectLanguage` 异步判定；检测 await 之后必须复查 `signal.aborted` 再写 DOM/缓存。
- **失败块可重入：** `.lector-bilingual-host:not(.lector-translation-error)` 只排除成功 host；错误 host 留在候选里，新 run / 手动 Retry 都能重译。run 启动时还会"复活"已失效的错误 host（挪进 no-translate 区域 / 识别为仓库标题的），零请求清理。
- **手动 Retry 保持整页目标语言：** 块级重试用的是 run 解析出的页面级 `target`，不会对孤立块重新检测方向。

### 后台词汇/句卡中继（先落库再富化）

`handleSaveWordRelay` / `handleExplainSentenceRelay` 先**立即**把词条/句卡（空翻译/空分析）写入 storage 队列，AI 调用完成后再按 id 回填富化——MV3 service worker 约 30 秒闲置回收，60 秒超时的慢请求不再连带丢失用户采集的内容。回填只填空字段，不覆盖并发写入的新值。

## 测试

- **vitest + jsdom**，`tests/**/*.test.{ts,tsx}`。配置：`vitest.config.ts`，`globals: false`，`setupFiles: ['tests/setup-env.ts']`。
- BYOK 后无后端，`tests/setup-env.ts` 已无环境变量要设（保留为空占位）。shared 纯逻辑模块零副作用，直接 import 测。
- `tests/content.test.ts` / `tests/extract.test.ts` import `src/content.ts`（它在 import 期注入样式并 console.log），在 jsdom 里跑抽取/工具栏逻辑。
- **`tests/browser/*.mjs`** 是真机浏览器 E2E（Playwright 驱动 macOS 上路径硬编码的真实 Chrome），用 mock 后端伺服真实 `dist/` 产物——**先跑 `build:extension`**。可只跑子集：`npm run test:browser:{content,sidepanel,background}`。
- `build:extension` 组装完会校验 manifest 引用的每个文件都存在于 `dist/`（content.js/background.js/sidepanel HTML/icons），缺失即 `exit 1`——半个构建不会假报成功。

## 易踩坑点

- **shell 里 `NODE_ENV=production`** 会搞坏开发工具链——见上方命令说明。
- **content script 必须是单个 IIFE 包**——`vite.content.config.ts` 用 `inlineDynamicImports` 把 byok/i18n 全内联进 `content.js`，不能有 chunk import 或 dynamic import（MV3 content_scripts 不支持 `type:"module"`）。
- **provider 列表是预设兜底**——真正的模型列表由用户点"拉取模型列表"实时 `GET {baseUrl}/models` 获取；`providers.ts` 里的 `models` 只是 fetch 失败前的占位。
- `tsconfig.json` 的 `include` 只有 `src`（`noEmit`）；打包是 Vite 的活。测试文件由 vitest 自己的 `include` 覆盖。
