# Factorio Blueprint Decoder — Free Online Tool to Decode and Edit Blueprint Strings

A free, open-source web tool to **decode, edit, and re-encode Factorio blueprint
strings**. Paste any blueprint, blueprint book, deconstruction planner, or
upgrade planner from the game and instantly see the underlying JSON, browse
nested books, edit values, and produce a new shareable blueprint string ready
to paste back into the game.

**Use it now:** https://kaferi.github.io/factorio-bp/

Everything runs in your browser. Your blueprint string never leaves your
machine — there is no server, no logging, no tracking.

Works with vanilla Factorio and the Space Age expansion. Tested on real
500 KB+ libraries with 80+ nested blueprints.

## Features

- **Decode any blueprint string.** Supports all four types Factorio exports:
  `blueprint`, `blueprint-book`, `deconstruction-planner`, `upgrade-planner`.
  Single blueprints and deeply-nested books up to several levels deep.
- **Navigate large libraries.** Books are rendered as a tree of children with
  per-blueprint kind badges. Click a child to inspect its JSON. Book branches
  are collapsible — fold away parts you're not interested in.
- **Live search across the tree.** Filter children by label as you type.
  Searches both the visible name and the underlying icon tags
  (`[item=…]`, `[recipe=…]`, etc.) so you can locate things by what you see
  *or* by what icon they use. Ancestors of matches stay visible so the path
  is preserved; user-set collapse state is remembered underneath and re-applies
  once the search clears.
