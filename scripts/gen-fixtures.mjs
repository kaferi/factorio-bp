import pako from 'pako'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, '..', 'src', '__fixtures__')
mkdirSync(fixturesDir, { recursive: true })

// 1. single-blueprint.txt
const obj = {
  blueprint: {
    icons: [{ signal: { type: 'item', name: 'transport-belt' }, index: 1 }],
    entities: [
      {
        entity_number: 1,
        name: 'transport-belt',
        position: { x: 0, y: 0 },
        direction: 0
      }
    ],
    item: 'blueprint',
    label: 'Test belt',
    version: 281474983067648
  }
}
const json = JSON.stringify(obj)
const deflated = pako.deflate(json)
const b64 = Buffer.from(deflated).toString('base64')
const goodFixture = '0' + b64
writeFileSync(join(fixturesDir, 'single-blueprint.txt'), goodFixture)
console.log('OK single-blueprint.txt', goodFixture.length, 'chars')
console.log('first 30:', goodFixture.slice(0, 30))

// 2. corrupt-base64.txt
writeFileSync(join(fixturesDir, 'corrupt-base64.txt'), '0!!!@@@###')
console.log('OK corrupt-base64.txt')

// 3. truncated.txt — chop last 20 chars off the good fixture
const good = readFileSync(join(fixturesDir, 'single-blueprint.txt'), 'utf8')
writeFileSync(join(fixturesDir, 'truncated.txt'), good.slice(0, -20))
console.log('OK truncated.txt', good.slice(0, -20).length, 'chars')

// 4. bad-json.txt — deflate non-JSON, prefix with 0
const badDeflated = pako.deflate('this is not json {{{')
const badB64 = Buffer.from(badDeflated).toString('base64')
writeFileSync(join(fixturesDir, 'bad-json.txt'), '0' + badB64)
console.log('OK bad-json.txt')

// 5. deconstruction-planner.txt
const deconObj = {
  deconstruction_planner: {
    item: 'deconstruction-planner',
    label: 'Decon test',
    version: 281474983067648
  }
}
const deconDeflated = pako.deflate(JSON.stringify(deconObj))
const deconB64 = Buffer.from(deconDeflated).toString('base64')
writeFileSync(join(fixturesDir, 'deconstruction-planner.txt'), '0' + deconB64)
console.log('OK deconstruction-planner.txt')

// 6. upgrade-planner.txt
const upgradeObj = {
  upgrade_planner: {
    item: 'upgrade-planner',
    label: 'Up test',
    version: 281474983067648
  }
}
const upgradeDeflated = pako.deflate(JSON.stringify(upgradeObj))
const upgradeB64 = Buffer.from(upgradeDeflated).toString('base64')
writeFileSync(join(fixturesDir, 'upgrade-planner.txt'), '0' + upgradeB64)
console.log('OK upgrade-planner.txt')

// 7. blueprint-book.txt and 8. nested-book.txt
const VERSION = 281474983067648
function pack(obj) {
  return '0' + Buffer.from(pako.deflate(JSON.stringify(obj))).toString('base64')
}
function bp(label) {
  return { blueprint: { item: 'blueprint', label, entities: [], version: VERSION } }
}
function book(label, blueprints) {
  return {
    blueprint_book: {
      item: 'blueprint-book',
      label,
      blueprints: blueprints.map((b, i) => ({ index: i, ...b })),
      version: VERSION
    }
  }
}

// Flat book with 3 blueprints.
writeFileSync(
  join(fixturesDir, 'blueprint-book.txt'),
  pack(book('Mall', [bp('Red'), bp('Green'), bp('Blue')]))
)
console.log('OK blueprint-book.txt')

// Nested book: top book has [bp, sub-book[bp, bp]].
writeFileSync(
  join(fixturesDir, 'nested-book.txt'),
  pack(book('Outer', [bp('Top item'), book('Inner', [bp('Inner A'), bp('Inner B')])]))
)
console.log('OK nested-book.txt')

// Verify the good fixture round-trips
const verifyBytes = Buffer.from(goodFixture.slice(1), 'base64')
const verifyJson = pako.inflate(verifyBytes, { to: 'string' })
console.log('verify round-trip:', verifyJson.slice(0, 80) + '...')
