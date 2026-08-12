# Privacy Policy — Lector AI

**Last updated: August 12, 2026**

Lector AI ("the Extension", "we", "us") is a browser side-panel reading companion
that lets you chat with any page, translate bilingually, explain selections, and
learn vocabulary. This policy explains what data the Extension handles and how.

> 中文版见本页下半部分 / Chinese version below.

---

## English

### 1. The short version

- **We do not collect, sell, rent, or share your personal data.** There is no
  Lector server, no database, and no account system.
- **Your API key never leaves your browser** except to the AI provider *you*
  personally choose and configure.
- **Your requests go directly from your browser to your chosen AI provider.**
  We are not in the path; we do not proxy, log, or see them.
- **Everything the Extension stores — keys, conversations, vocabulary, cache,
  preferences — is kept locally** in your browser's `chrome.storage.local`.

### 2. Data we do NOT collect

The Extension does **not** collect or transmit to us (or any analytics,
advertising, or tracking service) any of the following:

- Personal identity information (name, email, phone, address)
- Authentication or account credentials (there are no accounts)
- Browsing history, search history, or lists of URLs you visit
- Precise or coarse geolocation
- Payment or financial data
- Biometric, health, or sensitive personal data
- Analytics, telemetry, crash statistics, or usage metrics

There is **no third-party analytics, advertising, or tracking SDK** in the
Extension. We have no backend that receives data from it.

### 3. Data stored locally on your device

The Extension uses the `storage` permission to keep data **on your device only**
in `chrome.storage.local`. None of this is transmitted to us. This includes:

| Data | Purpose |
|------|---------|
| Your AI provider settings & API key(s) | To call the provider **you** chose (BYOK) |
| Conversation history ("Reading library") | So you can revisit past chats |
| Vocabulary cards & glossary | For word/sentence learning and SRS review |
| Translation cache | To avoid re-translating identical content |
| UI preferences (theme, language, personas, per-site rules) | To remember your settings |

You can delete all of this at any time from the Extension's settings, by removing
the Extension, or via Chrome's *Clear browsing data → Cookies and other site data*.

### 4. Data sent to a third party — only the provider you choose

When you use a feature (chat with this page, translate, explain, summarize,
vocabulary generation), the Extension sends your **request** directly from your
browser to the **AI provider you personally selected and configured** (for example
OpenAI, Anthropic, OpenRouter, DeepSeek, Qwen, Zhipu, or any custom
OpenAI-compatible endpoint). This request may contain:

- The text content of the page you are reading, or the text you selected
- Your message / prompt
- Your API key (as authentication to **your** provider)
- Standard request metadata (model id, parameters)

**Important:** This data goes to the provider *you* chose, governed by *that*
provider's privacy policy — not to Lector AI. We do not see, store, route, or
log any of it, because there is no Lector server in the connection path. The
Extension instructs supporting providers not to retain your data for their own
later use (e.g. `store: false`).

### 5. Permissions and why each is required

| Permission | Why it is needed |
|-----------|------------------|
| `activeTab` / `tabs` | Read the title, URL, and main text of the page you are currently reading, for "chat with this page" and bilingual translation. |
| `storage` | Locally save your BYOK settings, reading library, vocabulary, and preferences on your device. |
| `contextMenus` | Right-click menu actions ("translate / explain / summarize with Lector AI") on selected text. |
| `sidePanel` | Show the Lector AI interface in the browser side panel. |
| Host permission `<all_urls>` | "Chat with this page" and inline bilingual translation must read the article content on whatever page you are reading. The Extension reads content **only on user action** on the active page; it does not read pages in the background. |

The Extension does **not** use the content it reads for any purpose other than
fulfilling the feature you invoked.

### 6. Children's privacy

The Extension is not directed to children under 13 (or the applicable age in your
jurisdiction) and we do not knowingly collect data from them.

### 7. International users

Because the Extension sends requests only to the provider *you* configure, any
cross-border transfer of your data is determined by your chosen provider and your
own configuration. We do not perform any transfer ourselves.

### 8. Changes to this policy

If we change this policy, we will update the "Last updated" date above and the
version in the Extension's store listing.

### 9. Contact

For privacy questions or requests, open an issue at
<https://github.com/kingsxiao/lector-ai/issues> or contact the developer email
listed on the Chrome Web Store listing.

---

## 中文版

