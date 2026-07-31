// AI Expert translation personas.
//
// Pure module: no DOM, no chrome. Preset domain-specific sub-prompts that get
// spliced into the translation system prompt (by buildTranslateSystemPrompt in
// translation.ts) so a user can request "translate this like an academic
// paper" vs "like casual speech" without rewriting the whole prompt.
//
// Mirrors Immersive Translate's "AI Expert" feature, but as a fixed preset
// dropdown (per the design decision) rather than a full custom-prompt editor.

export interface PersonaDef {
  /** Stable id stored in settings. */
  id: string
  /** English label. */
  en: string
  /** Chinese label. */
  zh: string
  /**
   * The sub-prompt spliced before the glossary block. Written as a directive
   * that layers on top of the base "professional translator" instruction, so
   * it never overrides the hard "output MUST be in <language>" requirement.
   */
  prompt: string
}

export const TRANSLATION_PERSONAS: PersonaDef[] = [
  {
    id: 'general',
    en: 'General',
    zh: '通用',
    prompt: '',
  },
  {
    id: 'academic',
    en: 'Academic',
    zh: '学术',
    prompt: 'Adopt an academic register: precise terminology, formal syntax, hedged claims where appropriate. Preserve field-specific jargon and cite-style phrasing.',
  },
  {
    id: 'tech',
    en: 'Technical / IT',
    zh: '科技 / IT',
    prompt: 'Adopt a technical-writing register: concise, exact terminology, active voice. Keep identifiers, APIs, and product names as-is. Prefer the conventional Chinese/industry translation of technical terms.',
  },
  {
    id: 'colloquial',
    en: 'Colloquial',
    zh: '口语',
    prompt: 'Adopt a natural, conversational register as if a fluent native speaker were explaining informally. Use everyday idioms; avoid stiff or literal phrasing.',
  },
  {
    id: 'literary',
    en: 'Literary',
    zh: '文学',
    prompt: 'Adopt a literary register: preserve tone, rhythm, imagery, and rhetorical effect. Favor elegant, idiomatic expression over literal word-for-word rendering.',
  },
  {
    id: 'news',
    en: 'News',
    zh: '新闻',
    prompt: 'Adopt a journalistic register: clear, concise, neutral, and factual. Follow news-style conventions of the target language.',
  },
  {
    id: 'business',
    en: 'Business',
    zh: '商务',
    prompt: 'Adopt a professional business register: clear, polite, and conventional. Use standard business/finance terminology of the target language.',
  },
]

const PERSONA_BY_ID: Record<string, PersonaDef> = Object.fromEntries(
  TRANSLATION_PERSONAS.map((p) => [p.id, p])
)

/** Look up a persona def; falls back to 'general' for unknown ids. */
export function getPersona(id: string): PersonaDef {
  return PERSONA_BY_ID[id] || PERSONA_BY_ID.general
}

/** Strict membership check (used to validate stored persona settings). */
export function isValidPersonaId(id: unknown): id is string {
  return typeof id === 'string' && id in PERSONA_BY_ID
}

/** Return the sub-prompt text to splice into the system prompt (empty for general). */
export function personaPrompt(id: string): string {
  return getPersona(id).prompt
}
