import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Chrome refuses to INSTALL an extension that declares more than 4 commands
// with a suggested_key ("Too many shortcuts specified for 'commands': The
// maximum is 4"). The failure only surfaces at load time — vite, tsc and the
// build script's file-existence checks all pass — and it is exactly what CWS's
// automated install test rejects on ("未能通过 Linux 上的自动安装测试").
// Commands WITHOUT a suggested_key are unlimited and stay user-bindable at
// chrome://extensions/shortcuts, so the cap only counts declared defaults.
const MAX_SUGGESTED_KEYS = 4

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../src/manifest.json'), 'utf8')
) as {
  version: string
  commands?: Record<string, { suggested_key?: unknown }>
}

describe('src/manifest.json', () => {
  it('declares at most 4 suggested keyboard shortcuts (Chrome install-time limit)', () => {
    const withKeys = Object.entries(manifest.commands ?? []).filter(
      ([, cmd]) => cmd.suggested_key !== undefined
    )
    expect(
      withKeys.length,
      `too many suggested_key commands: ${withKeys.map(([n]) => n).join(', ')}`
    ).toBeLessThanOrEqual(MAX_SUGGESTED_KEYS)
  })

  it('keeps package.json and manifest.json versions in sync', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8')
    ) as { version: string }
    expect(manifest.version).toBe(pkg.version)
  })
})
