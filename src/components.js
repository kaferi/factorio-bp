// Pure module: extracts the "components" panel data for a single
// blueprint — counts of entities and tiles aggregated by (name, quality).
// No DOM, no locale. The UI layer renders the result and handles clicks.

const QUALITY_NORMAL = 'normal'

// Factorio's UI shows every rail variant under a single "rail" item with
// a combined count — one icon for straight, curved-a/b, half-diagonal,
// the elevated counterparts, etc. We mirror that aggregation in the
// components panel so the user sees the same picture as the in-game
// inventory.
//
// The map's value is how many `rail` items are needed to place one of
// the entity (matching the entity's `minable.results.amount` in
// Factorio's data): straight rails are 1×, half-diagonals 2×, full
// curves 4×. The aggregated "rail" tile sums those weighted counts so
// it matches what the game shows in the blueprint cost.
const RAIL_ITEM_MULTIPLIER = {
  'rail':                          1,
  'straight-rail':                 1,
  'curved-rail':                   3,
  'curved-rail-a':                 3,
  'curved-rail-b':                 3,
  'half-diagonal-rail':            3,
  'elevated-straight-rail':        1,
  'elevated-curved-rail-a':        3,
  'elevated-curved-rail-b':        3,
  'elevated-half-diagonal-rail':   3
}

function railMultiplier(name) {
  return RAIL_ITEM_MULTIPLIER[name] ?? 0
}

function isRailEntity(name) {
  return name in RAIL_ITEM_MULTIPLIER
}

function readQuality(obj) {
  if (obj && typeof obj === 'object' && typeof obj.quality === 'string' && obj.quality.length > 0) {
    return obj.quality
  }
  return QUALITY_NORMAL
}

// Aggregates `arr` by (name, quality) into an array of
// { kind, name, quality, count } sorted by count desc, then name asc.
function aggregate(arr, kind) {
  const map = new Map()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.name !== 'string' || item.name.length === 0) continue
    const quality = readQuality(item)
    const key = `${kind}|${item.name}|${quality}`
    const prev = map.get(key)
    if (prev) prev.count++
    else map.set(key, { kind, name: item.name, quality, count: 1 })
  }
  return [...map.values()]
}

// Folds every rail-variant entity into a single "rail" bucket per
// quality, mirroring how Factorio's inventory UI counts them.
// Each combined entry carries a `matchNames` array listing the
// underlying entity names so the click-to-jump search can highlight
// every variant in the JSON pane, not just the synthetic name.
function aggregateRails(components) {
  const railsByQuality = new Map()
  const others = []
  for (const c of components) {
    if (c.kind === 'entity' && isRailEntity(c.name)) {
      const itemsPerEntity = railMultiplier(c.name)
      const itemsForThis = c.count * itemsPerEntity
      const prev = railsByQuality.get(c.quality)
      if (prev) {
        prev.count += itemsForThis
        if (!prev.matchNames.includes(c.name)) prev.matchNames.push(c.name)
      } else {
        railsByQuality.set(c.quality, {
          kind: 'entity',
          name: 'rail',
          quality: c.quality,
          count: itemsForThis,
          matchNames: [c.name]
        })
      }
    } else {
      others.push(c)
    }
  }
  return [...others, ...railsByQuality.values()]
}

// Public API.
//
// Input: a wrapper-shaped object such as `{ blueprint: { entities, tiles } }`,
// or a bare inner blueprint, or even a Factorio JSON root we already have at
// hand. We probe for the typical shapes; if neither entities nor tiles are
// found, returns [].
export function extractComponents(json) {
  if (!json || typeof json !== 'object') return []
  const inner = json.blueprint && typeof json.blueprint === 'object'
    ? json.blueprint
    : json
  const entities = Array.isArray(inner.entities) ? inner.entities : []
  const tiles = Array.isArray(inner.tiles) ? inner.tiles : []
  if (entities.length === 0 && tiles.length === 0) return []

  let components = [
    ...aggregate(entities, 'entity'),
    ...aggregate(tiles, 'tile')
  ]
  components = aggregateRails(components)

  components.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    if (a.name !== b.name) return a.name.localeCompare(b.name)
    return a.quality.localeCompare(b.quality)
  })
  return components
}

