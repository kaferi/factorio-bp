# Validate before encode — v1.3 Design

Date: 2026-04-29
Status: agreed during brainstorming

## Goal

Catch obviously-broken JSON before it gets turned into a blueprint
string. Levels covered:

1. **Root structure.** The object must have one of the four expected
   root keys (`blueprint`, `blueprint_book`, `deconstruction_planner`,
   `upgrade_planner`); the inner value must be an object; if the inner
   has an `item` field it must match the root key.
2. **Container shape.** If the inner has `blueprints` it must be an
   array (for books); if it has `entities` it must be an array (for
   blueprints), and every entity must have a `name` (string) and
   `position` with numeric `x` / `y`.

Anything beyond this — checking that entity names are real Factorio
entities, that recipes exist, etc. — is explicitly **out of scope**.
Mods exist, the game evolves; we don't want to grow a static database.

## Architectural decisions

- **Separate module `src/validate.js`.** Keeps the encoder pure (no
  Factorio domain knowledge). Mirrors the layout of `decode.js` /
  `encode.js`: pure, DOM-free, locale-free, error codes.
- **Hard failure.** Validation errors block encoding; the user sees a
  localised error and the result panel does not appear. (No "Force
  encode" button — if it ever turns out we need one, we add it later.)
- **First failure wins.** `validate(json)` throws on the first problem
  it finds. We don't aggregate a list. Simpler code, simpler UI.
- **Throw-style API.** Same pattern as `decode` / `encode` — throws
  `ValidationError` with a stable `code` and a `params` object that
  carries `path`, `expected`, `actual`, etc.
- **Recursive walk for books.** Each child wrapper is validated as
  well, with `path` accumulating so the error message points at the
  exact node.

## Files

- **Create** `src/validate.js` — `validate(json)`, `ValidationError`,
  `ErrorCodes` constants.
- **Create** `src/validate.test.js` — Vitest unit tests covering every
  error path plus a positive-case test on every existing fixture.
- **Modify** `src/i18n.js` — add the new error keys (en + ru).
- **Modify** `src/app.js` — call `validate(parsed)` between `JSON.parse`
  and `encode` inside `onEncode`. Map `ValidationError.code` through
  `t('errors.' + code, params)`.

`encode.js` and `decode.js` are **not** touched.

## API contract

```js
// src/validate.js

export const ErrorCodes = Object.freeze({
  MISSING_ROOT_KEY:     'MISSING_ROOT_KEY',
  INNER_NOT_OBJECT:     'INNER_NOT_OBJECT',
  WRONG_ITEM_VALUE:     'WRONG_ITEM_VALUE',
  BLUEPRINTS_NOT_ARRAY: 'BLUEPRINTS_NOT_ARRAY',
  ENTITIES_NOT_ARRAY:   'ENTITIES_NOT_ARRAY',
  ENTITY_MALFORMED:     'ENTITY_MALFORMED'
})

export class ValidationError extends Error {
  constructor(code, params = {}) {
    super(/* English default message */)
    this.name = 'ValidationError'
    this.code = code
    this.params = params  // { path?, expected?, actual?, reason? }
  }
}

// Throws ValidationError on the first problem; returns void on success.
export function validate(json) { /* ... */ }
```

### Algorithm

1. If `json === null || typeof json !== 'object'` → throw
   `MISSING_ROOT_KEY` with `params.path = '<root>'`.
2. Pick the root key. Map: `blueprint → 'blueprint'`,
   `blueprint_book → 'blueprint-book'`,
   `deconstruction_planner → 'deconstruction-planner'`,
   `upgrade_planner → 'upgrade-planner'`. Take the first key that
   exists in `json`. If none → throw `MISSING_ROOT_KEY` with
   `params.path = '<root>'`.
3. `inner = json[rootKey]`. If not an object → throw
   `INNER_NOT_OBJECT` with `params.path = rootKey`.
4. If `'item' in inner` and `inner.item !== expectedItem` → throw
   `WRONG_ITEM_VALUE` with `path = rootKey`,
   `expected = expectedItem`, `actual = String(inner.item)`. (If
   `item` is missing, **do not** require it — many valid Factorio
   exports omit it for nested wrappers.)
5. If root is `blueprint_book`:
   - If `'blueprints' in inner` and `!Array.isArray(inner.blueprints)`
     → `BLUEPRINTS_NOT_ARRAY` with `path = rootKey + '.blueprints'`.
   - For each child `blueprints[i]`, **recurse**: build a new path
     prefix `${rootKey}.blueprints[${i}]` and validate the child wrapper
     under that prefix. (Children are wrapper objects, themselves
     validated against the same four-root-key rules.)
6. If root is `blueprint`:
   - If `'entities' in inner` and `!Array.isArray(inner.entities)` →
     `ENTITIES_NOT_ARRAY` with `path = rootKey + '.entities'`.
   - For each `entities[i]`: must have a `name` (non-empty string) and
     a `position` object with numeric `x` and `y`. If not →
     `ENTITY_MALFORMED` with `path = rootKey + '.entities[' + i + ']'`
     and `params.reason = '<missing-name|missing-position|bad-x|bad-y>'`
     (the UI uses just `path` for the message; `reason` is purely for
     debugging / future tests).
7. Planners (`deconstruction_planner`, `upgrade_planner`) — only steps
   1-4 apply; we don't probe their settings (`tile_filters`,
   `mappers`, etc).

