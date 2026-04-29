# Encode + Edit-then-encode — v1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure `encode(json, { deflate })` module that turns a JSON object back into a Factorio blueprint string, plus an edit-then-encode UI mode where the user can modify the currently selected node's JSON in a textarea and produce a fresh blueprint string.

**Architecture:** `src/encode.js` mirrors `decode.js` (pure, DOM-free, locale-free, error codes). The browser switches to the full `vendor/pako.min.js` so `window.pako.deflate` is available. `src/app.js` gains an edit mode and a result panel. Encoding works on the currently selected node; for child nodes inside a book, the wrapper's `index` field is stripped so the resulting string is a clean standalone blueprint.

**Tech Stack:** Vanilla JS (ES modules), HTML/CSS, Vitest for tests. `pako` (full build) replaces the inflate-only vendored copy. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-29-encode-edit.md](../specs/2026-04-29-encode-edit.md)

**No git operations during the plan — the user runs git themselves.**

---

## File Structure

- **Create** `src/encode.js` — `encode()`, `EncodeError`, `ErrorCodes`.
- **Create** `src/encode.test.js` — round-trip tests against existing fixtures + negative cases.
- **Replace** `vendor/pako_inflate.min.js` with `vendor/pako.min.js` (full build).
- **Modify** `src/i18n.js` — add edit-mode keys and encoder error keys (en + ru).
- **Modify** `index.html` — change vendored script tag to the new pako file.
- **Modify** `src/app.js` — add edit state, render edit textarea, wire encode flow, render result panel.
- **Modify** `styles.css` — small additions for the edit textarea and result panel.

---

## Task 1: Vendor full pako

**Files:**
- Create: `vendor/pako.min.js`
- Delete: `vendor/pako_inflate.min.js`
- Modify: `index.html`

- [ ] **Step 1: Copy the full pako build into `vendor/`**

Run:
```bash
cp node_modules/pako/dist/pako.min.js vendor/pako.min.js
ls -la vendor/
```
Expected: `vendor/pako.min.js` exists and is ~45-50 KB.

- [ ] **Step 2: Delete the old inflate-only file**

Run:
```bash
rm vendor/pako_inflate.min.js
ls vendor/
```
Expected: only `pako.min.js` remains.

- [ ] **Step 3: Update the script tag in `index.html`**

In `index.html`, change:
```html
<script src="vendor/pako_inflate.min.js"></script>
```
to:
```html
<script src="vendor/pako.min.js"></script>
```

- [ ] **Step 4: Confirm decoder tests still pass**

Run: `npm test`
Expected: all 16 tests pass (the npm-installed pako in tests is unaffected).

- [ ] **Step 5: Sanity-check the new vendored file exposes both inflate and deflate (Node check, parses-as-script form)**

Pako's UMD build assigns `pako` to a global. Verify:
```bash
node -e "
const fs = require('fs');
const code = fs.readFileSync('vendor/pako.min.js', 'utf8');
// crude smoke check — does the bundle reference both deflate and inflate?
console.log('has inflate:', code.includes('inflate'));
console.log('has deflate:', code.includes('deflate'));
console.log('size:', code.length, 'bytes');
"
```
Expected: both `true`, size around 45-50 KB.

---

## Task 2: `src/encode.js` and round-trip tests (TDD)

**Files:**
- Create: `src/encode.js`
- Create: `src/encode.test.js`

- [ ] **Step 1: Write failing tests first**

Create `src/encode.test.js`:

```js
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
```

- [ ] **Step 2: Run tests — they must fail**

Run: `npm test`
Expected: all 11 new tests fail because `src/encode.js` does not exist. The existing 16 decoder tests still pass.

- [ ] **Step 3: Create `src/encode.js`**

