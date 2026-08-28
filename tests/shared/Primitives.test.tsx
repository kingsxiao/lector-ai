import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatsCell } from '../../src/sidepanel/components/Primitives'

describe('StatsCell', () => {
  it('renders the value and label', () => {
    const html = renderToStaticMarkup(<StatsCell label="DUE" value={3} />)
    expect(html).toContain('>3<')
    expect(html).toContain('DUE')
    expect(html).toContain('text-accent')
  })
})
