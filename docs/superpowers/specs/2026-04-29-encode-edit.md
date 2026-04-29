# Encode + Edit-then-encode — v1.2 Design

Date: 2026-04-29
Status: agreed during brainstorming

## Goal

Round-trip: turn an arbitrary JSON object back into a Factorio
blueprint string, and let the user edit the JSON of the currently
selected node in a textarea before encoding. The output is a fresh
blueprint string the user can paste back into the game.

This is an additive iteration. The existing decoder, UI, i18n, and
locale switch keep working unchanged.

## Scope

### In scope

- A new pure module `src/encode.js` exporting
  `encode(json, { deflate })` and an `EncodeError` class. Mirror of
  `decode.js` in shape and discipline (no DOM, no locale, error codes).
- Replace the vendored pako with the full build
  (`vendor/pako.min.js`, ~46 KB) so `window.pako.deflate` is available
  in the browser.
- A new edit-then-encode mode in the UI:
  - On the JSON tab, a small `Edit` button appears next to `JSON / Children`.
  - Clicking it turns the read-only `<pre>` into a `<textarea>` with the
    same JSON, replaces the actions with `Encode` + `Cancel`.
  - `Encode` parses the textarea, encodes, shows the resulting string
    in a panel below with `Copy` + `Close` buttons.
  - `Cancel` returns to the read-only JSON view, discarding edits.
- Encoding works on the **currently selected node**. If a child of a book
  is selected, encoding produces a standalone blueprint string for
  that sub-tree only; the parent book's other contents are not embedded.
- When encoding a child node, strip the `index` field from the wrapper
  (it is a position marker inside its parent book and is meaningless
  in a standalone blueprint).

### Not in scope

- A structured editor (rename via input, change recipe via dropdown,
  reorder children of a book, etc.). That is v2 work.
- Mutating the parent book's JSON when a child is edited.
- Validation of the edited JSON beyond basic JSON.parse.
- Diff / preview of changes.

## Architectural decisions

- **`encode.js` mirrors `decode.js`.** Pure, DOM-free, locale-free.
  Takes the JSON object and an injected `deflate` function. Returns the
  full blueprint string (with the `'0'` prefix). Throws `EncodeError`
  with a stable `code` on failure.
- **One round-trip pipeline:**
  `JSON.stringify` → `deflate` (zlib) → `Buffer/atob`-style base64
  encoding → prefix with `'0'`.
