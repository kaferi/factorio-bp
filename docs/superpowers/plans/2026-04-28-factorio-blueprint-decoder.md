# Factorio Blueprint Decoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Static GitHub Pages site that decodes any Factorio blueprint string (blueprint, blueprint-book, deconstruction-planner, upgrade-planner) into JSON, with a tree view of nested blueprints in books.

**Architecture:** Pure client-side. `decode.js` is a DOM-free pure function returning a `DecodeResult`. `app.js` wires it to vanilla DOM (state object + `render(state)`). pako is vendored locally for zlib inflate. Vitest covers `decode.js`; UI is verified manually.

**Tech Stack:** Vanilla JS (ES modules), HTML/CSS, [pako](https://github.com/nodeca/pako) for zlib, [Vitest](https://vitest.dev/) for unit tests, Node ≥ 18 (for `npm test`).

**Spec:** [docs/superpowers/specs/2026-04-28-factorio-blueprint-decoder-design.md](../specs/2026-04-28-factorio-blueprint-decoder-design.md)

---

## File Structure

Files to create or modify:

- **Create** `package.json` — declares Vitest dev dep, `npm test` script, ESM module type.
- **Create** `.gitignore` — `node_modules/`, `.superpowers/`, OS junk.
- **Create** `vendor/pako_inflate.min.js` — vendored pako (inflate-only build, ~26 KB) downloaded from npm.
- **Create** `src/decode.js` — pure decoder; exports `decode(input)` and `DecodeError`. No DOM.
- **Create** `src/decode.test.js` — Vitest unit tests for `decode.js`. Uses fixtures.
- **Create** `src/__fixtures__/*.txt` — real blueprint strings (positive + negative cases).
- **Create** `src/app.js` — UI state + event wiring + `render(state)`. Imports `decode` from `decode.js`.
- **Modify** `index.html` — replace placeholder content with the decoder UI; load pako globally and `app.js` as ESM.
- **Modify** `styles.css` — replace boilerplate with decoder styles (input/result blocks, summary banner, tabs, tree, error text).
- **Modify** `README.md` — describe the tool, how to run tests, how to deploy.

Boundaries:
- `decode.js` knows nothing about DOM or pako module system — it expects `pako.inflate` to be available globally (browser via `<script>`) or imported (Node test). To keep one source of truth, `decode.js` accepts an injected `inflate` function: `decode(input, { inflate })`. The browser passes `window.pako.inflate`; tests pass the npm-installed `pako`'s inflate.
- `app.js` owns all DOM and event handling. It only calls `decode(...)` and reads `DecodeResult`.

---

## Task 1: Project skeleton and tooling

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Modify: `index.html` (clear body, leave only header/footer placeholder)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "factorio-blueprint-decoder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Online tool that decodes Factorio blueprint strings into JSON",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "pako": "^2.1.0",
    "vitest": "^2.1.0"
  }
}
```

Note: pako is in `devDependencies` because tests need it under Node. The browser uses the vendored copy in `vendor/`.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.superpowers/
.DS_Store
Thumbs.db
*.log
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: creates `node_modules/`, `package-lock.json`. No errors.

- [ ] **Step 4: Verify Vitest runs (no tests yet)**

Run: `npm test`
Expected: Vitest exits cleanly with "No test files found" (exit code 0 or 1 — either is fine, just no crash).

- [ ] **Step 5: Replace `index.html` body with empty decoder shell**

Replace the entire file with:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Factorio Blueprint Decoder</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-header">
    <h1>Factorio Blueprint Decoder</h1>
    <p class="subtitle">Вставь строку чертежа — получишь JSON.</p>
  </header>

  <main id="app" class="content">
    <!-- populated by src/app.js -->
  </main>

  <footer class="site-footer">
    <p>Работает локально в браузере. Строка никуда не отправляется.</p>
  </footer>

  <script src="vendor/pako_inflate.min.js"></script>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Smoke-check the page loads**

Open `index.html` in a browser (double-click or `npx serve .`). Expected: header and footer visible, no console errors yet (the script tags will 404 — that's OK, fixed in later tasks).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore index.html
git commit -m "chore: scaffold project (package.json, gitignore, html shell)"
```