export const QUALITY_NONE = QUALITY_NORMAL

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Walk backward from `pos` to find the index of the `{` that opens the
// enclosing JSON object. Tracks brace depth and SKIPS BRACES INSIDE
// STRING LITERALS so labels and keys with literal `{`/`}` don't break
// the count. Returns -1 if not found.
function findEnclosingOpenBrace(text, pos) {
  let depth = 0
  let inString = false
  // Walk backward; we need to know whether each char is inside a string.
  // Walking backward through escaped strings is tricky, so do a forward
  // scan from 0 to `pos`, recording the string-literal state at every
  // index, then walk backward using that info.
  const states = stringLiteralMask(text, pos + 1)
  for (let i = pos - 1; i >= 0; i--) {
    if (states[i]) continue
    const c = text[i]
    if (c === '}') depth++
    else if (c === '{') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

function findEnclosingCloseBrace(text, pos) {
  const states = stringLiteralMask(text, text.length)
  let depth = 0
  for (let i = pos + 1; i < text.length; i++) {
    if (states[i]) continue
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

// Returns a Uint8Array of length `upto`, where mask[i] === 1 iff
// text[i] is inside a JSON string literal (between unescaped quotes).
// Memoised per call site — cheap enough for blueprint-sized JSON
// (a few MB tops).
function stringLiteralMask(text, upto) {
  const mask = new Uint8Array(upto)
  let inString = false
  let escaped = false
  for (let i = 0; i < upto; i++) {
    const c = text[i]
    if (inString) {
      mask[i] = 1
      if (escaped) {
        escaped = false
      } else if (c === '\\') {
        escaped = true
      } else if (c === '"') {
        inString = false
        mask[i] = 0  // the closing quote itself is the boundary
      }
    } else if (c === '"') {
      inString = true
      mask[i] = 0  // the opening quote is the boundary
    }
  }
  return mask
}

// Find every entity / tile match in `jsonText` whose `name` is `name`
// (or one of `name` if it's an array — used for aggregated entries
// like the "rail" bucket) AND whose enclosing object's `quality`
// matches the requested one (with absence of "quality" treated as
// 'normal'). Returns an array of `{ start, end }` character positions
// of the `"name": "<X>"` substring, sorted by `start`.
//
// Used by the UI to wrap matches in <mark> spans for the components
// panel click handler.
export function findComponentMatches(jsonText, name, quality) {
  if (typeof jsonText !== 'string') return []
  const names = Array.isArray(name) ? name : [name]
  const filteredNames = names.filter(n => typeof n === 'string' && n.length > 0)
  if (filteredNames.length === 0) return []

  const wanted = (typeof quality === 'string' && quality.length > 0) ? quality : QUALITY_NORMAL
  const mask = stringLiteralMask(jsonText, jsonText.length)
  const matches = []

  for (const n of filteredNames) {
    const nameRe = new RegExp(`"name":\\s*"${escapeRegex(n)}"`, 'g')
    let m
    while ((m = nameRe.exec(jsonText)) !== null) {
      if (mask[m.index]) continue  // matched inside a string literal — false positive
      const objStart = walkBraceBackward(jsonText, m.index, mask)
      if (objStart < 0) continue
      const objEnd = walkBraceForward(jsonText, m.index, mask)
      if (objEnd < 0) continue
      const objText = jsonText.slice(objStart, objEnd + 1)
      const qualityMatch = /"quality":\s*"([^"]*)"/.exec(objText)
      const actual = qualityMatch ? qualityMatch[1] : QUALITY_NORMAL
      if (actual === wanted) matches.push({ start: m.index, end: m.index + m[0].length })
    }
  }

  matches.sort((a, b) => a.start - b.start)
  return matches
}

function walkBraceBackward(text, pos, mask) {
  let depth = 0
  for (let i = pos - 1; i >= 0; i--) {
    if (mask[i]) continue
    const c = text[i]
    if (c === '}') depth++
    else if (c === '{') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

function walkBraceForward(text, pos, mask) {
  let depth = 0
  for (let i = pos + 1; i < text.length; i++) {
    if (mask[i]) continue
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}
