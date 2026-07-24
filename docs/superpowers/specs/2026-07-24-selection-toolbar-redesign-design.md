# Selection Toolbar Redesign — Design Spec

**Date:** 2026-07-24
**Status:** Approved (verbal), pending written-spec review
**Scope:** The text-selection action panel built imperatively in `src/content.ts` (`createToolbar`, lines 186–236, plus its injected styles at lines 20–53 and the `mouseup` positioning math at lines 678–703). **Out of scope:** the post-action loading/result popups (`showLoading`/`showResult`), the FAB, and the React sidepanel.

## Problem

The current toolbar is visually heavy and inconsistent:

- A solid brown (`#9C6B3C`) bar, 10px radius, ~400px wide when all 8 buttons render.
- Buttons mix three styles: white `t-btn`, translucent `summary-btn`, dark `close-btn`.
- Emoji labels (`🌐 💬 📄 🤖 🔖 📚 🃏`) render inconsistently across OS/browsers and add visual noise.
- The `Summarize` button is visually orphaned (only translucent-white one).
- Positioning is buggy: `y = rect.bottom + window.scrollY` double-counts scroll because the bar is `position: fixed`, and the width clamp hardcodes `280` while the real width is ~400.

## Goals

1. Replace the heavy labeled bar with a compact icon-only pill.
2. Surface adapts to the page (light frosted glass; dark-glass fallback on dark pages).
3. Crisp, dependency-free SVG icons with consistent stroke.
4. Keep all 7 actions; preserve discoverability via hover tooltips.
5. Fix the positioning bugs while we're in there.

## Non-Goals

- No changes to action handlers (`handleAction`, `handleHighlight`, etc.).
- No changes to the loading/result popups that appear after a click.
- No new dependencies (no icon library, no CSS framework).
- No i18n key renames that would ripple into other call sites — labels stay, just have their emoji prefix stripped in `i18n.ts` so they can be reused as tooltip text.

---

## Design

### 1. Shape & surface

Replace the brown 10px-radius bar with a **pill** (`border-radius: 999px`):

| Property | Light glass (default) | Dark glass (fallback) |
|---|---|---|
| background | `rgba(255,255,255,0.82)` | `rgba(28,28,30,0.82)` |
| backdrop-filter | `blur(14px) saturate(1.6)` | same |
| border | `1px solid rgba(255,255,255,0.6)` | `1px solid rgba(255,255,255,0.12)` |
| box-shadow | `0 4px 16px rgba(43,38,32,0.14), 0 1px 2px rgba(43,38,32,0.06)` | same |
| icon color | `#6B6155` → `#9C6B3C` on hover | `rgba(255,255,255,0.8)` → `#FFF8EE` on hover |

Height ~34px; `padding: 5px 8px`; `gap: 2px` between icon buttons; `font-family` unchanged.