```js
// Pure encoder: turns a JSON object back into a Factorio blueprint
// string. Mirror of `decode.js`: no DOM, no locale knowledge, errors
// surfaced as `EncodeError` with stable codes. The UI layer is
// responsible for parsing user-typed JSON (textarea contents) before
// calling encode.

export const ErrorCodes = Object.freeze({
  INTERNAL_NO_DEFLATE: 'INTERNAL_NO_DEFLATE',
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  BAD_PAYLOAD: 'BAD_PAYLOAD'
})

const DEFAULT_MESSAGES = {
  INTERNAL_NO_DEFLATE: 'Internal error: deflate function missing',
  NOT_AN_OBJECT: 'Encoder expected an object at the root',
  BAD_PAYLOAD: 'JSON cannot be serialised (circular references?)'
}

export class EncodeError extends Error {
  constructor(code) {
    super(DEFAULT_MESSAGES[code] ?? code)
    this.name = 'EncodeError'
    this.code = code
  }
}

function bytesToBase64(bytes) {
  // Cross-environment: btoa in browser, Buffer in Node.
  if (typeof btoa === 'function') {
    let bin = ''
    // Chunk to keep `String.fromCharCode.apply` happy on big payloads.
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(bin)
  }
  return Buffer.from(bytes).toString('base64')
}

export function encode(json, { deflate } = {}) {
  if (typeof deflate !== 'function') {
    throw new EncodeError(ErrorCodes.INTERNAL_NO_DEFLATE)
  }
  if (json === null || typeof json !== 'object') {
    throw new EncodeError(ErrorCodes.NOT_AN_OBJECT)
  }

  let payload
  try {
    payload = JSON.stringify(json)
  } catch {
    throw new EncodeError(ErrorCodes.BAD_PAYLOAD)
  }
  if (typeof payload !== 'string') {
    // `JSON.stringify` returns `undefined` for unsupported root types
    // (functions, symbols). Treat as a payload error.
    throw new EncodeError(ErrorCodes.BAD_PAYLOAD)
  }

  const bytes = new TextEncoder().encode(payload)
  const compressed = deflate(bytes)
  const b64 = bytesToBase64(compressed)
  return '0' + b64
}
```

- [ ] **Step 4: Run tests — they must pass**

Run: `npm test`
Expected: all 27 tests pass (16 decoder + 11 encoder).

---

## Task 3: i18n keys for edit mode and encoder errors

**Files:**
- Modify: `src/i18n.js`

- [ ] **Step 1: Add new keys to both locale blocks**

In `src/i18n.js`, inside the `messages.en` block, append (preserve existing keys; add these new ones at the end of the block, just before the closing `}`):

```js
'buttons.encode': 'Encode',
'buttons.cancel': 'Cancel',
'buttons.close': 'Close',
'buttons.copyResult': 'Copy result',

'editor.title': 'Edit JSON',
'result.title': 'Blueprint string',

'errors.BAD_JSON_INPUT': 'Invalid JSON in editor',
'errors.INTERNAL_NO_DEFLATE': 'Internal error: deflate function missing',
'errors.NOT_AN_OBJECT': 'Encoder expected an object at the root',
'errors.BAD_PAYLOAD': 'JSON cannot be serialised (circular references?)'
```

In the `messages.ru` block, append the matching Russian translations:

```js
'buttons.encode': 'Кодировать',
'buttons.cancel': 'Отмена',
'buttons.close': 'Закрыть',
'buttons.copyResult': 'Копировать строку',

'editor.title': 'Редактирование JSON',
'result.title': 'Строка чертежа',

'errors.BAD_JSON_INPUT': 'Невалидный JSON в редакторе',
'errors.INTERNAL_NO_DEFLATE': 'Внутренняя ошибка: не передан deflate',
'errors.NOT_AN_OBJECT': 'Кодер ожидает объект в корне',
'errors.BAD_PAYLOAD': 'JSON невозможно сериализовать (циклические ссылки?)'
```

Note: `buttons.edit` already exists in v1.1 (used by the collapsed-input header). Reuse it; do not redefine.

- [ ] **Step 2: Sanity-check the module**

Run:
```bash
node --input-type=module -e "
import('./src/i18n.js').then(m => {
  m.setLocale('en'); console.log('en:', m.t('buttons.encode'), '|', m.t('errors.BAD_JSON_INPUT'))
  m.setLocale('ru'); console.log('ru:', m.t('buttons.encode'), '|', m.t('errors.BAD_JSON_INPUT'))
}).catch(e => { console.error('fail:', e.message); process.exit(1) })
"
```
Expected:
```
en: Encode | Invalid JSON in editor
ru: Кодировать | Невалидный JSON в редакторе
```

- [ ] **Step 3: Confirm tests still pass**

Run: `npm test`
Expected: 27 tests pass.

---

## Task 4: `app.js` — edit mode and result panel

**Files:**
- Modify: `src/app.js`

This task adds the most code. The approach: extend the state object with edit-mode fields, branch in `renderDecoded` based on `state.editing`, add new event handlers for `Edit / Encode / Cancel / Close / Copy result`, render the result panel below.

- [ ] **Step 1: Add `encode` import and extend state**

At the top of `src/app.js`, change:
```js
import { decode, DecodeError } from './decode.js'
import { t, setLocale, getLocale, detectLocale } from './i18n.js'
```
to:
```js
import { decode, DecodeError } from './decode.js'
import { encode, EncodeError } from './encode.js'
import { t, setLocale, getLocale, detectLocale } from './i18n.js'
```

In the `state` object literal, add after `selectedPath: []`:
```js
,
editing: false,
draft: '',
encodeResult: null,
encodeError: null
```

So the full block becomes:

```js
const state = {
  phase: 'empty',     // 'empty' | 'decoded' | 'error'
  input: '',
  result: null,
  error: null,
  view: 'json',       // 'json' | 'tree'
  selectedPath: [],   // [] = root
  editing: false,
  draft: '',
  encodeResult: null,
  encodeError: null
}
```