### 1. 一句话版本

- **我们不收集、出售、出租或共享你的个人数据。** 没有 Lector 服务器、没有数据库、没有账号体系。
- **你的 API Key 永不离开浏览器**，唯一例外是发送给你**亲自选择并配置**的 AI 提供商。
- **请求从你的浏览器直达你选择的 AI 提供商。** 全程没有 Lector 服务器介入——不代理、不记录、不可见。
- **扩展存储的一切**——Key、对话、单词、缓存、偏好——都只保存在你的浏览器本地 `chrome.storage.local`。

### 2. 我们不收集的数据

扩展**不会**向你或任何分析、广告、追踪服务上传以下任何数据：

- 个人身份信息（姓名、邮箱、电话、地址）
- 登录或账号凭据（本扩展没有账号）
- 浏览历史、搜索历史或你访问的 URL 列表
- 精确或粗略的地理位置
- 支付或财务数据
- 生物特征、健康或敏感个人数据
- 分析、遥测、崩溃统计或使用指标

扩展中**没有**第三方分析、广告或追踪 SDK。我们没有接收其数据的后端。

### 3. 仅存储在本地的数据

扩展使用 `storage` 权限，将数据**只存放在你的设备**上的 `chrome.storage.local`，均不会上传给我们，包括：

| 数据 | 用途 |
|------|------|
| 你的 AI 提供商设置与 API Key | 调用**你**选择的提供商（BYOK） |
| 对话历史（「阅读库」） | 随时回看历史对话 |
| 单词卡片与术语表 | 用于单词/例句学习与间隔重复复习 |
| 翻译缓存 | 避免重复翻译相同内容 |
| 界面偏好（主题、语言、人设、站点规则） | 记住你的设置 |

你随时可在扩展设置中删除，或卸载扩展，或通过 Chrome 的「清除浏览数据 → Cookie 及其他网站数据」清除。

### 4. 发送给第三方的数据——仅限你选择的提供商

当你使用某项功能（与本页对话、翻译、释义、总结、生成单词卡）时，扩展会从你的浏览器直接把**请求**发送到**你亲自选择并配置的 AI 提供商**（如 OpenAI、Anthropic、OpenRouter、DeepSeek、通义千问、智谱，或任意自定义 OpenAI 兼容入口）。该请求可能包含：

- 你正在阅读的页面正文，或你选中的文本
- 你的消息 / 提示词
- 你的 API Key（用于向**你的**提供商鉴权）
- 标准请求元数据（模型 id、参数等）

**重要：** 这些数据发送给**你**选择的提供商，受**该提供商**的隐私政策约束，而非 Lector AI。我们不会查看、存储、转发或记录其中任何内容，因为连接路径中不存在 Lector 服务器。对于支持的提供商，扩展会要求其不要为后续使用留存你的数据（如 `store: false`）。

### 5. 各权限及其必要性

| 权限 | 为什么需要 |
|------|-----------|
| `activeTab` / `tabs` | 获取你当前阅读页面的标题、URL 与正文，用于「与本页对话」和双语翻译。 |
| `storage` | 在你的设备本地保存 BYOK 设置、阅读库、单词卡片与偏好。 |
| `contextMenus` | 右键菜单：「用 Lector AI 翻译 / 释义 / 总结」所选文本。 |
| `sidePanel` | 在浏览器侧边栏承载 Lector AI 界面。 |
| 主机权限 `<all_urls>` | 「与本页对话」与段内双语翻译需要读取你正在阅读的任意页面的正文。扩展**仅在你主动操作时**读取当前活动页面，不会后台抓取页面。 |

扩展读取的内容**仅用于**你当时触发的功能，不用于任何其他目的。

### 6. 儿童隐私

本扩展不面向 13 岁以下（或你所在司法管辖区适用的年龄）儿童，也不会有意收集其数据。

### 7. 国际用户

由于扩展只向你**自行配置**的提供商发送请求，任何数据跨境传输均由你选择的提供商与你的配置决定。我们自身不进行任何传输。

### 8. 政策变更

若本政策发生变更，我们将更新上方「最后更新」日期，以及商店上架资料中的版本。

### 9. 联系方式

如有隐私问题或请求，请在 <https://github.com/kingsxiao/lector-ai/issues> 提交 issue，或联系 Chrome 应用商店商品页所列的开发者邮箱。
