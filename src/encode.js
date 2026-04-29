// Pure encoder: turns a JSON object back into a Factorio blueprint
// string. Mirror of `decode.js`: no DOM, no locale knowledge, errors
// surfaced as `EncodeError` with stable codes. The UI layer is
// responsible for parsing user-typed JSON (textarea contents) before
// calling encode.

export const ErrorCodes = Object.freeze({
  INTERNAL_NO_DEFLATE: 'INTERNAL_NO_DEFLATE',
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  BAD_PAYLOAD: 'BAD_PAYLOAD'
})

const DEFAULT_MESSAGES = {
  INTERNAL_NO_DEFLATE: 'Internal error: deflate function missing',
  NOT_AN_OBJECT: 'Encoder expected an object at the root',
  BAD_PAYLOAD: 'JSON cannot be serialised (circular references?)'
}

export class EncodeError extends Error {
  constructor(code) {
    super(DEFAULT_MESSAGES[code] ?? code)
    this.name = 'EncodeError'
    this.code = code
  }
}

function bytesToBase64(bytes) {
  // Cross-environment: btoa in browser, Buffer in Node.
  if (typeof btoa === 'function') {
    let bin = ''
    // Chunk to keep `String.fromCharCode.apply` happy on big payloads.
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(bin)
  }
  return Buffer.from(bytes).toString('base64')
}

export function encode(json, { deflate } = {}) {
  if (typeof deflate !== 'function') {
    throw new EncodeError(ErrorCodes.INTERNAL_NO_DEFLATE)
  }
  if (json === null || typeof json !== 'object') {
    throw new EncodeError(ErrorCodes.NOT_AN_OBJECT)
  }

  let payload
  try {
    payload = JSON.stringify(json)
  } catch {
    throw new EncodeError(ErrorCodes.BAD_PAYLOAD)
  }
  if (typeof payload !== 'string') {
    // `JSON.stringify` returns `undefined` for unsupported root types
    // (functions, symbols). Treat as a payload error.
    throw new EncodeError(ErrorCodes.BAD_PAYLOAD)
  }

  const bytes = new TextEncoder().encode(payload)
  const compressed = deflate(bytes)
  const b64 = bytesToBase64(compressed)
  return '0' + b64
}
