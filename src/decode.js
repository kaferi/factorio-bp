// Pure decoder: turns a Factorio blueprint string into a structured
// JSON object. Knows nothing about the DOM and nothing about locale —
// errors are surfaced as `DecodeError` instances with a stable `code`,
// the UI layer is responsible for showing localised text.

export const ErrorCodes = Object.freeze({
  WRONG_INPUT_TYPE: 'WRONG_INPUT_TYPE',
  EMPTY_INPUT: 'EMPTY_INPUT',
  BAD_PREFIX: 'BAD_PREFIX',
  INTERNAL_NO_INFLATE: 'INTERNAL_NO_INFLATE',
  BAD_BASE64: 'BAD_BASE64',
  BAD_ZLIB: 'BAD_ZLIB',
  BAD_JSON: 'BAD_JSON'
})

const DEFAULT_MESSAGES = {
  WRONG_INPUT_TYPE: 'Expected a string',
  EMPTY_INPUT: 'Empty string',
  BAD_PREFIX: 'String must start with "0"',
  INTERNAL_NO_INFLATE: 'Internal error: inflate function missing',
  BAD_BASE64: 'Invalid base64',
  BAD_ZLIB: 'Invalid zlib data',
  BAD_JSON: 'Corrupted JSON payload'
}

export class DecodeError extends Error {
  constructor(code) {
    super(DEFAULT_MESSAGES[code] ?? code)
    this.name = 'DecodeError'
    this.code = code
  }
}

// Strict base64 alphabet (RFC 4648). Allows optional `=` padding.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function base64ToBytes(b64) {
  // Cross-environment: atob in browser, Buffer in Node.
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

const ROOT_KEYS = {
  blueprint: 'blueprint',
  blueprint_book: 'blueprint-book',
  deconstruction_planner: 'deconstruction-planner',
  upgrade_planner: 'upgrade-planner'
}

function classify(json) {
  for (const key of Object.keys(ROOT_KEYS)) {
    if (json && typeof json === 'object' && json[key]) {
      return { kind: ROOT_KEYS[key], inner: json[key] }
    }
  }
  return { kind: 'unknown', inner: null }
}

function parseVersion(raw) {
  if (typeof raw !== 'number') return null
  // Factorio packs version as 4×16-bit big-endian: major.minor.patch.dev.
  // Use BigInt to avoid 53-bit precision loss on the high word.
  const big = BigInt(raw)
  const major = Number((big >> 48n) & 0xffffn)
  const minor = Number((big >> 32n) & 0xffffn)
  const patch = Number((big >> 16n) & 0xffffn)
  const dev   = Number(big & 0xffffn)
  return `${major}.${minor}.${patch}.${dev}`
}

function collectChildren(bookInner, prefix) {
  // bookInner is the object under the `blueprint_book` key.
  const out = []
  const list = Array.isArray(bookInner.blueprints) ? bookInner.blueprints : []
  list.forEach((entry, i) => {
    const path = [...prefix, i]
    const { kind, inner } = classify(entry)
    if (kind === 'unknown' || inner === null) return
    const label = (typeof inner.label === 'string') ? inner.label : null
    out.push({ path, kind, label, json: entry })
    if (kind === 'blueprint-book') {
      out.push(...collectChildren(inner, path))
    }
  })
  return out
}

export function decode(input, { inflate } = {}) {
  if (typeof input !== 'string') {
    throw new DecodeError(ErrorCodes.WRONG_INPUT_TYPE)
  }
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new DecodeError(ErrorCodes.EMPTY_INPUT)
  }
  if (trimmed[0] !== '0') {
    throw new DecodeError(ErrorCodes.BAD_PREFIX)
  }
  if (typeof inflate !== 'function') {
    throw new DecodeError(ErrorCodes.INTERNAL_NO_INFLATE)
  }

  const b64 = trimmed.slice(1)

  // Pre-validate base64 because Node's Buffer.from(..., 'base64') and
  // browsers' atob differ in strictness; this gives us a consistent error.
  if (!BASE64_RE.test(b64)) {
    throw new DecodeError(ErrorCodes.BAD_BASE64)
  }

  let bytes
  try {
    bytes = base64ToBytes(b64)
  } catch {
    throw new DecodeError(ErrorCodes.BAD_BASE64)
  }

  let jsonText
  try {
    jsonText = inflate(bytes, { to: 'string' })
  } catch {
    throw new DecodeError(ErrorCodes.BAD_ZLIB)
  }
  if (typeof jsonText !== 'string') {
    // pako 2.x returns undefined for truncated/incomplete streams without
    // throwing — treat that as a zlib failure too.
    throw new DecodeError(ErrorCodes.BAD_ZLIB)
  }

  let json
  try {
    json = JSON.parse(jsonText)
  } catch {
    throw new DecodeError(ErrorCodes.BAD_JSON)
  }

  const { kind, inner } = classify(json)
  const label = (inner && typeof inner.label === 'string') ? inner.label : null
  const version = (inner && typeof inner.version === 'number') ? inner.version : null
  const versionString = parseVersion(version)
  const children = (kind === 'blueprint-book' && inner) ? collectChildren(inner, []) : []

  return { kind, label, version, versionString, json, children }
}