---

## Task 2: Vendor pako (inflate-only build)

**Files:**
- Create: `vendor/pako_inflate.min.js`

- [ ] **Step 1: Locate the vendored file inside the installed package**

Run: `ls node_modules/pako/dist/`
Expected: among the listed files there is `pako_inflate.min.js` (~26 KB).

- [ ] **Step 2: Copy it into `vendor/`**

Run: `mkdir -p vendor && cp node_modules/pako/dist/pako_inflate.min.js vendor/pako_inflate.min.js`

- [ ] **Step 3: Verify it loads in the browser and exposes `pako`**

Open `index.html`, then in DevTools console run: `typeof pako.inflate`
Expected: `'function'`.

- [ ] **Step 4: Commit**

```bash
git add vendor/pako_inflate.min.js
git commit -m "chore: vendor pako inflate-only build"
```

---

## Task 3: `decode.js` — error class and prefix check (TDD)

**Files:**
- Create: `src/decode.js`
- Create: `src/decode.test.js`

- [ ] **Step 1: Write failing tests for empty input and bad prefix**

Create `src/decode.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { inflate } from 'pako'
import { decode, DecodeError } from './decode.js'

const opts = { inflate }

describe('decode — basic validation', () => {
  it('throws DecodeError on empty input', () => {
    expect(() => decode('', opts)).toThrow(DecodeError)
    expect(() => decode('   ', opts)).toThrow(/Пустая строка/)
  })

  it('throws DecodeError when prefix is not "0"', () => {
    expect(() => decode('1abcdef', opts)).toThrow(/начинаться с «0»/)
  })

  it('DecodeError is a subclass of Error', () => {
    const e = new DecodeError('x')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('DecodeError')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module `./decode.js` not found.

- [ ] **Step 3: Write minimal `decode.js` to make tests pass**

Create `src/decode.js`:

```js
export class DecodeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DecodeError'
  }
}

export function decode(input, { inflate } = {}) {
  if (typeof input !== 'string') {
    throw new DecodeError('Ожидается строка')
  }
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new DecodeError('Пустая строка')
  }
  if (trimmed[0] !== '0') {
    throw new DecodeError('Строка должна начинаться с «0»')
  }
  // The rest is implemented in later tasks.
  throw new DecodeError('Не реализовано')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/decode.js src/decode.test.js
git commit -m "feat(decode): add DecodeError and basic input validation"
```

---

## Task 4: Decode pipeline — base64 → inflate → JSON.parse

**Files:**
- Modify: `src/decode.js`
- Modify: `src/decode.test.js`
- Create: `src/__fixtures__/single-blueprint.txt`
- Create: `src/__fixtures__/corrupt-base64.txt`
- Create: `src/__fixtures__/truncated.txt`
- Create: `src/__fixtures__/bad-json.txt`

- [ ] **Step 1: Generate the fixture for a known-good single blueprint**

We need a real Factorio string. Build a tiny one programmatically (a single transport-belt at 0,0) so the test is deterministic. Add a one-off script call inline using Node:

Run:
```bash
node -e "
const pako = require('pako');
const obj = {
  blueprint: {
    icons: [{ signal: { type: 'item', name: 'transport-belt' }, index: 1 }],
    entities: [{ entity_number: 1, name: 'transport-belt', position: { x: 0, y: 0 }, direction: 0 }],
    item: 'blueprint',
    label: 'Test belt',
    version: 281474983067648
  }
};
const json = JSON.stringify(obj);
const deflated = pako.deflate(json);
const b64 = Buffer.from(deflated).toString('base64');
require('fs').writeFileSync('src/__fixtures__/single-blueprint.txt', '0' + b64);
console.log('OK', ('0' + b64).length, 'chars');
"
```
Expected: prints `OK <N> chars` and creates the file.

- [ ] **Step 2: Generate negative fixtures**

```bash
mkdir -p src/__fixtures__
# Wrong-prefix fixture is implicit (we pass '1xxx' inline in the test) — no file needed.
# Corrupt base64: starts with 0 but contains invalid base64 chars.
node -e "require('fs').writeFileSync('src/__fixtures__/corrupt-base64.txt', '0!!!@@@###')"
# Truncated: take the good fixture and chop off the last 20 chars.
node -e "
const fs = require('fs');
const s = fs.readFileSync('src/__fixtures__/single-blueprint.txt', 'utf8');
fs.writeFileSync('src/__fixtures__/truncated.txt', s.slice(0, -20));
"
# Bad JSON: deflate a non-JSON string and prefix with 0.
node -e "
const pako = require('pako');
const deflated = pako.deflate('this is not json {{{');
const b64 = Buffer.from(deflated).toString('base64');
require('fs').writeFileSync('src/__fixtures__/bad-json.txt', '0' + b64);
"
```

- [ ] **Step 3: Add failing tests for the full pipeline**

Append to `src/decode.test.js`:

```js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(here, '__fixtures__', name), 'utf8')