- **Real Factorio icons inline.** Tags inside labels (`[item=iron-plate]`,
  `[virtual-signal=down-arrow]`, `[recipe=…]`, etc.) and the structural
  `icons[]` array on each blueprint render as inline `<img>` elements at
  their original positions, served from the bundled `icons/` folder
  (see [Icons](#icons)).
- **Components panel for any blueprint.** Selecting a single blueprint shows
  the in-game-style "Components" strip above the JSON: every unique entity
  and tile, aggregated by name and quality (uncommon / rare / epic /
  legendary indicator in the corner), sorted by count desc. Rail variants
  (straight, curved, half-diagonal, elevated) are folded into a single
  weighted "rail" tile, mirroring how Factorio counts them in the
  blueprint cost. Click a tile to light up every matching entry in the
  JSON pane and scroll to the first occurrence; click the same tile again
  to cycle to the next match. Esc clears the highlight.
- **Structured entity editor.** When a component tile is active, an
  options panel appears with click-to-edit controls that don't require
  hand-editing JSON:
  - **Quality picker** — switch the entity to any of the five tiers
    (normal / uncommon / rare / epic / legendary).
  - **Chest slot limit** — an in-game-style slot grid for any chest
    entity; click a slot to set the bar, click the active slot to clear
    it.
  - **Requester options** — `request_from_buffers` and
    `trash_not_requested` checkboxes on requester chests.
  - **Delete** — trash button with confirmation modal; removes the
    entity (or every entity of the same type+quality) and cleans up
    dangling references in the surviving blueprint (1.x circuit
    `connections` + `neighbours`, 2.x flat `wires`, and train
    `schedules.locomotives`, dropping empty schedule entries).
  - **Scope toggle** — apply the change to *only this one* match (the
    one currently focused in the JSON pane) or to *all of this type*.
  The components panel and the JSON pane both update live as you edit.
- **Breadcrumb above the JSON.** When a child node is selected, a clickable
  breadcrumb across the top of the JSON shows the path from the root through
  every ancestor down to the current selection — so you always know where
  you are.
- **Clean labels.** Factorio rich-text tags (`[item=iron-plate] My Foundry`)
  are automatically stripped for display when no icon is being rendered for
  them. You see `My Foundry`, not the raw bracket syntax.
- **Edit JSON and re-encode.** The JSON pane is a live textarea — type
  freely, hit `Encode`, and copy the resulting blueprint string back into
  the game. Works on the whole library or a single nested blueprint
  extracted from a book as a standalone string.
- **Pre-encode validation.** Before encoding, the JSON is structurally
  validated. If you accidentally break the shape (delete a brace, mistype a
  field), you get a clear localised error pointing at the exact path of the
  problem (e.g. `blueprint_book.blueprints[2].blueprint.entities[0]`).
- **Dark Factorio-themed UI.** Single dark palette inspired by the
  Factorio wiki and the in-game UI; the same Titillium Web typeface
  Factorio uses in-game; in-game-style component tiles with bevelled
  inset, orange hover, count badge in the bottom-right, real quality
  indicator icons in the bottom-left.
- **Bilingual interface (English / Russian).** Locale is auto-detected from
  your browser; the choice is remembered in `localStorage` and can be
  flipped any time with the `EN · RU` switch in the header.
- **Responsive busy state.** Decoding and encoding multi-megabyte books
  takes seconds; the buttons disable themselves and show a spinner so
  the UI stays informative instead of looking frozen.
- **Copy & download.** Copy any JSON or blueprint string to the clipboard,
  or save the JSON as a `.json` file with the blueprint's label as the
  filename.
- **100% client-side.** No server, no backend, no analytics. The entire app
  is HTML, CSS, and a few hundred lines of vanilla JavaScript plus
  [pako](https://github.com/nodeca/pako) for zlib. All assets (icons
  included) are served from the same origin; works offline once the page
  is cached.

## How blueprint strings work

Factorio's export format is straightforward:

1. The string starts with the version prefix `0`.
2. The rest is base64-encoded.
3. Once decoded, it's a zlib-compressed payload.
4. Decompressing it yields a JSON object.

This tool implements the round-trip directly in the browser: decode runs the
pipeline forward, encode runs it backward.

## Local development

```bash
npm install
npm test            # run unit tests
npm run test:watch  # watch mode
```

To open the UI locally, just open `index.html` in a browser, or serve the
folder with any static server, for example:

```bash
npx serve .
```

## Project layout

- `index.html`, `styles.css` — page shell.
- `src/decode.js` — pure decoder. Takes a string and an `inflate` function,
  returns `{ kind, label, version, versionString, json, children }`. Throws
  `DecodeError` (with a stable `code` such as `BAD_BASE64`) on malformed
  input.
- `src/encode.js` — pure encoder. Takes a JSON object and a `deflate`
  function, returns a blueprint string with the `0` prefix. Throws
  `EncodeError` on failure.
- `src/validate.js` — structural validator that gates the encoder. Throws
  `ValidationError` with a `path` pointing at the broken field.
- `src/labels.js` — strips Factorio rich-text tags for clean display.
- `src/icons.js` — looks up Factorio icon URLs by tag type, renders labels
  with inline `<img>`, and renders the `icons[]` array of a blueprint.
- `src/icons-manifest.js` — auto-generated by
  `scripts/build-icons-manifest.mjs`; maps `category_name` keys to
  relative URLs under `icons/`.
- `src/components.js` — extracts the components-panel data from a blueprint
  (entities + tiles aggregated by name and quality) and finds matching
  positions inside the pretty-printed JSON for the click-to-jump highlight.
- `src/i18n.js` — locale dictionary and `t / setLocale / getLocale /
  detectLocale` helpers. Two locales: English and Russian.
- `src/app.js` — UI. State object + `render(state)`, wires the DOM to all
  pure modules above.
- `src/__fixtures__/`, `src/*.test.js` — Vitest tests and real-world
  fixtures.
- `scripts/gen-fixtures.mjs` — regenerates the test fixtures.
- `scripts/build-icons-manifest.mjs` — walks the local `icons/` folder
  and writes the manifest. Run with `npm run icons:update` after a game
  update.
- `vendor/pako.min.js` — vendored [pako](https://github.com/nodeca/pako)
  build (inflate + deflate).

## Browser support

Modern Chrome, Firefox, Safari, and Edge. No build step, no transpilation —
ES modules load directly, with native `clipboard`, `Blob`, and `TextEncoder`
APIs.

## Privacy

Every operation — decode, edit, encode, validate, search, components
indexing — runs entirely in your browser. Nothing is uploaded. Nothing is
logged. There is no backend. There are no third-party requests at all:
icons are bundled with the site and served from the same origin.

## Icons

Factorio icons are bundled in the `icons/` folder of this repository and
served directly from GitHub Pages, alongside the rest of the site.

`scripts/build-icons-manifest.mjs` walks `icons/` and writes a flat
`category_name → relative URL` map to `src/icons-manifest.js`. Filename
underscores are normalised to hyphens so `signal/signal_1.png` becomes
the key `signal_signal-1` — matching the dashed names Factorio uses
inside blueprint JSON.

To refresh icons (after a game update):

1. Copy these folders out of your Factorio install (typical Steam path:
   `C:\Program Files (x86)\Steam\steamapps\common\Factorio\data\`):

   | Source | Destination |
   |---|---|
   | `data/base/graphics/icons/` | `icons/base/icons/` |
   | `data/base/graphics/achievement/` | `icons/base/achievement/` |
   | `data/base/graphics/equipment/` | `icons/base/equipment/` |
   | `data/base/graphics/technology/` | `icons/base/technology/` |
   | `data/base/graphics/item-group/` | `icons/base/item-group/` |
   | `data/space-age/graphics/icons/` | `icons/space-age/icons/` |
   | `data/quality/graphics/icons/` | `icons/quality/icons/` |

2. Run `npm run icons:update` to regenerate the manifest.

3. Commit `icons/` and `src/icons-manifest.js`.

Factorio icons are © Wube Software ltd. and used here with their explicit
permission for non-commercial use.

## License

[MIT](LICENSE).

Factorio is © Wube Software ltd. This is a fan-made tool and is not
officially affiliated with or endorsed by Wube Software.
