import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { downloadBlob, readJsonFile } from '../src/sidepanel/lib/downloads'

// jsdom's File lacks .text() (present in real browsers). Polyfill for tests.
beforeAll(() => {
  if (typeof File.prototype.text !== 'function') {
    File.prototype.text = function (this: File): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    }
  }
})

describe('downloadBlob', () => {
  let created: { href: string; download: string; clicked: boolean } | null = null
  let revokeUrl = ''
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL

  beforeEach(() => {
    created = null
    revokeUrl = ''
    URL.createObjectURL = vi.fn(() => 'blob:fake-url') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn((u: string) => { revokeUrl = u }) as unknown as typeof URL.revokeObjectURL
    HTMLAnchorElement.prototype.click = vi.fn(function (this: HTMLAnchorElement) {
      created = { href: this.href, download: this.download, clicked: true }
    }) as unknown as typeof HTMLAnchorElement.prototype.click
  })
  afterEach(() => {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
  })

  it('creates an <a download> with the blob URL, clicks it, and revokes', () => {
    downloadBlob('lector-highlights.md', '# Hi', 'text/markdown')
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(created).not.toBeNull()
    expect(created!.download).toBe('lector-highlights.md')
    expect(created!.href).toBe('blob:fake-url')
    expect(created!.clicked).toBe(true)
    expect(revokeUrl).toBe('blob:fake-url')
  })
})

describe('readJsonFile', () => {
  it('reads file text and runs the parse callback', async () => {
    const file = new File(['{"a":1}'], 'x.json', { type: 'application/json' })
    const parsed = await readJsonFile(file, (text) => JSON.parse(text))
    expect(parsed).toEqual({ a: 1 })
  })
  it('propagates parse errors', async () => {
    const file = new File(['not json'], 'x.json')
    await expect(readJsonFile(file, JSON.parse)).rejects.toThrow()
  })
})
