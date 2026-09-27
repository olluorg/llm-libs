/**
 * Публичный датасет: три файла, которые может скачать и понять любой человек.
 *
 * JSON сам по себе бесполезен для постороннего человека: 27 полей, часть из них
 * служебная, а что означает tier и откуда взялся licenseId — не написано нигде.
 * Поэтому рядом кладутся CSV для таблицы и словарь полей, который собирается из
 * самих записей: если в записи появится новое поле, оно попадёт в словарь
 * само, и расхождение заметит проверка.
 */

/** Описание полей. Тип и доля записей добавляются при сборке. */
const FIELDS = {
  id: ['string', 'Идентификатор записи: экосистема и имя, в нижнем регистре.'],
  name: ['string', 'Имя пакета так, как оно заведено в реестре.'],
  description: ['string', 'Описание из реестра пакета. Язык оригинала, не переводится.'],
  ecosystem: ['string', 'Реестр или площадка: pypi, npm, maven, nuget, crates, rubygems, packagist, golang, github, cran, hex, luarocks, swift.'],
  language: ['string', 'Язык программирования библиотеки.'],
  role: ['string', 'Что библиотека делает с LLM: sdk (клиент API провайдера), framework (абстракция поверх SDK), runtime (локальный или серверный запуск моделей), gateway (прокси к провайдерам), support (сопутствующее: векторные БД, наблюдаемость, eval, токенизаторы, UI, MCP).'],
  kind: ['string', 'Более узкий тип внутри роли.'],
  providers: ['string[]', 'Провайдеры, чей API запись вызывает напрямую.'],
  sdkApi: ['string', 'Какой API использует клиент: chat-completions, responses, messages, bedrock и так далее.'],
  status: ['string', 'Состояние записи: active, deprecated или archived.'],
  tier: ['string', 'Уровень качества: A, B или C. Не выше C, если у записи нет ни звёзд, ни версии, ни загрузок.'],
  features: ['string[]', 'Что заявлено в описании: chat, streaming, tools, embeddings и другие.'],
  envVars: ['string[]', 'Ключи окружения, которые нужны для работы.'],
  install: ['string', 'Команда установки для этого реестра.'],
  repo: ['string', 'Репозиторий с исходным кодом.'],
  stars: ['number', 'Звёзды на GitHub. Пусто, если репозитория нет.'],
  worksWith: ['string[]', 'С чем библиотека работает через посредника, а не вызывает напрямую: у локального рантайма там Ollama и любой OpenAI-совместимый сервер.'],
  homepage: ['string', 'Страница проекта, если она отличается от репозитория.'],
  docs: ['string', 'Страница документации, если реестр её отдаёт.'],
  openaiCompatibleServer: ['boolean', 'Поднимает ли библиотека сервер с OpenAI-совместимым API. Имеет смысл только для локального запуска моделей.'],
  repoDropped: ['boolean', 'Служебное: ссылка на репозиторий признана нерабочей и удалена при аудите ссылок.'],
  license: ['string', 'Лицензия так, как её отдал реестр.'],
  licenseId: ['string', 'Нормализованный идентификатор SPDX.'],
  licenseFamily: ['string', 'Семейство лицензии: permissive, copyleft, source, other, unknown.'],
  registry: ['object', 'Данные реестра: адрес, версия, загрузки, дата обновления.'],
  github: ['object', 'Данные GitHub: звёзды, форки, открытые задачи, помечен ли архивным, когда был последний коммит и релиз.'],
  confidence: ['number', 'Служебное: насколько записи доверяет сбор. Внутреннее поле.'],
  source: ['string[]', 'Служебное: откуда взялась запись — реестр, курируемый список или автообнаружение. Внутреннее поле.'],
  notes: ['string', 'Заметка из курируемого списка: чем запись примечательна. Пусто у большинства записей — это нормально, описание пакета уже есть в description.'],
  matchReasons: ['string[]', 'Служебное: по каким признакам сбор опознал пакет как LLM-библиотеку. Внутреннее поле.'],
  discoveredAt: ['string', 'Дата первого попадания в каталог.'],
  updatedAt: ['string', 'Дата последней проверки записи в реестре.'],
  latestRelease: ['string', 'Последний релиз по данным GitHub.'],
  latestReleaseSource: ['string', 'Откуда взята дата релиза: тег или реестр.'],
};

const INTERNAL = new Set(['confidence', 'source', 'repoDropped', 'matchReasons']);

