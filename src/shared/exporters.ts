// Export providers for Feature ②. Pure functions producing payloads/strings.
import type { Highlight } from './highlights'

export interface ExportOptions {
  /** Optional vault root for relative links (Obsidian). */
  vaultRoot?: string
}

/** Markdown export: one block per highlight with note + source. */
export function toMarkdown(hs: Highlight[], _opts: ExportOptions = {}): string {
  return hs
    .map((h) => {
      const lines = [
        `### ${h.title}`,
        '',
        `> ${h.text}`,
        '',
        h.note ? `**Note:** ${h.note}` : '',
        '',
        `Source: [${h.title}](${h.url})`,
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
  const fm = [
    '---',
    `source: "${hs[0]?.url ?? ''}"`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    'tags: [lector, highlight]',
    '---',
    '',
  ].join('\n')
  const body = [...bySource.entries()]
    .map(([title, items]) => {
      const block = items
        .map(
          (h) =>
            `> [!quote] ${h.text}${h.note ? `\n> \n> **Note:** ${h.note}` : ''}\n> Source: [${title}](${h.url})`
        )
        .join('\n\n')
      return `## ${title}\n\n${block}`
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
