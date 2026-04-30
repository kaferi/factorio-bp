# Search children + clean labels — v1.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip Factorio rich-text tags (`[item=…]`, `[color=…]…[/color]`, etc.) from displayed labels, and add a live search field above the children tree that filters by raw or stripped label and keeps ancestors of matches visible.

**Architecture:** New pure module `src/labels.js` provides `stripFactorioTags(label)`. `app.js` imports it, applies it to summary and tree-node labels, adds a `searchQuery` state field, renders a search input, filters children at render time, and restores focus + selection after each keystroke-triggered re-render.

**Tech Stack:** Vanilla JS + Vitest. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-29-search-and-clean-labels.md](../specs/2026-04-29-search-and-clean-labels.md)

**No git operations during the plan — the user runs git themselves.**

---

## File Structure

- **Create** `src/labels.js` — `stripFactorioTags(label)`.
- **Create** `src/labels.test.js` — Vitest unit tests for stripping.
- **Modify** `src/i18n.js` — two new keys.
- **Modify** `src/app.js` — apply stripping; add search state, UI, filter, focus restore; reset on decode/clear.

---

## Task 1: `src/labels.js` and tests (TDD)

**Files:**
- Create: `src/labels.js`
- Create: `src/labels.test.js`

- [ ] **Step 1: Write failing tests first**

Create `src/labels.test.js`:

```js
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
```

- [ ] **Step 2: Run tests — they must fail**

Run: `npm test`
Expected: every test in `src/labels.test.js` fails because `./labels.js` does not exist. Existing 50 tests still pass.

- [ ] **Step 3: Create `src/labels.js`**

```js
// Strips Factorio rich-text tags from a label string for human-readable
// display. Removes opening tags like [item=foo] or [color=red] and
// closing tags like [/color]. Preserves the inner text. Collapses
// multiple spaces and trims.

export function stripFactorioTags(label) {
  if (label == null) return ''
  if (typeof label !== 'string') return String(label)
  return label
    .replace(/\[[a-z][a-z0-9-]*=[^\]]*\]/gi, '')
    .replace(/\[\/[a-z][a-z0-9-]*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
```

- [ ] **Step 4: Run tests — they must pass**

Run: `npm test`
Expected: all tests pass. Total = 50 (existing) + 14 (new strip tests) = 64.

---

## Task 2: i18n keys for search

**Files:**
- Modify: `src/i18n.js`

- [ ] **Step 1: Append two new keys to both locale blocks**

Inside `messages.en`, append at the end of the block:

```js
'search.placeholder': 'Search blueprints…',
'search.noMatches': 'No matches'
```

Inside `messages.ru`, append:

```js
'search.placeholder': 'Поиск чертежей…',
'search.noMatches': 'Ничего не найдено'
```

Be careful with comma placement: in the previous task the last entries in each block (`errors.ENTITY_MALFORMED`) currently have **no trailing comma**. You need to add a comma there and append the new keys after.

- [ ] **Step 2: Sanity-check**

```bash
node --input-type=module -e "
import('./src/i18n.js').then(m => {
  m.setLocale('en')
  console.log('en:', m.t('search.placeholder'), '|', m.t('search.noMatches'))
  m.setLocale('ru')
  console.log('ru:', m.t('search.placeholder'), '|', m.t('search.noMatches'))
})
"
```
Expected:
```
en: Search blueprints… | No matches
ru: Поиск чертежей… | Ничего не найдено
```

- [ ] **Step 3: Confirm tests still pass**

Run: `npm test`
Expected: 64 tests pass.

---

## Task 3: `app.js` — apply stripping, add search state and UI

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add the `stripFactorioTags` import**

At the top of `src/app.js`, after the existing imports, add:

```js
import { stripFactorioTags } from './labels.js'
```

- [ ] **Step 2: Extend `state` with `searchQuery`**

In the `state` object literal, add `searchQuery: ''` as a new field (after `encodeError: null`):

```js
const state = {
  phase: 'empty',
  input: '',
  result: null,
  error: null,
  view: 'json',
  selectedPath: [],
  editing: false,
  draft: '',
  encodeResult: null,
  encodeError: null,
  searchQuery: ''
}
```

- [ ] **Step 3: Reset `searchQuery` on `onDecode` and `onClear`**

In `onDecode`, after `state.selectedPath = []`, add:

```js
state.searchQuery = ''
```

In `onClear`, after the existing resets (`state.encodeError = null`), add:

```js
state.searchQuery = ''
```

- [ ] **Step 4: Apply stripping to the summary label**

Find this in `renderDecoded`:

```js
r.label ? `«${escapeHtml(r.label)}»` : null
```

Replace with:

```js
(r.label && stripFactorioTags(r.label)) ? `«${escapeHtml(stripFactorioTags(r.label))}»` : null
```

This way, if the label was *only* tags (e.g. `[item=foo]` and nothing else), the stripped version is empty and we omit the label segment.

- [ ] **Step 5: Add search input + filter logic to `renderTree`**

