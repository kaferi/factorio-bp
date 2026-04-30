# Search children + clean labels — v1.4 Design

Date: 2026-04-29
Status: agreed during brainstorming

## Goal

Make working with large blueprint books pleasant:

1. **Strip Factorio rich-text tags** (`[item=...]`, `[virtual-signal=...]`, `[recipe=...]`, `[color=...]…[/color]`, etc.) from any label we display, so users see human-readable names instead of bracket syntax. Real icons stay deferred until/unless Wube grants permission.
2. **Add a live search field** above the children tree so users can find blueprints in a 80+ entry library by typing. Substring match, case-insensitive, runs against both the original raw label and the stripped version. Ancestors of matches stay visible so the tree path is preserved.

This is an additive iteration; the decoder, encoder, validator, edit-mode, and locale switch are unchanged.

## Architectural decisions

- **New pure module `src/labels.js`** — exports `stripFactorioTags(s)`. Pure, no DOM, no locale; trivial to unit-test. UI imports and uses it everywhere it renders a `label`.
- **No state for search beyond a `searchQuery: string`** in the existing `state` object.
- **Search filters in render time, not by mutating data.** The result's `children` array is left untouched; rendering simply skips entries that don't match (and aren't ancestors of a match).
- **Focus restore after render.** Re-rendering re-creates the search input on every keystroke, so we save the cursor position and restore focus + selection right after each `render()` call triggered by typing.
- **Reset query on Decode and Clear, keep across tab/tree clicks.** Users wandering the tree usually want their filter to persist.

## Files

- **Create** `src/labels.js` — `stripFactorioTags(label)`.
- **Create** `src/labels.test.js` — Vitest unit tests for stripping.
- **Modify** `src/i18n.js` — two new keys (`search.placeholder`, `search.noMatches`).
- **Modify** `src/app.js`:
  - import `stripFactorioTags`,
  - apply it to summary label and tree-node labels,
  - add `searchQuery` to `state`,
  - render a search input above the tree,
  - filter visible tree entries through a `labelMatches` predicate that keeps ancestors of matches,
  - reset `searchQuery` on `onDecode` (fresh result) and `onClear`,
  - on input change, save selection, re-render, restore focus + selection.

`decode.js` / `encode.js` / `validate.js` / `i18n.js` (helpers) are not touched beyond i18n key additions.

## API: `src/labels.js`

```js
// Strips Factorio rich-text tags from a label string for human-readable
// display. Removes opening tags like [item=foo] and [color=red] and
// closing tags like [/color]. Preserves the inner text. Collapses
// multiple spaces and trims.
export function stripFactorioTags(label) {
  if (label == null) return ''
  if (typeof label !== 'string') return String(label)
  return label
    .replace(/\[[a-z][a-z0-9-]*=[^\]]*\]/gi, '')  // [item=foo], [color=red], [recipe=bar]
    .replace(/\[\/[a-z][a-z0-9-]*\]/gi, '')        // [/color], [/font]
    .replace(/\s{2,}/g, ' ')
    .trim()
}
```

Test fixtures:

| Input | Output |
| --- | --- |
| `[item=iron-plate] My Foundry` | `My Foundry` |
| `[virtual-signal=down-arrow] Погрузка` | `Погрузка` |
| `[color=red]Important[/color] line` | `Important line` |
| `Foo [item=bar] Baz` | `Foo Baz` (single space) |
| `Plain text` | `Plain text` |
| `` (empty) | `` |
| `null` / `undefined` | `` |
| `[Hello World]` (no `=`, no `/`) | `[Hello World]` (untouched — not a tag) |
| `[item=foo][item=bar]Result` | `Result` |
| `[/foo]Bar[/baz]` | `Bar` |

## Search behaviour

### State

Extend `state`:

```js
state = {
  …,
  searchQuery: ''  // current value of the children-tree search input
}
```

### Visibility rules

Given the flat `result.children` array and a query:

- If query is empty: every child is visible.
- Otherwise: a child is visible if **either** of the two strings — `c.label` (raw) or `stripFactorioTags(c.label)` — contains the lower-cased query as a substring (case-insensitive); plus every ancestor path of a visible child is itself visible (so book wrappers leading to a match stay in the tree).

Pseudocode:

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
```

### UI

Above the tree (only when on the `Children` tab and `result.children.length > 0`):

```html
<input class="tree-search" type="text" placeholder="…">
```

When the filtered list is empty, render a single line `<p class="empty-tree">No matches</p>` instead of an empty `<ul>`.

### Focus restoration

`render()` is called every keystroke. Without restoration, the input loses focus. The input handler:

```js
function onTreeSearchInput(e) {
  const cursor = e.target.selectionStart
  state.searchQuery = e.target.value
  render()
  const fresh = document.querySelector('.tree-search')
  if (fresh) {
    fresh.focus()
    fresh.setSelectionRange(cursor, cursor)
  }
}
```

### When `searchQuery` resets

- `onDecode` (fresh result loaded): set to `''`.
- `onClear` (user wipes input): set to `''`.
- Tab switch / tree-node click / encode flow: keep — the user is exploring within the same library.

## Where stripping is applied in the UI

Two places:

1. Summary header: `r.label ? `«${escapeHtml(r.label)}»` : null` → `r.label ? `«${escapeHtml(stripFactorioTags(r.label))}»` : null`. If the stripped string is empty, fall back to no display (filter via `&&` — if `stripFactorioTags(r.label) === ''`, treat like no label).
2. Tree node: `escapeHtml(c.label || t('treeNode.untitled'))` → `escapeHtml(stripFactorioTags(c.label) || t('treeNode.untitled'))`.

The `inputCollapsed` summary doesn't render a label — no change there.

## i18n

Add two keys (en + ru):

| Key | English | Russian |
| --- | --- | --- |
| `search.placeholder` | `Search blueprints…` | `Поиск чертежей…` |
| `search.noMatches` | `No matches` | `Ничего не найдено` |

## Tests

### `src/labels.test.js`

Unit tests for `stripFactorioTags` covering every row of the fixture table above.

### Decoder / encoder / validator tests

Untouched.

### Manual UI sweep (after implementation)

1. Decode `real-large-book.txt` → see summary `«Space Age»` (no `[item=cargo-landing-pad]` prefix).
2. Open `Children` tab → tree-node labels read clean (no bracket-tag prefixes).
3. Type "blue" in the search field → tree filters live; ancestors of matches stay visible; the input keeps focus and the cursor stays where you typed.
4. Clear the search field → all 82 entries return.
5. Type a query that matches nothing → "No matches" appears under the tree.
6. Type a tag-only query (e.g. `iron-plate` or `down-arrow`) → still matches blueprints whose raw label contains that tag, even if the stripped version doesn't.
7. Switch the locale RU ↔ EN while a query is active → input value preserved, placeholder translates, and "No matches" translates if it was showing.
8. Decode another blueprint → search field is empty (state was reset).
9. Click `Children` → click a child → click `JSON` → click `Children` again — the previous query is still there.

## Out of scope (explicitly)

- Filter by `kind` (checkboxes for blueprint/book/decon/upgrade).
- Fuzzy search.
- Highlighting matched substring inside the tree node.
- Search across the JSON content (entity names, recipes, etc.).
- An icon next to the cleaned label (still waiting on Wube).
