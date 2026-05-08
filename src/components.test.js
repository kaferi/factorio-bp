import { describe, it, expect } from 'vitest'
import { extractComponents, findComponentMatches } from './components.js'

describe('extractComponents', () => {
  it('returns empty array for empty / non-blueprint input', () => {
    expect(extractComponents(null)).toEqual([])
    expect(extractComponents(undefined)).toEqual([])
    expect(extractComponents({})).toEqual([])
    expect(extractComponents({ blueprint: {} })).toEqual([])
    expect(extractComponents({ blueprint: { entities: [] } })).toEqual([])
  })

  it('aggregates entity counts by name', () => {
    const r = extractComponents({
      blueprint: {
        entities: [
          { name: 'transport-belt', position: { x: 0, y: 0 } },
          { name: 'transport-belt', position: { x: 1, y: 0 } },
          { name: 'inserter',       position: { x: 0, y: 1 } }
        ]
      }
    })
    expect(r).toEqual([
      { kind: 'entity', name: 'transport-belt', quality: 'normal', count: 2 },
      { kind: 'entity', name: 'inserter',       quality: 'normal', count: 1 }
    ])
  })

  it('separates entries by quality', () => {
    const r = extractComponents({
      blueprint: {
        entities: [
          { name: 'roboport', quality: 'legendary', position: { x: 0, y: 0 } },
          { name: 'roboport', quality: 'legendary', position: { x: 1, y: 0 } },
          { name: 'roboport', position: { x: 2, y: 0 } } // normal
        ]
      }
    })
    expect(r).toEqual([
      { kind: 'entity', name: 'roboport', quality: 'legendary', count: 2 },
      { kind: 'entity', name: 'roboport', quality: 'normal',    count: 1 }
    ])
  })

  it('aggregates tiles separately from entities and tags them as kind=tile', () => {
    const r = extractComponents({
      blueprint: {
        entities: [{ name: 'transport-belt', position: { x: 0, y: 0 } }],
        tiles: [
          { name: 'concrete', position: { x: 0, y: 0 } },
          { name: 'concrete', position: { x: 1, y: 0 } },
          { name: 'stone-path', position: { x: 0, y: 1 } }
        ]
      }
    })
    expect(r).toEqual([
      { kind: 'tile',   name: 'concrete',       quality: 'normal', count: 2 },
      { kind: 'tile',   name: 'stone-path',     quality: 'normal', count: 1 },
      { kind: 'entity', name: 'transport-belt', quality: 'normal', count: 1 }
    ])
  })

  it('sorts by count desc, then name asc, then quality asc', () => {
    const r = extractComponents({
      blueprint: {
        entities: [
          { name: 'b', position: { x: 0, y: 0 } },
          { name: 'a', position: { x: 0, y: 0 } },
          { name: 'a', position: { x: 0, y: 0 } }
        ]
      }
    })
    expect(r.map(c => c.name)).toEqual(['a', 'b'])
  })

  it('accepts a bare inner blueprint object too (no wrapper)', () => {
    const r = extractComponents({
      entities: [{ name: 'transport-belt', position: { x: 0, y: 0 } }]
    })
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('transport-belt')
  })

  it('aggregates every rail variant into a single "rail" bucket weighted by recipe', () => {
    // straight×2 = 2 items, curved-a×1 = 3, half-diag×1 = 3, elevated-straight×1 = 1.
    // Total: 2 + 3 + 3 + 1 = 9 rail items.
    const r = extractComponents({
      blueprint: {
        entities: [
          { name: 'straight-rail', position: { x: 0, y: 0 } },
          { name: 'straight-rail', position: { x: 2, y: 0 } },
          { name: 'curved-rail-a', position: { x: 0, y: 2 } },
          { name: 'half-diagonal-rail', position: { x: 0, y: 4 } },
          { name: 'elevated-straight-rail', position: { x: 0, y: 6 } },
          { name: 'transport-belt', position: { x: 0, y: 8 } }
        ]
      }
    })
    const rail = r.find(c => c.name === 'rail')
    expect(rail).toBeDefined()
    expect(rail.kind).toBe('entity')
    expect(rail.quality).toBe('normal')
    expect(rail.count).toBe(9)  // 2 + 4 + 2 + 1
    expect(rail.matchNames).toEqual(expect.arrayContaining([
      'straight-rail', 'curved-rail-a', 'half-diagonal-rail', 'elevated-straight-rail'
    ]))
    // The non-rail entity stays separate.
    expect(r.find(c => c.name === 'transport-belt')).toBeDefined()
  })

  it('keeps rail buckets separate by quality and applies per-variant weights', () => {
    // straight×1 = 1 (normal). curved-a + curved-b = 3 + 3 = 6 (legendary).
    const r = extractComponents({
      blueprint: {
        entities: [
          { name: 'straight-rail', position: { x: 0, y: 0 } },
          { name: 'curved-rail-a', position: { x: 0, y: 2 }, quality: 'legendary' },
          { name: 'curved-rail-b', position: { x: 0, y: 4 }, quality: 'legendary' }
        ]
      }
    })
    const normal = r.find(c => c.name === 'rail' && c.quality === 'normal')
    const leg = r.find(c => c.name === 'rail' && c.quality === 'legendary')
    expect(normal.count).toBe(1)
    expect(leg.count).toBe(6)
    expect(leg.matchNames).toEqual(expect.arrayContaining(['curved-rail-a', 'curved-rail-b']))
  })

  it('skips malformed entries silently', () => {
    const r = extractComponents({
      blueprint: {
        entities: [
          { name: 'transport-belt', position: { x: 0, y: 0 } },
          null,
          { position: { x: 0, y: 0 } },          // no name
          { name: '', position: { x: 0, y: 0 } } // empty name
        ]
      }
    })
    expect(r).toEqual([
      { kind: 'entity', name: 'transport-belt', quality: 'normal', count: 1 }
    ])
  })
})

