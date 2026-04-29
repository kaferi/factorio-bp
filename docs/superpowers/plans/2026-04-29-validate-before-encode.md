# Validate before encode — v1.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block encoding of malformed/non-blueprint JSON. Two structural levels: root keys + item field (level 1) and arrays/entity shape (level 2). Errors are localised, point at the broken `path` inside the JSON.

**Architecture:** New pure module `src/validate.js` mirrors the layout of `decode.js` / `encode.js`. `app.js` calls `validate(parsed)` between `JSON.parse(state.draft)` and `encode(parsed, …)` inside `onEncode`. `encode.js` is unchanged.

**Tech Stack:** Vanilla JS + Vitest. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-29-validate-before-encode.md](../specs/2026-04-29-validate-before-encode.md)

**No git operations during the plan — the user runs git themselves.**

---

## File Structure

- **Create** `src/validate.js` — `validate(json)`, `ValidationError`, `ErrorCodes`.
- **Create** `src/validate.test.js` — Vitest unit tests.
- **Modify** `src/i18n.js` — six new error keys (en + ru).
- **Modify** `src/app.js` — wire `validate` into `onEncode`.

---

## Task 1: `src/validate.js` and tests (TDD)

**Files:**
- Create: `src/validate.js`
- Create: `src/validate.test.js`

- [ ] **Step 1: Write failing tests first**

Create `src/validate.test.js`:

```js
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
```

- [ ] **Step 2: Run tests — they must fail**

Run: `npm test`
Expected: every test in `src/validate.test.js` fails because `./validate.js` does not exist. Existing 27 tests still pass.

- [ ] **Step 3: Create `src/validate.js`**

```js
// Pure structural validator: checks that a JSON object looks like a
// real Factorio blueprint payload before we encode it. No DOM, no
// locale; errors carry stable `code` and a `params` object that the
// UI layer translates via the i18n dictionary.

export const ErrorCodes = Object.freeze({
  MISSING_ROOT_KEY:     'MISSING_ROOT_KEY',
  INNER_NOT_OBJECT:     'INNER_NOT_OBJECT',
  WRONG_ITEM_VALUE:     'WRONG_ITEM_VALUE',
  BLUEPRINTS_NOT_ARRAY: 'BLUEPRINTS_NOT_ARRAY',
  ENTITIES_NOT_ARRAY:   'ENTITIES_NOT_ARRAY',
  ENTITY_MALFORMED:     'ENTITY_MALFORMED'
})

const DEFAULT_MESSAGES = {
  MISSING_ROOT_KEY:     'Object is not a Factorio blueprint',
  INNER_NOT_OBJECT:     'Inner value must be an object',
  WRONG_ITEM_VALUE:     'item field does not match the root key',
  BLUEPRINTS_NOT_ARRAY: 'blueprints must be an array',
  ENTITIES_NOT_ARRAY:   'entities must be an array',
  ENTITY_MALFORMED:     'entity is malformed'
}

export class ValidationError extends Error {
  constructor(code, params = {}) {
    super(DEFAULT_MESSAGES[code] ?? code)
    this.name = 'ValidationError'
    this.code = code
    this.params = params
  }
}

const ROOT_KEYS = {
  blueprint:              'blueprint',
  blueprint_book:         'blueprint-book',
  deconstruction_planner: 'deconstruction-planner',
  upgrade_planner:        'upgrade-planner'
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

// Validates a wrapper object (the thing carrying one of the four root
// keys). `pathPrefix` is the dotted/bracket trail that led us here.
function validateWrapper(wrapper, pathPrefix) {
  if (!isObject(wrapper)) {
    throw new ValidationError(ErrorCodes.MISSING_ROOT_KEY, { path: pathPrefix })
  }

  let rootKey = null
  for (const key of Object.keys(ROOT_KEYS)) {
    if (key in wrapper) { rootKey = key; break }
  }
  if (!rootKey) {
    throw new ValidationError(ErrorCodes.MISSING_ROOT_KEY, { path: pathPrefix })
  }

  const innerPath = pathPrefix === '<root>' ? rootKey : `${pathPrefix}.${rootKey}`
  const inner = wrapper[rootKey]
  if (!isObject(inner)) {
    throw new ValidationError(ErrorCodes.INNER_NOT_OBJECT, { path: innerPath })
  }

  const expectedItem = ROOT_KEYS[rootKey]
  if ('item' in inner && inner.item !== expectedItem) {
    throw new ValidationError(ErrorCodes.WRONG_ITEM_VALUE, {
      path: innerPath,
      expected: expectedItem,
      actual: String(inner.item)
    })
  }

  if (rootKey === 'blueprint_book') {
    if ('blueprints' in inner) {
      if (!Array.isArray(inner.blueprints)) {
        throw new ValidationError(ErrorCodes.BLUEPRINTS_NOT_ARRAY, {
          path: `${innerPath}.blueprints`
        })
      }
      for (let i = 0; i < inner.blueprints.length; i++) {
        validateWrapper(inner.blueprints[i], `${innerPath}.blueprints[${i}]`)
      }
    }
  }

  if (rootKey === 'blueprint') {
    if ('entities' in inner) {
      if (!Array.isArray(inner.entities)) {
        throw new ValidationError(ErrorCodes.ENTITIES_NOT_ARRAY, {
          path: `${innerPath}.entities`
        })
      }
      for (let i = 0; i < inner.entities.length; i++) {
        const e = inner.entities[i]
        const ep = `${innerPath}.entities[${i}]`
        if (!isObject(e)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'not-an-object' })
        }
        if (typeof e.name !== 'string' || e.name.length === 0) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'missing-name' })
        }
        if (!isObject(e.position)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'missing-position' })
        }
        if (!isFiniteNumber(e.position.x)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'bad-x' })
        }
        if (!isFiniteNumber(e.position.y)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'bad-y' })
        }
      }
    }
  }
  // Planners (deconstruction_planner, upgrade_planner) only need
  // levels 1-4 — we do not probe their settings.
}

export function validate(json) {
  validateWrapper(json, '<root>')
}
```

