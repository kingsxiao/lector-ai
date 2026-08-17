# Lector AI 全面样式排版优化 — 设计文档

**日期**: 2026-08-17 · **状态**: 待用户预览决策 · **主题**: 「精装手稿」设计系统 v2

## 0. 决策方式（用户指定）

用户要求：全面优化插件样式排版、要有设计感、**预览后决定**。
因此本次改动全部保留在工作区（不提交），完成后生成 before/after 预览交用户决策；
用户不满意可 `git checkout -- .` 一键回滚。

## 1. 现状审计结论（截图 + 设计师视角分析）

保留的资产：暖纸编辑风（米白+赭棕+衬线标题）与阅读产品定位高度契合，是差异化优势。

执行短板（按严重度）：
1. **表面层级发糊** — bg `#FBF8F2` / 卡片 `#F8F0E2` / chip `#FDFBF7` 明度几乎相同，1px 描边不可见，容器浮不起来
2. **排版层级弱** — 字号阶梯 10/11/13/15/18 差距不足；衬线体使用位置不连贯（有的标题衬线有的不衬线）
3. **列表符号丢失** — Tailwind preflight 重置了 `list-style`，AI 回复的 Markdown 列表无 bullet，识别度差
4. **红色 `!` 徽章刺眼** — 句库/生词 tab 的复习提醒用 danger 红色，与安静暖调冲突、语义过重
5. **空态排版失衡** — 内容堆在上 2/3、底部 200px 死白、建议 chips 被输入区裁切
6. **引导噪音冗余** — "去设置加 Key" 在页头副标题/横幅/居中 CTA/输入框占位符四处重复
7. **设置页"一泻到底"** — 21 个服务商按钮平铺无分组容器；标签与控件间距无节奏；emoji 当分区图标与线性图标体系不符
8. **禁用态不一致** — 发送按钮禁用时仍近品牌色；chips 禁用文字几乎不可读
9. **滚动条粗重** — 8px 深棕实心，视觉存在感过强
10. **content 弹窗冷色残留** — 关闭按钮用冷灰蓝 `#f1f5f9/#94a3b8`，破坏暖调一致性

## 2. 设计方向：「精装手稿」

从"草稿纸"升级为"精装书"。不换风格基因，换执行精度：
- **对比更强**的表面分层（纸底更深、卡面纯白、描边可见）
- **更清晰的字阶**与固定的衬线使用规则
- **有语义的细节**（状态点、琥珀色复习提醒、eyebrow 小节标题）
- 所有改动落在 token 层，content script 同步对齐色值

## 3. Token 层变更（src/styles/tokens.css）

| Token | 旧 | 新 | 理由 |
|---|---|---|---|
| `--bg` | #FBF8F2 | #F5EFE3 | 纸底加深一档，让白色卡面浮起 |
| `--surface` | #FFFFFF | #FFFFFF | 不变（纯白卡面） |
| `--surface-muted` | #F5EFE3 | #F1E9D8 | 拉开与 bg 的差 |
| `--surface-sunken` | #F1E9D8 | #EBE0C9 | 内陷面更深 |
| `--line` | #E8DECC | #E2D5BB | 描边可见 |
| `--line-strong` | #D9CBB0 | #C9B893 | 更明确的分隔 |
| `--ink` | #2B2620 | #26211B | 略深 |
| `--ink-soft` | #6B6155 | #5C5347 | 正文次级对比 ↑（bg 上 ~7:1） |
| `--accent` | #9C6B3C | #8F5E30 | 略深，白字对比 ↑（≥4.5:1） |
| `--accent-hover` | #875A2F | #7A4E27 | 同步加深 |
| `--on-accent` | #FFF8EE | #FFF6EA | 不变 |
| `--warn` | #B07D2B | #A8761F | 用作"待复习"琥珀点 |

新增：`--t-xl: 22px`（空态主标题/视图标题）、`--track-wide: 0.08em`（eyebrow）、
`--shadow-*` 微调更暖更轻、`--r` 体系不变（已统一）。

## 4. 排版规则（固定）

- **衬线体只用于**：应用名、视图大标题、空态主标题、AI 回复的 Markdown 标题、
  词汇单词本体、统计数字 — "内容性文字"
- **无衬线用于**：一切 UI 控件、标签、按钮、正文说明 — "操作性文字"
- 空态主标题 22px/650/`-0.015em`；eyebrow 小节标题 10px/600/大写/`0.08em`
- 正文行高 1.6→1.65；prose 行高 1.65→1.7

## 5. 组件层变更

