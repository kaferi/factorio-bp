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

## Layout

- `index.html`, `styles.css` — page shell.
- `src/decode.js` — pure decoder; takes a string and an `inflate` function,
  returns `{ kind, label, version, versionString, json, children }`. Throws
  `DecodeError` on malformed input.
- `src/app.js` — UI: state object + `render(state)`, wires DOM to `decode`.
- `src/decode.test.js`, `src/__fixtures__/` — Vitest tests and fixtures.
- `scripts/gen-fixtures.mjs` — regenerates the test fixtures.
- `vendor/pako_inflate.min.js` — pako (inflate-only build) loaded in the page.

## Out of scope (v1)

Re-encoding, 2D canvas render, blueprint catalogue, performance/resource
analyser, themes/i18n, diff. See `docs/superpowers/specs/` for the design
record.