The recursion is depth-first; the first failure stops the whole walk.

## i18n keys

Each error code gets a localised message. Templates use `{path}`,
`{expected}`, `{actual}` placeholders.

| Key | English | Russian |
| --- | --- | --- |
| `errors.MISSING_ROOT_KEY` | `JSON is not a Factorio blueprint at {path} (expected blueprint, blueprint_book, deconstruction_planner, or upgrade_planner)` | `JSON не похож на чертёж Factorio в {path} (ожидается blueprint, blueprint_book, deconstruction_planner или upgrade_planner)` |
| `errors.INNER_NOT_OBJECT` | `Field {path} must be an object` | `Поле {path} должно быть объектом` |
| `errors.WRONG_ITEM_VALUE` | `Field {path}.item must be "{expected}", got "{actual}"` | `Поле {path}.item должно быть «{expected}», а не «{actual}»` |
| `errors.BLUEPRINTS_NOT_ARRAY` | `Field {path} must be an array` | `Поле {path} должно быть массивом` |
| `errors.ENTITIES_NOT_ARRAY` | `Field {path} must be an array` | `Поле {path} должно быть массивом` |
| `errors.ENTITY_MALFORMED` | `Entity at {path} is malformed (missing name or position)` | `Сущность {path} некорректна (нет name или position)` |

## UI integration

In `src/app.js`, the existing `onEncode` flow:

```
JSON.parse(state.draft)
  → encode(parsed, { deflate })
```

becomes:

```
JSON.parse(state.draft)              // BAD_JSON_INPUT on failure (unchanged)
  → validate(parsed)                  // ValidationError on failure (new)
  → encode(parsed, { deflate })       // EncodeError on failure (unchanged)
```

The catch-block builds `state.encodeError` from the error's code via
`t('errors.' + code, error.params)`. `params` is forwarded to `t` so
`{path}`, `{expected}`, `{actual}` placeholders fill in.

The result panel only appears on full success.

## Tests

`src/validate.test.js`:

- **Positive sweep** — load every existing fixture
  (`single-blueprint.txt`, `blueprint-book.txt`, `nested-book.txt`,
  `real-large-book.txt`, `deconstruction-planner.txt`,
  `upgrade-planner.txt`), decode it, run `validate(decoded.json)`,
  assert no throw.
- **`MISSING_ROOT_KEY`**: `null`, `42`, `'string'`, `{}`, `{ foo: 1 }`.
- **`INNER_NOT_OBJECT`**: `{ blueprint: null }`, `{ blueprint: 42 }`.
- **`WRONG_ITEM_VALUE`**:
  `{ blueprint: { item: 'blueprint-book' } }` → expected `'blueprint'`.
  `{ blueprint_book: { item: 'blueprint' } }` → expected `'blueprint-book'`.
- **No throw when `item` is absent**: `{ blueprint: {} }` is valid (so
  is `{ blueprint_book: { blueprints: [] } }`).
- **`BLUEPRINTS_NOT_ARRAY`**:
  `{ blueprint_book: { blueprints: 'no' } }`.
- **`ENTITIES_NOT_ARRAY`**: `{ blueprint: { entities: 'no' } }`.
- **`ENTITY_MALFORMED`**: missing `name`, missing `position`,
  `position.x` not number, `position.y` not number.
- **Nested book error path** —
  `{ blueprint_book: { blueprints: [{ blueprint: { entities: [{}] } }] } }`
  should throw with `path === 'blueprint_book.blueprints[0].blueprint.entities[0]'`.
- **`ValidationError` shape**:
  `expect(e).toBeInstanceOf(Error); expect(e.name).toBe('ValidationError'); expect(typeof e.code).toBe('string'); expect(typeof e.params).toBe('object')`.

A small helper `expectValidationError(fn, code, paramsMatcher)`
mirrors `expectDecodeError` / `expectEncodeError`.

## Manual UI sweep

Same v1.2 checklist plus:

1. Decode a real blueprint, click `Edit`, replace the entire JSON with
   `{}` → click `Encode` → red error mentioning `MISSING_ROOT_KEY` /
   "не похож на чертёж" appears, no result panel.
2. Same path with `{"blueprint": {"item": "blueprint-book"}}` →
   `WRONG_ITEM_VALUE` error showing `expected "blueprint"`.
3. Same path with valid edit (e.g. just changed `label`) → result
   panel appears as before.
4. In a deeply-nested book, edit the first child to break it (e.g. set
   `entities` to a string) → `Encode` → error message includes the
   `path` so the user can locate the broken node.

## Out of scope

- Aggregating multiple errors (we surface just the first).
- "Force encode" button.
- Semantic validation (entity-name list, recipe-name list, position
  bounds, etc).
- Validating planner-specific structures (`tile_filters`, `mappers`).
- Validating circuit `connections`, `wires`, schedules, train stations.
