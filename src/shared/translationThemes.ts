// Translation theme catalog + CSS builder.
//
// Pure module: no DOM, no chrome. Defines the named bilingual-translation
// styles (mirroring Immersive Translate's theme names so users migrating from
// it find familiar options) and produces the stylesheet text the content
// script injects into the page's `#lector-ai-styles` block.
//
// Themes are applied via a body class `lector-theme-<name>` plus the generated
// CSS rules that target `.lector-bilingual.lector-theme-<name>` — this keeps
// themes composable with the existing display-mode body classes
// (lector-dm-bilingual / -translationOnly / -hover) and lets the user
// hot-swap themes live without re-translating.
//
// A `readingFocus` mode (surpass-feature) goes beyond Immersive's `weakening`:
// it dims the source text and emphasizes the translation for long-form reading.

export interface ThemeDef {
  /** Stable id used as the body-class suffix and in settings. */
  id: string
  /** English label for the picker. */
  en: string
  /** Chinese label for the picker. */
  zh: string
  /**
   * CSS declarations applied to the `.lector-bilingual` element. Written as a
   * partial CSS string (no selector) so the builder can wrap them. Keys here
   * are intentionally low-level (color/border/background/opacity/font-weight)
   * so every theme reads predictably across sites.
   */
  css: string
}

/**
 * The 21 built-in themes. Names mirror Immersive Translate so migrating users
 * find the familiar set; the `readingFocus` theme is Lector's addition.
 */
export const TRANSLATION_THEMES: ThemeDef[] = [
  { id: 'default', en: 'Default', zh: '默认', css: 'border-left:3px solid #8F5E30;color:#5C5347;' },
  { id: 'none', en: 'None', zh: '无', css: '' },
  { id: 'grey', en: 'Grey', zh: '灰色', css: 'color:#6b7280;border-left:3px solid #6b7280;' },
  { id: 'dashed', en: 'Dashed border', zh: '虚线边框', css: 'border:1px dashed #8F5E30;color:#5C5347;' },
  { id: 'solidBorder', en: 'Solid border', zh: '实线边框', css: 'border:1px solid #8F5E30;color:#5C5347;' },
  { id: 'dotted', en: 'Dotted border', zh: '点线边框', css: 'border:1px dotted #8F5E30;color:#5C5347;' },
  { id: 'thinDashed', en: 'Thin dashed', zh: '细虚线', css: 'border-left:2px dashed #8F5E30;color:#5C5347;' },
  { id: 'underline', en: 'Underline', zh: '下划线', css: 'text-decoration:underline;text-decoration-color:#8F5E30;text-underline-offset:3px;color:#26211B;' },
  { id: 'nativeUnderline', en: 'Native underline', zh: '原生下划线', css: 'text-decoration:underline;color:#26211B;' },
  { id: 'nativeDashed', en: 'Native dashed', zh: '原生虚线', css: 'border-bottom:1px dashed currentColor;color:#26211B;' },
  { id: 'nativeDotted', en: 'Native dotted', zh: '原生点线', css: 'border-bottom:1px dotted currentColor;color:#26211B;' },
  { id: 'wavy', en: 'Wavy', zh: '波浪线', css: 'text-decoration:underline wavy #8F5E30;text-underline-offset:3px;color:#26211B;' },
  { id: 'highlight', en: 'Highlight', zh: '高亮', css: 'background:rgba(156,107,60,.14);color:#26211B;border-radius:3px;padding:2px 4px;' },
  { id: 'marker', en: 'Marker', zh: '荧光笔', css: 'background:linear-gradient(transparent 55%, rgba(255,221,87,.55) 55%);color:#26211B;' },
  { id: 'marker2', en: 'Marker 2', zh: '荧光笔 2', css: 'background:linear-gradient(transparent 40%, rgba(156,107,60,.28) 40%);color:#26211B;' },
  { id: 'paper', en: 'Paper', zh: '纸张', css: 'background:#FBF7EE;color:#4A4036;border-left:3px solid #8F5E30;padding:4px 8px;border-radius:4px;' },
  { id: 'background', en: 'Background', zh: '底色', css: 'background:#F5EFE3;color:#4A4036;padding:2px 6px;border-radius:4px;' },
  { id: 'blockquote', en: 'Blockquote', zh: '引用块', css: 'border-left:4px solid #8F5E30;padding-left:12px;color:#5C5347;font-style:italic;' },
  { id: 'dividingLine', en: 'Dividing line', zh: '分割线', css: 'border-top:1px solid #E8DECC;padding-top:6px;color:#5C5347;' },
  { id: 'weakening', en: 'Weakening', zh: '弱化', css: 'opacity:.72;color:#6b7280;' },
  { id: 'opacity', en: 'Opacity', zh: '透明度', css: 'opacity:.85;color:#5C5347;' },
  { id: 'italic', en: 'Italic', zh: '斜体', css: 'font-style:italic;color:#5C5347;' },
  { id: 'bold', en: 'Bold', zh: '粗体', css: 'font-weight:600;color:#26211B;' },
  { id: 'mask', en: 'Mask', zh: '遮罩', css: 'background:rgba(43,38,32,.06);color:#4A4036;padding:2px 4px;border-radius:3px;' },
  { id: 'readingFocus', en: 'Reading focus', zh: '专注阅读', css: 'border-left:3px solid #8F5E30;color:#26211B;font-weight:500;background:rgba(156,107,60,.06);padding:4px 8px;border-radius:4px;' },
]