- [ ] **Step 2: Helper: produce the JSON to encode for the current selection**

Append a helper near the existing `getNodeAtPath` function:

```js
// What we encode for the current selection. For book children we strip
// the `index` field — it is a position marker inside the parent and is
// meaningless in a standalone blueprint string.
function selectionForEncode(result, path) {
  const node = getNodeAtPath(result, path)
  if (path.length === 0) return result.json
  // node.json is the wrapper, e.g. { index: 0, blueprint: {...} } — clone and drop `index`.
  const { index: _drop, ...rest } = node.json
  return rest
}
```

- [ ] **Step 3: Replace the part of `renderDecoded` that draws the JSON view + actions**

In `renderDecoded`, the existing branch is:

```js
${s.view === 'json' || !showTree ? `
  <pre class="json">${escapeHtml(jsonText)}</pre>
  <div class="actions">
    <button id="btn-copy">${escapeHtml(t('buttons.copy'))}</button>
    <button id="btn-download">${escapeHtml(t('buttons.download'))}</button>
  </div>
` : `
  ${renderTree(r.children, s.selectedPath)}
`}
```

Replace it with:

```js
${s.view === 'json' || !showTree ? `
  ${s.editing ? `
    <textarea id="json-editor" class="json-editor" spellcheck="false">${escapeHtml(s.draft)}</textarea>
    <div class="actions">
      <button id="btn-encode" class="primary">${escapeHtml(t('buttons.encode'))}</button>
      <button id="btn-cancel">${escapeHtml(t('buttons.cancel'))}</button>
    </div>
  ` : `
    <pre class="json">${escapeHtml(jsonText)}</pre>
    <div class="actions">
      <button id="btn-edit-json">${escapeHtml(t('buttons.edit'))}</button>
      <button id="btn-copy">${escapeHtml(t('buttons.copy'))}</button>
      <button id="btn-download">${escapeHtml(t('buttons.download'))}</button>
    </div>
  `}
  ${s.encodeError ? `<p class="error">${escapeHtml(s.encodeError)}</p>` : ''}
  ${s.encodeResult !== null ? `
    <div class="result-panel">
      <div class="result-header">${escapeHtml(t('result.title'))}</div>
      <textarea readonly class="result-text">${escapeHtml(s.encodeResult)}</textarea>
      <div class="actions">
        <button id="btn-copy-result">${escapeHtml(t('buttons.copyResult'))}</button>
        <button id="btn-close-result">${escapeHtml(t('buttons.close'))}</button>
      </div>
    </div>
  ` : ''}
` : `
  ${renderTree(r.children, s.selectedPath)}
`}
```

- [ ] **Step 4: Wire the new buttons in `wireDecoded`**

Inside the existing `wireDecoded` function, before the closing `}`, append:

```js
  // View → Edit
  document.getElementById('btn-edit-json')?.addEventListener('click', () => {
    state.editing = true
    state.encodeResult = null
    state.encodeError = null
    const node = selectionForEncode(state.result, state.selectedPath)
    state.draft = JSON.stringify(node, null, 2)
    render()
    document.getElementById('json-editor')?.focus()
  })
  // Edit → keep state.draft in sync as the user types
  document.getElementById('json-editor')?.addEventListener('input', e => {
    state.draft = e.target.value
  })
  document.getElementById('btn-encode')?.addEventListener('click', onEncode)
  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    state.editing = false
    state.draft = ''
    state.encodeResult = null
    state.encodeError = null
    render()
  })
  document.getElementById('btn-copy-result')?.addEventListener('click', onCopyResult)
  document.getElementById('btn-close-result')?.addEventListener('click', () => {
    state.encodeResult = null
    state.encodeError = null
    render()
  })
```

- [ ] **Step 5: Implement `onEncode` and `onCopyResult`**

Append after the existing `onDownload` function (and before the static-text helpers):

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

