// One-stop i18n module: flat dotted keys, two locales, no dependencies.
// `t(key, params)` interpolates `{name}` placeholders in the message
// using `params[name]`. If a key is missing in the active locale we
// fall back to English; if missing there too, return the key itself —
// loud and obvious.

const messages = {
  en: {
    'header.title': 'Factorio Blueprint Decoder',
    'header.subtitle': 'Paste a blueprint string — get the JSON.',
    'footer.note': 'Runs locally in your browser. The string is never sent anywhere.',

    'input.placeholder': 'Paste a Factorio blueprint string here (starts with «0»)…',

    'buttons.decode': 'Decode',
    'buttons.decoding': 'Decoding…',
    'buttons.encoding': 'Encoding…',
    'buttons.paste': 'Paste',
    'buttons.clear': 'Clear',
    'buttons.edit': 'Edit',
    'buttons.copy': 'Copy JSON',
    'buttons.copied': 'Copied',
    'buttons.download': 'Download .json',

    'tabs.json': 'JSON',
    'tabs.children': 'Children ({count})',

    'summary.entriesCount': '{count} blueprints',
    'summary.version': 'version {ver}',

    'inputCollapsed.label': 'Blueprint string · {count} chars',

    'treeNode.untitled': '(unnamed)',

    'errors.WRONG_INPUT_TYPE': 'Expected a string',
    'errors.EMPTY_INPUT': 'Empty string',
    'errors.BAD_PREFIX': 'String must start with «0»',
    'errors.INTERNAL_NO_INFLATE': 'Internal error: inflate function missing',
    'errors.BAD_BASE64': 'Invalid base64',
    'errors.BAD_ZLIB': 'Invalid zlib data',
    'errors.BAD_JSON': 'Corrupted JSON payload',
    'errors.UNKNOWN': 'Unexpected error',

    'clipboard.failure': 'Failed to copy to clipboard.',

    'buttons.encode': 'Encode',
    'buttons.cancel': 'Cancel',
    'buttons.close': 'Close',
    'buttons.copyResult': 'Copy result',

    'editor.title': 'Edit JSON',
    'result.title': 'Blueprint string',

    'errors.BAD_JSON_INPUT': 'Invalid JSON in editor',
    'errors.INTERNAL_NO_DEFLATE': 'Internal error: deflate function missing',
    'errors.NOT_AN_OBJECT': 'Encoder expected an object at the root',
    'errors.BAD_PAYLOAD': 'JSON cannot be serialised (circular references?)',

    'errors.MISSING_ROOT_KEY': 'JSON is not a Factorio blueprint at {path} (expected blueprint, blueprint_book, deconstruction_planner, or upgrade_planner)',
    'errors.INNER_NOT_OBJECT': 'Field {path} must be an object',
    'errors.WRONG_ITEM_VALUE': 'Field {path}.item must be "{expected}", got "{actual}"',
    'errors.BLUEPRINTS_NOT_ARRAY': 'Field {path} must be an array',
    'errors.ENTITIES_NOT_ARRAY': 'Field {path} must be an array',
    'errors.ENTITY_MALFORMED': 'Entity at {path} is malformed (missing name or position)',

    'search.placeholder': 'Search blueprints…',
    'search.noMatches': 'No matches',

    'components.title': 'Components',
    'components.match': '{current} of {total}',

    'json.tooLarge': 'JSON is too large to render ({size}). Use Copy / Download to inspect it, or pick a child below.'
  },
  ru: {
    'header.title': 'Декодер чертежей Factorio',
    'header.subtitle': 'Вставь строку чертежа — получишь JSON.',
    'footer.note': 'Работает локально в браузере. Строка никуда не отправляется.',

    'input.placeholder': 'Вставь сюда строку чертежа Factorio (начинается с «0»)…',

    'buttons.decode': 'Декодировать',
    'buttons.decoding': 'Декодирую…',
    'buttons.encoding': 'Кодирую…',
    'buttons.paste': 'Вставить',
    'buttons.clear': 'Очистить',
    'buttons.edit': 'Изменить',
    'buttons.copy': 'Копировать JSON',
    'buttons.copied': 'Скопировано',
    'buttons.download': 'Скачать .json',

    'tabs.json': 'JSON',
    'tabs.children': 'Содержимое ({count})',

    'summary.entriesCount': '{count} чертежей',
    'summary.version': 'версия {ver}',

    'inputCollapsed.label': 'Строка чертежа · {count} симв.',

    'treeNode.untitled': '(без названия)',

    'errors.WRONG_INPUT_TYPE': 'Ожидается строка',
    'errors.EMPTY_INPUT': 'Пустая строка',
    'errors.BAD_PREFIX': 'Строка должна начинаться с «0»',
    'errors.INTERNAL_NO_INFLATE': 'Внутренняя ошибка: не передан inflate',
    'errors.BAD_BASE64': 'Неверный base64',
    'errors.BAD_ZLIB': 'Неверные zlib-данные',
    'errors.BAD_JSON': 'Повреждённый JSON',
    'errors.UNKNOWN': 'Неизвестная ошибка',

    'clipboard.failure': 'Не удалось скопировать в буфер обмена.',

    'buttons.encode': 'Кодировать',
    'buttons.cancel': 'Отмена',
    'buttons.close': 'Закрыть',
    'buttons.copyResult': 'Копировать строку',

    'editor.title': 'Редактирование JSON',
    'result.title': 'Строка чертежа',

    'errors.BAD_JSON_INPUT': 'Невалидный JSON в редакторе',
    'errors.INTERNAL_NO_DEFLATE': 'Внутренняя ошибка: не передан deflate',
    'errors.NOT_AN_OBJECT': 'Кодер ожидает объект в корне',
    'errors.BAD_PAYLOAD': 'JSON невозможно сериализовать (циклические ссылки?)',

    'errors.MISSING_ROOT_KEY': 'JSON не похож на чертёж Factorio в {path} (ожидается blueprint, blueprint_book, deconstruction_planner или upgrade_planner)',
    'errors.INNER_NOT_OBJECT': 'Поле {path} должно быть объектом',
    'errors.WRONG_ITEM_VALUE': 'Поле {path}.item должно быть «{expected}», а не «{actual}»',
    'errors.BLUEPRINTS_NOT_ARRAY': 'Поле {path} должно быть массивом',
    'errors.ENTITIES_NOT_ARRAY': 'Поле {path} должно быть массивом',
    'errors.ENTITY_MALFORMED': 'Сущность {path} некорректна (нет name или position)',

    'search.placeholder': 'Поиск чертежей…',
    'search.noMatches': 'Ничего не найдено',

    'components.title': 'Компоненты',
    'components.match': '{current} из {total}',

    'json.tooLarge': 'JSON слишком большой для отображения ({size}). Используй Копировать / Скачать, или выбери вложенный чертёж ниже.'
  }
}

let current = 'en'

export function getLocale() {
  return current
}

export function setLocale(loc) {
  if (loc !== 'en' && loc !== 'ru') return
  current = loc
  try { localStorage.setItem('locale', loc) } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.lang = loc
  }
}

export function detectLocale() {
  try {
    const stored = localStorage.getItem('locale')
    if (stored === 'en' || stored === 'ru') return stored
  } catch {}
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return nav.slice(0, 2).toLowerCase() === 'ru' ? 'ru' : 'en'
}

export function t(key, params) {
  const dict = messages[current] ?? messages.en
  const tmpl = dict[key] ?? messages.en[key] ?? key
  if (!params) return tmpl
  return tmpl.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}
