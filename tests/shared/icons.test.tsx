import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon, LogOutIcon,
  SendIcon, PlusIcon, XIcon, SettingsIcon, FileTextIcon, SparklesIcon, ListIcon,
} from '../../src/shared/icons'

const icons = {
  LibraryIcon, BookmarkIcon, BookOpenIcon, LanguagesIcon, LogOutIcon,
  SendIcon, PlusIcon, XIcon, SettingsIcon, FileTextIcon, SparklesIcon, ListIcon,
}

describe('icons', () => {
  for (const [name, Icon] of Object.entries(icons)) {
    test(`${name} renders an svg with stroke paths`, () => {
      const html = renderToStaticMarkup(<Icon />)
      expect(html).toContain('<svg')
      expect(html).toContain('stroke="currentColor"')
      expect(html).toContain('<path')
      expect(html).toContain('aria-hidden="true"')
    })
  }

  test('size prop sets width/height', () => {
    const html = renderToStaticMarkup(<SendIcon size={24} />)
    expect(html).toContain('width="24"')
    expect(html).toContain('height="24"')
  })
})
