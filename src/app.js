import { decode, DecodeError } from './decode.js'
import { t, setLocale, getLocale, detectLocale } from './i18n.js'

setLocale(detectLocale())

const root = document.getElementById('app')

const state = {
  phase: 'empty',     // 'empty' | 'decoded' | 'error'
  input: '',
  result: null,       // DecodeResult
  error: null,        // already-localised string
  view: 'json',       // 'json' | 'tree'
  selectedPath: []    // [] = root
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

function renderDecoded(s) {
  const r = s.result
  const inputPreview = s.input.length > 80 ? s.input.slice(0, 80) + '…' : s.input
  const summaryParts = [
    `<strong>${escapeHtml(r.kind)}</strong>`,
    r.children.length > 0 ? escapeHtml(t('summary.entriesCount', { count: r.children.length })) : null,
    r.versionString ? escapeHtml(t('summary.version', { ver: r.versionString })) : null,
    r.label ? `«${escapeHtml(r.label)}»` : null
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
      <pre class="json">${escapeHtml(jsonText)}</pre>
      <div class="actions">
        <button id="btn-copy">${escapeHtml(t('buttons.copy'))}</button>
        <button id="btn-download">${escapeHtml(t('buttons.download'))}</button>
      </div>
    ` : `
      ${renderTree(r.children, s.selectedPath)}
    `}
  `
}

function renderTree(children, selectedPath) {
  // v1 simplification vs spec: render the flat list with depth-based
  // indentation instead of expand/collapse toggles. For typical books
  // (5-30 single-level entries) this reads cleanly; nesting is rare.
  // Add per-book toggles here if deeply-nested books become common.
  const items = children.map(c => `
    <li>
      <div class="tree-node ${arraysEqual(c.path, selectedPath) ? 'selected' : ''}"
           style="padding-left: ${c.path.length * 14}px"
           data-path="${c.path.join(',')}">
        ${escapeHtml(c.label || t('treeNode.untitled'))}
        <span class="badge">${escapeHtml(c.kind)}</span>
      </div>
    </li>
  `).join('')
  return `<ul class="tree">${items}</ul>`
}

function wireDecoded() {
  document.getElementById('btn-edit')?.addEventListener('click', () => {
    state.phase = 'empty'
    render()
    document.getElementById('bp-input')?.focus()
  })
  document.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', () => {
      state.view = el.dataset.view
      render()
    })
  })
  document.querySelectorAll('.tree-node').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path.split(',').map(Number)
      state.selectedPath = path
      state.view = 'json'
      render()
    })
  })
  document.getElementById('btn-copy')?.addEventListener('click', onCopy)
  document.getElementById('btn-download')?.addEventListener('click', onDownload)
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