- **Errors are minimal.** Two codes: `INTERNAL_NO_DEFLATE` (deflate
  function missing — defensive guard, like `decode`'s) and
  `BAD_JSON_INPUT` (the user's textarea contained invalid JSON; thrown
  by the UI layer before calling `encode`, see below).
- **Where parsing happens:** the textarea contains a string; the UI
  layer is responsible for `JSON.parse` and surfacing `BAD_JSON_INPUT`
  via the i18n dictionary. `encode.js` itself only accepts objects.
- **Pako upgrade.** Single file `vendor/pako.min.js` replaces the
  inflate-only vendored copy. Browser keeps loading via a single
  `<script>` tag; tests in Node keep using the npm `pako` package
  (already in `devDependencies`). No runtime API change for the
  decoder, only an extra `deflate` symbol becomes available.

## Files

### Create

- `src/encode.js` — the encoder + `EncodeError` + error-code constants.
  Layout mirrors `decode.js`.
- `src/encode.test.js` — Vitest unit tests for `encode`. See "Tests".
- `vendor/pako.min.js` — the replacement vendored pako (full build).

### Modify

- `src/i18n.js` — add encoder-side error keys + edit-mode UI keys
  (`buttons.edit`, `buttons.encode`, `buttons.cancel`, `buttons.close`,
  `buttons.copyResult`, `buttons.copied`, `editor.label`,
  `result.label`, `errors.BAD_JSON_INPUT`,
  `errors.INTERNAL_NO_DEFLATE`).
- `src/app.js` — add edit-mode state, render edit textarea, wire
  `Edit / Encode / Cancel / Copy / Close` buttons, build the result
  panel.
- `index.html` — replace the vendored pako script tag with
  `vendor/pako.min.js`.
- `vendor/pako_inflate.min.js` — **deleted**, replaced by the full build.
- `styles.css` — minor styles for the edit textarea and the result panel.
- `scripts/gen-fixtures.mjs` — left untouched (encoder tests use the
  npm `pako`, not the vendored file).

## API contract

```ts
// src/encode.js

export const ErrorCodes: {
  INTERNAL_NO_DEFLATE: 'INTERNAL_NO_DEFLATE'
  // BAD_JSON_INPUT is owned by the UI layer; encode() does not throw it.
}

export class EncodeError extends Error {
  code: string  // one of ErrorCodes.*
}

export function encode(
  json: object,
  options: { deflate: (input: Uint8Array) => Uint8Array }
): string
```

### Algorithm

1. Validate `deflate` is a function — otherwise throw
   `EncodeError('INTERNAL_NO_DEFLATE')`.
2. Validate `json` is a non-null object — otherwise throw
   `EncodeError('NOT_AN_OBJECT')` (added to error-code constants).
3. `JSON.stringify(json)` to get the payload string. If `JSON.stringify`
   throws (e.g. circular structure), catch and rethrow as
   `EncodeError('BAD_PAYLOAD')`.
4. Encode the string into bytes:
   - Browser: `new TextEncoder().encode(s)`.
   - Node: same `TextEncoder` is available globally since Node 11.
5. `deflate(bytes)` → compressed bytes.
6. Base64-encode the bytes:
   - Browser: assemble a binary string char-by-char then `btoa(...)`.
   - Node: `Buffer.from(bytes).toString('base64')`.
7. Return `'0' + b64`.

Symmetry rule: encoding the JSON we just decoded must produce a string
that decodes back to a JSON deeply-equal to the input. The compressed
bytes themselves may differ from the original (deflate is not unique),
that is OK.

### Error codes

```js
ErrorCodes = {
  INTERNAL_NO_DEFLATE: 'INTERNAL_NO_DEFLATE',
  NOT_AN_OBJECT:       'NOT_AN_OBJECT',
  BAD_PAYLOAD:         'BAD_PAYLOAD'  // JSON.stringify failed
}
```

The UI also uses `BAD_JSON_INPUT` for textarea-parse failures, but
that's an `EncodeError` constructed in `app.js`, not thrown by
`encode.js` itself. (We pick this to keep `encode.js` purely about
post-parse encoding; the parse step belongs to whatever brings the
JSON in.)

## UI flow

### State extension

```js
state = {
  ...,
  editing: false,           // true ⇒ show editable textarea instead of <pre>
  draft: '',                // textarea contents while editing
  encodeResult: null,       // string | null — last successful encode result
  encodeError: null         // string | null — already-localised error text
}
```

When entering edit mode, `draft` is initialised to the current node's
JSON (pretty-printed, the same text that was in the `<pre>`).

### View transitions

- **Decoded, view mode** (existing): summary + tabs + `<pre>` JSON +
  Copy/Download buttons.
- **Decoded, edit mode** (new): summary + tabs + `<textarea>` with the
  current draft + `Encode` + `Cancel` buttons. Tabs + child tree still
  visible, but clicking `Children` discards the edit (with confirmation
  prompt? — see "Edge cases" below).
- **Decoded, edit mode + result panel** (new): the textarea stays as
  it was, **plus** a panel below with `<textarea readonly>` of the
  encoded blueprint string, a `Copy` button (with the same "Copied"
  flash as before) and a `Close` button that clears `encodeResult`.

The `Edit` button is part of the action row when on the JSON tab.

### Edge cases

- **Switching tabs while editing** discards the draft silently. We
  rely on the user noticing the warning in the button — keep it
  simple. (If this turns out to bite, add a confirm dialog later.)
- **Switching the selected node in the tree while editing** — same
  behaviour: draft discarded.
- **Switching locale while editing** — re-render preserves the
  `editing` state and `draft`. Buttons re-translate; the textarea
  content is the user's JSON, untouched.
- **Encoding a sub-tree with `index` field** — `app.js` shallow-copies
  the wrapper, deletes `index`, then encodes. Original `result.json`
  is never mutated.
- **Encoding when textarea is unparseable** — `state.encodeError`
  fills, panel shows red text instead of the result.

### Buttons / labels (added to i18n)

- `buttons.edit` — `Edit` / `Редактировать`
- `buttons.encode` — `Encode` / `Кодировать`
- `buttons.cancel` — `Cancel` / `Отмена`
- `buttons.close` — `Close` / `Закрыть`
- `buttons.copyResult` — `Copy result` / `Копировать строку`
- `editor.title` — `Edit JSON` / `Редактирование JSON`
- `result.title` — `Blueprint string` / `Строка чертежа`
- `errors.BAD_JSON_INPUT` — `Invalid JSON in editor` / `Невалидный JSON в редакторе`
- `errors.INTERNAL_NO_DEFLATE` — `Internal error: deflate function missing` / `Внутренняя ошибка: не передан deflate`
- `errors.NOT_AN_OBJECT` — `Encoder expected an object at the root` / `Кодер ожидает объект в корне`
- `errors.BAD_PAYLOAD` — `JSON cannot be serialised (circular references?)` / `JSON невозможно сериализовать (циклические ссылки?)`

## Tests

### `src/encode.test.js`

- **Round-trip — single blueprint.** Decode the existing
  `single-blueprint.txt` fixture; encode the result; decode the result
  again; assert deep equality of the JSON tree.
- **Round-trip — flat book.** Same against `blueprint-book.txt`.
- **Round-trip — nested book.** Same against `nested-book.txt`.
- **Round-trip — real large book.** Same against `real-large-book.txt`.
- **Round-trip — planners.** Both `deconstruction-planner.txt` and
  `upgrade-planner.txt`.
- **Encoding child of book gives a valid standalone blueprint.** Take
  the `nested-book.txt` fixture, decode, pick `children[2]`
  (`Inner A`), strip `index`, encode → decode → assert
  `kind === 'blueprint'`, `label === 'Inner A'`.
- **Throws when deflate not provided.** `expectEncodeError(() => encode({...}, {}), 'INTERNAL_NO_DEFLATE')`.
- **Throws when input is not an object.** `expectEncodeError(() => encode('x', { deflate }), 'NOT_AN_OBJECT')`.
- **Throws when stringify fails on circular input.**
  `const a = {}; a.self = a; expectEncodeError(() => encode(a, { deflate }), 'BAD_PAYLOAD')`.

A helper `expectEncodeError(fn, code)` mirrors `expectDecodeError`.

### Manual UI sweep

Same checklist as v1.1 plus:

1. Decode `single-blueprint.txt` → click `Edit` → textarea has the
   pretty-printed JSON → click `Encode` → result panel shows a string.
2. Verify the result string decodes (paste it back into the input,
   click Decode) — same JSON.
3. Click `Cancel` → returns to read-only JSON view, no result panel.
4. In a book, select a child → click `Edit` → modify the `label`
   field → `Encode` → result is a standalone string for that child.
   Decode it → kind matches, new label is present.
5. Break the JSON in the textarea (delete a closing brace) → click
   `Encode` → see localised error, not a stack trace.
6. Encode in EN, switch to RU mid-flow — labels swap, content stays.

## Migration

- **Vendored pako file rename.** Replace `vendor/pako_inflate.min.js`
  with `vendor/pako.min.js`. Update `index.html` to load the new file.
  Old file is deleted from the repo.
- **No breaking change** for the decoder, tests, fixtures, or any
  module API. `encode.js` is purely additive.

## Out of scope (explicitly)

- Structured editing controls.
- Diff/preview of edits.
- Persisting edits.
- Encoding "the whole book with this child mutated".
- Modifying the page deploy/build setup (still vanilla, still GitHub Pages).