describe('decode — pipeline', () => {
  it('decodes a real single blueprint into JSON', () => {
    const result = decode(fixture('single-blueprint.txt'), opts)
    expect(result.json).toBeTypeOf('object')
    expect(result.json.blueprint).toBeDefined()
    expect(result.json.blueprint.entities).toHaveLength(1)
    expect(result.json.blueprint.entities[0].name).toBe('transport-belt')
  })

  it('throws DecodeError on corrupt base64', () => {
    expect(() => decode(fixture('corrupt-base64.txt'), opts)).toThrow(/base64/i)
  })

  it('throws DecodeError on truncated input (zlib failure)', () => {
    expect(() => decode(fixture('truncated.txt'), opts)).toThrow(/zlib/i)
  })

  it('throws DecodeError on broken JSON payload', () => {
    expect(() => decode(fixture('bad-json.txt'), opts)).toThrow(/JSON/i)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: 4 new tests fail (pipeline not implemented).

- [ ] **Step 5: Implement the pipeline in `decode.js`**

Replace the `throw new DecodeError('Не реализовано')` line with the full pipeline. Final `decode.js`:

```js
export class DecodeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DecodeError'
  }
}

function base64ToBytes(b64) {
  // Cross-environment: atob in browser, Buffer in Node.
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

export function decode(input, { inflate } = {}) {
  if (typeof input !== 'string') {
    throw new DecodeError('Ожидается строка')
  }
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new DecodeError('Пустая строка')
  }
  if (trimmed[0] !== '0') {
    throw new DecodeError('Строка должна начинаться с «0»')
  }
  if (typeof inflate !== 'function') {
    throw new DecodeError('Внутренняя ошибка: не передан inflate')
  }

  const b64 = trimmed.slice(1)

  let bytes
  try {
    bytes = base64ToBytes(b64)
  } catch (e) {
    throw new DecodeError('Неверный base64')
  }

  let jsonText
  try {
    jsonText = inflate(bytes, { to: 'string' })
  } catch (e) {
    throw new DecodeError('Неверные zlib-данные')
  }

  let json
  try {
    json = JSON.parse(jsonText)
  } catch (e) {
    throw new DecodeError('Повреждённый JSON')
  }

  return {
    kind: 'unknown',     // filled in Task 5
    label: null,         // filled in Task 5
    version: null,       // filled in Task 5
    versionString: null, // filled in Task 5
    json,
    children: []         // filled in Task 6
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/decode.js src/decode.test.js src/__fixtures__/
git commit -m "feat(decode): implement base64 → inflate → JSON pipeline"
```

---

## Task 5: Identify `kind`, `label`, parse version

**Files:**
- Modify: `src/decode.js`
- Modify: `src/decode.test.js`
- Create: `src/__fixtures__/deconstruction-planner.txt`
- Create: `src/__fixtures__/upgrade-planner.txt`

- [ ] **Step 1: Generate planner fixtures**

```bash
node -e "
const pako = require('pako');
const fs = require('fs');
function pack(obj) {
  return '0' + Buffer.from(pako.deflate(JSON.stringify(obj))).toString('base64');
}
fs.writeFileSync('src/__fixtures__/deconstruction-planner.txt', pack({
  deconstruction_planner: { item: 'deconstruction-planner', label: 'Decon test', version: 281474983067648 }
}));
fs.writeFileSync('src/__fixtures__/upgrade-planner.txt', pack({
  upgrade_planner: { item: 'upgrade-planner', label: 'Up test', version: 281474983067648 }
}));
console.log('OK');
"
```

- [ ] **Step 2: Add failing tests for kind/label/version parsing**

Append to `src/decode.test.js`:

```js
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
    // 281474983067648 = 0x0001_0000_0061_0000 → 1.0.97.0
    const r = decode(fixture('single-blueprint.txt'), opts)
    expect(r.versionString).toBe('1.0.97.0')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: 4 new tests fail (kind is `'unknown'`, label/version are `null`).

- [ ] **Step 4: Implement classification and version parsing**

In `src/decode.js`, add helpers and replace the trailing `return { ... }`:

```js
const ROOT_KEYS = {
  blueprint: 'blueprint',
  blueprint_book: 'blueprint-book',
  deconstruction_planner: 'deconstruction-planner',
  upgrade_planner: 'upgrade-planner'
}

function classify(json) {
  for (const key of Object.keys(ROOT_KEYS)) {
    if (json && typeof json === 'object' && json[key]) {
      return { kind: ROOT_KEYS[key], inner: json[key] }
    }
  }
  return { kind: 'unknown', inner: null }
}

function parseVersion(raw) {
  if (typeof raw !== 'number') return null
  // Factorio packs version as 4×16-bit big-endian: major.minor.patch.dev.
  // Use BigInt to avoid 53-bit precision loss on the high word.
  const big = BigInt(raw)
  const major = Number((big >> 48n) & 0xffffn)
  const minor = Number((big >> 32n) & 0xffffn)
  const patch = Number((big >> 16n) & 0xffffn)
  const dev   = Number(big & 0xffffn)
  return `${major}.${minor}.${patch}.${dev}`
}
```

Then replace the `return { ... }` at the bottom of `decode` with:

```js
  const { kind, inner } = classify(json)
  const label = (inner && typeof inner.label === 'string') ? inner.label : null
  const version = (inner && typeof inner.version === 'number') ? inner.version : null
  const versionString = parseVersion(version)

  return {
    kind,
    label,
    version,
    versionString,
    json,
    children: []  // filled in Task 6
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/decode.js src/decode.test.js src/__fixtures__/
git commit -m "feat(decode): classify root kind and parse version (4×16-bit)"
```

---

## Task 6: Flatten blueprint-book children (with nesting)

**Files:**
- Modify: `src/decode.js`
- Modify: `src/decode.test.js`
- Create: `src/__fixtures__/blueprint-book.txt`
- Create: `src/__fixtures__/nested-book.txt`

- [ ] **Step 1: Generate book fixtures**

```bash
node -e "
const pako = require('pako');
const fs = require('fs');
function pack(obj) {
  return '0' + Buffer.from(pako.deflate(JSON.stringify(obj))).toString('base64');
}
const VERSION = 281474983067648;
function bp(label) {
  return { blueprint: { item: 'blueprint', label, entities: [], version: VERSION } };
}
function book(label, blueprints) {
  return { blueprint_book: { item: 'blueprint-book', label, blueprints: blueprints.map((b, i) => ({ index: i, ...b })), version: VERSION } };
}
// Flat book with 3 blueprints.
fs.writeFileSync('src/__fixtures__/blueprint-book.txt', pack(book('Mall', [bp('Red'), bp('Green'), bp('Blue')])));
// Nested book: top book has [bp, sub-book[bp, bp]].
fs.writeFileSync('src/__fixtures__/nested-book.txt', pack(book('Outer', [bp('Top item'), book('Inner', [bp('Inner A'), bp('Inner B')])])));
console.log('OK');
"
```

- [ ] **Step 2: Add failing tests for `children`**

Append to `src/decode.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: 2 new tests fail (children is `[]` for books).

- [ ] **Step 4: Implement child flattening**

In `src/decode.js`, add a helper above `decode`:

```js
function collectChildren(bookInner, prefix) {
  // bookInner is the object under `blueprint_book` key.
  const out = []
  const list = Array.isArray(bookInner.blueprints) ? bookInner.blueprints : []
  list.forEach((entry, i) => {
    const path = [...prefix, i]
    const { kind, inner } = classify(entry)
    if (kind === 'unknown' || inner === null) return
    const label = (typeof inner.label === 'string') ? inner.label : null
    out.push({ path, kind, label, json: entry })
    if (kind === 'blueprint-book') {
      out.push(...collectChildren(inner, path))
    }
  })
  return out
}
```

Then in `decode`, after computing `kind`/`inner`, replace `children: []` with:

```js
  const children = (kind === 'blueprint-book' && inner) ? collectChildren(inner, []) : []
```

And update the return object accordingly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all 14 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/decode.js src/decode.test.js src/__fixtures__/
git commit -m "feat(decode): flatten nested blueprint-book children with paths"
```

---

## Task 7: Wrong-prefix message and final decoder polish

**Files:**
- Modify: `src/decode.test.js`

- [ ] **Step 1: Add a sanity test that the unknown-kind case still returns json**

Append to `src/decode.test.js`:

```js
describe('decode — unknown root', () => {
  it('returns kind="unknown" if root has no recognised key', () => {
    // Build a payload with a bogus root key.
    const pako = await import('pako')
    const { Buffer } = await import('node:buffer')
    const payload = '0' + Buffer.from(pako.deflate(JSON.stringify({ mystery: { label: 'X' } }))).toString('base64')
    const r = decode(payload, opts)
    expect(r.kind).toBe('unknown')
    expect(r.json.mystery.label).toBe('X')
    expect(r.children).toEqual([])
  })
})
```

The test must be in an `it` with `async` because of the dynamic imports. Adjust the signature: `it('...', async () => { ... })`.

- [ ] **Step 2: Run tests to verify it passes**

Run: `npm test`
Expected: all 15 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/decode.test.js
git commit -m "test(decode): cover unknown root kind"
```

---

## Task 8: UI shell — state + render skeleton

**Files:**
- Create: `src/app.js`
- Modify: `styles.css`

- [ ] **Step 1: Replace `styles.css` with the decoder styles**

Replace the entire file with:

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f7f7f8;
  color: #222;
  line-height: 1.5;
}

.site-header,
.content,
.site-footer {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.site-header h1 { margin: 0 0 4px; font-size: 24px; }
.site-header .subtitle { margin: 0; color: #666; font-size: 14px; }

.site-footer {
  color: #888;
  font-size: 12px;
  border-top: 1px solid #e5e5e5;
  margin-top: 24px;
}

textarea#bp-input {
  width: 100%;
  min-height: 140px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 10px;
  border: 1px solid #d0d0d5;
  border-radius: 6px;
  resize: vertical;
}

.btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

button {
  font: inherit;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #d0d0d5;
  background: #fff;
  cursor: pointer;
}
button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
button.primary:hover { background: #1d4ed8; }
button:hover { background: #f0f0f3; }
button.primary:hover { background: #1d4ed8; }

.error {
  margin-top: 8px;
  color: #b00020;
  font-size: 13px;
}

.input-collapsed {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #ececef;
  border-radius: 6px;
  font-size: 12px;
}
.input-collapsed .preview {
  flex: 1;
  font-family: ui-monospace, monospace;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.summary {
  margin-top: 12px;
  padding: 8px 12px;
  background: #eef6ff;
  border-left: 3px solid #2563eb;
  border-radius: 4px;
  font-size: 13px;
}

.tabs { margin-top: 12px; display: flex; gap: 6px; }
.tab {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  background: #ececef;
  cursor: pointer;
  user-select: none;
}
.tab.active { background: #2563eb; color: #fff; }

pre.json {
  margin: 8px 0 0;
  padding: 12px;
  background: #1e1e22;
  color: #f3f3f3;
  border-radius: 6px;
  overflow: auto;
  max-height: 60vh;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

ul.tree, ul.tree ul { list-style: none; padding-left: 16px; margin: 0; }
ul.tree { padding-left: 0; }
.tree-node {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 13px;
}
.tree-node:hover { background: #eef; }
.tree-node.selected { background: #2563eb; color: #fff; }
.tree-node .toggle { display: inline-block; width: 14px; color: #888; }
.tree-node .badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #ddd;
  color: #444;
  margin-left: 6px;
}

.actions { display: flex; gap: 8px; margin-top: 10px; }

@media (max-width: 480px) {
  .site-header, .content, .site-footer { padding: 16px; }
}
```

- [ ] **Step 2: Create `src/app.js` with state and a no-op render**

```js
import { decode, DecodeError } from './decode.js'

const root = document.getElementById('app')

const state = {
  phase: 'empty',     // 'empty' | 'decoded' | 'error'
  input: '',
  result: null,       // DecodeResult
  error: null,        // string
  view: 'json',       // 'json' | 'tree'
  selectedPath: []    // [] = root
}

function render() {
  // Replaced in later tasks. For now, draw the empty input form.
  root.innerHTML = `
    <textarea id="bp-input" placeholder="Вставь сюда строку чертежа Factorio (начинается с «0»)…">${escapeHtml(state.input)}</textarea>
    <div class="btn-row">
      <button id="btn-decode" class="primary">Decode</button>
      <button id="btn-paste">Paste</button>
      <button id="btn-clear">Clear</button>
    </div>
    ${state.phase === 'error' ? `<p class="error">${escapeHtml(state.error || '')}</p>` : ''}
  `
  document.getElementById('btn-decode').addEventListener('click', onDecode)
  document.getElementById('btn-paste').addEventListener('click', onPaste)
  document.getElementById('btn-clear').addEventListener('click', onClear)
  document.getElementById('bp-input').addEventListener('input', e => {
    state.input = e.target.value
  })
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function onDecode() {
  try {
    const result = decode(state.input, { inflate: window.pako.inflate })
    state.phase = 'decoded'
    state.result = result
    state.error = null
    state.view = 'json'
    state.selectedPath = []
  } catch (e) {
    state.phase = 'error'
    state.error = (e instanceof DecodeError) ? e.message : `Неизвестная ошибка: ${e.message}`
  }
  render()
}

async function onPaste() {
  try {
    const text = await navigator.clipboard.readText()
    state.input = text
    render()
  } catch {
    // Clipboard not available — silently ignore; user can paste manually.
  }
}

function onClear() {
  state.phase = 'empty'
  state.input = ''
  state.result = null
  state.error = null
  render()
}

render()
```

- [ ] **Step 3: Smoke-test in the browser**

Open `index.html` in a browser. Expected:
- See textarea, three buttons, no console errors.
- Type garbage `1abc` → click Decode → red error «Строка должна начинаться с «0»» appears.
- Paste a real blueprint string → click Decode → no visible result yet (renderer not finished), but **no error** in the console either.

(If `Paste` button does nothing, that's fine — clipboard API is permission-gated.)

- [ ] **Step 4: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat(ui): app shell with state + decode wiring"
```

---

## Task 9: Render decoded state — collapsed input, summary, JSON pane

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Replace `render()` with the full version**

In `src/app.js`, replace the body of `render()` with:

```js
function render() {
  if (state.phase === 'decoded') {
    root.innerHTML = renderDecoded(state)
    wireDecoded()
    return
  }
  // empty or error — show input form
  root.innerHTML = `
    <textarea id="bp-input" placeholder="Вставь сюда строку чертежа Factorio (начинается с «0»)…">${escapeHtml(state.input)}</textarea>
    <div class="btn-row">
      <button id="btn-decode" class="primary">Decode</button>
      <button id="btn-paste">Paste</button>
      <button id="btn-clear">Clear</button>
    </div>
    ${state.phase === 'error' ? `<p class="error">${escapeHtml(state.error || '')}</p>` : ''}
  `
  document.getElementById('btn-decode').addEventListener('click', onDecode)
  document.getElementById('btn-paste').addEventListener('click', onPaste)
  document.getElementById('btn-clear').addEventListener('click', onClear)
  document.getElementById('bp-input').addEventListener('input', e => {
    state.input = e.target.value
  })
}
```

- [ ] **Step 2: Add `renderDecoded` and helpers**

Append to `src/app.js`:

```js
function getNodeAtPath(result, path) {
  if (path.length === 0) return { kind: result.kind, label: result.label, json: result.json }
  // Walk: root.json.blueprint_book.blueprints[idx0].blueprint_book.blueprints[idx1]...
  let cursor = result.json
  for (const idx of path) {
    // cursor is currently { blueprint_book: {...} } at start, then { blueprint: {...} } / { blueprint_book: {...} } at children
    const inner = cursor.blueprint_book ?? cursor.blueprint
    cursor = inner.blueprints[idx]
  }
  // cursor is the wrapper object e.g. { blueprint: {...} } — return it as-is for JSON view.
  // For label/kind, look up the matching child in result.children.
  const child = result.children.find(c => arraysEqual(c.path, path))
  return { kind: child?.kind ?? 'unknown', label: child?.label ?? null, json: cursor }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function renderDecoded(s) {
  const r = s.result
  const inputPreview = s.input.length > 80 ? s.input.slice(0, 80) + '…' : s.input
  const summaryParts = [
    `<strong>${r.kind}</strong>`,
    r.children.length > 0 ? `${r.children.length} чертежей` : null,
    r.versionString ? `версия ${r.versionString}` : null,
    r.label ? `«${escapeHtml(r.label)}»` : null
  ].filter(Boolean).join(' · ')

  const showTree = r.children.length > 0
  const node = getNodeAtPath(r, s.selectedPath)
  const jsonText = JSON.stringify(node.json, null, 2)

  return `
    <div class="input-collapsed">
      <span>📄 Blueprint string · ${s.input.length} символов</span>
      <span class="preview">${escapeHtml(inputPreview)}</span>
      <button id="btn-edit">Изменить</button>
    </div>
    <div class="summary">${summaryParts}</div>
    ${showTree ? `
      <div class="tabs">
        <span class="tab ${s.view === 'json' ? 'active' : ''}" data-view="json">JSON</span>
        <span class="tab ${s.view === 'tree' ? 'active' : ''}" data-view="tree">Children (${r.children.length})</span>
      </div>
    ` : ''}
    ${s.view === 'json' || !showTree ? `
      <pre class="json">${escapeHtml(jsonText)}</pre>
      <div class="actions">
        <button id="btn-copy">Copy JSON</button>
        <button id="btn-download">Download .json</button>
      </div>
    ` : `
      ${renderTree(r.children, s.selectedPath)}
    `}
  `
}

function renderTree(children, selectedPath) {
  // v1 simplification vs spec: render the flat list with depth-based
  // indentation instead of expand/collapse toggles. For typical books
  // (5-30 single-level entries) this reads cleanly; nesting is rare.
  // If books with deep nesting become common, add per-book toggles here.
  const items = children.map(c => `
    <li>
      <div class="tree-node ${arraysEqual(c.path, selectedPath) ? 'selected' : ''}"
           style="padding-left: ${c.path.length * 14}px"
           data-path="${c.path.join(',')}">
        ${escapeHtml(c.label || '(без названия)')}
        <span class="badge">${c.kind}</span>
      </div>
    </li>
  `).join('')
  return `<ul class="tree">${items}</ul>`
}

function wireDecoded() {
  document.getElementById('btn-edit')?.addEventListener('click', () => {
    state.phase = 'empty'
    render()
    document.getElementById('bp-input')?.focus()
  })
  document.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', () => {
      state.view = el.dataset.view
      render()
    })
  })
  document.querySelectorAll('.tree-node').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path === '' ? [] : el.dataset.path.split(',').map(Number)
      state.selectedPath = path
      state.view = 'json'
      render()
    })
  })
  document.getElementById('btn-copy')?.addEventListener('click', onCopy)
  document.getElementById('btn-download')?.addEventListener('click', onDownload)
}

async function onCopy() {
  const node = getNodeAtPath(state.result, state.selectedPath)
  const text = JSON.stringify(node.json, null, 2)
  try {
    await navigator.clipboard.writeText(text)
    const btn = document.getElementById('btn-copy')
    const old = btn.textContent
    btn.textContent = 'Скопировано'
    setTimeout(() => { btn.textContent = old }, 1200)
  } catch {
    alert('Не удалось скопировать в буфер обмена.')
  }
}

function onDownload() {
  const node = getNodeAtPath(state.result, state.selectedPath)
  const text = JSON.stringify(node.json, null, 2)
  const baseName = node.label || node.kind || state.result.label || state.result.kind || 'blueprint'
  const safeName = String(baseName).replace(/[^a-zA-Zа-яА-Я0-9._-]+/g, '_').slice(0, 64) || 'blueprint'
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 3: Smoke-test golden path**

Open `index.html`. Use a known blueprint string from `src/__fixtures__/single-blueprint.txt` (open the txt, copy, paste).

Expected:
- After Decode: textarea is replaced by the collapsed bar, summary shows `blueprint · версия 1.0.97.0 · «Test belt»`, JSON pane shows the full object pretty-printed.
- Click `Copy JSON` → button briefly shows «Скопировано».
- Click `Download .json` → file `Test_belt.json` downloads.
- Click `Изменить` → returns to the textarea with the previous input intact.

- [ ] **Step 4: Smoke-test book navigation**

Paste content of `src/__fixtures__/nested-book.txt`. Click Decode.

Expected:
- Summary: `blueprint-book · 4 чертежей · ... · «Outer»`.
- Tab `Children (4)` is visible. Click it → tree shows 4 entries with indentation reflecting paths.
- Click `Inner A` → JSON pane switches to that node's content; `Children` tab still selectable.

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "feat(ui): render decoded state with summary, JSON pane, tree, copy/download"
```

---

## Task 10: README and final polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`**

Replace the entire file with:

```markdown
# Factorio Blueprint Decoder

Statically-hosted (GitHub Pages) tool that decodes a Factorio blueprint string
(`blueprint`, `blueprint-book`, `deconstruction-planner`, `upgrade-planner`)
into JSON. Books are rendered as a navigable tree of nested blueprints.

Everything runs in the browser. The string never leaves your machine.

## Local development

```bash
npm install
npm test            # run unit tests for the decoder
npm run test:watch  # watch mode
```

To open the UI locally, just open `index.html` in a browser, or serve the
folder: `npx serve .`.

## Deploy

GitHub Pages, root of `main`:

```bash
git push origin main
```

GitHub Pages → Settings → Pages → Source: `main`, `/ (root)`.

## Layout

- `index.html`, `styles.css` — page shell.
- `src/decode.js` — pure decoder; takes a string and an `inflate` function,
  returns `{ kind, label, version, versionString, json, children }`. Throws
  `DecodeError` on malformed input.
- `src/app.js` — UI: state object + `render(state)`, wires DOM to `decode`.
- `src/decode.test.js`, `src/__fixtures__/` — Vitest tests and fixtures.
- `vendor/pako_inflate.min.js` — pako (inflate-only build) loaded in the page.

## Out of scope (v1)

Re-encoding, 2D canvas render, blueprint catalogue, performance/resource
analyser, themes/i18n, diff. See `docs/superpowers/specs/` for the design
record.
```

- [ ] **Step 2: Final test run**

Run: `npm test`
Expected: all 15 tests pass.

- [ ] **Step 3: Final manual UI sweep**

Open `index.html`. Walk the golden path one more time on each fixture:
- `single-blueprint.txt` — Children tab hidden, Copy/Download work.
- `blueprint-book.txt` — Children tab shows 3 items at depth 1, JSON for any child renders.
- `nested-book.txt` — Children tab shows 4 items, items at depth 2 are indented one extra step.
- Empty input → click Decode → error «Пустая строка» under textarea.
- `1xxx` input → error «должна начинаться с «0»».

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for the blueprint decoder"
```

---

## Done

15 unit tests cover the decoder; UI golden path verified manually across
single, flat-book, and nested-book inputs; error path verified for the three
common failure modes (empty, wrong prefix, corrupt payload).

Future work (not in v1): re-encoding, canvas render, catalogue, analytics,
diff. Each of those gets its own spec → plan cycle.
