// Strips Factorio rich-text tags from a label string for human-readable
// display. Removes opening tags like [item=foo] or [color=red] and
// closing tags like [/color]. Preserves the inner text. Collapses
// multiple spaces and trims.

export function stripFactorioTags(label) {
  if (label == null) return ''
  if (typeof label !== 'string') return String(label)
  return label
    .replace(/\[[a-z][a-z0-9-]*=[^\]]*\]/gi, '')
    .replace(/\[\/[a-z][a-z0-9-]*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
