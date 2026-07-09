# Lector AI — BYOK Redesign

**Date:** 2026-06-15
**Status:** Implemented (build green, type-check clean)
**Supersedes:** the backend/auth/payment design in this same folder.

## Decision

Drop the backend, auth, and payment tiers entirely. Ship a **BYOK (Bring Your
Own Key)** model: the user supplies their own AI provider key, stored locally,
and the extension calls the provider directly.

**Why:** simpler to ship, cheaper to run (zero hosting cost), stronger privacy
story ("your key never leaves your browser"), and a cleaner market position
("free extension, you pay your AI provider directly") than a yet-another-$9/mo
subscription. This also removed two launch-blocking bugs in the prior payment
flow (webhook persistence, `/auth/me` Pro resolution).

## Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                 │
│  Side panel (React) ──┐                                         │
│                       ├── shared/byok.ts ──fetch──►  Provider   │
│  Content script ──────┘            ▲                  (OpenAI / │
│                                    │                   Anthropic│
│  key stored in chrome.storage.local│                   / OR /   │
│             (byok.ts getSettings)  │                   Custom)  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

No backend. No database. No accounts.

### Kept from the prior competitive upgrade
- Side panel + **chat-with-page** + **streamed Markdown**
- Clean page **extraction** in the content script
- **Reading library** (local sessions)
- **Inline bilingual** paragraph translation
- Selection toolbar (translate / explain / summarize / ask)
- Dependency-free Markdown renderer

### Removed
- `api/` (all Vercel serverless functions: chat, summarize, translate, auth,
  subscription, webhook)
- Supabase + LemonSqueezy integrations
- `db/schema.sql`
- Popup (the action icon now opens the side panel directly)
- `vercel.json`, `@vercel/node`, `.env` provider keys

### New / changed

- `src/shared/providers.ts` — provider definitions (OpenAI, Anthropic,
  OpenRouter, Custom) with default model lists and base URLs. Model lists are
  always overridable with a free-text id so they never go stale.
- `src/shared/byok.ts` — the BYOK client:
  - `getSettings` / `saveSettings` — key + provider config in
    `chrome.storage.local` (`lector_byok_settings`).
  - `streamChat(messages, opts, onToken)` — speaks both the OpenAI and
    Anthropic streaming wire formats; routes Anthropic's system message
    correctly.
  - `completeOnce` — non-streaming helper for translate/summarize/explain.
  - `testConnection` — sends a trivial completion so users can verify their
    key before chatting.
- `src/shared/store.ts` — Zustand store now holds `byok` settings + the
  library. The API key is intentionally persisted (it's the whole point of
  BYOK); a code comment flags the shared-machine caveat.
- `src/sidepanel/App.tsx` — chat now streams via `streamChat`; the auth modal
  is replaced by a **Settings drawer** (provider picker, key input with
  show/hide, model picker with custom-id fallback, test-connection button).
  Inline prompts to open Settings when no key is set.
- `src/content.ts` — selection actions and bilingual translation now call the
  provider directly via `completeOnce`, with a friendly "add your key" prompt
  that opens the side panel.
- `src/background.ts` — slimmed to just opening the side panel and registering
  context menus that seed it. No AI calls.
- `src/manifest.json` — `openPanelOnActionClick: true` (icon click → panel),
  removed popup reference, v0.3.0.

## Security & privacy

- Key lives only in `chrome.storage.local`; sent solely to the chosen
  provider over HTTPS.
- No third-party analytics or telemetry.
- Markdown renderer escapes all input (XSS-safe `dangerouslySetInnerHTML`).
- Host permission `<all_urls>` is required so the content script and side
  panel can call arbitrary provider hosts and inject on any page. This is the
  one trade-off of client-side BYOK; it's disclosed in the store description.

## Launch readiness

- [x] `tsc --noEmit` clean
- [x] `npm run build:extension` green; dist layout matches manifest
- [x] No backend dependencies remain (`api/`, `vercel.json`, `@vercel/node`
      all removed)
- [x] Settings UI: provider + key + model + test connection
- [x] Chat / translate / summarize / explain all go through BYOK client
- [x] README documents the BYOK flow
- [ ] Operator steps before public release: write Chrome Web Store listing
      (emphasize BYOK + privacy), capture screenshots, publish.
