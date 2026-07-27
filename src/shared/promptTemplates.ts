// Prompt template domain logic. Pure functions, zero deps.
//
// Templates are reusable prompts the user invokes from the composer via the
// "/" menu (对标 Sider). They support placeholders that are filled from the
// reading context (selection / page / language). Built-in templates ship out
// of the box; users add their own via the templates drawer.

import type { StringKey } from './i18n'

export interface PromptTemplate {
  id: string
  /** Display title (custom templates). Built-ins use titleKey for i18n; this
   *  is the English fallback. */
  title: string
  /** i18n key for built-in templates, rendered via t(). Undefined for custom. */
  titleKey?: StringKey
  /** Template body, may contain placeholders. e.g. "Explain:\n\n{selection}" */
  content: string
  /** Built-in templates can't be deleted or have their content edited. */
  builtIn: boolean
  /** Sort weight; lower comes first. Reassigned on drag-reorder. */
  order: number
}

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/** Placeholder → value mapping context. */
export interface TemplateContext {
  /** Currently selected text from the content script, or '' if none. */
  selection: string
  /** Page body excerpt (first ~2000 chars), or '' with no page. */
  page: string
  /** Page language code, e.g. "en" "zh". */
  lang: string
}

/** Supported placeholders, for validation and UI hints. */
export const PLACEHOLDERS = ['{selection}', '{page}', '{lang}'] as const

const MAX_CONTENT_LEN = 2000

/**
 * Replace placeholders in a template body with actual values. Unknown
 * placeholders (anything not in PLACEHOLDERS) are left untouched.
 *
 * Implementation notes:
 *  - A single-pass replace with a function replacer is used deliberately.
 *    `String.replace(regex, stringReplacement)` interprets `$&`, `$'`, `` $` ``,
 *    `$$` as special patterns, which would silently corrupt user content
 *    (selection/page) containing `$` (prices, shell variables, code). A
 *    function replacer's return value is used verbatim — no `$` handling.
 *  - Single-pass also prevents cross-contamination: with chained `.replace`
 *    calls, a selection value shaped like `{page}` would be re-substituted by
 *    the next stage. One regex over all placeholders + a lookup map fixes that.
 */
export function fillTemplate(content: string, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    '{selection}': ctx.selection,
    '{page}': ctx.page,
    '{lang}': ctx.lang,
  }
  return content.replace(/\{selection\}|\{page\}|\{lang\}/g, (m) => values[m] ?? m)
}

/** Sort templates by order ascending (stable for equal orders). */
export function sortTemplates(list: PromptTemplate[]): PromptTemplate[] {
  return [...list].sort((a, b) => a.order - b.order)
}

/**
 * Fuzzy-filter templates by query against title or content (case-insensitive
 * substring). An empty query returns all templates.
 */
export function filterTemplates(list: PromptTemplate[], query: string): PromptTemplate[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (t) => t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q)
  )
}

/** Generate a unique-ish template id. */
export function newTemplateId(): string {
  return 'tpl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * Validate a template before saving. Title and content must be non-empty;
 * content must not exceed MAX_CONTENT_LEN.
 */
export function validateTemplate(t: { title: string; content: string }): ValidationResult {
  if (t.title.trim().length === 0) return { ok: false, reason: 'empty-title' }
  if (t.content.trim().length === 0) return { ok: false, reason: 'empty-content' }
  if (t.content.length > MAX_CONTENT_LEN) {
    return { ok: false, reason: 'too-long' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Built-in template library
// ---------------------------------------------------------------------------

/**
 * The out-of-the-box templates, shipped on first load. Content is English
 * (it's a prompt sent to the AI); titles are i18n keys resolved at render.
 */
export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'tpl_builtin_summarize',
    title: 'Summarize',
    titleKey: 'tpl.summarize',
    content: 'Summarize this page in 3-5 bullets and a one-line takeaway.',
    builtIn: true,
    order: 0,
  },
  {
    id: 'tpl_builtin_keypoints',
    title: 'Key points',
    titleKey: 'tpl.keypoints',
    content: 'What are the 3 most important points the author is making?',
    builtIn: true,
    order: 1,
  },
  {
    id: 'tpl_builtin_eli5',
    title: 'ELI5',
    titleKey: 'tpl.eli5',
    content: "Explain this like I'm 5 years old:\n\n{selection}",
    builtIn: true,
    order: 2,
  },
  {
    id: 'tpl_builtin_rewrite',
    title: 'Rewrite',
    titleKey: 'tpl.rewrite',
    content:
      'Rewrite this to be clearer and more professional, keeping the meaning:\n\n{selection}',
    builtIn: true,
    order: 3,
  },
  {
    id: 'tpl_builtin_translate_zh',
    title: 'Translate to 中文',
    titleKey: 'tpl.translateZh',
    content: 'Translate to 中文:\n\n{selection}',
    builtIn: true,
    order: 4,
  },
  {
    id: 'tpl_builtin_translate_en',
    title: 'Translate to English',
    titleKey: 'tpl.translateEn',
    content: 'Translate to English:\n\n{selection}',
    builtIn: true,
    order: 5,
  },
  {
    id: 'tpl_builtin_expand',
    title: 'Expand',
    titleKey: 'tpl.expand',
    content: 'Expand on this with more detail and examples:\n\n{selection}',
    builtIn: true,
    order: 6,
  },
  {
    id: 'tpl_builtin_email',
    title: 'Email reply',
    titleKey: 'tpl.email',
    content: 'Draft a concise, professional reply to this email:\n\n{selection}',
    builtIn: true,
    order: 7,
  },
  {
    id: 'tpl_builtin_extract',
    title: 'Extract facts',
    titleKey: 'tpl.extract',
    content:
      'Extract the key facts, names, and numbers from this as a bullet list:\n\n{selection}',
    builtIn: true,
    order: 8,
  },
  {
    id: 'tpl_builtin_critique',
    title: 'Critique',
    titleKey: 'tpl.critique',
    content:
      'What are the weak points, gaps, or unexamined assumptions in this argument?\n\n{selection}',
    builtIn: true,
    order: 9,
  },
]
