# Factorio Blueprint Decoder — Design

Дата: 2026-04-28
Статус: согласовано на этапе brainstorming

## Цель

Первый шаг будущего онлайн-инструмента для работы с чертежами Factorio:
**статическая страница, которая декодирует blueprint-строку Factorio и показывает
получившийся JSON.** Поддерживает любые типы строк, экспортируемые игрой:
`blueprint`, `blueprint-book`, `deconstruction-planner`, `upgrade-planner`. Для
книг (в том числе вложенных) дополнительно показывает их структуру в виде дерева.

Это самостоятельная итерация v1. Будущие фичи (рендер на canvas, обратное
кодирование, каталог, аналитика) надстраиваются сверху и в этот спек не входят.

## Сценарий пользователя

1. Открывает страницу.
2. Вставляет blueprint-строку в textarea.
3. Жмёт «Decode».
4. Видит сводку (тип, число вложенных чертежей, версия, ярлык), JSON и — для
   книг — переключатель на дерево вложенных чертежей.
5. По желанию копирует JSON в буфер или скачивает `.json`-файл.

## Архитектурные решения

- **Полностью клиентский, статический сайт под GitHub Pages.** Никакого
  бэкенда. Строка пользователя нигде не уходит — приватность по умолчанию.
- **Без фреймворков.** Vanilla JS + одна внешняя библиотека (pako).
- **Vendoring, не CDN.** `pako` лежит в репозитории — стабильность и работа
  офлайн.
- **Изоляция декодера от UI.** `decode.js` — чистая функция, ничего не знает
  про DOM, тестируется в Node. `app.js` связывает декодер с DOM.

## Структура файлов

```
/
├── index.html                ← разметка декодера
├── styles.css                ← стили
├── src/
│   ├── decode.js             ← чистая функция: string → DecodeResult
│   ├── decode.test.js        ← юнит-тесты для decode
│   ├── app.js                ← UI-логика: события, рендер, дерево, copy/download
│   └── __fixtures__/         ← фикстуры с реальными blueprint-строками
├── vendor/
│   └── pako.min.js           ← pako_inflate (~26 KB), только распаковка
├── package.json              ← devDependencies: vitest
├── docs/superpowers/specs/   ← этот спек и будущие
└── README.md
```

`.gitignore` дополнить: `node_modules/`, `.superpowers/`.

## Контракт `decode.js`

Единственная экспортируемая функция:

```js
decode(input: string) → DecodeResult
```

Тип результата:

```js
DecodeResult {
  kind: 'blueprint' | 'blueprint-book'
      | 'deconstruction-planner' | 'upgrade-planner' | 'unknown',
  label: string | null,           // имя из чертежа, если есть
  version: number | null,         // raw version из JSON
  versionString: string | null,   // распарсенная версия "major.minor.patch.dev"
  json: object,                   // полный декодированный JSON, как из игры
  children: ChildNode[]           // плоский массив для книг; [] для одиночных
}

ChildNode {
  path: number[],                 // путь в дереве, напр. [0, 2]
  kind: 'blueprint' | 'blueprint-book'
      | 'deconstruction-planner' | 'upgrade-planner',
  label: string | null,
  json: object                    // ссылка на узел внутри родительского json
}
```

### Алгоритм

1. `input.trim()`. Если пусто — `DecodeError('Пустая строка')`.
2. Префикс `'0'`. Если другой — `DecodeError('Строка должна начинаться с «0»')`.
3. base64-decode остатка. Падает — `DecodeError('Неверный base64')`.
4. `pako.inflate` → строка JSON. Падает — `DecodeError('Неверные zlib-данные')`.
5. `JSON.parse`. Падает — `DecodeError('Повреждённый JSON')`.
6. Корневой ключ → `kind` (`blueprint` / `blueprint_book` /
   `deconstruction_planner` / `upgrade_planner`; иначе `unknown`).
7. Извлекаем `label`, `version`, парсим `versionString`. Factorio хранит версию
   как 64-битное число; раскладываем его на четыре 16-битных компонента в
   порядке `major.minor.patch.dev` и склеиваем точкой (всегда 4 числа, даже
   если `dev = 0`).
8. Если книга — рекурсивно обходим `blueprint_book.blueprints[]`, собирая
   `children` плоским списком; для каждого узла записываем `path` (индексы по
   уровням), `kind`, `label`, ссылку на исходный объект.

`DecodeError extends Error` — обычная ошибка с понятным русским сообщением.
Никакой диагностики на каком шаге упало (YAGNI на v1).

## UI-поток (`app.js`)

### Состояние

