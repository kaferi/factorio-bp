import { decode, DecodeError } from './decode.js'

const root = document.getElementById('app')

const state = {
  phase: 'empty',     // 'empty' | 'decoded' | 'error'
  input: '',
  result: null,       // DecodeResult
  error: null,        // string
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
    <textarea id="bp-input" placeholder="Вставь сюда строку чертежа Factorio (начинается с «0»)…">${escapeHtml(state.input)}</textarea>
    <div class="btn-row">
      <button id="btn-decode" class="primary">Decode</button>
      <button id="btn-paste">Paste</button>
      <button id="btn-clear">Clear</button>
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
    state.error = (e instanceof DecodeError) ? e.message : `Неизвестная ошибка: ${e.message}`
  }
  render()
}

async function onPaste() {
  try {
    const text = await navigator.clipboard.readText()
    state.input = text
    render()
  } catch {
    // Clipboard not available — silently ignore; user can paste manually.
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
    // cursor is currently { blueprint_book: {...} } at start, then { blueprint: {...} } / { blueprint_book: {...} } at children
    const inner = cursor.blueprint_book ?? cursor.blueprint
    cursor = inner.blueprints[idx]
  }
  // cursor is the wrapper object e.g. { blueprint: {...} } — return it as-is for JSON view.
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
    `<strong>${r.kind}</strong>`,
    r.children.length > 0 ? `${r.children.length} чертежей` : null,
    r.versionString ? `версия ${r.versionString}` : null,
    r.label ? `«${escapeHtml(r.label)}»` : null
  ].filter(Boolean).join(' · ')

  const showTree = r.children.length > 0
  const node = getNodeAtPath(r, s.selectedPath)
  const jsonText = JSON.stringify(node.json, null, 2)

  return `
    <div class="input-collapsed">
      <span>Blueprint string · ${s.input.length} символов</span>
      <span class="preview">${escapeHtml(inputPreview)}</span>
      <button id="btn-edit">Изменить</button>
    </div>
    <div class="summary">${summaryParts}</div>
    ${showTree ? `
      <div class="tabs">
        <span class="tab ${s.view === 'json' ? 'active' : ''}" data-view="json">JSON</span>
        <span class="tab ${s.view === 'tree' ? 'active' : ''}" data-view="tree">Children (${r.children.length})</span>
      </div>
    ` : ''}
    ${s.view === 'json' || !showTree ? `
      <pre class="json">${escapeHtml(jsonText)}</pre>
      <div class="actions">
        <button id="btn-copy">Copy JSON</button>
        <button id="btn-download">Download .json</button>
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
  // If books with deep nesting become common, add per-book toggles here.
  const items = children.map(c => `
    <li>
      <div class="tree-node ${arraysEqual(c.path, selectedPath) ? 'selected' : ''}"
           style="padding-left: ${c.path.length * 14}px"
           data-path="${c.path.join(',')}">
        ${escapeHtml(c.label || '(без названия)')}
        <span class="badge">${c.kind}</span>
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
    btn.textContent = 'Скопировано'
    setTimeout(() => { btn.textContent = old }, 1200)
  } catch {
    alert('Не удалось скопировать в буфер обмена.')
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

render()
