import { describe, it, expect } from 'vitest'
import { lookupIconUrl, renderLabelWithIconsHtml, renderIconsArrayHtml } from './icons.js'

describe('lookupIconUrl', () => {
  it('returns a jsDelivr URL for a base item', () => {
    const url = lookupIconUrl('item', 'iron-plate')
    expect(url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/deniszholob\/icons-factorio@[0-9a-f]{40}\//)
    expect(url).toContain('iron-plate.png')
  })

  it('returns a URL for cargo-landing-pad (in icons_, not space-age)', () => {
    const url = lookupIconUrl('item', 'cargo-landing-pad')
    expect(url).toMatch(/cargo-landing-pad\.png$/)
  })

  it('finds virtual-signal arrow under arrows_', () => {
    const url = lookupIconUrl('virtual-signal', 'down-arrow')
    expect(url).toContain('arrows/down-arrow.png')
  })

  it('finds virtual-signal signal under signal_', () => {
    const url = lookupIconUrl('virtual-signal', 'signal-1')
    expect(url).toContain('signal/signal-1.png')
  })

  it('finds fluid', () => {
    const url = lookupIconUrl('fluid', 'water')
    expect(url).toContain('fluid/water.png')
  })

  it('returns null for an unknown name', () => {
    expect(lookupIconUrl('item', 'definitely-not-real-name-xyz-123')).toBeNull()
  })

  it('returns null for an unknown type', () => {
    expect(lookupIconUrl('color', 'red')).toBeNull()
  })

  it('does not throw on weird names', () => {
    expect(lookupIconUrl('item', 'name with space')).toBeNull()
    expect(lookupIconUrl('item', '')).toBeNull()
  })

  it('treats type "virtual" as an alias for "virtual-signal" (icons[] format)', () => {
    const a = lookupIconUrl('virtual', 'signal-1')
    const b = lookupIconUrl('virtual-signal', 'signal-1')
    expect(a).toBe(b)
    expect(a).toContain('signal/signal-1.png')
  })

  it('finds quality indicator icons for all five tiers', () => {
    for (const q of ['normal', 'uncommon', 'rare', 'epic', 'legendary']) {
      const url = lookupIconUrl('quality', q)
      expect(url, `quality=${q}`).toMatch(new RegExp(`quality-${q}\\.png$`))
    }
  })
})

describe('renderLabelWithIconsHtml', () => {
  it('renders a single item tag as <img> followed by the text', () => {
    const html = renderLabelWithIconsHtml('[item=iron-plate] My Foundry')
    expect(html).toMatch(/^<img class="bp-icon" src="https:\/\/cdn\.jsdelivr\.net[^"]+iron-plate\.png" alt="\[item=iron-plate\]" \/>\s*My Foundry$/)
  })

  it('emits an <img> for cargo-landing-pad (the case the heuristic missed)', () => {
    const html = renderLabelWithIconsHtml('[item=cargo-landing-pad] Space Age')
    expect(html).toContain('<img class="bp-icon"')
    expect(html).toContain('cargo-landing-pad.png')
    expect(html).toContain('Space Age')
  })

  it('escapes plain text portions', () => {
    expect(renderLabelWithIconsHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('returns plain text untouched when there are no tags', () => {
    expect(renderLabelWithIconsHtml('Plain text')).toBe('Plain text')
  })

  it('returns empty string for null / undefined / empty', () => {
    expect(renderLabelWithIconsHtml(null)).toBe('')
    expect(renderLabelWithIconsHtml(undefined)).toBe('')
    expect(renderLabelWithIconsHtml('')).toBe('')
  })

  it('drops tags whose lookup returns null', () => {
    expect(renderLabelWithIconsHtml('[unknown=foo] Bar')).toBe('Bar')
    expect(renderLabelWithIconsHtml('[item=really-non-existent-name-xyz] Bar')).toBe('Bar')
  })

  it('strips colour wrapping tags but keeps the text', () => {
    expect(renderLabelWithIconsHtml('[color=red]Important[/color] line'))
      .toBe('Important line')
  })

  it('uses the base name only when quality is appended', () => {
    const html = renderLabelWithIconsHtml('[item=iron-plate,quality=rare] Foo')
    expect(html).toContain('iron-plate.png')
    expect(html).not.toContain('quality')
    expect(html).toContain('Foo')
  })

  it('renders multiple icons in their original positions', () => {
    const html = renderLabelWithIconsHtml('A [item=iron-plate] B [virtual-signal=down-arrow] C')
    const imgCount = (html.match(/<img /g) || []).length
    expect(imgCount).toBe(2)
    expect(html.indexOf('A')).toBe(0)
    expect(html).toContain('B')
    expect(html.endsWith('C')).toBe(true)
  })

  it('coerces non-string input to string and escapes', () => {
    expect(renderLabelWithIconsHtml(42)).toBe('42')
  })

  it('handles closing tags appearing alone', () => {
    expect(renderLabelWithIconsHtml('[/foo]Bar[/baz]')).toBe('Bar')
  })
})

describe('renderIconsArrayHtml', () => {
  it('renders a single signal as <img>', () => {
    const html = renderIconsArrayHtml([{ signal: { name: 'iron-plate' }, index: 1 }])
    expect(html).toContain('<img class="bp-icon"')
    expect(html).toContain('iron-plate.png')
    expect(html).toContain('alt="[item=iron-plate]"')
  })

  it('defaults missing signal.type to "item"', () => {
    const html = renderIconsArrayHtml([{ signal: { name: 'iron-plate' } }])
    expect(html).toContain('iron-plate.png')
  })

  it('respects an explicit signal.type', () => {
    const html = renderIconsArrayHtml([{ signal: { type: 'fluid', name: 'water' } }])
    expect(html).toContain('fluid/water.png')
  })

  it('orders entries by index', () => {
    const html = renderIconsArrayHtml([
      { signal: { name: 'copper-plate' }, index: 2 },
      { signal: { name: 'iron-plate' }, index: 1 }
    ])
    expect(html.indexOf('iron-plate')).toBeLessThan(html.indexOf('copper-plate'))
  })

  it('falls back to array order when index is missing', () => {
    const html = renderIconsArrayHtml([
      { signal: { name: 'iron-plate' } },
      { signal: { name: 'copper-plate' } }
    ])
    expect(html.indexOf('iron-plate')).toBeLessThan(html.indexOf('copper-plate'))
  })

  it('ignores quality field on the signal', () => {
    const html = renderIconsArrayHtml([{ signal: { name: 'roboport', quality: 'legendary' } }])
    expect(html).toContain('roboport.png')
    expect(html).not.toContain('legendary')
  })

  it('drops signals not in the manifest', () => {
    const html = renderIconsArrayHtml([{ signal: { name: 'definitely-not-real-xyz' } }])
    expect(html).toBe('')
  })

  it('drops malformed entries (no signal, no name)', () => {
    expect(renderIconsArrayHtml([{ signal: null }])).toBe('')
    expect(renderIconsArrayHtml([{ signal: {} }])).toBe('')
    expect(renderIconsArrayHtml([{}])).toBe('')
  })

  it('returns empty string for null / undefined / non-array', () => {
    expect(renderIconsArrayHtml(null)).toBe('')
    expect(renderIconsArrayHtml(undefined)).toBe('')
    expect(renderIconsArrayHtml('not an array')).toBe('')
    expect(renderIconsArrayHtml([])).toBe('')
  })

  it('renders the real-world "Сити блоки" book icon (big-electric-pole)', () => {
    const html = renderIconsArrayHtml([{ signal: { name: 'big-electric-pole' }, index: 1 }])
    expect(html).toContain('big-electric-pole.png')
  })
})