```js
state = {
  phase: 'empty' | 'decoded' | 'error',
  input: '',
  result: null,         // DecodeResult или null
  error: null,          // строка или null
  view: 'json' | 'tree',
  selectedPath: []      // выбранный узел в дереве; [] = корень
}
```

### Раскладка (одна страница, два состояния)

**До декодирования (`empty` / `error`):**

- textarea во всю ширину;
- кнопки `Decode`, `Paste from clipboard`, `Clear`;
- если `phase === 'error'` — под textarea красный текст с сообщением.

**После декодирования (`decoded`):**

- ввод схлопывается в одну строку: «Blueprint string · 1 248 символов · [Изменить]»;
- сводка: «`kind` · N чертежей · версия `versionString` · «`label`»»;
- табы `JSON` / `Children (N)` (`Children` скрыт, если `children.length === 0`);
- активная вкладка: `<pre>` c JSON выбранного узла (`JSON.stringify(node, null, 2)`,
  без подсветки синтаксиса — YAGNI на v1) **или** дерево с раскрытием/сворачиванием
  (по умолчанию все узлы первого уровня раскрыты, глубже — свёрнуты);
- кнопки `Copy JSON`, `Download .json`.

### События

| Действие | Что происходит |
| --- | --- |
| `Decode` | `decode(input)`. Успех → `phase='decoded'`, `view='json'`, `selectedPath=[]`. Ошибка → `phase='error'`, `error=msg`. |
| `Paste from clipboard` | `navigator.clipboard.readText()` → подставить в textarea. Если API недоступен — кнопка не рендерится. |
| `Clear` | `state = { phase: 'empty', input: '', ... }`. |
| `Изменить` | `phase='empty'`, фокус на textarea, текущий `input` сохранён. |
| Таб `JSON` / `Children` | меняем `view`. |
| Клик в дереве | `selectedPath = node.path`; JSON-вкладка показывает JSON этого узла. |
| `Copy JSON` | `clipboard.writeText(JSON.stringify(currentNode.json, null, 2))`. На кнопке кратко «Скопировано». |
| `Download .json` | Blob, имя = `(label || kind || 'blueprint') + '.json'`. |

Рендер: одна функция `render(state)`, перерисовывает DOM по состоянию. Без
виртуального DOM — узлов мало, перерисовка дешёвая.

## Тестирование

**Юнит-тесты для `decode.js` через Vitest.** UI проверяется вручную в браузере
по golden path и edge cases (объём v1 — оверкилл для UI-фреймворков).

`package.json` нужен только для `devDependencies`: `vitest`. Браузер по-прежнему
грузит `vendor/pako.min.js` без бандлинга.

### Фикстуры (`src/__fixtures__/`)

- `single-blueprint.txt` — одиночный чертёж.
- `blueprint-book.txt` — книга с 2-3 чертежами.
- `nested-book.txt` — книга, содержащая ещё одну книгу.
- `deconstruction-planner.txt`, `upgrade-planner.txt` — по одному.
- `corrupt-base64.txt`, `wrong-prefix.txt`, `truncated.txt`, `bad-json.txt` —
  негативные кейсы.

### Кейсы

1. Одиночный blueprint → `kind='blueprint'`, `children=[]`, `label` и
   `versionString` извлечены.
2. Книга → `kind='blueprint-book'`, `children` содержит всех потомков плоским
   списком с правильными `path`.
3. Вложенная книга → потомки книги-внутри-книги в плоском списке, глубина
   `path` ≥ 2.
4. Planners → правильный `kind`, `children=[]`.
5. Версия раскладывается корректно (проверка на известном raw-числе).
6. Каждый негативный кейс → выбрасывается `DecodeError` с ожидаемым сообщением.

### Ручная проверка UI (golden path)

1. Вставить → Decode → видна сводка, JSON.
2. Для книги — переключиться на Children, раскрыть/свернуть узлы, кликом
   выбрать вложенный чертёж, увидеть его JSON во вкладке JSON.
3. Copy JSON → проверить буфер.
4. Download .json → имя файла из `label`.
5. Edge cases: пустой ввод, очень большая книга (~50 чертежей), мобильная
   ширина (≤ 480 px) — раскладка должна не ломаться.

## Деплой

Существующий GitHub Pages из `main`, root. Никаких билдов и CI. `git push` →
сайт обновился.

## Что НЕ входит в v1 (YAGNI)

- Кодирование обратно в blueprint-строку.
- Визуальный 2D-рендер фабрики на canvas.
- Каталог чертежей, сохранение, шаринг по ссылке.
- Калькулятор производительности / потребления ресурсов / энергии.
- Темы оформления, i18n.
- Diff двух чертежей.
- Drag-and-drop файла со строкой.

Все эти направления возможны как следующие итерации поверх готовой
`decode.js`, которая уже даст структурированный JSON.