const THEME_BY_ID: Record<string, ThemeDef> = Object.fromEntries(
  TRANSLATION_THEMES.map((t) => [t.id, t])
)

/** Look up a theme def; falls back to 'default' for unknown ids. */
export function getTheme(id: string): ThemeDef {
  return THEME_BY_ID[id] || THEME_BY_ID.default
}

/** Strict membership check (used to validate stored theme settings). */
export function isValidThemeId(id: unknown): id is string {
  return typeof id === 'string' && id in THEME_BY_ID
}

/**
 * Build the full stylesheet the content script injects. Produces:
 *   - a per-theme rule (`.lector-bilingual` styled when body has the theme class)
 *   - the font-size override (relative scale, default 0.92em)
 *   - the readingFocus source-dimming rule
 *   - the user's raw custom CSS appended verbatim last (so it can win cascade)
 *
 * The selector is `.lector-theme-<id> .lector-bilingual` so the theme only
 * applies when the body carries the theme class; this keeps themes composable
 * with display-mode classes and lets multiple themes' rules coexist in the
 * injected block without conflict (only the active class matches).
 */
export function buildThemeStylesheet(
  fontSize: number,
  customCss: string,
  readingFocus: boolean
): string {
  const themeRules = TRANSLATION_THEMES
    .filter((t) => t.css)
    .map((t) => `body.lector-theme-${t.id} .lector-bilingual{${t.css}}`)
    .join('\n')

  // Font size applies to all themes uniformly (relative to the host block).
  const sizeRule = `body .lector-bilingual{font-size:${clampFontSize(fontSize)}em;line-height:1.6;}`

  // Reading-focus dim: lower the source text opacity so the translation reads
  // as the primary content. Toggled independently of the theme id.
  const focusRule = readingFocus
    ? `body.lector-focus-on .lector-bi-source{opacity:.45;}body.lector-focus-on .lector-bilingual{font-weight:500;}`
    : ''

  const custom = customCss && customCss.trim() ? '\n/* user custom css */\n' + customCss.trim() : ''

  return [themeRules, sizeRule, focusRule, custom].filter(Boolean).join('\n')
}

/** Clamp the font-size scale to a sane range (0.6–1.6) so a stray stored
 *  value can't blow up the layout. */
export function clampFontSize(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0.92
  return Math.min(1.6, Math.max(0.6, Math.round(v * 100) / 100))
}
