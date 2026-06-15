# Lector AI — Competitive Upgrade Design

**Date:** 2026-06-15
**Status:** Implemented (build green, type-check clean)

## Context

Lector AI shipped as an MVP: a popup with summarize/translate, a selection
toolbar, and scaffolded (but non-functional) Supabase auth + LemonSqueezy
payments. This upgrade closes the gaps that block a competitive launch and
adds two differentiators.

## Competitive gaps addressed

| Gap vs. Monica / Sider / Glasp / Immersive Translate | Fix |
| --- | --- |
| No persistent surface (popup disappears) | **Side panel** that stays open while you read |
| No "chat with this page" | **Chat-with-page** with streamed replies + carried history |
| Plain-text output | **Markdown rendering** (dependency-free renderer) |
| Trivially bypassed client-side quota | **Server-side rate limiting** (per-user + per-IP, DB-backed) |
| Payments never actually grant Pro | **Webhook → DB persistence**; `/auth/me` reads Pro from DB |
| No history | **Reading library** (local, persisted sessions) |
| No immersive translation | **Inline bilingual paragraph translation** |

## Architecture

### Backend (Vercel serverless)

- `api/_lib/supabase.ts` — raw `fetch` to the Supabase REST API (PostgREST +
  GoTrue). **No `@supabase/supabase-js` dependency** — keeps cold start fast
  and the dep tree tiny. Functions: `getUserIdFromToken`, `getUserEmail`,
  `getSubscription`, `isProUser`, `upsertSubscription`, `bumpUserUsage`,
  `readUserUsage`, `bumpAnonUsage`, `readAnonUsage`.
- `api/_lib/ratelimit.ts` — `checkRateLimit(headers, accessToken, cost)`.
  Pro users bypass; authenticated users get `FREE_DAILY_LIMIT` (20); anon
  users get `ANON_DAILY_LIMIT` (5), keyed by IP. Degrades to "allowed" when
  Supabase isn't configured (local dev).
- `api/_lib/openrouter.ts` — adds `streamChat()` (SSE) alongside the existing
  non-streaming `callOpenRouter()`.
- `api/chat/index.ts` — **new**. Streaming SSE endpoint. System prompt embeds
  cleaned page content + metadata so the assistant reasons about the article
  the user is reading. Emits `meta` → `token`* → `done`/`error`.
- `api/summarize/index.ts` — adds `style` (`brief|detailed|tldr`), rate
  limiting, Markdown output, and an optional `remaining` echo.
- `api/translate/index.ts` — rate limiting + optional `bilingual` flag.
- `api/webhook/lemonsqueezy.ts` — **fixed**. Verifies signature, reads
  `user_id` from `custom_data`, upserts the `subscriptions` row (was: only
  `console.log`).
- `api/auth/me.ts` — **fixed**. Reads Pro status from our `subscriptions`
  table (was: queried LemonSqueezy by Supabase user id, which never matched).
- `api/subscription/create.ts` — embeds `user_id` in `checkout_data.custom`
  so the webhook can link the payment to the user.

### Database

`db/schema.sql` — three tables with RLS:

- `subscriptions(user_id pk, status, lemonsqueezy_id, variant_id, renews_at, ends_at)`
- `usage_daily(user_id, day, count)` — per-user daily counter
- `anon_usage(anon_id, day, count)` — per-IP daily counter

Run in the Supabase SQL editor. Code degrades gracefully when these don't
exist yet (local dev returns unlimited).

### Extension frontend

- **Side panel** (`src/sidepanel/`): React + Tailwind. Chat UI with streamed
  Markdown replies, suggestion chips, reading library drawer, auth modal.
  Pulls page context from the content script via `lector-get-page`.
- **Content script** (`src/content.ts`):
  - Clean page extraction (`extractPage()`): scores candidate containers,
    strips nav/footer/ads, preserves paragraph structure. Replaces the old
    "refetch URL + regex-strip HTML" approach (which lost paywalled /
    JS-rendered content).
  - Selection toolbar now has 翻译 / 解释 / 摘要 / 提问.
  - Floating "L" button opens the side panel.
  - `lector-toggle-bilingual` action for inline bilingual paragraph
    translation.
- **Background worker** (`src/background.ts`): opens the side panel on
  demand, forwards selection seeds, handles the explain action by reading the
  chat SSE stream.
- **Manifest** (`src/manifest.json`): v0.2.0, adds `sidePanel` + `tabs`
  permissions, registers `side_panel.default_path`.

## Security notes

- Service-role key is server-side only; never shipped to the client.
- Webhook verifies HMAC-SHA256 signature with `timingSafeEqual`.
- Markdown renderer escapes all input before applying its own tags (no raw
  HTML, no `dangerouslySetInnerHTML` of unescaped content).
- Rate limiting is server-side; the client counter is a UI hint only.

## Launch readiness checklist

- [x] Build green (`npm run build:extension`)
- [x] Type-check clean (`tsc --noEmit`)
- [x] dist layout matches manifest references
- [x] Streaming chat endpoint
- [x] Server-side rate limiting (DB-backed, degrades gracefully)
- [x] Webhook persists Pro status; `/auth/me` reads it
- [x] Side panel + chat-with-page + Markdown
- [x] Reading library (local persistence)
- [x] Inline bilingual translation
- [ ] Operator steps before public release: set `OPENROUTER_API_KEY`,
      `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, LemonSqueezy vars in Vercel;
      run `db/schema.sql` in Supabase; create a Pro variant in LemonSqueezy
      and set `LEMONSQUEEZY_VARIANT_ID`; publish to the Chrome Web Store.
