export class DecodeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DecodeError'
  }
}

// Strict base64 alphabet (RFC 4648). Allows optional `=` padding.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

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

function collectChildren(bookInner, prefix) {
  // bookInner is the object under `blueprint_book` key.
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

export function decode(input, { inflate } = {}) {
  if (typeof input !== 'string') {
    throw new DecodeError('Ожидается строка')
  }
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new DecodeError('Пустая строка')
  }
  if (trimmed[0] !== '0') {
    throw new DecodeError('Строка должна начинаться с «0»')
  }
  if (typeof inflate !== 'function') {
    throw new DecodeError('Внутренняя ошибка: не передан inflate')
  }

  const b64 = trimmed.slice(1)

  // Pre-validate base64 because Node's Buffer.from(..., 'base64') and
  // browsers' atob differ in strictness; we want a consistent error.
  if (!BASE64_RE.test(b64)) {
    throw new DecodeError('Неверный base64')
  }

  let bytes
  try {
    bytes = base64ToBytes(b64)
  } catch (e) {
    throw new DecodeError('Неверный base64')
  }

  let jsonText
  try {
    jsonText = inflate(bytes, { to: 'string' })
  } catch (e) {
    throw new DecodeError('Неверные zlib-данные')
  }
  if (typeof jsonText !== 'string') {
    // Pako 2.x returns undefined for truncated/incomplete streams without
    // throwing — treat that as a zlib failure too.
    throw new DecodeError('Неверные zlib-данные')
  }

  let json
  try {
    json = JSON.parse(jsonText)
  } catch (e) {
    throw new DecodeError('Повреждённый JSON')
  }

  const { kind, inner } = classify(json)
  const label = (inner && typeof inner.label === 'string') ? inner.label : null
  const version = (inner && typeof inner.version === 'number') ? inner.version : null
  const versionString = parseVersion(version)
  const children = (kind === 'blueprint-book' && inner) ? collectChildren(inner, []) : []

  return {
    kind,
    label,
    version,
    versionString,
    json,
    children
  }
}
