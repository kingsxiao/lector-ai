import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jumpToBlock } from '../src/sidepanel/lib/chromeUtils'

describe('jumpToBlock', () => {
  beforeEach(() => {
    const tabsSend = vi.fn((_tabId: number, _msg: unknown, cb: () => void) => cb())
    ;(globalThis as any).chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 42 }]),
        sendMessage: tabsSend,
      },
      runtime: { lastError: undefined },
    }
  })

  it('queries the active tab and sends lector-jump-to with the blockId', async () => {
    await jumpToBlock('b3')
    expect((globalThis as any).chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true })
    expect((globalThis as any).chrome.tabs.sendMessage).toHaveBeenCalled()
    const [tabId, msg] = (globalThis as any).chrome.tabs.sendMessage.mock.calls[0]
    expect(tabId).toBe(42)
    expect(msg).toEqual({ action: 'lector-jump-to', blockId: 'b3' })
  })

  it('no-ops when there is no active tab id', async () => {
    ;(globalThis as any).chrome.tabs.query = vi.fn(async () => [{}])
    ;(globalThis as any).chrome.tabs.sendMessage.mockClear()
    await jumpToBlock('b1')
    expect((globalThis as any).chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })
})