**Dark-page detection:** compute once at toolbar-creation time. Method: walk up from `range.startContainer` to the nearest **block-level** ancestor (tag in `DIV, SECTION, ARTICLE, MAIN, P, LI, BLOCKQUOTE, TD, BODY`); read `getComputedStyle(ancestor).backgroundColor`; parse the `rgb()`/`rgba()` triple; compute relative luminance `L = 0.2126·r + 0.7152·g + 0.0722·b` (channels normalized 0–1). If `L < 0.35`, use the dark-glass variant. If the parsed color is `transparent` or unparseable, walk to the next ancestor; if `BODY` yields nothing, default to **light**. Whole thing wrapped in try/catch → default light on any failure. (Chosen over a canvas pixel-read because it's synchronous, allocation-free, and good enough — we only need a rough threshold.)

> **Rationale:** frosted glass sits on top of page content instead of fighting it; the dark fallback prevents a blinding white pill on a dark site.

### 2. Layout & grouping

Two semantic groups inside the pill, separated by a 1px vertical divider (`width:1px; height:18px; background: currentColor; opacity:0.15`):

- **AI actions:** Translate · Explain · Summarize · Ask
- **Annotation:** Highlight · Save word · Explain sentence

Each button is a 28×28 hit area containing a 16px SVG, centered with flex. Approx total width ≈ 220px (7×28 + divider + padding), down from ~400px.

### 3. Icons

Seven custom **inline SVGs**, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `stroke-width="1.7"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"` (with per-icon exceptions noted). 16px rendered. Defined once as a JS map `TOOLBAR_ICONS: Record<string, string>` near the top of the toolbar section, keyed by a stable action id:

| Action id | Icon | Notes |
|---|---|---|
| `translate` | globe (meridian + equator) | |
| `explain` | chat bubble (rounded) | |
| `summarize` | document with 3 lines | |
| `ask` | sparkles (4-point star + small spark) | |
| `highlight` | highlighter/marker nib | |
| `saveWord` | bookmark outline | |
| `explainSentence` | quotation mark block | |

**Emoji removal:** strip the emoji prefixes from the seven `toolbar.*` i18n values in `src/shared/i18n.ts:119–125` so each is bare text (`'Translate'`, `'翻译'`, …). These bare strings become the hover tooltips.

### 4. Interaction

- **Default:** icon `#6B6155` (light) / `rgba(255,255,255,0.8)` (dark). No background.
- **Hover:** icon → `#9C6B3C` / `#FFF8EE`; a circular chip appears behind the icon (`background: rgba(156,107,60,0.12)` light / `rgba(255,255,255,0.12)` dark; `border-radius: 999px`) with a 150ms ease transition.
- **Active:** `transform: translateY(1px)` on press.
- **Tooltip:** each button sets `title` to the i18n label → native browser tooltip. No custom tooltip DOM (keeps it dependency-free and accessible).
- **Close button (✕): removed.** The pill auto-dismisses via the existing handlers — selection cleared, Escape, outside-click (`content.ts:705–723`). Dropping the explicit ✕ is standard for icon-only selection menus and saves width.
- **Entrance:** keep the existing `lectorFadeIn` keyframe; set `transform-origin` to the side nearest the selection so it appears to rise out of the text.

### 5. Positioning fix

Switch to pure viewport coordinates (correct for `position: fixed`):

```
const rect = range.getBoundingClientRect()
const GAP = 8
let x = rect.left
let y = rect.bottom + GAP
// clamp after the pill is in the DOM and measured:
//   x = min(x, innerWidth  - pill.offsetWidth  - 8)
//   if (y + pill.offsetHeight > innerHeight) y = rect.top - pill.offsetHeight - GAP  // flip above
```

- Drop `+ window.scrollY` (was double-counting).
- Replace the hardcoded `280` clamp with the measured `pill.offsetWidth`, measured after append. Re-clamp in the same frame (sync read after append is fine; the pill has no async layout deps).
- Add a **flip-above** fallback when the pill would overflow the bottom of the viewport.

---

## Files Touched

| File | Change |
|---|---|
| `src/content.ts` | Rewrite `createToolbar()` (186–236) for pill + SVG icons + groups + auto-dismiss-only; rewrite the `#lector-ai-toolbar*` rules in `injectStyles()` (31–38); add `TOOLBAR_ICONS` map; add dark-page luminance helper; fix `mouseup` positioning math (678–703). |
| `src/shared/i18n.ts` | Strip emoji prefixes from `toolbar.*` keys (119–125). |

No other files change. No manifest changes. No new files.

## Verification

- `npm run typecheck` (or `tsc --noEmit`) must pass.
- Manual: load the unpacked extension, select text on (a) a light page, (b) a dark page, (c) near the right edge, (d) near the bottom edge of the viewport; confirm pill renders, icons are crisp, tooltips show, clamping/flip works, and all 7 actions still fire.
- No automated tests exist for the content-script toolbar; none will be added (out of scope).
