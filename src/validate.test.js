import { describe, it, expect } from 'vitest'
import { inflate } from 'pako'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decode } from './decode.js'
import { validate, ValidationError } from './validate.js'

const decodeOpts = { inflate }
const here = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(here, '__fixtures__', name), 'utf8')

function expectValidationError(fn, code, paramsMatcher) {
  let err
  try { fn() } catch (e) { err = e }
  expect(err).toBeInstanceOf(ValidationError)
  expect(err.code).toBe(code)
  if (paramsMatcher) expect(err.params).toMatchObject(paramsMatcher)
}

describe('validate — positive cases on real fixtures', () => {
  const names = [
    'single-blueprint.txt',
    'blueprint-book.txt',
    'nested-book.txt',
    'real-large-book.txt',
    'deconstruction-planner.txt',
    'upgrade-planner.txt'
  ]
  for (const name of names) {
    it(`accepts ${name}`, () => {
      const r = decode(fixture(name), decodeOpts)
      expect(() => validate(r.json)).not.toThrow()
    })
  }
})

describe('validate — root structure (level 1)', () => {
  it('rejects null / non-object roots', () => {
    expectValidationError(() => validate(null), 'MISSING_ROOT_KEY', { path: '<root>' })
    expectValidationError(() => validate(42), 'MISSING_ROOT_KEY', { path: '<root>' })
    expectValidationError(() => validate('blueprint'), 'MISSING_ROOT_KEY', { path: '<root>' })
  })

  it('rejects empty object', () => {
    expectValidationError(() => validate({}), 'MISSING_ROOT_KEY', { path: '<root>' })
  })

  it('rejects roots with no recognised key', () => {
    expectValidationError(() => validate({ foo: 42 }), 'MISSING_ROOT_KEY')
    expectValidationError(() => validate({ mystery: { item: 'blueprint' } }), 'MISSING_ROOT_KEY')
  })

  it('rejects roots where the inner value is not an object', () => {
    expectValidationError(() => validate({ blueprint: null }), 'INNER_NOT_OBJECT', { path: 'blueprint' })
    expectValidationError(() => validate({ blueprint_book: 42 }), 'INNER_NOT_OBJECT', { path: 'blueprint_book' })
  })

  it('rejects wrong item value', () => {
    expectValidationError(
      () => validate({ blueprint: { item: 'blueprint-book' } }),
      'WRONG_ITEM_VALUE',
      { path: 'blueprint', expected: 'blueprint', actual: 'blueprint-book' }
    )
    expectValidationError(
      () => validate({ blueprint_book: { item: 'blueprint' } }),
      'WRONG_ITEM_VALUE',
      { path: 'blueprint_book', expected: 'blueprint-book', actual: 'blueprint' }
    )
  })

  it('accepts when item is absent (Factorio omits it for nested wrappers)', () => {
    expect(() => validate({ blueprint: {} })).not.toThrow()
    expect(() => validate({ blueprint_book: { blueprints: [] } })).not.toThrow()
    expect(() => validate({ deconstruction_planner: {} })).not.toThrow()
  })
})

describe('validate — container shape (level 2)', () => {
  it('rejects non-array blueprints', () => {
    expectValidationError(
      () => validate({ blueprint_book: { blueprints: 'no' } }),
      'BLUEPRINTS_NOT_ARRAY',
      { path: 'blueprint_book.blueprints' }
    )
  })

  it('rejects non-array entities', () => {
    expectValidationError(
      () => validate({ blueprint: { entities: 'no' } }),
      'ENTITIES_NOT_ARRAY',
      { path: 'blueprint.entities' }
    )
  })

  it('rejects entity missing name', () => {
    expectValidationError(
      () => validate({ blueprint: { entities: [{ position: { x: 0, y: 0 } }] } }),
      'ENTITY_MALFORMED',
      { path: 'blueprint.entities[0]' }
    )
  })

  it('rejects entity missing position', () => {
    expectValidationError(
      () => validate({ blueprint: { entities: [{ name: 'transport-belt' }] } }),
      'ENTITY_MALFORMED',
      { path: 'blueprint.entities[0]' }
    )
  })

  it('rejects entity with non-numeric x or y', () => {
    expectValidationError(
      () => validate({ blueprint: { entities: [{ name: 'belt', position: { x: 'a', y: 0 } }] } }),
      'ENTITY_MALFORMED'
    )
    expectValidationError(
      () => validate({ blueprint: { entities: [{ name: 'belt', position: { x: 0, y: null } }] } }),
      'ENTITY_MALFORMED'
    )
  })

  it('accepts a blueprint with no entities at all', () => {
    expect(() => validate({ blueprint: { item: 'blueprint' } })).not.toThrow()
  })

  it('accepts an empty book', () => {
    expect(() => validate({ blueprint_book: { item: 'blueprint-book', blueprints: [] } })).not.toThrow()
  })
})

describe('validate — recursion into book children', () => {
  it('reports the deep path on a malformed nested entity', () => {
    const broken = {
      blueprint_book: {
        item: 'blueprint-book',
        blueprints: [
          { blueprint: { item: 'blueprint', entities: [{}] } }
        ]
      }
    }
    expectValidationError(
      () => validate(broken),
      'ENTITY_MALFORMED',
      { path: 'blueprint_book.blueprints[0].blueprint.entities[0]' }
    )
  })

  it('reports child wrapper without recognised key', () => {
    const broken = {
      blueprint_book: {
        item: 'blueprint-book',
        blueprints: [{ foo: 42 }]
      }
    }
    expectValidationError(
      () => validate(broken),
      'MISSING_ROOT_KEY',
      { path: 'blueprint_book.blueprints[0]' }
    )
  })
})

describe('validate — ValidationError shape', () => {
  it('exposes name, code, params', () => {
    const e = new ValidationError('MISSING_ROOT_KEY', { path: 'foo' })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('ValidationError')
    expect(e.code).toBe('MISSING_ROOT_KEY')
    expect(e.params).toEqual({ path: 'foo' })
    expect(typeof e.message).toBe('string')
  })

  it('default message reads sensibly when no params are passed', () => {
    const e = new ValidationError('ENTITY_MALFORMED')
    expect(typeof e.message).toBe('string')
    expect(e.message.length).toBeGreaterThan(0)
  })
})