Add two new top-level helpers (`labelMatches`, `visibleChildren`) and replace the existing `renderTree` function with the new version below. All three live at module scope (the same level as `renderTree` is now). Place them in the existing position of `renderTree`:

```js
function labelMatches(label, query) {
  if (!query) return true
  const q = query.toLowerCase()
  const raw = (label || '').toLowerCase()
  const stripped = stripFactorioTags(label || '').toLowerCase()
  return raw.includes(q) || stripped.includes(q)
}

function visibleChildren(children, query) {
  if (!query) return children
  const visible = new Set()
  const pathKey = path => path.join(',')
  for (const c of children) {
    if (labelMatches(c.label, query)) {
      visible.add(pathKey(c.path))
      for (let i = 1; i < c.path.length; i++) {
        visible.add(pathKey(c.path.slice(0, i)))
      }
    }
  }
  return children.filter(c => visible.has(pathKey(c.path)))
}

function renderTree(children, selectedPath, query) {
  // v1 simplification vs spec: render the flat list with depth-based
  // indentation instead of expand/collapse toggles. For typical books
  // (5-30 single-level entries) this reads cleanly; nesting is rare.
  // Add per-book toggles here if deeply-nested books become common.
  const filtered = visibleChildren(children, query)
  const items = filtered.map(c => `
    <li>
      <div class="tree-node ${arraysEqual(c.path, selectedPath) ? 'selected' : ''}"
           style="padding-left: ${c.path.length * 14}px"
           data-path="${c.path.join(',')}">
        ${escapeHtml(stripFactorioTags(c.label) || t('treeNode.untitled'))}
        <span class="badge">${escapeHtml(c.kind)}</span>
      </div>
    </li>
  `).join('')

  const treeBlock = filtered.length === 0
    ? `<p class="empty-tree">${escapeHtml(t('search.noMatches'))}</p>`
    : `<ul class="tree">${items}</ul>`

  return `
    <input
      class="tree-search"
      type="text"
      placeholder="${escapeHtml(t('search.placeholder'))}"
      value="${escapeHtml(query)}"
    >
    ${treeBlock}
  `
}
```

- [ ] **Step 6: Pass `state.searchQuery` into `renderTree`**

In `renderDecoded`, find:

```js
${renderTree(r.children, s.selectedPath)}
```

Replace with:

```js
${renderTree(r.children, s.selectedPath, s.searchQuery)}
```

- [ ] **Step 7: Wire the search input in `wireDecoded`**

Inside `wireDecoded`, after the existing tree-node click handler, add:

```js
document.querySelector('.tree-search')?.addEventListener('input', e => {
  const cursor = e.target.selectionStart
  state.searchQuery = e.target.value
  render()
  const fresh = document.querySelector('.tree-search')
  if (fresh) {
    fresh.focus()
    fresh.setSelectionRange(cursor, cursor)
  }
})
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: 64 tests still pass.

- [ ] **Step 9: Sanity-check `app.js` parses as ESM**

```bash
node --input-type=module -e "
import('./src/app.js').catch(e => {
  if (/document is not defined|navigator is not defined|window is not defined|localStorage is not defined/.test(e.message)) {
    console.log('OK: parses, fails only on browser globals as expected')
  } else {
    console.error('Unexpected error:', e.message); process.exit(1)
  }
})
"
```

---

## Task 4: Styles for search input and empty-tree placeholder

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Append styles**

```css
input.tree-search {
  width: 100%;
  padding: 6px 10px;
  margin-top: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  border: 1px solid #d0d0d5;
  border-radius: 6px;
  font-family: inherit;
}
input.tree-search:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

p.empty-tree {
  color: #888;
  font-size: 13px;
  padding: 12px 4px;
  margin: 0;
}
```

---

## Task 5: Final sweep + manual checklist

**Files:** none (verification only)

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: 4 test files pass (`decode`, `encode`, `validate`, `labels`); 64 tests green.

- [ ] **Step 2: Manual UI checklist (the user runs this in the browser)**

1. Decode `real-large-book.txt` (518 KB Space Age library). The header summary shows `«Space Age»` — no `[item=cargo-landing-pad]` prefix.
2. Open `Children` tab. Tree node labels show clean text.
3. Type `blue` in the search field. The tree shrinks to entries containing "blue" (case-insensitive). Ancestors of matches stay visible. The cursor stays where it was; the input keeps focus.
4. Clear the search field. All 82 entries reappear.
5. Type a query that matches nothing — "No matches" / "Ничего не найдено" placeholder shows.
6. Type a tag-name (e.g. `cargo-landing-pad`). Search still finds entries whose RAW label contains it.
7. Switch RU ↔ EN with a query active. Input value preserved, placeholder translates.
8. Click a child node → click `JSON` → click `Children` — the query is still there.
9. Decode a different fixture (e.g. paste `single-blueprint.txt`) → search field is empty (state was reset).

---

## Done

After Task 5 the children tree is searchable, labels are clean, and 64 tests pass. The next layer of polish (filter by kind, real game icons after Wube replies, fuzzy search) is explicitly deferred.
