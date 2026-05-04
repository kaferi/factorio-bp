# Render Factorio rich-text icons inline — v1.5 Design

Date: 2026-04-30
Status: agreed during brainstorming (revised approach using manifest)

## Goal

Replace the current "strip all rich-text tags as plain text" behaviour
with **inline rendering of real Factorio icons** at the original tag
positions. So `[item=iron-plate] My Foundry` becomes
`<img>iron-plate</img> My Foundry` — visually it reads as the icon
followed by the text. If a tag's icon isn't in our manifest, the
renderer simply drops the tag (same behaviour as today's
`stripFactorioTags`). If the network fetch fails despite a valid URL,
the `<img>` is replaced with its alt text so nothing degrades worse
than today.

## Permission and licensing

Wube has granted explicit permission to use Factorio icons for our
non-commercial purpose ("we are fine with you hosting a copy of the
icons and using them as appropriate" — Scott @ Wube, by email).

We do not ship the icon binaries in our own repository. Instead we
hot-link icons from the third-party GitHub repo
[`deniszholob/icons-factorio`](https://github.com/deniszholob/icons-factorio)
through the [jsDelivr](https://www.jsdelivr.com/) CDN. The repo is
GPL-3.0; for hot-linking image assets (no code redistribution), this
licence does not apply to our project.

Pinned commit SHA: **`417c12fa9a7d2ede08b2545b13c4c25bfa5ba6a9`**.

URL template:
```
https://cdn.jsdelivr.net/gh/deniszholob/icons-factorio@<SHA>/factorio-icons/<path>
```

We pin to a specific commit SHA so future renames in the upstream
repo can't silently break our icon resolution.

## Architectural decisions

- **Bundle the manifest at build time, look up at runtime
  synchronously.** A small Node script fetches the upstream
  `manifest.json` (1288 entries, ~210 KB raw / ~50 KB gzipped),
  transforms every URL from `raw.githubusercontent.com/.../refs/heads/main/...`
  to `cdn.jsdelivr.net/gh/.../@<SHA>/...`, and writes the result as
  `src/icons-manifest.js` (a JS module that exports a flat object).
  The app imports it directly. No async setup at runtime.
- **Single-attempt URL.** Because we know the URL from the manifest,
  we don't need an `onerror` fallback chain. We do attach a one-shot
  `onerror` that replaces the `<img>` with its alt text — strictly a
  resilience measure for the rare case where jsDelivr fails to serve
  a known-good URL.
- **Plain text fallback.** Tags whose `(type, name)` aren't in the
  manifest are dropped entirely (no `<img>` emitted) — the rest of
  the label stays as plain text. This matches the v1.4
  `stripFactorioTags` behaviour for unknown tags.
- **Keep `labels.js` as is.** Its `stripFactorioTags` is still used
  by the search-match logic and as a "label has any visible content"
  predicate. Icon rendering is a separate concern.
- **Where icons appear:** the summary header (root label) and the
  children tree (each tree node). The download filename and search
  matching continue to use the text version — icons are
  display-only.
- **Quality tags ignored.** `[item=iron-plate,quality=rare]` uses
  the base name (`iron-plate`); the `quality=…` part is dropped from
  the icon lookup.

## Files

- **Create** `scripts/build-icons-manifest.mjs` — fetches upstream
  manifest, transforms URLs, writes `src/icons-manifest.js`.
  Run via `npm run icons:update`. Idempotent.
- **Create** `src/icons-manifest.js` — generated module. Single
  default export: `{ [key]: url }`. Committed to the repo. Not
  edited by hand.
- **Create** `src/icons.js`:
  - `lookupIconUrl(type, name) → string | null` — manifest lookup
    based on type-specific candidate keys.
  - `renderLabelWithIconsHtml(label) → string` — replaces opening
    tags with `<img>` markup when the icon is found, drops tags
    otherwise; HTML-escapes plain-text portions. The result is
    ready for `innerHTML`.
- **Create** `src/icons.test.js` — Vitest unit tests.
- **Modify** `src/app.js`:
  - import `renderLabelWithIconsHtml` from `./icons.js`,
  - in `renderDecoded` summary: use it for the root label,
  - in `renderTree`: use it for tree-node labels,
  - in `wireDecoded`: attach a one-shot `onerror` to every
    `img.bp-icon` that replaces the broken image with its alt text.
- **Modify** `index.html` — add a `preconnect` link for jsDelivr.
- **Modify** `styles.css` — add `.bp-icon` rules.
- **Modify** `package.json` — add `"icons:update": "node scripts/build-icons-manifest.mjs"`.
- **Modify** `README.md` — document the icon source, the Wube
  permission, and the update workflow.

## API contract

### `src/icons-manifest.js` (generated)

```js
// AUTO-GENERATED — run `npm run icons:update` to regenerate.
// Source: https://github.com/deniszholob/icons-factorio @ 417c12fa…
// SHA-pinned URLs through jsDelivr.
export default {
  'achievement_lazy-bastard': 'https://cdn.jsdelivr.net/gh/...',
  'arrows_down-arrow': 'https://cdn.jsdelivr.net/gh/...',
  // … 1288 entries total
}
```

### `src/icons.js`

```js
import manifest from './icons-manifest.js'

const CANDIDATE_KEYS = {
  item:             name => [`icons_${name}`],
  recipe:           name => [`icons_${name}`],
  entity:           name => [`icons_${name}`],
  tile:             name => [`icons_${name}`],
  fluid:            name => [`fluid_${name}`],
  'virtual-signal': name => [
    `signal_${name}`,
    `arrows_${name}`,
    `shapes_${name}`,
    `parameter_${name}`
  ],
  achievement:      name => [`achievement_${name}`],
  technology:       name => [`technology_${name}`],
  equipment:        name => [`equipment_${name}`],
  'item-group':     name => [`item-group_${name}`],
  planet:           name => [`icons_${name}`],
  quality:          name => [`quality_${name}`]
}

export function lookupIconUrl(type, name) {
  const buildKeys = CANDIDATE_KEYS[type]
  if (!buildKeys) return null
  for (const key of buildKeys(name)) {
    const url = manifest[key]
    if (url) return url
  }
  return null
}

export function renderLabelWithIconsHtml(label) { /* … */ }
```

### Tag parsing in `renderLabelWithIconsHtml`

Same regexes as in `labels.js`:
- Opening: `\[([a-z][a-z0-9-]*)=([^\]]*)\]`
- Closing: `\[\/[a-z][a-z0-9-]*\]`

For each opening match:

1. Take `(type, value)` from the capture groups (lower-case the type).
2. Strip everything from the first `,` onwards (quality / params).
3. `lookupIconUrl(type, name)`.
4. If found → emit `<img class="bp-icon" src="<url>" alt="[type=name]" />`.
5. If null → emit nothing (drop the tag).

Closing tags are replaced with empty strings unconditionally.

Plain-text portions between/around tags are HTML-escaped, then the
whole result is whitespace-collapsed and trimmed (only between
`<img>` boundaries — never collapse within the `<img>` markup).

### `wireIconFallback` (in `app.js`)

```js
function wireIconFallback() {
  document.querySelectorAll('img.bp-icon').forEach(img => {
    img.addEventListener('error', () => {
      const txt = document.createTextNode(img.getAttribute('alt') || '')
      img.replaceWith(txt)
    })
  })
}
```

Attach once at the end of every `wireDecoded()`.

## `scripts/build-icons-manifest.mjs`

Pseudocode:

```js
import { writeFileSync } from 'node:fs'

const SHA = '417c12fa9a7d2ede08b2545b13c4c25bfa5ba6a9'
const SOURCE = `https://cdn.jsdelivr.net/gh/deniszholob/icons-factorio@${SHA}/factorio-icons/manifest.json`
const RAW_PREFIX_RE = /^https:\/\/raw\.githubusercontent\.com\/deniszholob\/icons-factorio\/refs\/heads\/[^/]+\/(.+)$/
const CDN_PREFIX = `https://cdn.jsdelivr.net/gh/deniszholob/icons-factorio@${SHA}/`

const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const original = await res.json()

const transformed = {}
for (const [key, url] of Object.entries(original)) {
  const m = RAW_PREFIX_RE.exec(url)
  if (!m) {
    console.warn(`Skipping unrecognised URL for ${key}: ${url}`)
    continue
  }
  transformed[key] = CDN_PREFIX + m[1]
}

const out = `// AUTO-GENERATED by scripts/build-icons-manifest.mjs.
// Source: deniszholob/icons-factorio @ ${SHA}
// Run \`npm run icons:update\` to regenerate.

export default ${JSON.stringify(transformed, null, 2)}
`

writeFileSync('src/icons-manifest.js', out)
console.log(`Wrote ${Object.keys(transformed).length} entries.`)
```

## `package.json`

Add a script:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "icons:update": "node scripts/build-icons-manifest.mjs"
}
```

## CSS

Append to `styles.css`:

```css
img.bp-icon {
  display: inline-block;
  height: 1.1em;
  width: auto;
  vertical-align: -0.2em;
  margin: 0 1px;
}
.tree-node img.bp-icon { height: 1em; vertical-align: -0.15em; }
.summary img.bp-icon { height: 1.05em; vertical-align: -0.18em; }
```

## index.html

Inside `<head>`, after the stylesheet link:

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
```

## Where icons appear in the UI

### Summary header

In `renderDecoded`, change:

```js
(r.label && stripFactorioTags(r.label)) ? `«${escapeHtml(stripFactorioTags(r.label))}»` : null
```

to:

```js
(r.label && stripFactorioTags(r.label)) ? `«${renderLabelWithIconsHtml(r.label)}»` : null
```

### Tree node

In `renderTree`, change:

```js
${escapeHtml(stripFactorioTags(c.label) || t('treeNode.untitled'))}
```

to:

```js
${stripFactorioTags(c.label) ? renderLabelWithIconsHtml(c.label) : escapeHtml(t('treeNode.untitled'))}
```

### Search matching

**Unchanged.** Continues to use `stripFactorioTags(c.label)` and
`c.label` (raw).

### Download filename

**Unchanged.** Continues to use `stripFactorioTags`.

## Tests

`src/icons.test.js`:

- `lookupIconUrl('item', 'iron-plate')` returns a string starting
  with `https://cdn.jsdelivr.net/gh/deniszholob/icons-factorio@`,
  containing `iron-plate.png`.
- `lookupIconUrl('item', 'cargo-landing-pad')` returns a valid
  jsDelivr URL (this is the case my heuristic missed).
- `lookupIconUrl('virtual-signal', 'down-arrow')` returns the
  `arrows_down-arrow` URL even though the type was `virtual-signal`.
- `lookupIconUrl('virtual-signal', 'signal-1')` returns the
  `signal_signal-1` URL.
- `lookupIconUrl('fluid', 'water')` returns the `fluid_water` URL.
- `lookupIconUrl('item', 'definitely-not-real-name')` returns
  `null`.
- `lookupIconUrl('color', 'red')` returns `null` (unknown type).
- `lookupIconUrl('item', 'name with space')` — names with spaces
  shouldn't exist in real Factorio, but the function should still
  return `null` cleanly without crashing.

- `renderLabelWithIconsHtml('[item=iron-plate] My Foundry')` →
  starts with `<img class="bp-icon" src="https://cdn.jsdelivr.net/...iron-plate.png"`,
  ends with the escaped text "My Foundry".
- `renderLabelWithIconsHtml('[item=cargo-landing-pad] Mall')` →
  emits an `<img>` (not dropped — manifest has it).
- `renderLabelWithIconsHtml('[unknown=foo] Bar')` → `'Bar'` (tag
  dropped because lookup returned null).
- `renderLabelWithIconsHtml('[item=really-non-existent-name-xyz] Bar')`
  → `'Bar'` (also dropped).
- `renderLabelWithIconsHtml('[color=red]Important[/color] line')` →
  `'Important line'` (color tags always dropped).
- `renderLabelWithIconsHtml('[item=iron-plate,quality=rare] Foo')` →
  `<img>` for `iron-plate` (no quality), then `'Foo'`.
- `renderLabelWithIconsHtml('Plain text')` → `'Plain text'`.
- `renderLabelWithIconsHtml('')` / `null` / `undefined` → `''`.
- `renderLabelWithIconsHtml('<script>alert(1)</script>')` → fully
  escaped, no raw `<script>`.
- Multiple icons in original positions:
  `'A [item=iron-plate] B [virtual-signal=down-arrow] C'` produces
  two `<img>` elements separated by their plain text.

Existing tests (`decode`, `encode`, `validate`, `labels`) are
unchanged and must remain green.

## Manual UI sweep

After implementation:

1. Decode `real-large-book.txt`. Summary: `cargo-landing-pad` icon
   followed by "Space Age".
2. Children tab: tree-node labels show icons in their original
   positions next to text.
3. Search by `down-arrow` (raw tag value) → still finds matches;
   icons render in the filtered results.
4. RU ↔ EN switch: icons unchanged, surrounding text translates.
5. Edit-mode: textarea shows the JSON with the original `[item=…]`
   tags (no icons in raw JSON view — by design).
6. Encode → result panel works as before.
7. DevTools → Network: every icon returns 200 from `cdn.jsdelivr.net`.
   The first decode triggers a burst of requests; subsequent
   decodes use the HTTP cache.

## Update workflow

When upstream `deniszholob/icons-factorio` adds new icons (e.g.
post-DLC):

1. Bump the SHA in `scripts/build-icons-manifest.mjs`.
2. Run `npm run icons:update`.
3. Commit `src/icons-manifest.js` and the script.

The pinned SHA in `icons.js` is no longer separately referenced —
it lives only in the build script and the URL strings inside
`icons-manifest.js`.

## Out of scope

- Pre-rendering or transforming icons (recolouring quality borders,
  overlays).
- Bundling the icon PNGs themselves in our repo.
- Forking the upstream repo into the user's account.
- Auto-updating the manifest in CI.
- Rendering icons inside the JSON `<pre>` view.
