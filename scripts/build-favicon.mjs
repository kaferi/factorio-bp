// Generates the site's favicon from the local icon set.
//
//   favicon.png — the blueprint-book item icon, the closest visual match
//                 to what the tool actually does (browse blueprint books).
//
// Source PNGs in Factorio's data are mipmap sprite sheets (e.g. 120×64 =
// 64 + 32 + 16 + 8 stacked horizontally); we work with just the leftmost
// height×height square (the main icon).
//
// Run: `node scripts/build-favicon.mjs`

import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

function loadPng(path) {
  return PNG.sync.read(readFileSync(path))
}

// Take the leftmost height×height portion of the source as a fresh PNG.
function cropLeftSquare(png) {
  const size = png.height
  const out = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    const srcStart = y * png.width * 4
    const dstStart = y * size * 4
    png.data.copy(out.data, dstStart, srcStart, srcStart + size * 4)
  }
  return out
}

const book = cropLeftSquare(loadPng('icons/base/icons/blueprint-book.png'))
writeFileSync('favicon.png', PNG.sync.write(book))
console.log('Wrote favicon.png')
