import { describe, it, expect } from 'vitest'
import { inflate, deflate } from 'pako'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decode, DecodeError } from './decode.js'

const opts = { inflate }

const here = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(here, '__fixtures__', name), 'utf8')

function expectDecodeError(fn, code) {
  let err
  try { fn() } catch (e) { err = e }
  expect(err).toBeInstanceOf(DecodeError)
  expect(err.code).toBe(code)
}

describe('decode — basic validation', () => {
  it('throws DecodeError on empty input', () => {
    expectDecodeError(() => decode('', opts), 'EMPTY_INPUT')
    expectDecodeError(() => decode('   ', opts), 'EMPTY_INPUT')
  })

  it('throws DecodeError when prefix is not "0"', () => {
    expectDecodeError(() => decode('1abcdef', opts), 'BAD_PREFIX')
  })

  it('DecodeError is a subclass of Error and exposes a code', () => {
    const e = new DecodeError('BAD_PREFIX')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('DecodeError')
    expect(e.code).toBe('BAD_PREFIX')
    // English default message — useful for raw `console.error` output
    expect(typeof e.message).toBe('string')
  })
})

describe('decode — pipeline', () => {
  it('decodes a real single blueprint into JSON', () => {
    const result = decode(fixture('single-blueprint.txt'), opts)
    expect(result.json).toBeTypeOf('object')
    expect(result.json.blueprint).toBeDefined()
    expect(result.json.blueprint.entities).toHaveLength(1)
    expect(result.json.blueprint.entities[0].name).toBe('transport-belt')
  })

  it('throws DecodeError on corrupt base64', () => {
    expectDecodeError(() => decode(fixture('corrupt-base64.txt'), opts), 'BAD_BASE64')
  })

  it('throws DecodeError on truncated input (zlib failure)', () => {
    expectDecodeError(() => decode(fixture('truncated.txt'), opts), 'BAD_ZLIB')
  })

  it('throws DecodeError on broken JSON payload', () => {
    expectDecodeError(() => decode(fixture('bad-json.txt'), opts), 'BAD_JSON')
  })
})

describe('decode — kind/label/version', () => {
  it('classifies a single blueprint correctly', () => {
    const r = decode(fixture('single-blueprint.txt'), opts)
    expect(r.kind).toBe('blueprint')
    expect(r.label).toBe('Test belt')
    expect(r.version).toBe(281474983067648)
    expect(r.versionString).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
  })

  it('classifies a deconstruction planner', () => {
    const r = decode(fixture('deconstruction-planner.txt'), opts)
    expect(r.kind).toBe('deconstruction-planner')
    expect(r.label).toBe('Decon test')
  })

  it('classifies an upgrade planner', () => {
    const r = decode(fixture('upgrade-planner.txt'), opts)
    expect(r.kind).toBe('upgrade-planner')
    expect(r.label).toBe('Up test')
  })

  it('parseVersion splits 64-bit number into 4 components', () => {
    // 281474983067648 = 0x0001_0000_0061_0000 = 1.0.97.0
    const r = decode(fixture('single-blueprint.txt'), opts)
    expect(r.versionString).toBe('1.0.97.0')
  })
})

describe('decode — book children', () => {
  it('returns empty children for a single blueprint', () => {
    const r = decode(fixture('single-blueprint.txt'), opts)
    expect(r.children).toEqual([])
  })

  it('flattens a flat book into 3 children at depth 1', () => {
    const r = decode(fixture('blueprint-book.txt'), opts)
    expect(r.kind).toBe('blueprint-book')
    expect(r.children).toHaveLength(3)
    expect(r.children.map(c => c.label)).toEqual(['Red', 'Green', 'Blue'])
    expect(r.children.map(c => c.path)).toEqual([[0], [1], [2]])
    expect(r.children.every(c => c.kind === 'blueprint')).toBe(true)
  })

  it('flattens a nested book and records deeper paths', () => {
    const r = decode(fixture('nested-book.txt'), opts)
    expect(r.children).toHaveLength(4)
    const labels = r.children.map(c => c.label)
    const paths = r.children.map(c => c.path)
    const kinds = r.children.map(c => c.kind)
    expect(labels).toEqual(['Top item', 'Inner', 'Inner A', 'Inner B'])
    expect(paths).toEqual([[0], [1], [1, 0], [1, 1]])
    expect(kinds).toEqual(['blueprint', 'blueprint-book', 'blueprint', 'blueprint'])
  })
})

describe('decode — unknown root', () => {
  it('returns kind="unknown" if root has no recognised key', () => {
    // Build a payload with a bogus root key.
    const payload = '0' + Buffer.from(deflate(JSON.stringify({ mystery: { label: 'X' } }))).toString('base64')
    const r = decode(payload, opts)
    expect(r.kind).toBe('unknown')
    expect(r.json.mystery.label).toBe('X')
    expect(r.children).toEqual([])
  })
})

describe('decode — real-world large book (regression smoke)', () => {
  // Real Space Age library. Covers all four kinds, 4 levels of nesting.
  // Numbers are exact and serve as a regression check on the decoder.
  it('decodes the real large book without errors and matches expected shape', () => {
    const r = decode(fixture('real-large-book.txt'), opts)
    expect(r.kind).toBe('blueprint-book')
    expect(r.versionString).toBe('2.0.76.0')
    expect(r.children).toHaveLength(82)

    const byKind = r.children.reduce((acc, c) => {
      acc[c.kind] = (acc[c.kind] || 0) + 1
      return acc
    }, {})
    expect(byKind).toEqual({
      'blueprint-book': 16,
      'blueprint': 53,
      'deconstruction-planner': 6,
      'upgrade-planner': 7
    })

    const maxDepth = Math.max(...r.children.map(c => c.path.length))
    expect(maxDepth).toBe(4)
  })
})
