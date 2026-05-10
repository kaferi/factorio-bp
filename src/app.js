import { decode, DecodeError } from './decode.js'
import { encode, EncodeError } from './encode.js'
import { validate, ValidationError } from './validate.js'
import { t, setLocale, getLocale, detectLocale } from './i18n.js'
import { stripFactorioTags } from './labels.js'
import { renderLabelWithIconsHtml, renderIconsArrayHtml, lookupIconUrl } from './icons.js'
import { extractComponents, findComponentMatches } from './components.js'

setLocale(detectLocale())

const root = document.getElementById('app')

const state = {
  phase: 'empty',     // 'empty' | 'decoded' | 'error'
  input: '',
  result: null,       // DecodeResult
  error: null,        // already-localised string
  view: 'json',       // 'json' | 'tree'
  selectedPath: [],   // [] = root
  draft: '',          // current text in the JSON editor textarea (mirrors the selected node, edited freely by the user)
  encodeResult: null,
  encodeError: null,
  searchQuery: '',
  busy: false,      // a heavy synchronous op (decode / encode) is running
  collapsedPaths: new Set(),// set of path-keys ("0,1") of books the user collapsed
  activeComponent: null,    // { kind, name, quality } currently highlighted in JSON, or null
  componentMatchIdx: 0,     // index of the current match within state.activeComponent
  editorScope: 'one',       // 'one' | 'all' — apply structured edits only to the currently active match, or to all entities of this type+quality
  confirmDelete: null       // null | { count, name } — when set, the delete-confirm modal is shown
}

// Build the editor's draft text for the currently selected node:
// pretty-printed JSON, with the parent-book `index` field stripped on
// children so the JSON reads as a standalone blueprint (matches what
// Factorio exports natively and what Encode will produce).
function draftForSelection(result, selectedPath) {
  if (!result) return ''
  const node = selectionForEncode(result, selectedPath)
  return JSON.stringify(node, null, 2)
}

// Snapshot scroll positions of long content panes so we can restore
// them after innerHTML replaces the DOM. Returns null fields when the
// element isn't present in the current view.
function captureScrolls() {
  const pre = document.querySelector('pre.json')
  const ta = document.getElementById('json-editor')
  return {
    pre: pre ? pre.scrollTop : null,
    ta: ta ? ta.scrollTop : null,
    taSelStart: ta ? ta.selectionStart : null,
    taSelEnd: ta ? ta.selectionEnd : null
  }
}
function restoreScrolls(s) {
  if (!s) return
  if (s.pre != null) {
    const pre = document.querySelector('pre.json')
    if (pre) pre.scrollTop = s.pre
  }
  if (s.ta != null) {
    const ta = document.getElementById('json-editor')
    if (ta) {
      ta.scrollTop = s.ta
      if (s.taSelStart != null) ta.setSelectionRange(s.taSelStart, s.taSelEnd ?? s.taSelStart)
    }
  }
}

function render({ preserveScroll = false } = {}) {
  const saved = preserveScroll ? captureScrolls() : null
  if (state.phase === 'decoded') {
    root.innerHTML = renderDecoded(state)
    wireDecoded()
    if (saved) restoreScrolls(saved)
    return
  }
  // empty or error — show input form
  const inputEmpty = state.input.trim().length === 0
  const decodeDisabled = state.busy || inputEmpty
  const decodeBtn = state.busy
    ? `<button id="btn-decode" class="primary" disabled><span class="spinner"></span>${escapeHtml(t('buttons.decoding'))}</button>`
    : `<button id="btn-decode" class="primary"${decodeDisabled ? ' disabled' : ''}>${escapeHtml(t('buttons.decode'))}</button>`
  root.innerHTML = `
    <textarea id="bp-input" placeholder="${escapeHtml(t('input.placeholder'))}" ${state.busy ? 'disabled' : ''}>${escapeHtml(state.input)}</textarea>
    <div class="btn-row">
      ${decodeBtn}
      <button id="btn-paste" ${state.busy ? 'disabled' : ''}>${escapeHtml(t('buttons.paste'))}</button>
      <button id="btn-clear" ${state.busy ? 'disabled' : ''}>${escapeHtml(t('buttons.clear'))}</button>
      <button id="btn-demo" class="btn-demo" ${state.busy ? 'disabled' : ''}>${escapeHtml(t('buttons.demo'))}</button>
    </div>
    ${state.phase === 'error' ? `<p class="error">${escapeHtml(state.error || '')}</p>` : ''}
  `
  if (!state.busy) {
    document.getElementById('btn-decode').addEventListener('click', onDecode)
    document.getElementById('btn-paste').addEventListener('click', onPaste)
    document.getElementById('btn-demo').addEventListener('click', onDemo)
    document.getElementById('btn-clear').addEventListener('click', onClear)
    // Live-update Decode's disabled state as the user types — saves a
    // full re-render on every keystroke while still keeping the button
    // and the input in sync.
    const decodeBtnEl = document.getElementById('btn-decode')
    document.getElementById('bp-input').addEventListener('input', e => {
      state.input = e.target.value
      decodeBtnEl.disabled = state.input.trim().length === 0
    })
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function localiseError(e) {
  if (e instanceof DecodeError) {
    return t('errors.' + e.code)
  }
  return `${t('errors.UNKNOWN')}: ${e.message}`
}

// Yield to the browser for one paint cycle so the UI can show the
// disabled / spinner state before we run the synchronous heavy work.
function nextPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    } else {
      setTimeout(resolve, 0)
    }
  })
}

async function onDecode() {
  if (state.busy) return
  state.busy = true
  render()
  await nextPaint()
  try {
    const result = decode(state.input, { inflate: window.pako.inflate })
    state.phase = 'decoded'
    state.result = result
    state.error = null
    // Books and planners-with-children open on the tree tab so the user
    // sees the contents at a glance instead of a giant raw JSON.
    state.view = result.children.length > 0 ? 'tree' : 'json'
    state.selectedPath = []
    state.draft = draftForSelection(result, [])
    state.encodeResult = null
    state.encodeError = null
    state.searchQuery = ''
    state.collapsedPaths = new Set()
    state.activeComponent = null
    state.componentMatchIdx = 0
  } catch (e) {
    state.phase = 'error'
    state.error = localiseError(e)
  } finally {
    state.busy = false
  }
  render()
}

