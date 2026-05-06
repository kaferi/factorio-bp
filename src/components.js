// Pure module: extracts the "components" panel data for a single
// blueprint — counts of entities and tiles aggregated by (name, quality).
// No DOM, no locale. The UI layer renders the result and handles clicks.

const QUALITY_NORMAL = 'normal'

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

  const components = [
    ...aggregate(entities, 'entity'),
    ...aggregate(tiles, 'tile')
  ]

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
// AND whose enclosing object's `quality` matches the requested one
// (with absence of "quality" treated as 'normal'). Returns an array of
// { start, end } character positions of the `"name": "<X>"` substring.
//
// Used by the UI to wrap matches in <mark> spans for the components
// panel click handler.
export function findComponentMatches(jsonText, name, quality) {
  if (typeof jsonText !== 'string' || typeof name !== 'string' || name.length === 0) return []
  const wanted = (typeof quality === 'string' && quality.length > 0) ? quality : QUALITY_NORMAL
  const matches = []
  const nameRe = new RegExp(`"name":\\s*"${escapeRegex(name)}"`, 'g')
  // We need brace info for the whole document; compute the string-literal
  // mask once and reuse for every match.
  const mask = stringLiteralMask(jsonText, jsonText.length)
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
