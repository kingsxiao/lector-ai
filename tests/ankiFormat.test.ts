import { describe, it, expect } from 'vitest'
import { formatAnkiResult } from '../src/sidepanel/lib/ankiFormat'

describe('formatAnkiResult', () => {
  const result = { added: 3, duplicated: 1, failed: 2 }

  it('formats the short-token template (anki.result)', () => {
    expect(formatAnkiResult('Added {added}, duplicated {dup}, failed {fail}', result))
      .toBe('Added 3, duplicated 1, failed 2')
  })
  it('formats the long-token template (side.vocab.ankiResult)', () => {
    expect(formatAnkiResult('Added: {added} · Duplicated: {duplicated} · Failed: {failed}', result))
      .toBe('Added: 3 · Duplicated: 1 · Failed: 2')
  })
  it('leaves unknown tokens untouched', () => {
    expect(formatAnkiResult('no tokens here', result)).toBe('no tokens here')
  })
})