async function onPaste() {
  try {
    const text = await navigator.clipboard.readText()
    state.input = text
    render()
  } catch {
    // Clipboard not available — silently ignore; the user can paste manually.
  }
}

// Loads our committed sample blueprint string and decodes it in one go,
// so the user doesn't have to copy-paste the fixture every time. The
// fixture is shipped at the same origin as the page (it lives under
// `src/__fixtures__/` in the repo, served as-is by GitHub Pages).
const DEMO_FIXTURE_URL = 'src/__fixtures__/real-large-book.txt'

async function onDemo() {
  if (state.busy) return
  state.busy = true
  render()
  await nextPaint()
  try {
    const res = await fetch(DEMO_FIXTURE_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    state.input = await res.text()
    const result = decode(state.input, { inflate: window.pako.inflate })
    state.phase = 'decoded'
    state.result = result
    state.error = null
    state.view = result.children.length > 0 ? 'tree' : 'json'
    state.selectedPath = []
    state.draft = draftForSelection(result, [])
    state.encodeResult = null
    state.encodeError = null
    state.searchQuery = ''
    state.collapsedPaths = new Set()
    state.activeComponent = null
    state.componentMatchIdx = 0
  } catch (e) {
    state.phase = 'error'
    state.error = e instanceof DecodeError
      ? localiseError(e)
      : `${t('errors.UNKNOWN')}: ${e.message}`
  } finally {
    state.busy = false
  }
  render()
}

function onClear() {
  state.phase = 'empty'
  state.input = ''
  state.result = null
  state.error = null
  state.draft = ''
  state.encodeResult = null
  state.encodeError = null
  state.searchQuery = ''
  state.collapsedPaths = new Set()
  state.activeComponent = null
  state.componentMatchIdx = 0
  render()
}

function getNodeAtPath(result, path) {
  if (path.length === 0) return { kind: result.kind, label: result.label, json: result.json }
  // Walk: root.json.blueprint_book.blueprints[idx0].blueprint_book.blueprints[idx1]...
  let cursor = result.json
  for (const idx of path) {
    // cursor is { blueprint_book: {...} } at the root, then a wrapper
    // { blueprint: {...} } / { blueprint_book: {...} } at each child level.
    const inner = cursor.blueprint_book ?? cursor.blueprint
    cursor = inner.blueprints[idx]
  }
  // cursor is the wrapper object, e.g. { blueprint: {...} } — return as-is for the JSON view.
  // For label/kind, look up the matching child in result.children.
  const child = result.children.find(c => arraysEqual(c.path, path))
  return { kind: child?.kind ?? 'unknown', label: child?.label ?? null, json: cursor }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// Read the `icons[]` array for a wrapper or root blueprint object —
// the structural icon hint Factorio attaches to a blueprint, separate
// from rich-text tags in the label. Returns [] if the wrapper does
// not carry any.
function innerIconsArr(wrapperOrJson) {
  if (!wrapperOrJson || typeof wrapperOrJson !== 'object') return []
  const inner = wrapperOrJson.blueprint
    ?? wrapperOrJson.blueprint_book
    ?? wrapperOrJson.deconstruction_planner
    ?? wrapperOrJson.upgrade_planner
    ?? wrapperOrJson
  return Array.isArray(inner?.icons) ? inner.icons : []
}

// Render a label as HTML, mixing rich-text tag icons (from the label
// string itself) and structural icons (from the JSON `icons[]` array).
// If the label contains rich-text tags, we trust them and skip the
// `icons[]` array (otherwise icons get duplicated). Otherwise, we
// prepend `icons[]` icons before the plain text.
function renderLabelAndIconsHtml(label, iconsArr) {
  const hasRichTag = typeof label === 'string' && /\[[a-z][a-z0-9-]*=[^\]]+\]/i.test(label)
  if (hasRichTag) return renderLabelWithIconsHtml(label)
  const iconsHtml = renderIconsArrayHtml(iconsArr)
  const textHtml = label ? escapeHtml(stripFactorioTags(label)) : ''
  if (iconsHtml && textHtml) return `${iconsHtml} ${textHtml}`
  return iconsHtml || textHtml
}

// Build the breadcrumb segments from the root down to the currently
// selected node. Each segment carries enough info for the renderer:
// its path, label, and icons[]-array (so we can show icons + label).
function breadcrumbSegments(result, selectedPath) {
  if (selectedPath.length === 0) return []
  const segments = [{
    path: [],
    label: result.label,
    iconsArr: innerIconsArr(result.json),
    kind: result.kind
  }]
  for (let i = 1; i <= selectedPath.length; i++) {
    const subpath = selectedPath.slice(0, i)
    const child = result.children.find(c => arraysEqual(c.path, subpath))
    if (!child) continue
    segments.push({
      path: subpath,
      label: child.label,
      iconsArr: innerIconsArr(child.json),
      kind: child.kind
    })
  }
  return segments
}

function renderBreadcrumb(s) {
  const segments = breadcrumbSegments(s.result, s.selectedPath)
  if (segments.length === 0) return ''
  const lastIdx = segments.length - 1
  const items = segments.map((seg, i) => {
    const display = renderLabelAndIconsHtml(seg.label, seg.iconsArr) || escapeHtml(t('treeNode.untitled'))
    const cls = i === lastIdx ? 'bc-segment current' : 'bc-segment'
    return `<span class="${cls}" data-path="${seg.path.join(',')}">${display}</span>`
  })
  return `<div class="breadcrumb">${items.join('<span class="bc-sep">›</span>')}</div>`
}

// Cap on how big a JSON string we are willing to splat into a single
// <pre>. Beyond this we render a placeholder — the browser layout
// cost on a multi-megabyte monospace pre with custom font dwarfs any
// usefulness, and Copy/Download still work on the underlying object.
const JSON_RENDER_LIMIT = 2_000_000  // 2 MB of pretty-printed text

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Render the components panel (entities + tiles aggregated by name +
// quality). Only meaningful for blueprint nodes — book / planner
// nodes return ''.
function renderComponentsPanel(s) {
  const node = getNodeAtPath(s.result, s.selectedPath)
  if (node.kind !== 'blueprint') return ''
  // Prefer the live draft so structured edits (quality change, bar limit,
  // requester flags) immediately reshape the components panel. Fall back
  // to the original parsed result if the draft is mid-edit and not yet
  // valid JSON.
  let source = node.json
  try {
    const parsed = JSON.parse(s.draft)
    if (parsed && typeof parsed === 'object') source = parsed
  } catch {}
  const components = extractComponents(source)
  if (components.length === 0) return ''

  const ac = s.activeComponent
  const tiles = components.map(c => {
    const isActive = ac && ac.kind === c.kind && ac.name === c.name && ac.quality === c.quality
    const url = lookupIconUrl(c.kind === 'tile' ? 'tile' : 'item', c.name)
      ?? lookupIconUrl('entity', c.name)
    const iconHtml = url
      ? `<img class="bp-icon" src="${escapeHtml(url)}" alt="${escapeHtml(c.name)}" />`
      : `<span class="comp-fallback">${escapeHtml(c.name.slice(0, 4))}</span>`
    // Quality is shown via the matching in-game indicator icon
    // (uncommon / rare / epic / legendary). Normal quality is the
    // default and shows nothing — keeps tiles clean.
    const qUrl = c.quality !== 'normal' ? lookupIconUrl('quality', c.quality) : null
    const qBar = qUrl
      ? `<img class="comp-quality" src="${escapeHtml(qUrl)}" alt="${escapeHtml(c.quality)}" />`
      : ''
    const titleParts = [c.name]
    if (c.quality !== 'normal') titleParts.push(c.quality)
    titleParts.push(`× ${c.count}`)
    // Aggregated entries (e.g. the "rail" bucket combining straight, curved
    // and elevated variants) carry `matchNames`; the click-to-jump search
    // uses them to highlight every variant in the JSON pane.
    const matchNamesAttr = Array.isArray(c.matchNames)
      ? ` data-comp-match-names="${escapeHtml(JSON.stringify(c.matchNames))}"`
      : ''
    return `
      <button type="button"
        class="comp-tile ${isActive ? 'active' : ''}"
        title="${escapeHtml(titleParts.join(' '))}"
        data-comp-kind="${escapeHtml(c.kind)}"
        data-comp-name="${escapeHtml(c.name)}"
        data-comp-quality="${escapeHtml(c.quality)}"${matchNamesAttr}>
        <span class="comp-slot">${iconHtml}</span>
        <span class="comp-count">${c.count}</span>
        ${qBar}
      </button>
    `
  }).join('')

  return `
    <div class="components-panel">
      <div class="components-header">${escapeHtml(t('components.title'))}</div>
      <div class="components-grid">${tiles}</div>
    </div>
  `
}

// Returns the inner blueprint object the editor should read against,
// parsed live from `state.draft`. Returns null when the draft does
// not represent a single-blueprint object (e.g. a book selected) or
// when parsing fails.
function editorTargetBlueprint(state) {
  let parsed
  try { parsed = JSON.parse(state.draft) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  return parsed.blueprint || (Array.isArray(parsed.entities) ? parsed : null)
}

// Walk `state.draft` (parsed) and return every entity matching the
// active component's name + quality (in document order — same as
// JSON.stringify writes them, so index N here corresponds to the Nth
// match in the textarea).
function entitiesMatchingActive(state) {
  const ac = state.activeComponent
  if (!ac) return []
  const inner = editorTargetBlueprint(state)
  if (!inner) return []
  const entities = Array.isArray(inner.entities) ? inner.entities : []
  return entities.filter(e =>
    e && e.name === ac.name && (e.quality || 'normal') === ac.quality
  )
}

// Reads the `request_filters.<field>` flag on a requester-chest entity.
// Defaults to false when the parent or field is absent.
function readRequesterFlag(entity, field) {
  return Boolean(entity?.request_filters?.[field])
}

// Mutates the entity in place: sets `request_filters.<field>` to `value`,
// or deletes the field when `value` is false (keeps the JSON tidy and
// matches Factorio's "default = absent" convention).
function writeRequesterFlag(entity, field, value) {
  if (!entity) return
  if (!entity.request_filters || typeof entity.request_filters !== 'object') {
    entity.request_filters = { sections: [{ index: 1 }] }
  }
  if (value) {
    entity.request_filters[field] = true
  } else {
    delete entity.request_filters[field]
  }
}

// Reads the chest's `bar` field — index of the first slot blocked from
// automation. Returns null when the chest has no limit set.
function readChestBar(entity) {
  if (!entity) return null
  return typeof entity.bar === 'number' ? entity.bar : null
}

// Sets `entity.bar` to `value`, or deletes the field when value is null /
// undefined / not a non-negative number (keeps "no limit" as absence).
function writeChestBar(entity, value) {
  if (!entity) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    delete entity.bar
  } else {
    entity.bar = Math.floor(value)
  }
}

// Every chest entity that has a player-visible inventory and therefore
// supports a bar limit. The map's value is the chest's base inventory
// size (Factorio 2.0, normal quality) — used to render the slot grid
// in the structured editor.
const CHEST_INVENTORY_SIZES = {
  'wooden-chest':            16,
  'iron-chest':              32,
  'steel-chest':             48,
  'active-provider-chest':   48,
  'passive-provider-chest':  48,
  'storage-chest':           48,
  'requester-chest':         48,
  'buffer-chest':            48
}

function isChestEntity(name) {
  return name in CHEST_INVENTORY_SIZES
}

function chestInventorySize(name) {
  return CHEST_INVENTORY_SIZES[name] ?? 48
}

// Five Factorio quality tiers, in display order. Used to render the
// quality picker in the entity editor.
const QUALITY_TIERS = ['normal', 'uncommon', 'rare', 'epic', 'legendary']

// Sets `entity.quality` to the new tier, or deletes the field for
// 'normal' (matches Factorio's "default = absent" convention).
function writeEntityQuality(entity, value) {
  if (!entity) return
  if (typeof value !== 'string' || value === 'normal') {
    delete entity.quality
  } else {
    entity.quality = value
  }
}

function renderQualityPicker(currentQuality) {
  const tiles = QUALITY_TIERS.map(q => {
    const url = lookupIconUrl('quality', q)
    const cls = q === currentQuality ? 'quality-pick-tile selected' : 'quality-pick-tile'
    const inner = url
      ? `<img class="bp-icon" src="${escapeHtml(url)}" alt="${escapeHtml(q)}" />`
      : `<span>${escapeHtml(q.slice(0, 2))}</span>`
    return `<button type="button" class="${cls}" data-quality-pick="${escapeHtml(q)}" title="${escapeHtml(q)}">${inner}</button>`
  }).join('')
  return `<div class="quality-picker">${tiles}</div>`
}

// Renders the in-game-style slot grid for the chest's bar limit.
// Slots before `bar` are "usable" (orange), the slot at `bar` carries
// the × marker, slots after it are "blocked" (dark). Click any slot to
// move the bar there; click the marker itself to clear the limit.
// `bar === null` means no limit — every slot is usable, no marker.
function renderChestBarGrid(chestName, bar) {
  const total = chestInventorySize(chestName)
  const cells = []
  for (let i = 0; i < total; i++) {
    let cls = 'cb-slot'
    if (bar == null || i < bar) cls += ' usable'
    else if (i === bar) cls += ' bar-marker'
    else cls += ' blocked'
    cells.push(`<button type="button" class="${cls}" data-cb-slot="${i}" aria-label="slot ${i}"></button>`)
  }
  return `<div class="chest-bar-grid">${cells.join('')}</div>`
}

// After any re-render that should keep the user focused on the same
// "logical" match (component-tile click, structured edit), find the
// position of `state.activeComponent`'s `componentMatchIdx`th
// occurrence in the freshly-rendered textarea, select that range,
// and scroll it into view. We can't preserve the previous selection
// range across edits because the JSON length may have changed —
// every byte after the edit is now at a different offset.
function focusActiveMatchInTextarea() {
  const ac = state.activeComponent
  if (!ac) return
  const ta = document.getElementById('json-editor')
  if (!ta) return
  const searchTarget = ac.matchNames ?? ac.name
  const matches = findComponentMatches(state.draft, searchTarget, ac.quality)
  if (matches.length === 0) return
  const idx = ((state.componentMatchIdx % matches.length) + matches.length) % matches.length
  const m = matches[idx]
  ta.focus()
  ta.setSelectionRange(m.start, m.end)
  // Scroll so the entity's opening `{` sits on the first visible row.
  // Browsers don't reliably auto-scroll a focused textarea to its
  // selection, so we compute the target line ourselves.
  const anchor = typeof m.objStart === 'number' ? m.objStart : m.start
  const before = ta.value.slice(0, anchor)
  const lineNum = (before.match(/\n/g) || []).length
  const cs = getComputedStyle(ta)
  let lineHeight = parseFloat(cs.lineHeight)
  if (!Number.isFinite(lineHeight)) {
    lineHeight = parseFloat(cs.fontSize) * 1.5
  }
  // A tiny bit of headroom above the brace looks better than pinning it
  // to the very top edge.
  ta.scrollTop = Math.max(0, lineNum * lineHeight - 4)
}

// Parse `state.draft`, find entities that match the active component
// (filtered by name + quality), narrow by `editorScope`, hand them to
// `mutator` for in-place edits, then serialise back to `state.draft`.
// Silently no-ops if the draft is not a valid blueprint JSON.
function applyStructuredEdit(mutator) {
  const ac = state.activeComponent
  if (!ac) return
  let parsed
  try { parsed = JSON.parse(state.draft) } catch { return }
  const inner = parsed && (parsed.blueprint || parsed)
  const entities = Array.isArray(inner?.entities) ? inner.entities : []
  const matches = entities.filter(e =>
    e && e.name === ac.name && (e.quality || 'normal') === ac.quality
  )
  if (matches.length === 0) return
  const targets = state.editorScope === 'one'
    ? [matches[((state.componentMatchIdx % matches.length) + matches.length) % matches.length]]
    : matches
  mutator(targets)
  state.draft = JSON.stringify(parsed, null, 2)
}

// Deletes every entity whose `entity_number` is in `targetNumbers`,
// then walks the surviving structure and strips dangling references
// pointing at the now-gone entities so the resulting blueprint stays
// internally consistent. Handles both Factorio 1.x layout
// (entity.connections.{1,2}.{red,green}[].entity_id, entity.neighbours[])
// and 2.x layout (blueprint.wires[] flat tuples). Schedules referencing
// deleted locomotives are pruned, and the schedule entry is dropped if
// no locomotive remains. No-op for an invalid draft or empty target set.
function deleteEntitiesFromDraft(targetNumbers) {
  if (!(targetNumbers instanceof Set) || targetNumbers.size === 0) return
  let parsed
  try { parsed = JSON.parse(state.draft) } catch { return }
  const inner = parsed && (parsed.blueprint || parsed)
  if (!inner || !Array.isArray(inner.entities)) return

  inner.entities = inner.entities.filter(e =>
    !(e && typeof e.entity_number === 'number' && targetNumbers.has(e.entity_number))
  )

  for (const e of inner.entities) {
    if (!e || typeof e !== 'object') continue
    // 1.x circuit-network connections: per-entity, two sides, two wire colors.
    if (e.connections && typeof e.connections === 'object') {
      for (const sideKey of Object.keys(e.connections)) {
        const side = e.connections[sideKey]
        if (!side || typeof side !== 'object') continue
        for (const wire of ['red', 'green']) {
          if (!Array.isArray(side[wire])) continue
          side[wire] = side[wire].filter(c =>
            !(c && typeof c.entity_id === 'number' && targetNumbers.has(c.entity_id))
          )
          if (side[wire].length === 0) delete side[wire]
        }
        if (Object.keys(side).length === 0) delete e.connections[sideKey]
      }
      if (Object.keys(e.connections).length === 0) delete e.connections
    }
    // 1.x copper-pole jumpers.
    if (Array.isArray(e.neighbours)) {
      e.neighbours = e.neighbours.filter(n =>
        !(typeof n === 'number' && targetNumbers.has(n))
      )
      if (e.neighbours.length === 0) delete e.neighbours
    }
  }

  // 2.x wires: flat array of [entity_a, wire_id_a, entity_b, wire_id_b].
  if (Array.isArray(inner.wires)) {
    inner.wires = inner.wires.filter(w =>
      Array.isArray(w) &&
      !(typeof w[0] === 'number' && targetNumbers.has(w[0])) &&
      !(typeof w[2] === 'number' && targetNumbers.has(w[2]))
    )
    if (inner.wires.length === 0) delete inner.wires
  }

  if (Array.isArray(inner.schedules)) {
    for (const s of inner.schedules) {
      if (s && Array.isArray(s.locomotives)) {
        s.locomotives = s.locomotives.filter(n =>
          !(typeof n === 'number' && targetNumbers.has(n))
        )
      }
    }
    inner.schedules = inner.schedules.filter(s =>
      s && Array.isArray(s.locomotives) && s.locomotives.length > 0
    )
    if (inner.schedules.length === 0) delete inner.schedules
  }

  state.draft = JSON.stringify(parsed, null, 2)
}

// Renders the structured-edit panel for the currently active component.
// Shows the quality picker for every entity, the chest bar grid only
// for chests, and the requester-specific checkboxes only for the
// requester-chest. Hidden for tiles (Factorio tiles have no quality
// or per-instance options blueprints care about).
function renderEntityEditor(s) {
  const ac = s.activeComponent
  if (!ac || ac.kind !== 'entity') return ''

  const matches = entitiesMatchingActive(s)
  if (matches.length === 0) return ''
  const totalEntities = matches.length
  const idx = ((s.componentMatchIdx % totalEntities) + totalEntities) % totalEntities
  const current = matches[idx] || matches[0]

  const isChest = isChestEntity(ac.name)
  const isRequester = ac.name === 'requester-chest'

  // Show the entity_number of the source entity in the header so the user
  // can confirm which one they're reading from / writing to in 'one' mode.
  const entNum = (current && typeof current.entity_number === 'number') ? current.entity_number : null
  const entNumLabel = entNum != null ? ` <span class="entity-editor-entnum">#${entNum}</span>` : ''
  // Mini-tile of the active entity in front of the title — same shape
  // and size as the components-panel tile the user clicked, with the
  // quality badge in the corner so a quality change is visible here too.
  const headerIconUrl = lookupIconUrl('item', ac.name) ?? lookupIconUrl('entity', ac.name)
  const headerIconInner = headerIconUrl
    ? `<img class="bp-icon" src="${escapeHtml(headerIconUrl)}" alt="${escapeHtml(ac.name)}" />`
    : `<span class="comp-fallback">${escapeHtml(ac.name.slice(0, 4))}</span>`
  const headerQUrl = ac.quality !== 'normal' ? lookupIconUrl('quality', ac.quality) : null
  const headerQBadge = headerQUrl
    ? `<img class="comp-quality" src="${escapeHtml(headerQUrl)}" alt="${escapeHtml(ac.quality)}" />`
    : ''
  const headerIcon = `
    <span class="comp-tile entity-editor-tile">
      <span class="comp-slot">${headerIconInner}</span>
      ${headerQBadge}
    </span>
  `

  const bar = isChest ? readChestBar(current) : null
  const reqBufs = isRequester ? readRequesterFlag(current, 'request_from_buffers') : false
  const trashUnreq = isRequester ? readRequesterFlag(current, 'trash_not_requested') : false

  const totalSlots = isChest ? chestInventorySize(ac.name) : 0
  const barStatus = bar == null
    ? escapeHtml(t('editor.chest.barNoLimit'))
    : `${bar} / ${totalSlots}`

  // Inline SVG trash icon — keeps us off any external sprite, scales
  // crisply, and recolors via `currentColor`.
  const deleteSvg = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.75A.75.75 0 0 1 6.75 2h2.5a.75.75 0 0 1 .75.75V4M3.75 4l.7 8.4a1.5 1.5 0 0 0 1.5 1.35h4.1a1.5 1.5 0 0 0 1.5-1.35L12.25 4M6.75 7v4M9.25 7v4"/>
    </svg>
  `
  const deleteBtn = `
    <button type="button" class="entity-editor-delete" data-action="open-delete-confirm" title="${escapeHtml(t('buttons.delete'))}" aria-label="${escapeHtml(t('buttons.delete'))}">
      ${deleteSvg}
    </button>
  `

  return `
    <div class="entity-editor">
      <div class="entity-editor-header">${headerIcon}${escapeHtml(t('editor.entity.title'))}${entNumLabel}${deleteBtn}</div>
      <div class="entity-editor-row">
        <span>${escapeHtml(t('editor.quality'))}</span>
        ${renderQualityPicker(ac.quality)}
      </div>
      ${isChest ? `
        <div class="entity-editor-bar-row">
          <span>${escapeHtml(t('editor.chest.bar'))}</span>
          <span class="entity-editor-bar-status">${barStatus}</span>
        </div>
        ${renderChestBarGrid(ac.name, bar)}
      ` : ''}
      ${isRequester ? `
        <label class="entity-editor-row">
          <input type="checkbox" data-edit-field="trash_not_requested" ${trashUnreq ? 'checked' : ''} />
          <span>${escapeHtml(t('editor.requester.trashNotRequested'))}</span>
        </label>
        <label class="entity-editor-row">
          <input type="checkbox" data-edit-field="request_from_buffers" ${reqBufs ? 'checked' : ''} />
          <span>${escapeHtml(t('editor.requester.requestFromBuffers'))}</span>
        </label>
      ` : ''}
      <div class="entity-editor-scope">
        <label>
          <input type="radio" name="edit-scope" value="one" ${s.editorScope === 'one' ? 'checked' : ''} />
          <span>${escapeHtml(t('editor.scope.one'))}</span>
        </label>
        <label>
          <input type="radio" name="edit-scope" value="all" ${s.editorScope === 'all' ? 'checked' : ''} />
          <span>${escapeHtml(t('editor.scope.all'))} (${totalEntities})</span>
        </label>
      </div>
    </div>
  `
}

// What we encode for the current selection. For book children we strip
// the `index` field — it is a position marker inside the parent and is
// meaningless in a standalone blueprint string.
function selectionForEncode(result, path) {
  const node = getNodeAtPath(result, path)
  if (path.length === 0) return result.json
  // node.json is the wrapper, e.g. { index: 0, blueprint: {...} } — clone and drop `index`.
  const { index: _drop, ...rest } = node.json
  return rest
}

function renderDecoded(s) {
  const r = s.result
  const inputPreview = s.input.length > 80 ? s.input.slice(0, 80) + '…' : s.input
  const rootLabelHtml = renderLabelAndIconsHtml(r.label, innerIconsArr(r.json))
  const summaryParts = [
    `<strong>${escapeHtml(r.kind)}</strong>`,
    r.children.length > 0 ? escapeHtml(t('summary.entriesCount', { count: r.children.length })) : null,
    r.versionString ? escapeHtml(t('summary.version', { ver: r.versionString })) : null,
    rootLabelHtml ? `«${rootLabelHtml}»` : null
  ].filter(Boolean).join(' · ')

  const showTree = r.children.length > 0

  return `
    <div class="input-collapsed">
      <span>${escapeHtml(t('inputCollapsed.label', { count: s.input.length }))}</span>
      <span class="preview">${escapeHtml(inputPreview)}</span>
      <button id="btn-edit">${escapeHtml(t('buttons.edit'))}</button>
    </div>
    <div class="summary">${summaryParts}</div>
    ${showTree ? `
      <div class="tabs">
        <span class="tab ${s.view === 'json' ? 'active' : ''}" data-view="json">${escapeHtml(t('tabs.json'))}</span>
        <span class="tab ${s.view === 'tree' ? 'active' : ''}" data-view="tree">${escapeHtml(t('tabs.children', { count: r.children.length }))}</span>
      </div>
    ` : ''}
    ${s.view === 'json' || !showTree ? `
      ${renderBreadcrumb(s)}
      ${renderComponentsPanel(s)}
      ${renderEntityEditor(s)}
      ${s.draft.length > JSON_RENDER_LIMIT
        ? `<p class="json-too-large">${escapeHtml(t('json.tooLarge', { size: formatSize(s.draft.length) }))}</p>`
        : `<textarea id="json-editor" class="json-editor" spellcheck="false">${escapeHtml(s.draft)}</textarea>`}
      <div class="actions">
        ${s.busy
          ? `<button id="btn-encode" class="primary" disabled><span class="spinner"></span>${escapeHtml(t('buttons.encoding'))}</button>`
          : `<button id="btn-encode" class="primary"${s.draft.length > JSON_RENDER_LIMIT ? ' disabled' : ''}>${escapeHtml(t('buttons.encode'))}</button>`}
        <button id="btn-copy">${escapeHtml(t('buttons.copy'))}</button>
        <button id="btn-download">${escapeHtml(t('buttons.download'))}</button>
      </div>
      ${s.encodeError ? `<p class="error">${escapeHtml(s.encodeError)}</p>` : ''}
      ${s.encodeResult !== null ? `
        <div class="result-panel">
          <div class="result-header">${escapeHtml(t('result.title'))}</div>
          <textarea readonly class="result-text">${escapeHtml(s.encodeResult)}</textarea>
          <div class="actions">
            <button id="btn-copy-result">${escapeHtml(t('buttons.copyResult'))}</button>
            <button id="btn-close-result">${escapeHtml(t('buttons.close'))}</button>
          </div>
        </div>
      ` : ''}
    ` : `
      ${renderTree(r.children, s.selectedPath, s.searchQuery, s.collapsedPaths)}
    `}
    ${renderDeleteConfirm(s)}
  `
}

// Renders the delete-confirmation modal as the last child of the
// decoded view. Returns '' when no confirmation is pending.
function renderDeleteConfirm(s) {
  const cd = s.confirmDelete
  if (!cd) return ''
  const title = escapeHtml(t('editor.delete.title'))
  const body = cd.count > 1
    ? escapeHtml(t('editor.delete.bodyMany', { name: cd.name, count: cd.count }))
    : escapeHtml(t('editor.delete.bodyOne', { name: cd.name, num: cd.entityNumber ?? '?' }))
  return `
    <div class="modal-backdrop" data-action="cancel-delete">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-action="modal-keepalive">
        <div class="modal-title" id="modal-title">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button type="button" data-action="cancel-delete">${escapeHtml(t('buttons.cancel'))}</button>
          <button type="button" class="danger" data-action="confirm-delete">${escapeHtml(t('buttons.delete'))}</button>
        </div>
      </div>
    </div>
  `
}

function labelMatches(label, query) {
  if (!query) return true
  const q = query.toLowerCase()
  const raw = (label || '').toLowerCase()
  const stripped = stripFactorioTags(label || '').toLowerCase()
  return raw.includes(q) || stripped.includes(q)
}

function visibleChildren(children, query, collapsedPaths) {
  // Search overrides collapse: when the user is searching, every match
  // (and its ancestors) is shown regardless of whether a parent book
  // was previously collapsed. The collapsed state is preserved
  // underneath and re-applies once the query is cleared.
  const pathKey = path => path.join(',')
  if (query) {
    const visible = new Set()
    for (const c of children) {
      if (labelMatches(c.label, query)) {
        visible.add(pathKey(c.path))
        for (let i = 1; i < c.path.length; i++) {
          visible.add(pathKey(c.path.slice(0, i)))
        }
      }
    }
    return children.filter(c => visible.has(pathKey(c.path)))
  }
  if (!collapsedPaths || collapsedPaths.size === 0) return children
  // Hide entries whose ancestor (any parent book in the path) is collapsed.
  return children.filter(c => {
    for (let i = 1; i < c.path.length; i++) {
      if (collapsedPaths.has(pathKey(c.path.slice(0, i)))) return false
    }
    return true
  })
}

function renderTree(children, selectedPath, query, collapsedPaths) {
  const filtered = visibleChildren(children, query, collapsedPaths)
  const items = filtered.map(c => {
    const pathKey = c.path.join(',')
    const isBook = c.kind === 'blueprint-book'
    const collapsed = isBook && collapsedPaths && collapsedPaths.has(pathKey)
    const toggle = isBook
      ? `<span class="tree-toggle ${collapsed ? 'collapsed' : 'expanded'}" data-toggle="1" aria-label="toggle">▾</span>`
      : `<span class="tree-toggle empty" aria-hidden="true"></span>`
    return `
    <li>
      <div class="tree-node ${arraysEqual(c.path, selectedPath) ? 'selected' : ''}"
           style="padding-left: ${c.path.length * 14}px"
           data-path="${pathKey}">
        ${toggle}
        ${renderLabelAndIconsHtml(c.label, innerIconsArr(c.json)) || escapeHtml(t('treeNode.untitled'))}
        <span class="badge">${escapeHtml(c.kind)}</span>
      </div>
    </li>
  `
  }).join('')

  const treeBlock = filtered.length === 0
    ? `<p class="empty-tree">${escapeHtml(t('search.noMatches'))}</p>`
    : `<ul class="tree">${items}</ul>`

  return `
    <input
      class="tree-search"
      type="text"
      placeholder="${escapeHtml(t('search.placeholder'))}"
      value="${escapeHtml(query)}"
    >
    ${treeBlock}
  `
}

function wireDecoded() {
  document.getElementById('btn-edit')?.addEventListener('click', () => {
    state.phase = 'empty'
    state.draft = ''
    state.encodeResult = null
    state.encodeError = null
    render()
    document.getElementById('bp-input')?.focus()
  })
  document.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', () => {
      state.view = el.dataset.view
      state.encodeResult = null
      state.encodeError = null
      render()
    })
  })
  document.querySelectorAll('.tree-toggle[data-toggle="1"]').forEach(el => {
    el.addEventListener('click', e => {
      // Stop the click from bubbling to the .tree-node row, which would
      // otherwise navigate to this node. The toggle is for collapse only.
      e.stopPropagation()
      const row = el.closest('.tree-node')
      const key = row?.dataset.path
      if (key == null) return
      if (state.collapsedPaths.has(key)) state.collapsedPaths.delete(key)
      else state.collapsedPaths.add(key)
      render()
    })
  })
  document.querySelectorAll('.tree-node').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path.split(',').map(Number)
      state.selectedPath = path
      state.view = 'json'
      state.draft = draftForSelection(state.result, path)
      state.encodeResult = null
      state.encodeError = null
      state.activeComponent = null
      state.componentMatchIdx = 0
      render()
    })
  })
  document.querySelectorAll('.breadcrumb .bc-segment').forEach(el => {
    el.addEventListener('click', () => {
      const raw = el.dataset.path
      const path = raw === '' ? [] : raw.split(',').map(Number)
      if (arraysEqual(state.selectedPath, path)) return
      state.selectedPath = path
      state.view = 'json'
      state.draft = draftForSelection(state.result, path)
      state.encodeResult = null
      state.encodeError = null
      state.activeComponent = null
      state.componentMatchIdx = 0
      render()
    })
  })
  document.querySelector('.tree-search')?.addEventListener('input', e => {
    const cursor = e.target.selectionStart
    state.searchQuery = e.target.value
    render()
    const fresh = document.querySelector('.tree-search')
    if (fresh) {
      fresh.focus()
      fresh.setSelectionRange(cursor, cursor)
    }
  })
  document.getElementById('btn-copy')?.addEventListener('click', onCopy)
  document.getElementById('btn-download')?.addEventListener('click', onDownload)
  // The textarea is the user's editable copy of the current node's JSON.
  // We keep `state.draft` in sync on every keystroke without re-rendering
  // (would clobber focus and selection); the rest of the UI re-reads it
  // on the next render — typically when the user clicks something else.
  document.getElementById('json-editor')?.addEventListener('input', e => {
    state.draft = e.target.value
  })
  document.getElementById('btn-encode')?.addEventListener('click', onEncode)
  document.getElementById('btn-copy-result')?.addEventListener('click', onCopyResult)
  document.getElementById('btn-close-result')?.addEventListener('click', () => {
    state.encodeResult = null
    state.encodeError = null
    render()
  })
  document.querySelectorAll('.comp-tile').forEach(el => {
    el.addEventListener('click', () => {
      const kind = el.dataset.compKind
      const name = el.dataset.compName
      const quality = el.dataset.compQuality
      let matchNames = null
      const rawMatchNames = el.dataset.compMatchNames
      if (rawMatchNames) {
        try {
          const parsed = JSON.parse(rawMatchNames)
          if (Array.isArray(parsed)) matchNames = parsed
        } catch { /* fall back to single-name search */ }
      }
      const ac = state.activeComponent
      if (ac && ac.kind === kind && ac.name === name && ac.quality === quality) {
        // Same tile clicked → cycle to next match.
        state.componentMatchIdx = state.componentMatchIdx + 1
      } else {
        state.activeComponent = { kind, name, quality, matchNames }
        state.componentMatchIdx = 0
      }
      render()
      requestAnimationFrame(focusActiveMatchInTextarea)
    })
  })
  // Structured edits change `state.draft`'s length (added/removed
  // fields shift every byte after the edit), so we can't preserve the
  // previous selection range — we re-find the same logical match in
  // the new text and re-focus to it.
  document.querySelectorAll('.entity-editor input[type="checkbox"][data-edit-field]').forEach(el => {
    el.addEventListener('change', e => {
      if (!state.activeComponent) return
      const field = e.target.dataset.editField
      const value = !!e.target.checked
      applyStructuredEdit(targets => {
        for (const ent of targets) writeRequesterFlag(ent, field, value)
      })
      render()
      requestAnimationFrame(focusActiveMatchInTextarea)
    })
  })
  // Quality picker: switch the entity's quality tier. Edit applies via
  // the same scope (one / all) as other structured edits, then we
  // realign activeComponent.quality to the new tier so the focused
  // textarea match follows the user's edit.
  document.querySelectorAll('.quality-pick-tile[data-quality-pick]').forEach(el => {
    el.addEventListener('click', e => {
      const ac = state.activeComponent
      if (!ac) return
      const newQ = e.currentTarget.dataset.qualityPick
      if (!newQ || newQ === ac.quality) return
      applyStructuredEdit(targets => {
        for (const ent of targets) writeEntityQuality(ent, newQ)
      })
      // Re-anchor the active component on the new quality, so the
      // highlighted match in the textarea is the entity we just edited
      // (or one of the just-edited batch in 'all' scope).
      state.activeComponent = { ...ac, quality: newQ }
      state.componentMatchIdx = 0
      render()
      requestAnimationFrame(focusActiveMatchInTextarea)
    })
  })
  // Chest bar grid: clicking any slot moves the bar there. Clicking the
  // current bar marker (the slot at `bar` index) clears the limit.
  document.querySelectorAll('.cb-slot[data-cb-slot]').forEach(el => {
    el.addEventListener('click', e => {
      if (!state.activeComponent) return
      const slot = parseInt(e.currentTarget.dataset.cbSlot, 10)
      if (!Number.isFinite(slot)) return
      const matches = entitiesMatchingActive(state)
      if (matches.length === 0) return
      const idx = ((state.componentMatchIdx % matches.length) + matches.length) % matches.length
      const currentBar = readChestBar(matches[idx])
      const newValue = currentBar === slot ? null : slot
      applyStructuredEdit(targets => {
        for (const ent of targets) writeChestBar(ent, newValue)
      })
      render()
      requestAnimationFrame(focusActiveMatchInTextarea)
    })
  })
  // Scope radio: 'all' vs 'one'. Pure UI state, no JSON change.
  document.querySelectorAll('.entity-editor input[name="edit-scope"]').forEach(el => {
    el.addEventListener('change', e => {
      state.editorScope = e.target.value
      render({ preserveScroll: true })
    })
  })
  // Trash button — opens the confirmation modal. Captures the names /
  // count to display now, since after the modal renders the user might
  // change the scope and we want the message to match what they clicked.
  document.querySelector('.entity-editor-delete[data-action="open-delete-confirm"]')?.addEventListener('click', () => {
    const ac = state.activeComponent
    if (!ac) return
    const matches = entitiesMatchingActive(state)
    if (matches.length === 0) return
    const idx = ((state.componentMatchIdx % matches.length) + matches.length) % matches.length
    const current = matches[idx]
    const targets = state.editorScope === 'one' ? [current] : matches
    state.confirmDelete = {
      name: ac.name,
      count: targets.length,
      entityNumber: (current && typeof current.entity_number === 'number') ? current.entity_number : null
    }
    render()
  })
  // Modal backdrop click and Cancel button both dismiss without changes.
  // Clicks inside the modal box itself are caught by the data-action
  // attribute check so they don't bubble up as a "cancel" event.
  document.querySelectorAll('[data-action="cancel-delete"]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target !== e.currentTarget) return
      state.confirmDelete = null
      render()
    })
  })
  document.querySelector('[data-action="confirm-delete"]')?.addEventListener('click', () => {
    if (!state.confirmDelete) return
    const ac = state.activeComponent
    if (!ac) {
      state.confirmDelete = null
      render()
      return
    }
    const matches = entitiesMatchingActive(state)
    const idx = matches.length > 0
      ? ((state.componentMatchIdx % matches.length) + matches.length) % matches.length
      : 0
    const current = matches[idx]
    const targets = state.editorScope === 'one' && current ? [current] : matches
    const numbers = new Set(
      targets.map(e => e?.entity_number).filter(n => typeof n === 'number')
    )
    deleteEntitiesFromDraft(numbers)
    state.confirmDelete = null
    // Re-evaluate which matches survive so the editor / focus follow the
    // user's last action: in 'one' scope the next sibling becomes the new
    // active match; if the type is wiped out entirely (or 'all' scope was
    // used), drop the active component so the editor closes.
    const remaining = entitiesMatchingActive(state)
    if (remaining.length === 0) {
      state.activeComponent = null
      state.componentMatchIdx = 0
    } else {
      state.componentMatchIdx = Math.min(state.componentMatchIdx, remaining.length - 1)
    }
    render()
    requestAnimationFrame(focusActiveMatchInTextarea)
  })
  wireIconFallback()
}

// Copy / Download grab whatever the user has in the textarea right now —
// `state.draft`. It mirrors the on-screen content (including any in-progress
// edits and any structured-edit changes), so what they save is what they see.
async function onCopy() {
  try {
    await navigator.clipboard.writeText(state.draft)
    const btn = document.getElementById('btn-copy')
    const old = btn.textContent
    btn.textContent = t('buttons.copied')
    setTimeout(() => { btn.textContent = old }, 1200)
  } catch {
    alert(t('clipboard.failure'))
  }
}

function onDownload() {
  const node = getNodeAtPath(state.result, state.selectedPath)
  const baseName = node.label || node.kind || state.result.label || state.result.kind || 'blueprint'
  const safeName = String(baseName).replace(/[^a-zA-Zа-яА-ЯёЁ0-9._-]+/g, '_').slice(0, 64) || 'blueprint'
  const blob = new Blob([state.draft], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function onEncode() {
  if (state.busy) return
  state.encodeResult = null
  state.encodeError = null

  // Parse the textarea cheaply on the click — if the JSON is broken,
  // there's no need to flip the busy state at all.
  let parsed
  try {
    parsed = JSON.parse(state.draft)
  } catch {
    state.encodeError = t('errors.BAD_JSON_INPUT')
    render()
    return
  }

  state.busy = true
  render()
  await nextPaint()
  try {
    validate(parsed)
    state.encodeResult = encode(parsed, { deflate: window.pako.deflate })
  } catch (e) {
    if (e instanceof ValidationError) {
      state.encodeError = t('errors.' + e.code, e.params)
    } else if (e instanceof EncodeError) {
      state.encodeError = t('errors.' + e.code)
    } else {
      state.encodeError = `${t('errors.UNKNOWN')}: ${e.message}`
    }
  } finally {
    state.busy = false
  }
  render()
}

async function onCopyResult() {
  const text = state.encodeResult ?? ''
  try {
    await navigator.clipboard.writeText(text)
    const btn = document.getElementById('btn-copy-result')
    if (!btn) return
    const old = btn.textContent
    btn.textContent = t('buttons.copied')
    setTimeout(() => { btn.textContent = old }, 1200)
  } catch {
    alert(t('clipboard.failure'))
  }
}

// One-shot fallback: if a Factorio icon fails to load (rare — manifest is
// pinned, jsDelivr is reliable), replace the broken <img> with its alt text.
function wireIconFallback() {
  document.querySelectorAll('img.bp-icon').forEach(img => {
    img.addEventListener('error', () => {
      const txt = document.createTextNode(img.getAttribute('alt') || '')
      img.replaceWith(txt)
    })
  })
}

// Wire the locale switch (the static markup is added in index.html — see Task 4).
function wireLocaleSwitch() {
  document.querySelectorAll('.locale-switch [data-locale]').forEach(el => {
    el.addEventListener('click', () => {
      const next = el.dataset.locale
      if (next === getLocale()) return
      setLocale(next)
      hydrateStaticText()
      updateLocaleSwitch()
      render()
    })
  })
}

// Populates the static header/footer text from the current locale.
function hydrateStaticText() {
  const setText = (sel, value) => {
    const el = document.querySelector(sel)
    if (el) el.textContent = value
  }
  setText('.site-header h1', t('header.title'))
  setText('.site-header .subtitle', t('header.subtitle'))
  setText('.site-footer .footer-note', t('footer.note'))
  document.title = t('header.title')
}

function updateLocaleSwitch() {
  const cur = getLocale()
  document.querySelectorAll('.locale-switch [data-locale]').forEach(el => {
    el.classList.toggle('active', el.dataset.locale === cur)
  })
}

hydrateStaticText()
updateLocaleSwitch()
wireLocaleSwitch()
// Esc dismisses the delete-confirm modal first, then clears the active
// component highlight. A single global listener wired once at startup.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  if (state.confirmDelete) {
    state.confirmDelete = null
    render()
    return
  }
  if (state.activeComponent) {
    state.activeComponent = null
    state.componentMatchIdx = 0
    render()
  }
})
render()