async function onCopyResult() {
  const text = state.encodeResult ?? ''
  try {
    await navigator.clipboard.writeText(text)
    const btn = document.getElementById('btn-copy-result')
    if (!btn) return
    const old = btn.textContent
    btn.textContent = t('buttons.copied')
    setTimeout(() => { btn.textContent = old }, 1200)
  } catch {
    alert(t('clipboard.failure'))
  }
}
```

- [ ] **Step 6: Reset edit state on tab/tree clicks and clear**

In `wireDecoded`, find the existing tab-click handler:

```js
document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    state.view = el.dataset.view
    render()
  })
})
```

Replace with:

```js
document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    state.view = el.dataset.view
    state.editing = false
    state.draft = ''
    state.encodeResult = null
    state.encodeError = null
    render()
  })
})
```

Find the existing tree-node click handler:

```js
document.querySelectorAll('.tree-node').forEach(el => {
  el.addEventListener('click', () => {
    const path = el.dataset.path.split(',').map(Number)
    state.selectedPath = path
    state.view = 'json'
    render()
  })
})
```

Replace with:

```js
document.querySelectorAll('.tree-node').forEach(el => {
  el.addEventListener('click', () => {
    const path = el.dataset.path.split(',').map(Number)
    state.selectedPath = path
    state.view = 'json'
    state.editing = false
    state.draft = ''
    state.encodeResult = null
    state.encodeError = null
    render()
  })
})
```

In the existing `onClear` function, add resets at the top so a `Clear` from the input form also wipes any leftover edit state. Replace `onClear` with:

```js
function onClear() {
  state.phase = 'empty'
  state.input = ''
  state.result = null
  state.error = null
  state.editing = false
  state.draft = ''
  state.encodeResult = null
  state.encodeError = null
  render()
}
```

Same for the `Edit` (collapsed-input) button — find this in `wireDecoded`:

```js
document.getElementById('btn-edit')?.addEventListener('click', () => {
  state.phase = 'empty'
  render()
  document.getElementById('bp-input')?.focus()
})
```

Replace with:

```js
document.getElementById('btn-edit')?.addEventListener('click', () => {
  state.phase = 'empty'
  state.editing = false
  state.draft = ''
  state.encodeResult = null
  state.encodeError = null
  render()
  document.getElementById('bp-input')?.focus()
})
```

Note: there is now a `btn-edit` (the collapsed-input "Edit" button on the input header) **and** a `btn-edit-json` (the new "Edit" button next to Copy/Download). They have different IDs and do different things; keep them separate.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: all 27 tests pass — encoder + decoder are untouched by app.js changes.

- [ ] **Step 8: Sanity-check `app.js` parses as ESM**

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

## Task 5: Styles for editor and result panel

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Append new styles to `styles.css`**

Append (do not rewrite):

```css
/* JSON edit mode */
textarea.json-editor {
  width: 100%;
  min-height: 360px;
  margin-top: 8px;
  padding: 12px;
  background: #1e1e22;
  color: #f3f3f3;
  border: 1px solid #333;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  white-space: pre;
  overflow: auto;
}

.result-panel {
  margin-top: 16px;
  padding: 12px;
  background: #fff;
  border: 1px solid #d0d0d5;
  border-radius: 6px;
}
.result-panel .result-header {
  font-size: 12px;
  color: #555;
  margin-bottom: 6px;
  font-weight: 600;
}
.result-panel textarea.result-text {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  border: 1px solid #d0d0d5;
  border-radius: 4px;
  background: #fafafa;
  resize: vertical;
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: 27 tests pass (CSS doesn't affect tests, but confirm nothing was inadvertently broken).

---

## Task 6: Final test sweep + manual UI checklist

**Files:** none (verification only)

- [ ] **Step 1: All tests green**

Run: `npm test`
Expected: 27 tests pass.

- [ ] **Step 2: i18n smoke**

```bash
node --input-type=module -e "
import('./src/i18n.js').then(m => {
  m.setLocale('en'); console.log('en encode label:', m.t('buttons.encode'))
  m.setLocale('ru'); console.log('ru encode label:', m.t('buttons.encode'))
})
"
```
Expected:
```
en encode label: Encode
ru encode label: Кодировать
```

- [ ] **Step 3: Manual UI sweep (the user runs this in the browser; the implementer mentions it in the report)**

1. Open `index.html` (or the deployed site).
2. Paste `src/__fixtures__/single-blueprint.txt` content → Decode.
3. Click `Edit` → JSON appears in a dark textarea, action row shows `Encode` + `Cancel`.
4. Click `Encode` without changing anything → result panel appears below with a fresh blueprint string.
5. Copy the result → paste into the input area → Decode → the JSON should be **deeply equal** to the original (label "Test belt", same entity).
6. Click `Cancel` → returns to read-only `<pre>` view, no result panel.
7. Click `Edit` again → modify the `label` from "Test belt" to "Edited belt" → `Encode` → copy → Decode → label is "Edited belt".
8. Decode `nested-book.txt` → click `Children` → click `Inner A` → JSON shows the nested blueprint → `Edit` → `Encode` → copy → Decode → kind is `blueprint`, label is "Inner A", standalone (not a book).
9. In the editor, break the JSON (delete a `}`) → `Encode` → red error appears, no result panel.
10. Switch locale RU ↔ EN while in edit mode → buttons re-translate, the textarea contents stay intact.

---

## Done

After Task 6 the site supports edit-then-encode, can extract sub-blueprints from books as standalone strings, has 11 new round-trip and error-path tests (27 total) and the locale switch covers all the new strings.