- [ ] **Step 4: Run tests — they must pass**

Run: `npm test`
Expected: all tests pass. New count: 27 + however many new validate tests (around 18-20) = mid-40s. Get the exact total from the run.

---

## Task 2: i18n keys for validation errors

**Files:**
- Modify: `src/i18n.js`

- [ ] **Step 1: Append new keys to both locale blocks**

Inside `messages.en`, append at the end of the block (after the v1.2 keys, before the closing `}`):

```js
'errors.MISSING_ROOT_KEY': 'JSON is not a Factorio blueprint at {path} (expected blueprint, blueprint_book, deconstruction_planner, or upgrade_planner)',
'errors.INNER_NOT_OBJECT': 'Field {path} must be an object',
'errors.WRONG_ITEM_VALUE': 'Field {path}.item must be "{expected}", got "{actual}"',
'errors.BLUEPRINTS_NOT_ARRAY': 'Field {path} must be an array',
'errors.ENTITIES_NOT_ARRAY': 'Field {path} must be an array',
'errors.ENTITY_MALFORMED': 'Entity at {path} is malformed (missing name or position)'
```

Inside `messages.ru`, append the matching Russian translations:

```js
'errors.MISSING_ROOT_KEY': 'JSON не похож на чертёж Factorio в {path} (ожидается blueprint, blueprint_book, deconstruction_planner или upgrade_planner)',
'errors.INNER_NOT_OBJECT': 'Поле {path} должно быть объектом',
'errors.WRONG_ITEM_VALUE': 'Поле {path}.item должно быть «{expected}», а не «{actual}»',
'errors.BLUEPRINTS_NOT_ARRAY': 'Поле {path} должно быть массивом',
'errors.ENTITIES_NOT_ARRAY': 'Поле {path} должно быть массивом',
'errors.ENTITY_MALFORMED': 'Сущность {path} некорректна (нет name или position)'
```

- [ ] **Step 2: Sanity-check the module**