### sidepanel（App.tsx + index.css + views）
1. **Header**: 副标题前加状态点（无 Key=琥珀、就绪=绿），信息即装饰
2. **TabBar**: active pill 用 `--accent-soft`（更深一档）+ semibold；**红色 `!` 徽章 → 琥珀色圆点**（`--warn`），语义=待复习，视觉=温和
3. **聊天**: AI 消息加 20px 衬线 "L" 头像 chip（品牌锚点+左右视觉平衡）；用户气泡 max-w 85%→80%
4. **Prose**: 修复 `ul/ol` 列表符号（preflight 重置问题，`list-style: disc/decimal` + accent marker）；标题/代码块/引用间距节奏统一
5. **空态**: 垂直居中（`h-full flex flex-col justify-center`），chips 区留出底部安全距离；建议 chips 改为带左边 accent 细线的卡片式
6. **BYOK 横幅**: 可关闭（X 按钮，session 内记住）；key emoji → 线性钥匙图标风格化处理
7. **Composer**: 发送按钮禁用态明确去饱和；禁用时不显示快捷键提示
8. **设置页**: 分组卡片化（`bg-surface border rounded-xl p-4`）+ eyebrow 小节标题；服务商网格选中态=accent 边+浅底+左上角小勾；语言三选一改为连体分段控件
9. **列表行**: 内边距 ↑（px-3.5→px-4, py-2→py-3）、hover 暖色、词汇单词用衬线 15px
10. **SRS 评分按钮**: 语义着色（again=红调/hard=暖灰/good=棕/easy=绿调）软底填充
11. **StatsBar**: 数字衬线加大、分隔线减淡
12. **滚动条**: 8px→6px、透明轨道、thumb 半透明 line-strong、hover 才实

### content script（content.ts / content.css）
13. 弹窗关闭按钮冷灰蓝 → 暖调（`#F1E9D8` 底 + `#7A6E5C` 字）
14. 边框/滚动条色值对齐新 token（#E8DECC→#E2D5BB 等）
15. FAB/径向菜单/双语块色调不变（已达标）

### 启动屏（index.html）
16. boot shell 硬编码色同步新 token

## 6. 不做的事（YAGNI）

- ~~不引入暗色模式（独立大工程，另行立项）~~ → 已在 v2.1 补齐（见下）
- 不换图标库/加图标字体（现线性图标质量已达标）
- 不动信息架构/导航结构（本次纯视觉层）
- 不加 CSS-in-JS/组件库（维持 token + tailwind 体系）

## 6a. v2.1 追加（用户"采用"后要求全部处理完）

### 暗色模式 ——「烛下手稿」

- **机制**：tokens.css 增加 `:root.dark` 块整体翻转全部 token（暖棕深色系，
  `color-scheme: dark` 让原生控件/滚动条跟随）；App 按 `settings.theme`
  （'auto' | 'light' | 'dark'，默认 auto 跟随 prefers-color-scheme 且
  live 跟随系统切换）在 `<html>` 上挂 `.dark`。组件零分叉。
- **存储**：`ByokSettings.theme`（optional，undefined=auto），
  `normalizeByokSettings` 负责解析/兜底（曾漏掉导致暗色不生效，已修）。
- **设置入口**：设置页语言卡片内新增"外观"连体分段控件（auto/浅色/深色）。
- **暗色专调**：accent 反转为高亮度焦糖 + on-accent 深字（按钮倒置）；
  POS 词性标签/代码块/due 徽章暗色变体；ErrorBoundary 崩溃屏改为
  自包含纸卡（不依赖主题变量，防主题未应用时不可读）；启动屏 boot shell
  按 prefers-color-scheme 出暗色（React 挂载后由设置收编）。

### Tailwind var 色透明度修饰符修复

`border-line/60` 一类 /N 修饰符对 `var(--x)` 色值无效，会静默回退到
浏览器默认边框色（暗色下是刺眼冷白 #e5e7eb）。修复：每个颜色 token
增加 RGB 通道三元组 `--x-rgb`，tailwind.config 改走
`rgb(var(--x-rgb) / <alpha-value>)`。全代码库 28 处修饰符用法一并修复
（顺带让此前从未生效的 `bg-danger-soft/60` 等真正渲染）。

### 其它

- 服务商网格去重：`custom` 是 `openrouter-custom` 的存储兼容别名，
  从网格隐藏；存量 `provider:'custom'` 的选中态映射到 openrouter-custom。
- 聊天输入框占位符补 `placeholder:text-ink-faint`（原先为浏览器默认冷灰）。
- 暗色下次级文字 `--ink-soft` 提亮一档（#B5A88F→#BFB299）。

## 7. 验证

- `npm run typecheck` + `npm test`（536/536，类名不变）
- `npm run build:extension` 产物校验 + 真机 sidepanel E2E 22/22
- 浏览器实截 before/after/after-dark 各视图对比图（preview/，gitignored）
