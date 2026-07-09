import { describe, it, expect } from 'vitest'
import {
  isDuplicateHighlight,
  groupHighlights,
  searchHighlights,
  type Highlight,
} from '../src/shared/highlights'

const base: Highlight = {
  id: 'h1',
  text: 'trust matters',
  note: '',
  quote: 'In software, trust matters a lot.',
  url: 'https://a.com/post',
  title: 'Post',
  blockId: 'b0',
  createdAt: 1000,
  color: 'yellow',
}

describe('isDuplicateHighlight', () => {
  it('flags same text + same url', () => {
    expect(isDuplicateHighlight(base, { ...base, id: 'h2' })).toBe(true)
  })
  it('different url is not a duplicate', () => {
    expect(isDuplicateHighlight(base, { ...base, id: 'h2', url: 'https://b.com' })).toBe(false)
  })
  it('different text is not a duplicate', () => {
    expect(isDuplicateHighlight(base, { ...base, id: 'h2', text: 'other' })).toBe(false)
  })
})

describe('groupHighlights', () => {
  it('groups by origin (title + url)', () => {
    const groups = groupHighlights([
      base,
      { ...base, id: 'h2', title: 'Other', url: 'https://b.com' },
    ])
    expect(groups.size).toBe(2)
  })
  it('sorts highlights within a group newest-first', () => {
    const groups = groupHighlights([base, { ...base, id: 'h2', createdAt: 5000 }])
    const arr = [...groups.values()][0]
    expect(arr[0].id).toBe('h2')
  })
})

describe('searchHighlights', () => {
  it('returns all when query empty', () => {
    expect(searchHighlights([base], '').length).toBe(1)
  })
  it('matches case-insensitively across text/note/title', () => {
    expect(searchHighlights([base], 'TRUST').length).toBe(1)
    expect(searchHighlights([base], 'post').length).toBe(1)
    expect(searchHighlights([base], 'nomatch').length).toBe(0)
  })
})