describe('findComponentMatches', () => {
  const sample = JSON.stringify({
    blueprint: {
      entities: [
        { entity_number: 1, name: 'transport-belt', position: { x: 0, y: 0 } },
        { entity_number: 2, name: 'transport-belt', position: { x: 1, y: 0 } },
        { entity_number: 3, name: 'inserter', position: { x: 0, y: 1 }, quality: 'legendary' },
        { entity_number: 4, name: 'inserter', position: { x: 0, y: 2 } }
      ]
    }
  }, null, 2)

  it('finds every matching entry by name and quality=normal (no quality field)', () => {
    const matches = findComponentMatches(sample, 'transport-belt', 'normal')
    expect(matches).toHaveLength(2)
    // match positions point at the `"name": "transport-belt"` substring
    matches.forEach(m => {
      expect(sample.slice(m.start, m.end)).toMatch(/"name":\s*"transport-belt"/)
    })
  })

  it('finds quality=legendary entries only', () => {
    const matches = findComponentMatches(sample, 'inserter', 'legendary')
    expect(matches).toHaveLength(1)
    expect(sample.slice(matches[0].start, matches[0].end)).toMatch(/"name":\s*"inserter"/)
  })

  it('finds quality=normal inserter (no quality field) only', () => {
    const matches = findComponentMatches(sample, 'inserter', 'normal')
    expect(matches).toHaveLength(1)
  })

  it('returns empty array when name is absent', () => {
    expect(findComponentMatches(sample, 'splitter', 'normal')).toEqual([])
  })

  it('returns empty array on bad input', () => {
    expect(findComponentMatches(null, 'x', 'normal')).toEqual([])
    expect(findComponentMatches('', 'x', 'normal')).toEqual([])
    expect(findComponentMatches(sample, '', 'normal')).toEqual([])
  })

  it('accepts an array of names and returns matches for any of them, sorted by position', () => {
    const sample = JSON.stringify({
      blueprint: {
        entities: [
          { entity_number: 1, name: 'straight-rail',     position: { x: 0, y: 0 } },
          { entity_number: 2, name: 'curved-rail-a',     position: { x: 0, y: 2 } },
          { entity_number: 3, name: 'transport-belt',    position: { x: 0, y: 4 } },
          { entity_number: 4, name: 'half-diagonal-rail', position: { x: 0, y: 6 } }
        ]
      }
    }, null, 2)
    const matches = findComponentMatches(sample, ['straight-rail', 'curved-rail-a', 'half-diagonal-rail'], 'normal')
    expect(matches).toHaveLength(3)
    // Sorted by position — straight first, then curved, then half-diagonal
    expect(sample.slice(matches[0].start, matches[0].end)).toMatch(/straight-rail/)
    expect(sample.slice(matches[1].start, matches[1].end)).toMatch(/curved-rail-a/)
    expect(sample.slice(matches[2].start, matches[2].end)).toMatch(/half-diagonal-rail/)
  })

  it('does not match a literal "name": "X" that appears inside a string label', () => {
    const tricky = JSON.stringify({
      blueprint: {
        label: '"name": "transport-belt" — fake match in label',
        entities: [
          { entity_number: 1, name: 'inserter', position: { x: 0, y: 0 } }
        ]
      }
    }, null, 2)
    // The "transport-belt" appears only inside the label string (escaped).
    // With proper string-literal handling this should yield zero matches.
    const matches = findComponentMatches(tricky, 'transport-belt', 'normal')
    expect(matches).toEqual([])
  })
})
