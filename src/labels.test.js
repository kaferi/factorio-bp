import { describe, it, expect } from 'vitest'
import { stripFactorioTags } from './labels.js'

describe('stripFactorioTags', () => {
  it('strips a single item tag with leading space cleanup', () => {
    expect(stripFactorioTags('[item=iron-plate] My Foundry')).toBe('My Foundry')
  })

  it('strips a virtual-signal tag', () => {
    expect(stripFactorioTags('[virtual-signal=down-arrow] Погрузка')).toBe('Погрузка')
  })

  it('strips a recipe tag', () => {
    expect(stripFactorioTags('[recipe=copper-cable]Cables')).toBe('Cables')
  })

  it('strips wrapping color tags but keeps the inner text', () => {
    expect(stripFactorioTags('[color=red]Important[/color] line')).toBe('Important line')
  })

  it('collapses multiple spaces left by stripping', () => {
    expect(stripFactorioTags('Foo [item=bar] Baz')).toBe('Foo Baz')
  })

  it('strips multiple opening tags in a row', () => {
    expect(stripFactorioTags('[item=foo][item=bar]Result')).toBe('Result')
  })

  it('strips standalone closing tags', () => {
    expect(stripFactorioTags('[/foo]Bar[/baz]')).toBe('Bar')
  })

  it('returns plain text unchanged', () => {
    expect(stripFactorioTags('Plain text')).toBe('Plain text')
  })

  it('returns an empty string for empty input', () => {
    expect(stripFactorioTags('')).toBe('')
  })

  it('returns an empty string for null / undefined', () => {
    expect(stripFactorioTags(null)).toBe('')
    expect(stripFactorioTags(undefined)).toBe('')
  })

  it('coerces non-strings to a string', () => {
    expect(stripFactorioTags(42)).toBe('42')
  })

  it('does not touch bracketed text that is not a tag', () => {
    expect(stripFactorioTags('[Hello World]')).toBe('[Hello World]')
  })

  it('handles uppercase tag names too (case-insensitive)', () => {
    expect(stripFactorioTags('[Item=Foo] Bar')).toBe('Bar')
  })

  it('strips font tags', () => {
    expect(stripFactorioTags('[font=default-bold]Bold[/font]')).toBe('Bold')
  })
})
