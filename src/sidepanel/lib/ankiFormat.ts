export interface AnkiResultCounts {
  added: number
  duplicated: number
  failed: number
}

/**
 * Format an Anki-export result into a localized template. Replaces both the
 * `{added}/{dup}/{fail}` tokens (i18n key `anki.result`) and the
 * `{added}/{duplicated}/{failed}` tokens (i18n key `side.vocab.ankiResult`),
 * so the two call sites share one helper. Absent tokens are left untouched.
 */
export function formatAnkiResult(template: string, result: AnkiResultCounts): string {
  return template
    .replace('{added}', String(result.added))
    .replace('{dup}', String(result.duplicated))
    .replace('{duplicated}', String(result.duplicated))
    .replace('{fail}', String(result.failed))
    .replace('{failed}', String(result.failed))
}