Run:
```bash
node --input-type=module -e "
import('./src/i18n.js').then(m => {
  m.setLocale('en')
  console.log('en:', m.t('errors.WRONG_ITEM_VALUE', { path: 'blueprint', expected: 'blueprint', actual: 'blueprint-book' }))
  m.setLocale('ru')
  console.log('ru:', m.t('errors.WRONG_ITEM_VALUE', { path: 'blueprint', expected: 'blueprint', actual: 'blueprint-book' }))
}).catch(e => { console.error('fail:', e.message); process.exit(1) })
"
```
Expected:
```
en: Field blueprint.item must be "blueprint", got "blueprint-book"
ru: Поле blueprint.item должно быть «blueprint», а не «blueprint-book»
```

- [ ] **Step 3: Confirm tests still pass**

Run: `npm test`
Expected: same count as after Task 1, all green.

---

## Task 3: Wire `validate` into `app.js`

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add import**

At the top of `src/app.js`, alongside the existing imports, add:

```js
import { validate, ValidationError } from './validate.js'
```

Place it directly after the `encode/EncodeError` import.

- [ ] **Step 2: Update `onEncode` to validate before encoding**

Replace the existing `onEncode` body with:

```js
function onEncode() {
  state.encodeResult = null
  state.encodeError = null

  let parsed
  try {
    parsed = JSON.parse(state.draft)
  } catch {
    state.encodeError = t('errors.BAD_JSON_INPUT')
    render()
    return
  }

  try {
    validate(parsed)
  } catch (e) {
    if (e instanceof ValidationError) {
      state.encodeError = t('errors.' + e.code, e.params)
    } else {
      state.encodeError = `${t('errors.UNKNOWN')}: ${e.message}`
    }
    render()
    return
  }

  try {
    state.encodeResult = encode(parsed, { deflate: window.pako.deflate })
  } catch (e) {
    if (e instanceof EncodeError) {
      state.encodeError = t('errors.' + e.code)
    } else {
      state.encodeError = `${t('errors.UNKNOWN')}: ${e.message}`
    }
  }
  render()
}
```

The change from v1.2 is the new middle `try { validate(parsed) } catch …` block; the parse and encode blocks are untouched.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests still pass (this task does not touch decoder/encoder/validate test files).

- [ ] **Step 4: Sanity-check `app.js` parses as ESM**

```bash
node --input-type=module -e "
import('./src/app.js').catch(e => {
  if (/document is not defined|navigator is not defined|window is not defined|localStorage is not defined/.test(e.message)) {
    console.log('OK: parses, fails only on browser globals as expected')
  } else {
    console.error('Unexpected error:', e.message)
    process.exit(1)
  }
})
"
```

---

## Task 4: Final test sweep + manual checklist

**Files:** none (verification only)

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: 3 test files pass (`decode.test.js`, `encode.test.js`, `validate.test.js`); all tests green.

- [ ] **Step 2: i18n smoke**

```bash
node --input-type=module -e "
import('./src/i18n.js').then(m => {
  m.setLocale('en')
  console.log('en root:', m.t('errors.MISSING_ROOT_KEY', { path: '<root>' }))
  m.setLocale('ru')
  console.log('ru root:', m.t('errors.MISSING_ROOT_KEY', { path: '<root>' }))
})
"
```
Expected output contains both English and Russian strings.

- [ ] **Step 3: Manual UI checklist (the user runs this in the browser)**

1. Decode any blueprint, click `Edit`, replace the textarea contents
   with `{}` → click `Encode`. The error panel shows
   `JSON is not a Factorio blueprint at <root> …` (or Russian
   equivalent). The result panel does not appear.
2. Replace contents with `{"blueprint": {"item": "blueprint-book"}}`
   → `Encode` → error mentions
   `Field blueprint.item must be "blueprint", got "blueprint-book"`.
3. Replace contents with `{"blueprint_book": {"blueprints": "nope"}}`
   → `Encode` → error: `Field blueprint_book.blueprints must be an array`.
4. Replace contents with valid edits (e.g. just rename the label) →
   `Encode` → result panel appears as before.
5. In a deeply-nested book, edit a child wrapper into `{}` → `Encode`
   → error path includes the index trail
   (`blueprint_book.blueprints[0]`).
6. Switch RU ↔ EN while a validation error is showing → message
   re-translates without losing the textarea contents.

---

## Done

After Task 4 the encoder is gated by a structural validator; users
get a clear, localised, path-pointing error when their edit broke
the blueprint shape.
