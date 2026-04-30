import { decode, DecodeError } from './decode.js'
import { encode, EncodeError } from './encode.js'
import { validate, ValidationError } from './validate.js'
import { t, setLocale, getLocale, detectLocale } from './i18n.js'
import { stripFactorioTags } from './labels.js'

setLocale(detectLocale())

const root = document.getElementById('app')

const state = {
  phase: 'empty',     // 'empty' | 'decoded' | 'error'
  input: '',
  result: null,       // DecodeResult
  error: null,        // already-localised string
  view: 'json',       // 'json' | 'tree'
  selectedPath: [],   // [] = root
  editing: false,
  draft: '',
  encodeResult: null,
  encodeError: null,
  searchQuery: ''
}

function render() {
  if (state.phase === 'decoded') {
    root.innerHTML = renderDecoded(state)
    wireDecoded()
    return
  }
  // empty or error — show input form
  root.innerHTML = `
    <textarea id="bp-input" placeholder="${escapeHtml(t('input.placeholder'))}">${escapeHtml(state.input)}</textarea>
    <div class="btn-row">
      <button id="btn-decode" class="primary">${escapeHtml(t('buttons.decode'))}</button>
      <button id="btn-paste">${escapeHtml(t('buttons.paste'))}</button>
      <button id="btn-clear">${escapeHtml(t('buttons.clear'))}</button>
    </div>
    ${state.phase === 'error' ? `<p class="error">${escapeHtml(state.error || '')}</p>` : ''}
  `
  document.getElementById('btn-decode').addEventListener('click', onDecode)
  document.getElementById('btn-paste').addEventListener('click', onPaste)
  document.getElementById('btn-clear').addEventListener('click', onClear)
  document.getElementById('bp-input').addEventListener('input', e => {
    state.input = e.target.value
  })
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

function onDecode() {
  try {
    const result = decode(state.input, { inflate: window.pako.inflate })
    state.phase = 'decoded'
    state.result = result
    state.error = null
    state.view = 'json'
    state.selectedPath = []
    state.searchQuery = ''
  } catch (e) {
    state.phase = 'error'
    state.error = localiseError(e)
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

function onClear() {
  state.phase = 'empty'
  state.input = ''
  state.result = null
  state.error = null
  state.editing = false
  state.draft = ''
  state.encodeResult = null
  state.encodeError = null
  state.searchQuery = ''
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
  const summaryParts = [
    `<strong>${escapeHtml(r.kind)}</strong>`,
    r.children.length > 0 ? escapeHtml(t('summary.entriesCount', { count: r.children.length })) : null,
    r.versionString ? escapeHtml(t('summary.version', { ver: r.versionString })) : null,
    (r.label && stripFactorioTags(r.label)) ? `«${escapeHtml(stripFactorioTags(r.label))}»` : null
  ].filter(Boolean).join(' · ')

  const showTree = r.children.length > 0
  const node = getNodeAtPath(r, s.selectedPath)
  const jsonText = JSON.stringify(node.json, null, 2)

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
      ${s.editing ? `
        <textarea id="json-editor" class="json-editor" spellcheck="false">${escapeHtml(s.draft)}</textarea>
        <div class="actions">
          <button id="btn-encode" class="primary">${escapeHtml(t('buttons.encode'))}</button>
          <button id="btn-cancel">${escapeHtml(t('buttons.cancel'))}</button>
        </div>
      ` : `
        <pre class="json">${escapeHtml(jsonText)}</pre>
        <div class="actions">
          <button id="btn-edit-json">${escapeHtml(t('buttons.edit'))}</button>
          <button id="btn-copy">${escapeHtml(t('buttons.copy'))}</button>
          <button id="btn-download">${escapeHtml(t('buttons.download'))}</button>
        </div>
      `}
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
      ${renderTree(r.children, s.selectedPath, s.searchQuery)}
    `}
  `
}

function labelMatches(label, query) {
  if (!query) return true
  const q = query.toLowerCase()
  const raw = (label || '').toLowerCase()
  const stripped = stripFactorioTags(label || '').toLowerCase()
  return raw.includes(q) || stripped.includes(q)
}

function visibleChildren(children, query) {
  if (!query) return children
  const visible = new Set()
  const pathKey = path => path.join(',')
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

function renderTree(children, selectedPath, query) {
  // v1 simplification vs spec: render the flat list with depth-based
  // indentation instead of expand/collapse toggles. For typical books
  // (5-30 single-level entries) this reads cleanly; nesting is rare.
  // Add per-book toggles here if deeply-nested books become common.
  const filtered = visibleChildren(children, query)
  const items = filtered.map(c => `
    <li>
      <div class="tree-node ${arraysEqual(c.path, selectedPath) ? 'selected' : ''}"
           style="padding-left: ${c.path.length * 14}px"
           data-path="${c.path.join(',')}">
        ${escapeHtml(stripFactorioTags(c.label) || t('treeNode.untitled'))}
        <span class="badge">${escapeHtml(c.kind)}</span>
      </div>
    </li>
  `).join('')

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
    state.editing = false
    state.draft = ''
    state.encodeResult = null
    state.encodeError = null
    render()
    document.getElementById('bp-input')?.focus()
  })
  document.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', () => {
      state.view = el.dataset.view
      state.editing = false
      state.draft = ''
      state.encodeResult = null
      state.encodeError = null
      render()
    })
  })
  document.querySelectorAll('.tree-node').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path.split(',').map(Number)
      state.selectedPath = path
      state.view = 'json'
      state.editing = false
      state.draft = ''
      state.encodeResult = null
      state.encodeError = null
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
  // View → Edit
  document.getElementById('btn-edit-json')?.addEventListener('click', () => {
    state.editing = true
    state.encodeResult = null
    state.encodeError = null
    const node = selectionForEncode(state.result, state.selectedPath)
    state.draft = JSON.stringify(node, null, 2)
    render()
    document.getElementById('json-editor')?.focus()
  })
  // Edit → keep state.draft in sync as the user types
  document.getElementById('json-editor')?.addEventListener('input', e => {
    state.draft = e.target.value
  })
  document.getElementById('btn-encode')?.addEventListener('click', onEncode)
  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    state.editing = false
    state.draft = ''
    state.encodeResult = null
    state.encodeError = null
    render()
  })
  document.getElementById('btn-copy-result')?.addEventListener('click', onCopyResult)
  document.getElementById('btn-close-result')?.addEventListener('click', () => {
    state.encodeResult = null
    state.encodeError = null
    render()
  })
}

