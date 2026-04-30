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
  per-blueprint kind badges. Click a child to inspect its JSON.
- **Live search across the tree.** Filter children by label as you type.
  Searches both the visible name and the underlying icon tags
  (`[item=…]`, `[recipe=…]`, etc.) so you can locate things by what you see
  *or* by what icon they use. Ancestors of matches stay visible so the path
  is preserved.
- **Clean labels.** Factorio rich-text tags (`[item=iron-plate] My Foundry`)
  are automatically stripped for display. You see `My Foundry`, not the raw
  bracket syntax.
- **Edit JSON and re-encode.** Click `Edit` on any node, modify its JSON in
  a textarea, hit `Encode`, and copy the resulting blueprint string back into
  the game. Works on the whole library or a single nested blueprint
  extracted from a book as a standalone string.
- **Pre-encode validation.** Before encoding, the JSON is structurally
  validated. If you accidentally break the shape (delete a brace, mistype a
  field), you get a clear localised error pointing at the exact path of the
  problem (e.g. `blueprint_book.blueprints[2].blueprint.entities[0]`).
- **Bilingual interface (English / Russian).** Locale is auto-detected from
  your browser; the choice is remembered in `localStorage` and can be
  flipped any time with the `EN · RU` switch in the header.
- **Copy & download.** Copy any JSON or blueprint string to the clipboard,
  or save the JSON as a `.json` file with the blueprint's label as the
  filename.
- **100% client-side.** No server, no backend, no analytics. The entire app
  is HTML, CSS, and a few hundred lines of vanilla JavaScript plus
  [pako](https://github.com/nodeca/pako) for zlib. Works offline.

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
npm test            # run unit tests (64 across decoder, encoder, validator, label-stripping)
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
- `src/i18n.js` — locale dictionary and `t / setLocale / getLocale /
  detectLocale` helpers. Two locales: English and Russian.
- `src/app.js` — UI. State object + `render(state)`, wires the DOM to all
  pure modules above.
- `src/__fixtures__/`, `src/*.test.js` — Vitest tests and real-world
  fixtures.
- `scripts/gen-fixtures.mjs` — regenerates the test fixtures.
- `vendor/pako.min.js` — vendored [pako](https://github.com/nodeca/pako)
  build (inflate + deflate).

## Browser support

Modern Chrome, Firefox, Safari, and Edge. No build step, no transpilation —
ES modules load directly, with native `clipboard`, `Blob`, and `TextEncoder`
APIs.

## Privacy

Every operation — decode, edit, encode, validate, search — runs entirely
in your browser. Nothing is uploaded. Nothing is logged. There is no
backend.

## License

[MIT](LICENSE).

Factorio is © Wube Software ltd. This is a fan-made tool and is not
officially affiliated with or endorsed by Wube Software.
