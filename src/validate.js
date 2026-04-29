// Pure structural validator: checks that a JSON object looks like a
// real Factorio blueprint payload before we encode it. No DOM, no
// locale; errors carry stable `code` and a `params` object that the
// UI layer translates via the i18n dictionary.

export const ErrorCodes = Object.freeze({
  MISSING_ROOT_KEY:     'MISSING_ROOT_KEY',
  INNER_NOT_OBJECT:     'INNER_NOT_OBJECT',
  WRONG_ITEM_VALUE:     'WRONG_ITEM_VALUE',
  BLUEPRINTS_NOT_ARRAY: 'BLUEPRINTS_NOT_ARRAY',
  ENTITIES_NOT_ARRAY:   'ENTITIES_NOT_ARRAY',
  ENTITY_MALFORMED:     'ENTITY_MALFORMED'
})

const DEFAULT_MESSAGES = {
  MISSING_ROOT_KEY:     'Object is not a Factorio blueprint',
  INNER_NOT_OBJECT:     'Inner value must be an object',
  WRONG_ITEM_VALUE:     'item field does not match the root key',
  BLUEPRINTS_NOT_ARRAY: 'blueprints must be an array',
  ENTITIES_NOT_ARRAY:   'entities must be an array',
  ENTITY_MALFORMED:     'entity is malformed'
}

export class ValidationError extends Error {
  constructor(code, params = {}) {
    super(DEFAULT_MESSAGES[code] ?? code)
    this.name = 'ValidationError'
    this.code = code
    this.params = params
  }
}

const ROOT_KEYS = {
  blueprint:              'blueprint',
  blueprint_book:         'blueprint-book',
  deconstruction_planner: 'deconstruction-planner',
  upgrade_planner:        'upgrade-planner'
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

// Validates a wrapper object (the thing carrying one of the four root
// keys). `pathPrefix` is the dotted/bracket trail that led us here.
function validateWrapper(wrapper, pathPrefix) {
  if (!isObject(wrapper)) {
    throw new ValidationError(ErrorCodes.MISSING_ROOT_KEY, { path: pathPrefix })
  }

  let rootKey = null
  for (const key of Object.keys(ROOT_KEYS)) {
    if (key in wrapper) { rootKey = key; break }
  }
  if (!rootKey) {
    throw new ValidationError(ErrorCodes.MISSING_ROOT_KEY, { path: pathPrefix })
  }

  const innerPath = pathPrefix === '<root>' ? rootKey : `${pathPrefix}.${rootKey}`
  const inner = wrapper[rootKey]
  if (!isObject(inner)) {
    throw new ValidationError(ErrorCodes.INNER_NOT_OBJECT, { path: innerPath })
  }

  const expectedItem = ROOT_KEYS[rootKey]
  if ('item' in inner && inner.item !== expectedItem) {
    throw new ValidationError(ErrorCodes.WRONG_ITEM_VALUE, {
      path: innerPath,
      expected: expectedItem,
      actual: String(inner.item)
    })
  }

  if (rootKey === 'blueprint_book') {
    if ('blueprints' in inner) {
      if (!Array.isArray(inner.blueprints)) {
        throw new ValidationError(ErrorCodes.BLUEPRINTS_NOT_ARRAY, {
          path: `${innerPath}.blueprints`
        })
      }
      for (let i = 0; i < inner.blueprints.length; i++) {
        validateWrapper(inner.blueprints[i], `${innerPath}.blueprints[${i}]`)
      }
    }
  }

  if (rootKey === 'blueprint') {
    if ('entities' in inner) {
      if (!Array.isArray(inner.entities)) {
        throw new ValidationError(ErrorCodes.ENTITIES_NOT_ARRAY, {
          path: `${innerPath}.entities`
        })
      }
      for (let i = 0; i < inner.entities.length; i++) {
        const e = inner.entities[i]
        const ep = `${innerPath}.entities[${i}]`
        if (!isObject(e)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'not-an-object' })
        }
        if (typeof e.name !== 'string' || e.name.length === 0) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'missing-name' })
        }
        if (!isObject(e.position)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'missing-position' })
        }
        if (!isFiniteNumber(e.position.x)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'bad-x' })
        }
        if (!isFiniteNumber(e.position.y)) {
          throw new ValidationError(ErrorCodes.ENTITY_MALFORMED, { path: ep, reason: 'bad-y' })
        }
      }
    }
  }
  // Planners (deconstruction_planner, upgrade_planner) only need
  // levels 1-4 — we do not probe their settings.
}

export function validate(json) {
  validateWrapper(json, '<root>')
}