async function onCopy() {
  const node = getNodeAtPath(state.result, state.selectedPath)
  const text = JSON.stringify(node.json, null, 2)
  try {
    await navigator.clipboard.writeText(text)
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
  const text = JSON.stringify(node.json, null, 2)
  const baseName = node.label || node.kind || state.result.label || state.result.kind || 'blueprint'
  const safeName = String(baseName).replace(/[^a-zA-Zа-яА-ЯёЁ0-9._-]+/g, '_').slice(0, 64) || 'blueprint'
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function onEncode() {
  state.encodeResult = null
  state.encodeError = null

  let parsed
  try {
    parsed = JSON.parse(state.draft)
  } catch {
    state.encodeError = t('errors.BAD_JSON_INPUT')
    render()
    return
  }

  try {
    validate(parsed)
  } catch (e) {
    if (e instanceof ValidationError) {
      state.encodeError = t('errors.' + e.code, e.params)
    } else {
      state.encodeError = `${t('errors.UNKNOWN')}: ${e.message}`
    }
    render()
    return
  }

  try {
    state.encodeResult = encode(parsed, { deflate: window.pako.deflate })
  } catch (e) {
    if (e instanceof EncodeError) {
      state.encodeError = t('errors.' + e.code)
    } else {
      state.encodeError = `${t('errors.UNKNOWN')}: ${e.message}`
    }
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
render()