/** Тип значения по факту, а не по описанию: пригодится словарю. */
function typeOf(value) {
  if (Array.isArray(value)) return 'string[]';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * Заполнено ли поле по-настоящему.
 *
 * Ключ может присутствовать, а значения не нести: envVars есть у всех записей,
 * но у большинства это пустой массив. Считать такой ключ заполненным на 100%
 * значило бы соврать о данных, поэтому пустое не считается.
 */
function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Датасет для публикации: компактный JSON с переводом строки в конце.
 *
 * Без отступов намеренно. Файл машинный, его читает парсер, а отступы стоили
 * 250 КБ на каждое дерево — четверть файла. Читаемому виду служит словарь
 * рядом, а не форматирование JSON.
 */
export function toJson(dataset) {
  return `${JSON.stringify(dataset)}\n`;
}

export const CSV_COLUMNS = [
  'id', 'name', 'ecosystem', 'language', 'role', 'kind', 'status', 'tier',
  'providers', 'sdkApi', 'licenseId', 'licenseFamily', 'stars', 'downloads',
  'version', 'updatedAt', 'repo', 'homepage', 'install', 'envVars', 'features', 'description', 'notes',
  'matchReasons',
];

/** Одна CSV-строка: кавычки вокруг всего, внутри — удвоенные. */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('|') : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

/** Плоская таблица для тех, кто хочет открыть каталог в таблице. */
export function toCsv(libraries) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const library of libraries) {
    const row = {
      ...library,
      stars: library.github?.stars ?? '',
      downloads: library.registry?.downloads ?? '',
      version: library.registry?.version ?? '',
      repo: library.repo ?? '',
    };
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Словарь полей: назначение, тип и доля записей, где поле заполнено.
 *
 * Доля считается по факту, а не по описанию, иначе словарь разошёлся бы с
 * данными при первом же изменении набора записей.
 */
export function toDictionary(libraries, meta) {
  const total = libraries.length || 1;
  const present = new Map();
  for (const library of libraries) {
    for (const [key, value] of Object.entries(library)) {
      const entry = present.get(key) ?? { count: 0, type: typeOf(value) };
      if (hasValue(value)) entry.count += 1;
      if (entry.type === 'null') entry.type = typeOf(value);
      present.set(key, entry);
    }
  }

  const names = [...present.keys()].sort();
  const rows = names.map((key) => {
    const entry = present.get(key);
    const [declared, about] = FIELDS[key] ?? ['—', 'Поле появилось в данных, но не описано.'];
    const type = entry.type === declared ? declared : `${entry.type} (в данных), ${declared} (в описании)`;
    const share = Math.round((entry.count / total) * 100);
    return `| \`${key}\` | ${type} | ${share}% | ${INTERNAL.has(key) ? '**внутреннее.** ' : ''}${about} |`;
  });

  return [
    '# Каталог LLM-библиотек: данные',
    '',
    `Собрано: ${meta.generatedAt}`,
    `Записей: ${libraries.length}`,
    meta.siteUrl ? `Сайт: ${meta.siteUrl}` : '',
    '',
    'Файлы:',
    '',
    '- `libraries.json` — полные записи, как в каталоге;',
    '- `libraries.csv` — та же выборка плоскими колонками, для таблицы;',
    '- `README.md` — этот словарь.',
    '',
    '## Что означают уровни',
    '',
    '- `role` — что библиотека делает с LLM:',
    '  - `sdk` — прямой HTTP-клиент API провайдера;',
    '  - `framework` — абстракция поверх клиентских SDK: агенты, цепочки, RAG;',
    '  - `runtime` — локальный или серверный запуск моделей: Ollama, vLLM, llama.cpp;',
    '  - `gateway` — прокси к провайдерам: LiteLLM, Portkey;',
    '  - `support` — сопутствующее: векторные БД, наблюдаемость, eval, токенизаторы, UI, MCP.',
    '- `tier` — оценка качества записи, а не библиотеки. Не выше `C`, если у записи',
    '  нет ни звёзд, ни версии, ни загрузок: без доказательств оценка не ставится.',
    '- `status` — `active`, `deprecated` или `archived`.',
    '',
    '## Как читать провайдеров',
    '',
    '`providers` — провайдеры, чей API запись вызывает напрямую. У рантаймов и',
    'сопутствующих инструментов провайдеров нет: Ollama не «звонит» в OpenAI. Такие',
    'записи перечислены в `worksWith`.',
    '',
    '## Поля',
    '',
    'Доля — сколько процентов записей поле заполнено.',
    '',
    '| Поле | Тип | Заполнено | Значение |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Чего в данных нет',
    '',
    'Оценок качества библиотек, сравнений, рекомендаций и текста о том, что лучше.',
    'Описание библиотеки приходит из реестра и переводить его значило бы выдумывать',
    'формулировки, поэтому оно остаётся на языке оригинала.',
    '',
    '## Откуда данные',
    '',
    'Сбор из реестров пакетов и GitHub, плюс курируемый список для записей, которые',
    'автоматика классифицировать не может. Каждая запись хранит, откуда она взялась,',
    'в служебном поле `source`.',
    '',
  ].join('\n');
}
