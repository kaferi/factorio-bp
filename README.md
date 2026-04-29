# Factorio Blueprint Decoder

Live site: **https://kaferi.github.io/factorio-bp/**

Statically-hosted tool that decodes a Factorio blueprint string
(`blueprint`, `blueprint-book`, `deconstruction-planner`, `upgrade-planner`)
into JSON. Books are rendered as a navigable tree of nested blueprints.

Everything runs in the browser. The string never leaves your machine.

The UI is bilingual (English / Russian). The locale is auto-detected from the
browser, defaults to English, and can be flipped manually with the `EN · RU`
switch in the header. The choice is remembered in `localStorage`.

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
  `DecodeError` (with a stable `code` such as `BAD_BASE64`) on malformed input.
- `src/i18n.js` — locale dictionary and `t / setLocale / getLocale / detectLocale` helpers.
- `src/app.js` — UI: state object + `render(state)`, wires DOM to `decode`, renders localised text.
- `src/decode.test.js`, `src/__fixtures__/` — Vitest tests and fixtures.
- `scripts/gen-fixtures.mjs` — regenerates the test fixtures.
- `vendor/pako_inflate.min.js` — pako (inflate-only build) loaded in the page.
