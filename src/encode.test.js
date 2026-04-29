import { describe, it, expect } from 'vitest'
import { inflate, deflate } from 'pako'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decode } from './decode.js'
import { encode, EncodeError } from './encode.js'

const decodeOpts = { inflate }
const encodeOpts = { deflate }

const here = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(here, '__fixtures__', name), 'utf8')

function expectEncodeError(fn, code) {
  let err
  try { fn() } catch (e) { err = e }
  expect(err).toBeInstanceOf(EncodeError)
  expect(err.code).toBe(code)
}

function roundTrip(name) {
  const original = decode(fixture(name), decodeOpts)
  const reEncoded = encode(original.json, encodeOpts)
  expect(typeof reEncoded).toBe('string')
  expect(reEncoded[0]).toBe('0')
  const reDecoded = decode(reEncoded, decodeOpts)
  expect(reDecoded.json).toEqual(original.json)
  expect(reDecoded.kind).toBe(original.kind)
  return { original, reEncoded, reDecoded }
}

describe('encode — round-trip across fixtures', () => {
  it('round-trips a single blueprint', () => {
    roundTrip('single-blueprint.txt')
  })
  it('round-trips a flat book', () => {
    roundTrip('blueprint-book.txt')
  })
  it('round-trips a nested book', () => {
    roundTrip('nested-book.txt')
  })
  it('round-trips the real large library', () => {
    roundTrip('real-large-book.txt')
  })
  it('round-trips a deconstruction planner', () => {
    roundTrip('deconstruction-planner.txt')
  })
  it('round-trips an upgrade planner', () => {
    roundTrip('upgrade-planner.txt')
  })
})

describe('encode — extracting a child of a book', () => {
  it('encoding a child wrapper (with index stripped) yields a valid standalone blueprint', () => {
    const r = decode(fixture('nested-book.txt'), decodeOpts)
    // children: [{path:[0], 'Top item'}, {path:[1], 'Inner', book}, {path:[1,0], 'Inner A'}, {path:[1,1], 'Inner B'}]
    const child = r.children.find(c => c.label === 'Inner A')
    expect(child).toBeDefined()
    // Strip the `index` field — it's a position marker inside the parent book.
    const { index, ...standalone } = child.json
    expect(index).toBeDefined() // sanity: the wrapper does carry an index
    const reEncoded = encode(standalone, encodeOpts)
    const reDecoded = decode(reEncoded, decodeOpts)
    expect(reDecoded.kind).toBe('blueprint')
    expect(reDecoded.label).toBe('Inner A')
    expect(reDecoded.children).toEqual([])
  })
})

describe('encode — error paths', () => {
  it('throws EncodeError when deflate is missing', () => {
    expectEncodeError(() => encode({ blueprint: { item: 'blueprint' } }, {}), 'INTERNAL_NO_DEFLATE')
  })
  it('throws EncodeError when input is not an object', () => {
    expectEncodeError(() => encode('not an object', encodeOpts), 'NOT_AN_OBJECT')
    expectEncodeError(() => encode(null, encodeOpts), 'NOT_AN_OBJECT')
    expectEncodeError(() => encode(42, encodeOpts), 'NOT_AN_OBJECT')
  })
  it('throws EncodeError on circular references (BAD_PAYLOAD)', () => {
    const a = {}
    a.self = a
    expectEncodeError(() => encode(a, encodeOpts), 'BAD_PAYLOAD')
  })
  it('EncodeError exposes name and code', () => {
    const e = new EncodeError('NOT_AN_OBJECT')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('EncodeError')
    expect(e.code).toBe('NOT_AN_OBJECT')
    expect(typeof e.message).toBe('string')
  })
})
