// Pure module: maps Factorio rich-text tags to icon URLs (via the
// pre-built manifest) and produces HTML fragments with inline <img>
// for each recognised tag. No DOM access at lookup time. The caller
// inserts the result via innerHTML.

import manifest from './icons-manifest.js'

const CANDIDATE_KEYS = {
  item:             name => [`icons_${name}`],
  recipe:           name => [`icons_${name}`],
  entity:           name => [`icons_${name}`],
  tile:             name => [`icons_${name}`],
  fluid:            name => [`fluid_${name}`],
  'virtual-signal': name => [
    `signal_${name}`,
    `arrows_${name}`,
    `shapes_${name}`,
    `parameter_${name}`
  ],
  achievement:      name => [`achievement_${name}`],
  technology:       name => [`technology_${name}`],
  equipment:        name => [`equipment_${name}`],
  'item-group':     name => [`item-group_${name}`],
  planet:           name => [`icons_${name}`],
  // Quality indicator icons live under `icons_quality-<name>` in the
  // upstream manifest (uncommon / rare / epic / legendary / normal).
  // The older `quality_<name>` keys are mostly module variants, so we
  // try the new shape first.
  quality:          name => [`icons_quality-${name}`, `quality_${name}`]
}

// Factorio uses different `type` names in two places: rich-text labels
// (e.g. `[virtual-signal=down-arrow]`) vs. structural blueprint `icons[]`
// arrays (`{ type: "virtual", name: "down-arrow" }`). Normalise the
// engine-internal forms to the rich-text form used by CANDIDATE_KEYS.
const TYPE_ALIASES = {
  virtual: 'virtual-signal'
}

export function lookupIconUrl(type, name) {
  const normalised = TYPE_ALIASES[type] ?? type
  const buildKeys = CANDIDATE_KEYS[normalised]
  if (!buildKeys) return null
  if (typeof name !== 'string' || name.length === 0) return null
  for (const key of buildKeys(name)) {
    const url = manifest[key]
    if (url) return url
  }
  return null
}

const OPENING_TAG_RE = /\[([a-z][a-z0-9-]*)=([^\]]*)\]/gi
const CLOSING_TAG_RE = /\[\/[a-z][a-z0-9-]*\]/gi

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escapeAttr(s) {
  return escapeHtml(s)
}

export function renderLabelWithIconsHtml(label) {
  if (label == null) return ''
  const s = typeof label === 'string' ? label : String(label)

  // Drop closing tags first; they are never useful for our renderer.
  const noClosing = s.replace(CLOSING_TAG_RE, '')

  let out = ''
  let lastIndex = 0
  const re = new RegExp(OPENING_TAG_RE.source, OPENING_TAG_RE.flags)
  let m
  while ((m = re.exec(noClosing)) !== null) {
    out += escapeHtml(noClosing.slice(lastIndex, m.index))

    const type = m[1].toLowerCase()
    const rawValue = m[2]
    // [item=iron-plate,quality=rare] → "iron-plate"
    const name = rawValue.split(',')[0]
    const url = lookupIconUrl(type, name)
    if (url) {
      const altText = `[${type}=${name}]`
      out += `<img class="bp-icon" src="${escapeAttr(url)}" alt="${escapeAttr(altText)}" />`
    }
    // Unknown / not-in-manifest → drop the tag silently.

    lastIndex = m.index + m[0].length
  }
  out += escapeHtml(noClosing.slice(lastIndex))

  // Collapse runs of whitespace within the textual portions, trim ends.
  // The conservative pattern below leaves single spaces between words alone
  // and only collapses 2+ consecutive whitespace.
  return out.replace(/\s{2,}/g, ' ').trim()
}

// Render the contents of a Factorio `icons` array (the structural icon
// hint that lives next to entities / blueprints, separate from rich-text
// tags inside the label). Each entry looks like
// `{ signal: { type?, name, quality? }, index? }`. The default `signal.type`
// is "item". `index` orders the entries in a 1-based 2x2 grid; we just
// sort by it. Unknown signals are silently dropped.
export function renderIconsArrayHtml(iconsArr) {
  if (!Array.isArray(iconsArr) || iconsArr.length === 0) return ''
  const sorted = iconsArr
    .map((entry, i) => ({ entry, order: typeof entry?.index === 'number' ? entry.index : i + 1 }))
    .sort((a, b) => a.order - b.order)
    .map(x => x.entry)

  let out = ''
  for (const entry of sorted) {
    const sig = entry?.signal
    if (!sig || typeof sig.name !== 'string') continue
    const type = (typeof sig.type === 'string' && sig.type.length > 0) ? sig.type : 'item'
    const url = lookupIconUrl(type, sig.name)
    if (!url) continue
    const altText = `[${type}=${sig.name}]`
    out += `<img class="bp-icon" src="${escapeAttr(url)}" alt="${escapeAttr(altText)}" />`
  }
  return out
}
