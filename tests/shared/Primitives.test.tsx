import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Row, IconButton, StatsCell } from '../../src/sidepanel/components/Primitives'

describe('StatsCell', () => {
  it('renders the value and label', () => {
    const html = renderToStaticMarkup(<StatsCell label="DUE" value={3} />)
    expect(html).toContain('>3<')
    expect(html).toContain('DUE')
    expect(html).toContain('text-accent')
  })
})

describe('IconButton', () => {
  it('renders aria-label + title for a11y', () => {
    const html = renderToStaticMarkup(
      <IconButton label="Delete" onClick={() => {}}>
        <svg />
      </IconButton>
    )
    expect(html).toContain('aria-label="Delete"')
    expect(html).toContain('title="Delete"')
    expect(html).toContain('type="button"')
  })
  it('applies danger styling when danger is set', () => {
    const html = renderToStaticMarkup(
      <IconButton label="Delete" onClick={() => {}} danger>
        <svg />
      </IconButton>
    )
    expect(html).toContain('text-danger')
  })
})

describe('Row', () => {
  it('renders title + subtitle and hides actions until hover (opacity-0 group-hover)', () => {
    const html = renderToStaticMarkup(
      <Row
        title="hello"
        subtitle="world"
        actions={[{ label: 'Delete', onClick: () => {}, icon: <svg data-testid="x" /> }]}
      />
    )
    expect(html).toContain('hello')
    expect(html).toContain('world')
    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover:opacity-100')
    expect(html).toContain('aria-label="Delete"')
  })
  it('marks the row cursor-pointer when onClick is provided', () => {
    const html = renderToStaticMarkup(<Row title="x" onClick={() => {}} />)
    expect(html).toContain('cursor-pointer')
  })
})
