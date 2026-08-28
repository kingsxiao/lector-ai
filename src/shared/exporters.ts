// Export providers for Feature ②. Pure functions producing payloads/strings.
import type { Highlight } from './highlights'
import type { VocabEntry } from './vocabulary'
import type { ChatSession } from './store'

export interface ExportOptions {
  /** Optional vault root for relative links (Obsidian). */
  vaultRoot?: string
}

/** Escape page-controlled text so it can't break out of the markdown we emit.
 * `title`/`url` come from the captured page — a title like `a](http://evil)`
 * would otherwise inject arbitrary markdown links into the user's notes, and
 * brackets/parens in ordinary titles ("Foo (bar)") corrupt the link syntax. */
function escapeMdLinkText(s: string): string {
  return s.replace(/([\\[\]])/g, '\\$1')
}

/** Wrap a URL in <…> so spaces/parens can't terminate the link; drop URLs that
 * try to smuggle whitespace or angle brackets through. */
function mdLinkUrl(url: string): string {
  return /^[\x21-\x7E]+$/.test(url) && !url.includes('<') && !url.includes('>')
    ? `<${url}>`
    : ''
}

/** Prefix every line of multi-line text so blockquote/callout structure holds. */
function quoteAllLines(s: string): string {
  return s
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
}

/** Local (not UTC) YYYY-MM-DD — a user exporting at 23:00 local expects today's
 *  date, not toISOString()'s UTC value which is a day off outside 00:00–24:00
 *  UTC depending on timezone. */
function localDateString(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Markdown export: one block per highlight with note + source. */
export function toMarkdown(hs: Highlight[], _opts: ExportOptions = {}): string {
  return hs
    .map((h) => {
      const lines = [
        `### ${escapeMdLinkText(h.title)}`,
        '',
        quoteAllLines(h.text),
        '',
        h.note ? `**Note:** ${h.note}` : '',
        '',
        `Source: [${escapeMdLinkText(h.title)}](${mdLinkUrl(h.url)})`,
        '',
        '---',
        '',
      ]
      return lines.join('\n')
    })
    .join('\n')
}

/** Obsidian export: front-matter + callout-friendly markdown. */
export function toObsidian(hs: Highlight[], opts: ExportOptions = {}): string {
  const bySource = new Map<string, Highlight[]>()
  for (const h of hs) {
    const k = h.title
    bySource.set(k, [...(bySource.get(k) ?? []), h])
  }
  // A URL containing a quote or newline would break the YAML front matter of
  // the whole export; fall back to an empty value when it can't be quoted.
  const fmUrl = hs[0]?.url ?? ''
  const fmUrlSafe = /[\n\r"]/.test(fmUrl) ? '' : fmUrl
  const fm = [
    '---',
    `source: "${fmUrlSafe}"`,
    `created: ${localDateString()}`,
    'tags: [lector, highlight]',
    '---',
    '',
  ].join('\n')
  const body = [...bySource.entries()]
    .map(([title, items]) => {
      const block = items
        .map(
          (h) =>
            `${quoteAllLines(`[!quote] ${h.text}${h.note ? `\n\n**Note:** ${h.note}` : ''}`)}\n> Source: [${escapeMdLinkText(title)}](${mdLinkUrl(h.url)})`
        )
        .join('\n\n')
      return `## ${escapeMdLinkText(title)}\n\n${block}`
    })
    .join('\n\n')
  void opts
  return `${fm}${body}\n`
}

/**
 * Notion "create page" properties payload for a single highlight. The caller
 * posts this to the Notion API with the user's database id.
 */
export function toNotionProperties(h: Highlight): Record<string, unknown> {
  return {
    Title: {
      title: [{ text: { content: h.text.slice(0, 2000) } }],
    },
    Source: {
      url: h.url,
    },
    Note: {
      // Notion's rich_text content field rejects values longer than 2000 chars
      // (same limit as title); slice to keep a single long note from failing
      // the entire createPage call.
      rich_text: [{ text: { content: (h.note || '').slice(0, 2000) } }],
    },
  }
}

/** Markdown export of one chat session: header with source link + date, then
 *  the Q&A turns. Model replies are already markdown source — emitted verbatim
 *  so structure (lists/code/citations) survives the round-trip. */
export function sessionToMarkdown(s: ChatSession): string {
  const head = [
    `# ${escapeMdLinkText(s.title || 'Untitled conversation')}`,
    '',
    s.url ? `Source: [${escapeMdLinkText(s.title || s.url)}](${mdLinkUrl(s.url)})` : '',
    `Date: ${localDateString(new Date(s.createdAt))}`,
    '',
    '---',
    '',
  ]
  const turns = s.messages.map((m) =>
    m.role === 'user'
      ? `## ❓ ${m.content}\n`
      : `${m.content}\n`
  )
  return head.filter((l) => l !== undefined).join('\n') + turns.join('\n\n') + '\n'
}

/** RFC-4180 CSV field escaping: quote when the value has a comma, quote,
 *  newline, or CR; double embedded quotes. */
function csvField(s: string): string {
  const v = s ?? ''
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Vocab export as an Anki-importable tab-separated file: front=word,
 *  back=translation, extra columns context + source. Anki's importer accepts
 *  TSV natively (Field separation: Tabs); HTML line breaks render multi-line
 *  context inside a card. */
export function toAnkiTsv(vs: VocabEntry[]): string {
  const lines = ['#separator:tab', '#html:true', '#columns:Word\tTranslation\tContext\tSource']
  for (const v of vs) {
    const br = (s: string) => (s ?? '').replace(/\t/g, ' ').replace(/\n/g, '<br>')
    lines.push(
      [br(v.word), br(v.translation), br(v.context), br(v.title)].map(csvField).join('\t')
    )
  }
  return lines.join('\n') + '\n'
}
