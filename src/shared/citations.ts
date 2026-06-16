// Citation grounding for Feature ①. Pure functions, no DOM deps.

export interface PageBlock {
  /** Stable id like "b0". Mirrored on the DOM node as data-lector-id. */
  id: string
  text: string
  /** Selector/xpath for jump-back location. */
  domSelector: string
}

export interface Citation {
  /** The normalized id, e.g. "b0". */
  raw: string
  /** The number shown to the user, e.g. "0". */
  display: string
}

/**
 * Parse "[N]" markers out of model text, keeping only ids present in the
 * whitelist. A marker may be written as [0] or [b0]; both map to id "b0".
 * Order is preserved and duplicates within a contiguous run are kept (the
 * model sometimes emits [0][2]).
 */
export function parseCitations(text: string, validIds: Set<string>): Citation[] {
  const out: Citation[] = []
  // Match [digits] possibly with a leading b.
  const re = /\[(b?\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const display = m[1].replace(/^b/, '')
    const raw = `b${display}`
    if (validIds.has(raw)) {
      out.push({ raw, display })
    }
  }
  return out
}

/**
 * Build the system-prompt PAGE CONTENT section, prefixing each block with its
 * id so the model can cite it.
 */
export function buildCitedSystemPrompt(blocks: PageBlock[]): string {
  const body = blocks.map((b) => `[${b.id}] ${b.text}`).join('\n')
  return [
    'PAGE CONTENT (each block prefixed [bN]; cite ONLY these ids):',
    body,
    '',
    'When you state a fact from the article, append [bN] referencing the block(s) it came from.',
    'If the answer is not covered in the page content, say so rather than guessing.',
    'Never cite an id not listed above.',
  ].join('\n')
}

/**
 * Render an HTML fragment, replacing [bN] markers with clickable citation
 * chips. Invalid ids are stripped entirely (no chip, no leftover bracket).
 * Input HTML is assumed already-escaped by the markdown renderer.
 */
export function renderCitations(html: string, validIds: Set<string>): string {
  return html.replace(/\[(b?\d+)\]/g, (_full, inside: string) => {
    const display = inside.replace(/^b/, '')
    const raw = `b${display}`
    if (!validIds.has(raw)) return ''
    return `<sup class="lector-cite" data-cite="${raw}" title="Source block ${display}">[${display}]</sup>`
  })
}
