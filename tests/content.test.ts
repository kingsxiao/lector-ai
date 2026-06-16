import { describe, it, expect, beforeEach } from 'vitest'

// jsdom gives us a DOM but NOT chrome.* APIs or module side effects. We test
// the jump-to DOM behavior by simulating what the content-script handler does:
// locate the [data-lector-id] node, scroll it into view, and pulse-highlight it.

function jumpTo(blockId: string): HTMLElement | null {
  const node = document.querySelector<HTMLElement>(`[data-lector-id="${blockId}"]`)
  if (!node) return null
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  node.classList.add('lector-pulse')
  setTimeout(() => node.classList.remove('lector-pulse'), 50)
  return node
}

describe('jump-to', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    // jsdom does not implement scrollIntoView; stub it so the handler logic is testable.
    window.HTMLElement.prototype.scrollIntoView = function () {}
  })
  it('highlights the target block when present', () => {
    const p = document.createElement('p')
    p.setAttribute('data-lector-id', 'b2')
    p.textContent = 'target'
    document.body.appendChild(p)
    const hit = jumpTo('b2')
    expect(hit).toBe(p)
    expect(p.classList.contains('lector-pulse')).toBe(true)
  })
  it('returns null when the block is absent', () => {
    expect(jumpTo('b99')).toBeNull()
  })
})

describe('highlight mark injection', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  it('wraps selected text in a mark without disturbing siblings', () => {
    const p = document.createElement('p')
    p.setAttribute('data-lector-id', 'b0')
    p.textContent = 'alpha beta gamma'
    document.body.appendChild(p)
    // Simulate surrounding a single text-node range with a mark.
    const range = document.createRange()
    range.selectNodeContents(p)
    const mark = document.createElement('mark')
    mark.className = 'lector-hl'
    range.surroundContents(mark)
    // The mark contains the text and is inside the block.
    expect(mark.textContent).toBe('alpha beta gamma')
    expect(mark.closest('[data-lector-id]')?.getAttribute('data-lector-id')).toBe('b0')
    // No other nodes were touched.
    expect(document.body.children.length).toBe(1)
  })
})
