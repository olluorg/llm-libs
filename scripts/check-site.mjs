#!/usr/bin/env node
/**
 * Дымовой тест собранного сайта.
 *
 * Проверяет то, что не видно в логах сборки:
 *  - страница не падает на инициализации (ошибка в JS = пустой список);
 *  - список непуст до первого клика и отсортирован по популярности;
 *  - карточка библиотеки открывается и закрывается всеми способами;
 *  - статическая разметка для поисковиков на месте (строки, JSON-LD, canonical);
 *  - каталог подстраивается под поисковый запрос из referrer.
 *
 *   node scripts/check-site.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { createLogger } from './lib/log.mjs';
import { DIST_DIR } from './lib/store.mjs';
import { slugify as slugifyLanguage } from './lib/site-helpers.mjs';

const log = createLogger('check-site');
const failures = [];

function assert(condition, message) {
  if (condition) return;
  failures.push(message);
  log.error(message);
}

/** Минимальный DOM: достаточно, чтобы app.js отработал инициализацию и отрисовку. */
function createElement(tag = 'div') {
  const listeners = new Map();
  return {
    tagName: tag,
    value: '',
    innerHTML: '',
    textContent: '',
    // В разметке у #hint стоит атрибут hidden, то есть по умолчанию он не виден.
    hidden: true,
    dataset: {},
    style: {},
    scrollTop: 0,
    classList: {
      set: new Set(),
      add(name) { this.set.add(name); },
      remove(name) { this.set.delete(name); },
      contains(name) { return this.set.has(name); },
      toggle(name, force) {
        const on = force === undefined ? !this.set.has(name) : Boolean(force);
        if (on) this.set.add(name);
        else this.set.delete(name);
        return on;
      },
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
    focus() {},
    // Атрибуты нужны карточке: она помечает источник как раскрытый и вешает
    // aria-labelledby. Стаб обязан это уметь, иначе тест проверял бы
    // обрезанный код, а не настоящий.
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    removeAttribute(name) { this.attributes.delete(name); },
    contains(node) { return node === this; },
    querySelector(selector) {
      // Карточка рисуется в innerHTML, поэтому «находим» только нужные элементы.
      return selector === '#hint-reset' && this.innerHTML.includes('id="hint-reset"')
        ? createElement('button')
        : null;
    },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

const dataSource = await fs.readFile(path.join(DIST_DIR, 'assets', 'data.js'), 'utf8');
const dataContext = vm.createContext({ window: {} });
vm.runInContext(dataSource, dataContext, { filename: 'data.js' });
const data = dataContext.window.__LLMDOCS__;
assert(Boolean(data), 'assets/data.js не задаёт window.__LLMDOCS__');
if (!data) process.exit(1);
const appSource = await fs.readFile(path.join(DIST_DIR, 'assets', 'app.js'), 'utf8');

// Словарь интерфейса лежит в собранной странице: читаем его оттуда, чтобы
// тесты проверяли настоящие строки, а не жёстко зашитый русский текст.
// Признак конца — `;</script>`: внутри самих строк встречаются `};`
// (например, «…задач на %{language}; остальное…»), поэтому искать `};` нельзя.
const STRINGS_REGEX = /window\.__LLMDOCS_I18N__ = ([\s\S]*?);\s*<\/script>/;
const indexMarkup = await fs.readFile(path.join(DIST_DIR, 'index.html'), 'utf8');
const ruMarkup = await fs.readFile(path.join(DIST_DIR, 'ru', 'index.html'), 'utf8');
assert(STRINGS_REGEX.test(indexMarkup) && STRINGS_REGEX.test(ruMarkup), 'в собранной странице нет словаря интерфейса');
const STRINGS = JSON.parse(STRINGS_REGEX.exec(indexMarkup)[1]);
const RU_STRINGS = JSON.parse(STRINGS_REGEX.exec(ruMarkup)[1]);

/** Текст счётчика в нужной локали: «306 of 504» / «306 из 504». */
function countText(shown, total, strings = STRINGS) {
  return strings['count.format'].replace('%{shown}', shown).replace('%{total}', total);
}

/** Поднимает app.js в чистом окружении и возвращает доступ к DOM-заглушкам. */
function boot({ view = {}, referrer = '', search = '', strings = STRINGS } = {}) {
  const ids = ['search', 'f-role', 'f-language', 'f-provider', 'f-kind', 'f-status', 'f-tier', 'f-license', 'count', 'rows', 'drawer', 'backdrop', 'reset', 'generated', 'hint'];
  const elements = new Map(ids.map((id) => [id, createElement()]));

  const sortHeaders = ['name', 'language', 'popular', 'updated'].map((sort) => {
    const th = createElement('th');
    th.dataset.sort = sort;
    return th;
  });

  const handlers = new Map();
  const windowHandlers = new Map();
  const documentStub = {
    activeElement: null,
    referrer,
    // Реальный document умеет отдавать корневой элемент: app.js кладёт туда
    // CSS-переменную с высотой липкой панели и атрибут data-theme.
    documentElement: { dataset: {}, style: { setProperty() {} } },
    querySelector: (selector) => elements.get(selector.replace('#', '')) ?? null,
    querySelectorAll: (selector) => (selector.includes('data-sort') ? sortHeaders : []),
    getElementById: (id) => elements.get(id) ?? null,
    addEventListener(type, handler) { handlers.set(type, handler); },
  };

  const context = vm.createContext({
    window: {
      __LLMDOCS__: data,
      __LLMDOCS_VIEW__: view,
      __LLMDOCS_I18N__: strings,
      addEventListener(type, handler) { windowHandlers.set(type, handler); },
    },
    document: documentStub,
    history: { replaceState() {} },
    location: { pathname: '/', search },
    navigator: {},
    URL,
    URLSearchParams,
    setTimeout: () => {},
    console,
  });

  let error = null;
  try {
    vm.runInContext(appSource, context, { filename: 'app.js' });
  } catch (thrown) {
    error = thrown;
  }
  return { elements, sortHeaders, handlers, windowHandlers, error };
}

const popularity = (library) => {
  const period = library.registry?.downloadsPeriod;
  const weight = { month: 1, total: 0.8, imports: 0.5, none: 0 }[period] ?? 0.8;
  const stars = Number(library.stars) || 0;
  const downloads = Number(library.registry?.downloads) || 0;
  return 2 * Math.log10(stars + 10) + weight * Math.log10(downloads + 10) + (library.tier === 'A' ? 0.5 : 0);
};

const byPopularity = (list) =>
  [...list].sort((a, b) => popularity(b) - popularity(a) || String(a.name).localeCompare(String(b.name)));

// Метрика должна быть монотонной: кто выигрывает по обеим величинам —
// обязан стоять выше. Иначе формула «переворачивает» список, как было с
// `звёзды × 20 + загрузки / 1000`, где boto3 с 2.4 млрд CI-загрузок
// в месяц вставал первым при 6 раз меньшем числе звёзд, чем у litellm.
function checkMonotonicity(list) {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const better = list[i];
      const worse = list[j];
      if (popularity(worse) <= popularity(better)) continue;
      const starsBetter = (better.stars ?? 0) >= (worse.stars ?? 0);
      const downloadsBetter = (better.registry?.downloads ?? 0) >= (worse.registry?.downloads ?? 0);
      if (starsBetter && downloadsBetter) {
        assert(false, `популярность немонотонна: ${worse.name} (★${worse.stars}, ⬇${worse.registry?.downloads}) ` +
          `обгоняет ${better.name} (★${better.stars}, ⬇${better.registry?.downloads})`);
        return;
      }
    }
  }
}

// Счётчик должен быть помечен по смыслу: у PyPI и npm — за месяц,
// у crates.io, NuGet, RubyGems — накопительно с публикации.
// Ищем именно в нужной экосистеме: одноимённый пакет в другом реестре
// (npm:openai, nuget:openai) счётчика с другим смыслом не объясняет.
const periodOf = (ecosystem, name) =>
  data.libraries.find((l) => l.ecosystem === ecosystem && l.name === name)?.registry?.downloadsPeriod;
if (data.libraries.some((l) => l.ecosystem === 'pypi' && l.registry?.downloads)) {
  assert(periodOf('pypi', 'openai') === 'month', `счётчик PyPI помечен как «${periodOf('pypi', 'openai')}», а не month`);
}
const cratesRecord = data.libraries.find((l) => l.ecosystem === 'crates' && l.registry?.downloads);
if (cratesRecord) {
  assert(
    cratesRecord.registry.downloadsPeriod === 'total',
    `счётчик crates.io помечен как «${cratesRecord.registry.downloadsPeriod}», а не total`,
  );
}

// ── 1. Инициализация и первый рендер ───────────────────────────────────────
const main = boot();
assert(!main.error, `app.js падает при инициализации: ${main.error?.message}`);
if (main.error) process.exit(1);

const rowsHtml = main.elements.get('rows').innerHTML;
assert(rowsHtml.length > 0, 'при первом открытии список библиотек пуст');

// По умолчанию видны только клиенты API провайдеров и шлюзы: рантаймы,
// фреймворки и инфраструктура — отдельная роль, иначе они неотличимы от SDK.
const defaultVisible = data.libraries.filter((l) => l.role === 'sdk' || l.role === 'gateway');
assert(
  main.elements.get('count').textContent === countText(defaultVisible.length, data.libraries.length),
  `в режиме по умолчанию показано ${main.elements.get('count').textContent}, ` +
    `ожидалось ${countText(defaultVisible.length, data.libraries.length)} (роль sdk+gateway)`,
);
assert(
  !rowsHtml.includes('data-id="pypi:transformers"') && !rowsHtml.includes('data-id="pypi:ollama"'),
  'в списке клиентов API по умолчанию есть локальные рантаймы',
);

// Самое популярное среди клиентов должно быть первым.
checkMonotonicity(byPopularity(defaultVisible));
const firstRendered = /data-id="([^"]+)"/.exec(rowsHtml)?.[1];
const expectedFirst = byPopularity(defaultVisible)[0];
assert(
  firstRendered === expectedFirst.id,
  `сортировка по популярности неверна: первой выводится ${firstRendered}, а должна ${expectedFirst.id}`,
);

// Порядок детерминирован: у языков без звёзд метрики близки к нулю, нужна
// вторичная сортировка. Язык выбираем динамически: в каталоге есть записи
// без звёзд, иначе проверка выродилась бы в сравнение 0 с 0.
const languageWithTies = (() => {
  const byLanguage = new Map();
  for (const library of data.libraries) {
    if (!byLanguage.has(library.language)) byLanguage.set(library.language, []);
    byLanguage.get(library.language).push(library);
  }
  return [...byLanguage.entries()]
    .filter(([, list]) => list.length >= 3 && list.some((l) => !l.stars))
    .sort((a, b) => a[1].length - b[1].length)[0]?.[0];
})();
assert(Boolean(languageWithTies), 'в каталоге нет языка с записями без звёзд — проверять нечего');

const tieLanguage = boot({ view: { language: languageWithTies, role: 'all' } });
const tieIds = [...tieLanguage.elements.get('rows').innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
const tieLibraries = tieIds.map((id) => data.libraries.find((l) => l.id === id));
const tieExpected = byPopularity(data.libraries.filter((l) => l.language === languageWithTies));
assert(
  tieIds.length === tieExpected.length,
  `страница языка ${languageWithTies} показывает ${tieIds.length} записей вместо ${tieExpected.length}`,
);
assert(
  tieLibraries.every((library, index) => library.id === tieExpected[index].id),
  `порядок записей на странице языка ${languageWithTies} не детерминирован (нужна вторичная сортировка)`,
);

// ── 2. Сортировка кликом и фильтры ─────────────────────────────────────────
main.sortHeaders[0].dispatch('click');
assert(main.elements.get('rows').innerHTML.length > 0, 'после сортировки список стал пустым');
main.sortHeaders[3].dispatch('click');
assert(main.elements.get('rows').innerHTML.length > 0, 'после сортировки по дате список пуст');

// Сортировка объявлена и скринридеру, и глазу: без этого отсортированный
// столбец не отличался от остальных.
const sortedTh = main.sortHeaders.find((th) => th.classList.contains('sorted'));
assert(Boolean(sortedTh), 'после сортировки ни один заголовок не помечен как отсортированный');
assert(
  ['ascending', 'descending'].includes(sortedTh?.getAttribute('aria-sort')),
  `у отсортированного заголовка неверный aria-sort: ${sortedTh?.getAttribute('aria-sort')}`,
);
assert(
  main.sortHeaders.filter((th) => th !== sortedTh).every((th) => th.getAttribute('aria-sort') === 'none'),
  'у неотсортированных заголовков должен быть aria-sort="none"',
);

main.elements.get('f-provider').value = data.providers[0].id;
main.elements.get('f-provider').dispatch('input');
const filteredCount = main.elements.get('count').textContent;
assert(
  !filteredCount.startsWith(countText(data.libraries.length, data.libraries.length)),
  `фильтр по провайдеру «${data.providers[0].id}» не изменил выборку (${filteredCount})`,
);
main.elements.get('reset').dispatch('click');
assert(main.elements.get('rows').innerHTML.length > 0, 'после сброса фильтров список пуст');

// Фильтр по лицензии: семейства в списке должны совпадать с датасетом,
// а выбор «разрешающая» — отдавать ровно те записи, у которых такая лицензия.
const licenseSelect = main.elements.get('f-license');
const offeredFamilies = [...licenseSelect.innerHTML.matchAll(/<option value="([^"]+)"/g)]
  .map((match) => match[1])
  .filter(Boolean)
  .sort();
const datasetFamilies = [...new Set(data.libraries.map((l) => l.licenseFamily ?? 'unknown'))].sort();
assert(
  offeredFamilies.join(',') === datasetFamilies.join(','),
  `фильтр по лицензии предлагает [${offeredFamilies}] вместо семейств из датасета [${datasetFamilies}]`,
);

// Переключаем роли на «все», иначе считаем пересечение с фильтром по ролям,
// который на главной по умолчанию ограничен клиентами API.
main.elements.get('f-role').value = 'all';
main.elements.get('f-role').dispatch('input');
assert(
  main.elements.get('count').textContent.startsWith(countText(data.libraries.length, data.libraries.length)),
  `фильтр ролей «все» показал не все записи: ${main.elements.get('count').textContent}`,
);

for (const family of offeredFamilies) {
  const expected = data.libraries.filter((l) => (l.licenseFamily ?? 'unknown') === family);
  licenseSelect.value = family;
  licenseSelect.dispatch('input');
  const shown = main.elements.get('count').textContent;
  assert(
    shown.startsWith(countText(expected.length, data.libraries.length)),
    `фильтр «${family}» показал ${shown} вместо ${expected.length}`,
  );
  const licenseIds = [...main.elements.get('rows').innerHTML.matchAll(/class="lic lic-[a-z]+"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert(
    new Set(licenseIds).size <= new Set(expected.map((l) => l.licenseId ?? '—')).size,
    `в строках «${family}» встретились идентификаторы лицензий, которых нет в датасете`,
  );
}

// Поиск должен находить по лицензии: «apache-2.0» — осмысленный запрос.
main.elements.get('reset').dispatch('click');
const apache = data.libraries.filter((l) => l.licenseId === 'Apache-2.0');
if (apache.length) {
  main.elements.get('search').value = 'apache-2.0';
  main.elements.get('search').dispatch('input');
  const byLicense = main.elements.get('count').textContent;
  assert(
    !byLicense.startsWith('0 из'),
    `поиск по лицензии «apache-2.0» ничего не нашёл, хотя таких записей ${apache.length}`,
  );
  main.elements.get('reset').dispatch('click');
}

// ── 3. Карточка библиотеки ────────────────────────────────────────────────
const drawer = main.elements.get('drawer');
const backdrop = main.elements.get('backdrop');
const clickTarget = { closest: (selector) => (selector === '#drawer-close' ? createElement('button') : null) };

// Вешаем обработчик клика на строку, как это делает render().
const rowHandlers = [];
main.elements.get('rows').querySelectorAll = (selector) => {
  if (!selector.includes('data-id')) return [];
  const tr = createElement('tr');
  tr.dataset.id = firstRendered;
  tr.addEventListener = (type, handler) => rowHandlers.push([type, handler]);
  return [tr];
};
main.elements.get('reset').dispatch('click');
assert(rowHandlers.length === 1, 'не удалось навесить обработчик клика по строке');
const openFirstRow = rowHandlers[0][1];
const openedLibrary = data.libraries.find((l) => l.id === firstRendered);

// Карточка объявлена диалогом, и её заголовок связан с ней через aria-labelledby.
const drawerMarkup = await fs.readFile(path.join(DIST_DIR, 'index.html'), 'utf8');
assert(/<aside class="drawer"[^>]*role="dialog"/.test(drawerMarkup), 'карточка не объявлена как dialog');
assert(/<aside class="drawer"[^>]*aria-modal="true"/.test(drawerMarkup), 'у карточки нет aria-modal');
assert(/id="drawer"/.test(drawerMarkup) && /aria-labelledby="drawer-title"/.test(drawerMarkup), 'нет связи карточки с её заголовком');
// Счётчик объявлен статусом: иначе скринридер не слышит, сколько записей
// осталось после фильтрации.
assert(/id="count"[^>]*role="status"/.test(drawerMarkup) || /id="count"[^>]*aria-live/.test(drawerMarkup), 'счётчик не объявлен как статус для скринридера');
// Имя библиотеки — кнопка: с клавиатуры карточка иначе не открывается.
assert(/<button type="button" class="pkg-open"/.test(drawerMarkup), 'имя библиотеки не сделано кнопкой');
// Мобильный вид: без подписей data-label в карточках вместо таблицы
// получится набор чисел без названий.
const firstRow = /<tr data-id="[^"]+" id="[^"]+">[\s\S]*?<\/tr>/.exec(drawerMarkup)?.[0] ?? '';
const labelledCells = [...firstRow.matchAll(/<td[^>]*data-label="([^"]*)"/g)].map(([, label]) => label);
assert(labelledCells.length >= 5, `в строке только ${labelledCells.length} подписанных ячеек — на узком экране данные останутся без названий`);
assert(
  labelledCells.every((label) => label.trim().length > 0),
  'в строке есть ячейка с пустой подписью data-label',
);
assert(/class="cell-name"/.test(firstRow), 'в строке нет класса cell-name для мобильной карточки');
// Панель фильтров и шапка таблицы не должны наезжать друг на друга.
const sticky = await fs.readFile(path.join(DIST_DIR, 'assets', 'style.css'), 'utf8');
assert(/@media \(max-width: 560px\)/.test(sticky), 'нет брейкпоинта для телефонов: восемь колонок туда не влезают');
// Липкой остаётся только шапка таблицы. Если липким станет что-то ещё, у
// шапки снова появится отступ, который надо откуда-то измерять, и без
// измерения она уедет вниз — как и случилось: измерялась вся панель
// фильтров вместе со свёрнутой легендой.
assert(
  /thead th \{ position: sticky; top: 0;/.test(sticky),
  'шапка таблицы должна липнуть к верху экрана (top: 0), а не к измеренному отступу',
);
// Липкой может быть только сама таблица — её заголовок и первый столбец.
// Липкая панель фильтров сдвинет заголовок вниз: так и вышло, когда отступ
// брался из высоты всей панели вместе со свёрнутой легендой.
// Комментарии и открывающие@media убираем: иначе в правило попадёт текст
// над ним.
const stickyRules = [
  ...sticky
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:media|supports)[^{]*\{/g, '')
    .matchAll(/([^{}]*)\{[^}]*position: sticky/g),
].map((m) => m[1].trim());
for (const rule of stickyRules) {
  const outside = rule
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(thead th|th|tbody td:first-child|td:first-child)(:first-child)?$/.test(part));
  assert(
    outside.length === 0,
    `липкое правило «${rule}» захватывает что-то вне таблицы — липкой может быть только она`,
  );
}
assert(!sticky.includes('sticky-h'), 'осталась переменная --sticky-h: её отступ без измерения уводит шапку вниз');
assert(!/syncStickyOffset|getBoundingClientRect/.test(appSource), 'в app.js остался код измерения высоты панели');
// Сайт — одна центрированная колонка. Полос на всю ширину окна быть не
// должно: на 2560px лента с узким содержимым внутри выглядит нелепо, и
// «починить» это растягиванием фона шапки тоже нельзя.
assert(!/class="strip"/.test(drawerMarkup), 'в разметке появился блок на всю ширину: сайт должен быть одной колонкой');
assert(!/\.strip\s*\{/.test(sticky), 'в стилях остался блок на всю ширину окна');
assert(
  /header\.top \{[^}]*border-bottom/.test(sticky) && !/header\.top \{[^}]*background/.test(sticky),
  'у шапки не должно быть собственного фона: он и рисовал полосу во всю ширину',
);
assert(/\.wrap \{ max-width: 1400px/.test(sticky), 'колонка содержимого не ограничена по ширине');
// Сквозная ссылка к таблице: иначе с клавиатуры до первого списка нужно
// пройти все фильтры.
assert(/class="skip-link" href="#catalog"/.test(drawerMarkup), 'нет сквозной ссылки к таблице');
assert(/\.skip-link:focus/.test(sticky), 'сквозная ссылка не видна при фокусе — она и не работает');
// Анимации уважают системную настройку: переходы карточки при
// motion sensitivity лишни.
assert(/@media \(prefers-reduced-motion: reduce\)/.test(sticky), 'нет правила для prefers-reduced-motion');
// Первый столбец липкий там, где таблица прокручивается вбок, и не липкий
// там, где она уже карточки.
assert(
  /@media \(min-width: 561px\)[\s\S]*?td:first-child \{ position: sticky; left: 0;/.test(sticky),
  'первый столбец не липкий: при прокрутке вбок имя библиотеки уезжает за край',
);
// Правила после сброса: переменные объявлены в :root, дальше только используются.
const body = sticky.slice(sticky.indexOf('* {'));

// Объявленные, но не используемые переменные — признак того, что оформление
// меняли, а следы не убрали: так в проекте остался мёртвый --bg-header.
const declaredVars = new Set([...sticky.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1].slice(2)));
const usedVars = new Set([...body.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
const deadVars = [...declaredVars].filter((name) => !usedVars.has(name));
assert(deadVars.length === 0, `в стилях остались неиспользуемые переменные: ${deadVars.join(', ')}`);
// И наоборот: необъявленная переменная молча даёт пустое значение.
const undeclared = [...usedVars].filter((name) => !declaredVars.has(name));
assert(undeclared.length === 0, `используются необъявленные переменные: ${undeclared.join(', ')}`);
// Светлая тема: переключатель есть, тема применяется до первой отрисовки.
assert(/id="theme-toggle"/.test(drawerMarkup), 'нет переключателя темы');
assert(/llmcat\.theme/.test(drawerMarkup), 'тема не восстанавливается до первой отрисовки');
assert(/:root\[data-theme='light'\]/.test(sticky), 'в стилях нет светлой темы');
assert(/color-scheme: light/.test(sticky), 'в светлой теме не объявлен color-scheme');
// Все цвета в правилах — через переменные, иначе светлая тема оставит часть
// вкладок тёмной: сегодня это ровно тот случай, который не видно на глаз.
const literalColors = new Set(
  [...body.matchAll(/(?:^|[\s;{])(?:color|background|border-color|background-color):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)].map((m) => m[2]),
);
assert(
  literalColors.size === 0,
  `в правилах есть прямые цвета (${[...literalColors].slice(0, 3).join(', ')}) — светлая тема их не перекроет`,
);

openFirstRow();
assert(drawer.classList.contains('open'), 'карточка библиотеки не открылась');
assert(drawer.innerHTML.includes(openedLibrary.name), `в карточке нет названия библиотеки ${openedLibrary.name}`);
assert(drawer.innerHTML.includes('id="drawer-close"'), 'в карточке нет кнопки закрытия');

drawer.dispatch('click', { target: clickTarget });
assert(!drawer.classList.contains('open'), 'кнопка закрытия не работает');

openFirstRow();
main.handlers.get('keydown')({ key: 'Escape' });
assert(!drawer.classList.contains('open'), 'Escape не закрывает карточку');

openFirstRow();
backdrop.dispatch('click');
assert(!drawer.classList.contains('open'), 'клик по фону не закрывает карточку');
assert(!backdrop.classList.contains('open'), 'фон не скрывается после закрытия карточки');

// ── 4. Понимание поискового запроса (referrer) ────────────────────────────
const fromYandex = boot({ referrer: 'https://yandex.ru/search/?text=библиотеки+llm+для+rust' });
assert(fromYandex.error === null, `app.js падает на referrer из Яндекса: ${fromYandex.error?.message}`);
assert(
  fromYandex.elements.get('f-language').value === 'Rust',
  `по запросу «библиотеки llm для rust» язык не определён (получено «${fromYandex.elements.get('f-language').value}»)`,
);
// Служебные слова («библиотеки», «llm», «для») не должны превращаться в поисковый запрос,
// иначе AND-поиск не находит ничего.
assert(
  fromYandex.elements.get('search').value === '',
  `служебные слова попали в поиск: «${fromYandex.elements.get('search').value}»`,
);
assert(fromYandex.elements.get('hint').hidden === false, 'не показана подсказка о запросе из поисковика');
const rustClients = data.libraries.filter(
  (l) => l.language === 'Rust' && (l.role === 'sdk' || l.role === 'gateway'),
).length;
assert(
  Number(/^(\d+)/.exec(fromYandex.elements.get('count').textContent)?.[1] ?? 0) === rustClients,
  `фильтр «Rust из поисковика» дал не то число клиентов (ожидалось ${rustClients})`,
);
assert(
  fromYandex.elements.get('rows').innerHTML.includes('async-openai'),
  'по запросу про Rust не показаны Rust-клиенты',
);
// Локальные рантаймы по этому же запросу — отдельная роль, в списке клиентов их нет.
assert(
  !fromYandex.elements.get('rows').innerHTML.includes('data-id="crates:candle"'),
  'рантайм попал в список клиентов API по запросу «библиотеки llm для rust»',
);

const fromGoogle = boot({ referrer: 'https://www.google.com/search?q=openai+sdk+php' });
assert(
  fromGoogle.elements.get('f-language').value === 'PHP',
  `по запросу «openai sdk php» язык не определён (получено «${fromGoogle.elements.get('f-language').value}»)`,
);
assert(
  fromGoogle.elements.get('search').value.includes('openai'),
  `содержательная часть запроса потеряна (получено «${fromGoogle.elements.get('search').value}»)`,
);
assert(
  fromGoogle.elements.get('rows').innerHTML.includes('openai-php/client'),
  'по запросу «openai sdk php» не найден openai-php/client',
);

const fromDuckduckgo = boot({ referrer: 'https://duckduckgo.com/?q=llm+client+golang&q=llm' });
assert(
  fromDuckduckgo.elements.get('f-language').value === 'Go',
  `по запросу «llm client golang» язык не определён (получено «${fromDuckduckgo.elements.get('f-language').value}»)`,
);

// Прямая ссылка с параметрами должна работать так же.
const fromUrl = boot({ search: '?q=anthropic&language=Python' });
assert(fromUrl.elements.get('search').value === 'anthropic', 'параметр ?q= не подставляется в поиск');
assert(fromUrl.elements.get('f-language').value === 'Python', 'параметр ?language= не применяется');

// Срез по языку важнее запроса из поисковика: страница /languages/r.html
// не должна переключаться на язык из referrer.
const languagePage = boot({ view: { language: 'R' }, referrer: 'https://yandex.ru/search/?text=llm+для+rust' });
assert(
  languagePage.elements.get('f-language').value === 'R',
  `страница языка R переключилась на язык из поисковика (получено «${languagePage.elements.get('f-language').value}»)`,
);
assert(languagePage.elements.get('hint').hidden === true, 'на срезе языка показывается лишняя подсказка');

// Русские и смешанные запросы.
for (const [query, expected] of [
  ['https://yandex.ru/search/?text=библиотеки+для+golang', 'Go'],
  ['https://www.google.com/search?q=llm+java+client', 'Java'],
  ['https://www.bing.com/search?q=openai+dotnet+sdk', 'C#'],
  ['https://search.brave.com/search?q=anthropic+ruby+gem', 'Ruby'],
  ['https://duckduckgo.com/?q=llm+lua+client', 'Lua'],
]) {
  const env = boot({ referrer: query });
  assert(
    env.elements.get('f-language').value === expected,
    `запрос «${query}» → язык ${env.elements.get('f-language').value || 'не определён'}, ожидался ${expected}`,
  );
}

// Чужой referrer не должен ломать выдачу.
const fromOther = boot({ referrer: 'https://news.ycombinator.com/item?id=1' });
assert(
  fromOther.elements.get('f-language').value === '' && fromOther.elements.get('search').value === '',
  'referrer с непоискового сайта не должен влиять на фильтры',
);
assert(fromOther.elements.get('rows').innerHTML.length > 0, 'после не-search referrer список пуст');

// ── 4b. Фильтр ролей ──────────────────────────────────────────────────────
const allRoles = boot({ view: { role: 'all' } });
assert(
  allRoles.elements.get('count').textContent === countText(data.libraries.length, data.libraries.length),
  `режим «все роли» показывает не всё: ${allRoles.elements.get('count').textContent}`,
);
const runtimes = boot({ view: { role: 'runtime' } });
const runtimeCount = Number(/^(\d+)/.exec(runtimes.elements.get('count').textContent)?.[1] ?? 0);
assert(runtimeCount > 0, 'фильтр «локальный запуск моделей» пуст');
assert(
  runtimes.elements.get('rows').innerHTML.includes('data-id="pypi:transformers"'),
  'в рантаймах нет transformers',
);

// Семантика данных: рантайм и инфраструктура не должны числиться клиентами провайдера.
for (const [id, role] of [['pypi:transformers', 'runtime'], ['pypi:chromadb', 'support'], ['pypi:promptfoo', 'support']]) {
  const library = data.libraries.find((l) => l.id === id);
  if (!library) continue;
  assert(library.role === role, `${id}: ожидалась роль ${role}, получено ${library.role}`);
  assert(
    !(library.providers ?? []).length,
    `${id} (${role}) не должен быть приписан к API провайдера, а у него providers: ${(library.providers ?? []).join(', ')}`,
  );
}

// ── 5. SEO: статическая разметка ──────────────────────────────────────────
const indexHtml = await fs.readFile(path.join(DIST_DIR, 'index.html'), 'utf8');
const preRendered = [...indexHtml.matchAll(/<tr data-id="/g)].length;
assert(preRendered > 50, `в статической разметке только ${preRendered} строк — поисковик увидит почти пустую таблицу`);
assert(!indexHtml.includes('{{'), 'в index.html остались незаполненные плейсхолдеры');
assert(/<link rel="canonical" href="https?:\/\/[^"]+"/.test(indexHtml), 'нет canonical на главной');
assert(
  /<link rel="canonical" href="https?:\/\/[^"]*\/(providers|languages)\//.test(indexHtml) === false,
  'canonical главной страницы указывает внутрь подкаталога',
);
assert(/property="og:title"/.test(indexHtml), ' нет Open Graph-разметки');
assert(/application\/ld\+json/.test(indexHtml), 'нет JSON-LD разметки');
assert(!/\.\.\/\//.test(indexHtml), 'сломан относительный путь (..//)');

try {
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(indexHtml)[1]);
  const graph = ld['@graph'] ?? [];
  assert(graph.length >= 1, 'JSON-LD пуст');
  assert(
    graph.some((node) => node['@type'] === 'CollectionPage' && node.mainEntity?.itemListElement?.length > 10),
    'в JSON-LD нет списка библиотек (ItemList)',
  );
} catch (error) {
  assert(false, `JSON-LD не парсится: ${error.message}`);
}

// Страницы провайдеров и языков: та же структура + собственные метаданные.
// Ожидаемый заголовок берём из словаря той локали, которую проверяем.
for (const [file, expected] of [
  ['providers/openai.html', 'OpenAI'],
  ['languages/r.html', 'R'],
  ['providers.html', STRINGS['nav.providers']],
  ['languages.html', STRINGS['nav.languages']],
]) {
  const html = await fs.readFile(path.join(DIST_DIR, file), 'utf8').catch(() => null);
  if (html === null) {
    assert(false, `нет страницы ${file}`);
    continue;
  }
  assert(html.includes(expected), `в ${file} нет ожидаемого заголовка (${expected})`);
  assert(!html.includes('{{'), `в ${file} остались незаполненные плейсхолдеры`);
  assert(!/\.\.\/\//.test(html), `в ${file} сломан относительный путь (..//)`);
  assert(
    /<tr data-id="/.test(html),
    `в ${file} нет статически отрендеренных строк — страница пуста без JavaScript`,
  );
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? '';
  assert(
    canonical.startsWith('http') && !canonical.includes('..'),
    `в ${file} неверный canonical: ${canonical || 'отсутствует'}`,
  );
}

// Служебные файлы для поисковиков. sitemap.xml перечисляет обе локали,
// llms.txt лежит в каждом дереве.
for (const [file, pattern] of [
  ['robots.txt', /Sitemap: https?:\/\/\S+\/sitemap\.xml/],
  ['sitemap.xml', /<urlset[\s\S]*<loc>https?:\/\/[^<]*index\.html<\/loc>/],
  ['sitemap.xml', /<xhtml:link rel="alternate" hreflang="ru" href="[^"]*\/ru\/index\.html"/],
  ['llms.txt', new RegExp(STRINGS['llms.providers'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
  ['ru/llms.txt', new RegExp(RU_STRINGS['llms.providers'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
]) {
  const content = await fs.readFile(path.join(DIST_DIR, file), 'utf8').catch(() => null);
  assert(content !== null && pattern.test(content), `файл ${file} отсутствует или неверен`);
}

// Дата релиза: у всех записей с репозиторием она должна находиться,
// причём источник выбирается по приоритету: реестр → релиз GitHub → коммит.
const RANK = { registry: 3, 'github-release': 2, 'github-commit': 1 };
const noRelease = data.libraries.filter((l) => !l.latestRelease);
const withRepoButNoDate = data.libraries.filter((l) => l.repo && !l.latestRelease);
assert(
  noRelease.length === 0,
  `у ${noRelease.length} записей нет даты релиза: ${noRelease.slice(0, 6).map((l) => l.name).join(', ')}`,
);
assert(
  withRepoButNoDate.length === 0,
  `у ${withRepoButNoDate.length} записей с репозиторием нет даты: ${withRepoButNoDate.slice(0, 6).map((l) => l.name).join(', ')}`,
);
for (const library of data.libraries) {
  if (!library.latestRelease) continue;
  assert(
    RANK[library.latestReleaseSource] >= RANK['github-commit'],
    `${library.name}: неизвестный источник даты «${library.latestReleaseSource}»`,
  );
  // Дата из реестра должна побеждать GitHub, когда обе есть.
  if (library.registry?.updatedAt && library.registry.updatedAt !== library.latestRelease) {
    assert(
      library.latestRelease === library.github?.releasedAt || library.latestRelease === library.github?.pushedAt,
      `${library.name}: latestRelease (${library.latestRelease}) не совпадает ни с реестром ` +
        `(${library.registry.updatedAt}), ни с GitHub (${library.github?.releasedAt ?? library.github?.pushedAt})`,
    );
  }
}

// ── 6. Локализация ────────────────────────────────────────────────────────
//
// Три вещи, которые иначе расходятся молча:
//  - непереведённая строка в английской версии (ловим по кириллице);
//  - страница, существующая только в одной локали;
//  - hreflang, указывающий на несуществующий или не тот же адрес.
const LOCALES = ['en', 'ru'];
const LOCALE_DIR = { en: '', ru: 'ru' };
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Собственный текст страницы: без описаний библиотек (они из реестров), без
 * JSON-LD, словаря и комментариев разработчика — они не видны посетителю,
 * поэтому отсутствие перевода в них не ошибка.
 */
function ownText(html) {
  return html
    .replace(/<tbody id="rows">[\s\S]*?<\/tbody>/, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')
    .replace(/window\.__LLMDOCS_I18N__ = \{[\s\S]*?\};/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    // Переключатель языка по правилам показывает целевой язык его же названием
    // («Русский» на английской странице), поэтому из проверки исключён.
    .replace(/<a class="lang-switch"[\s\S]*?<\/a>/, '');
}

const htmlFiles = (await fs.readdir(DIST_DIR, { recursive: true }))
  .filter((name) => String(name).endsWith('.html'))
  .map(String);

for (const locale of LOCALES) {
  const dir = LOCALE_DIR[locale];
  const prefix = dir ? `${dir}/` : '';
  for (const relative of htmlFiles.filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))) {
    const html = await fs.readFile(path.join(DIST_DIR, relative), 'utf8');
    const lang = /<html lang="([a-z]+)"/.exec(html)?.[1];
    assert(lang === locale, `в ${relative} lang="${lang}", а ожидалась локаль ${locale}`);

    // Канонический адрес и hreflang указывают на адрес этой же страницы.
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? '';
    assert(
      canonical.endsWith(`/${relative.split(path.sep).join('/')}`),
      `в ${relative} canonical указывает на другую страницу: ${canonical}`,
    );
    const alternates = [...html.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]+)"/g)];
    const byLang = Object.fromEntries(alternates.map(([, lang2, href]) => [lang2, href]));
    for (const other of LOCALES) {
      assert(Boolean(byLang[other]), `в ${relative} нет hreflang="${other}"`);
      const target = relative.replace(new RegExp(`^${prefix}`), '');
      const expectedTail = other === 'en' ? `/${target}` : `/ru/${target}`;
      assert(
        byLang[other]?.endsWith(expectedTail),
        `в ${relative} hreflang="${other}" указывает на ${byLang[other]}, а не на ${expectedTail}`,
      );
    }
    assert(
      byLang['x-default'] === byLang.en,
      `в ${relative} x-default (${byLang['x-default']}) должен совпадать с английской версией (${byLang.en})`,
    );

    // Переключатель ведёт на ту же страницу на другом языке и подписан её названием.
    const switcher = /<a class="lang-switch" href="([^"]+)" hreflang="(\w+)"/.exec(html);
    const otherLocale = locale === 'en' ? 'ru' : 'en';
    const ownRelative = relative.slice(prefix.length).split(path.sep).join('/');
    const expectedHref = (otherLocale === 'ru' ? 'ru/' : '') + ownRelative;
    assert(
      switcher?.[2] === otherLocale && switcher[1].endsWith(expectedHref),
      `в ${relative} переключатель языка ведёт на ${switcher?.[1] ?? 'никуда'}, а не на ${expectedHref}`,
    );
    // Ссылка относительная: с такого уровня вложенности она обязана существовать.
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), switcher?.[1] ?? ''));
    assert(
      htmlFiles.includes(resolved),
      `в ${relative} переключатель языка указывает на несуществующий файл ${resolved}`,
    );
    const switchLabel = /<a class="lang-switch"[\s\S]*?>([^<]+)</.exec(html)?.[1] ?? '';
    assert(
      switchLabel === STRINGS[`nav.switchTo${otherLocale === 'ru' ? 'Ru' : 'En'}`],
      `в ${relative} подпись переключателя «${switchLabel}» не совпадает со словарём`,
    );

    // Собственный текст английской страницы не должен содержать кириллицу.
    if (locale === 'en') {
      const text = ownText(html);
      const cyrillic = text.match(/[Ѐ-ӿ][^<>]{0,40}/g) ?? [];
      assert(
        cyrillic.length === 0,
        `в английской странице ${relative} остался русский текст: ${cyrillic.slice(0, 3).join(' | ')}`,
      );
    } else {
      const text = ownText(html);
      assert(CYRILLIC.test(text), `в русской странице ${relative} нет ни одного русского слова — похоже, словарь не применился`);
    }
  }
}

// Симметрия деревьев: у каждой страницы есть пара на другом языке.
const enPages = htmlFiles.filter((name) => !name.startsWith('ru/')).map((name) => `ru/${name}`);
for (const mirror of enPages) {
  assert(htmlFiles.includes(mirror), `нет русской версии страницы ${mirror}`);
}

// Страница на другом языке открывается без JavaScript и тоже работает.
const ruMain = boot({ strings: RU_STRINGS });
assert(ruMain.error === null, `app.js падает на русской странице: ${ruMain.error?.message}`);
assert(
  ruMain.elements.get('rows').innerHTML.length > 0,
  'на русской странице список пуст до первого клика',
);
assert(
  ruMain.elements.get('count').textContent === countText(
    data.libraries.filter((l) => ['sdk', 'gateway'].includes(l.role)).length,
    data.libraries.length,
    RU_STRINGS,
  ),
  `на русской странице неверный счётчик: ${ruMain.elements.get('count').textContent}`,
);
assert(
  ruMain.elements.get('drawer') !== null,
  'на русской странице не инициализировалась карточка',
);

// ── 7. Подборка на странице языка ─────────────────────────────────────────
//
// Страница языка должна отвечать на вопрос «что взять», а не только выдавать
// таблицу: вступление, «с чего начать» и секции по ролям. Проверяем, что
// счётчики в тексте совпадают с данными, а якоря ведут в существующие записи —
// иначе поисковик получит подборку с выдуманными числами и битыми ссылками.
// Страница языка лежит прямо в languages/, ролевой срез — во вложенной папке.
const languagePages = htmlFiles.filter(
  (name) => name.includes('languages/') && !name.slice(name.indexOf('languages/') + 10).includes('/'),
);
assert(languagePages.length > 0, 'нет ни одной страницы языка');

for (const relative of languagePages) {
  const html = await fs.readFile(path.join(DIST_DIR, relative), 'utf8');
  const slug = path.basename(relative, '.html');
  const language = data.libraries.find((library) => library.language && slugifyLanguage(library.language) === slug)?.language;
  if (!language) {
    assert(false, `не нашёлся язык для страницы ${relative}`);
    continue;
  }
  const subset = data.libraries.filter((library) => library.language === language);
  const collection = /<section class="collection"[\s\S]*?(?=<table id="catalog")/.exec(html)?.[0] ?? '';
  assert(collection.length > 0, `в ${relative} нет блока подборки`);

  // Вступление называет настоящее число записей.
  const intro = /class="collection-intro">([^<]*)</.exec(collection)?.[1] ?? '';
  assert(
    intro.includes(String(subset.length)),
    `в ${relative} во вступлении нет числа ${subset.length}: «${intro.slice(0, 60)}»`,
  );

  // Секция должна быть на каждую роль, которая реально есть на этом языке.
  const roleCounts = new Map();
  for (const library of subset) roleCounts.set(library.role, (roleCounts.get(library.role) ?? 0) + 1);
  const sections = [...collection.matchAll(/data-role="(\w+)"[\s\S]*?<h3>[^<]*— (\d+)<\/h3>/g)].map(([, role, count]) => [role, Number(count)]);
  const expectedRoles = [...roleCounts.keys()].sort();
  assert(
    sections.map(([role]) => role).sort().join(',') === expectedRoles.join(','),
    `в ${relative} секции [${sections.map(([role]) => role).join(', ')}] вместо ролей [${expectedRoles.join(', ')}]`,
  );
  // Сумма счётчиков по секциям равна числу записей языка: ничего не потеряно
  // и ничего не посчитано дважды.
  const total = sections.reduce((sum, [, count]) => sum + count, 0);
  assert(total === subset.length, `в ${relative} сумма по секциям ${total}, а записей ${subset.length}`);
  for (const [role, count] of sections) {
    assert(
      count === roleCounts.get(role),
      `в ${relative} секция «${role}» показывает ${count}, а в данных ${roleCounts.get(role)}`,
    );
  }

  // Каждый якорь в списках ведёт в запись этого языка. Ссылку «полный список»
  // ссылку «полный список» внизу не проверяем: это не запись, а переход к таблице.
  const ids = new Set(subset.map((library) => library.id));
  const lists = [...collection.matchAll(/<ul[\s\S]*?<\/ul>/g)].map(([block]) => block).join('\n');
  const anchors = [...lists.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
  assert(anchors.length > 0, `в ${relative} в подборке нет ссылок-якорей`);
  for (const id of anchors) {
    assert(ids.has(id), `в ${relative} якорь #${id} не соответствует ни одной записи языка ${language}`);
  }
  // Якорь должен вести в строку, которая реально есть в таблице: у строк
  // обязан быть id, иначе переход по ссылке из подборки ничего не делает.
  const rowIds = new Set();
  for (const [, dataId, htmlId] of html.matchAll(/<tr data-id="([^"]+)" id="([^"]+)"/g)) {
    assert(dataId === htmlId, `в ${relative} у строки data-id="${dataId}" и id="${htmlId}" расходятся`);
    rowIds.add(htmlId);
  }
  for (const id of anchors) {
    assert(rowIds.has(id), `в ${relative} якорь #${id} ведёт в строку без id — переход ничего не сделает`);
  }
  // «С чего начать»: не больше 5 записей, все — из этого языка.
  const picks = /<ul class="picks">[\s\S]*?<\/ul>/.exec(collection)?.[0] ?? '';
  const pickIds = [...picks.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
  assert(pickIds.length > 0 && pickIds.length <= 5, `в ${relative} «с чего начать» содержит ${pickIds.length} записей`);
}

// На главной и на срезе провайдера подборки нет: она осмысленна только там,
// где человек пришёл за языком.
for (const relative of ['index.html', 'providers.html', 'languages.html', 'providers/openai.html', 'ru/index.html']) {
  const html = await fs.readFile(path.join(DIST_DIR, relative), 'utf8');
  assert(!html.includes('class="collection"'), `в ${relative} подборка не нужна, но присутствует`);
}

// ── 8. Страницы «язык × роль» ─────────────────────────────────────────────
//
// Это длинный хвост запросов: «официальные клиенты API на Go», «шлюзы на
// TypeScript». Проверяем, что страница появляется ровно там, где есть что
// показать, содержит ровно свой срез и что на неё ведут ссылки с сайта.
const ROLE_SLUGS = {
  sdk: 'api-clients',
  framework: 'frameworks',
  runtime: 'local-runtimes',
  gateway: 'gateways',
  support: 'supporting-tools',
};
const roleSliceCount = new Map();
for (const library of data.libraries) {
  const key = `${library.language}|${library.role}`;
  roleSliceCount.set(key, (roleSliceCount.get(key) ?? 0) + 1);
}
const expectedSlices = new Set(
  [...roleSliceCount]
    .filter(([, count]) => count >= 3)
    .map(([key]) => key),
);
const actualSlices = new Set();
let linkedFromLanguagePage = 0;
let linkedFromRelated = 0;

for (const relative of htmlFiles.filter((name) => /languages\/[^/]+\/[^/]+\.html$/.test(name))) {
  // Отбрасываем префикс локали: ru/languages/go/api-clients.html → languages/go/…
  const withoutLocale = relative.replace(/^ru\//, '');
  const [, languageSlug, file] = withoutLocale.split('/');
  const language = data.libraries.find((l) => l.language && slugifyLanguage(l.language) === languageSlug)?.language;
  const role = Object.entries(ROLE_SLUGS).find(([, slug]) => slug === path.basename(file, '.html'))?.[0];
  assert(Boolean(language && role), `не определены язык или роль для ${relative}`);
  if (!language || !role) continue;
  actualSlices.add(`${language}|${role}`);

  const html = await fs.readFile(path.join(DIST_DIR, relative), 'utf8');
  const expected = data.libraries.filter((library) => library.language === language && library.role === role);
  const rows = [...html.matchAll(/<tr data-id="([^"]+)"/g)].map(([, id]) => id);
  assert(
    rows.length === Math.min(expected.length, 150),
    `в ${relative} ${rows.length} строк, а в срезе ${expected.length} записей`,
  );
  // Срез не смешан с другими ролями: каждая строка принадлежит роли.
  const foreign = expected.filter((library) => !rows.includes(library.id)).map((library) => library.id);
  assert(foreign.length === 0, `в ${relative} нет части среза: ${foreign.slice(0, 3).join(', ')}`);
  // Своя роль в заголовке, в тексте и в разметке подборки.
  const heading = /<h1[^>]*>([^<]*)/.exec(html)?.[1] ?? '';
  assert(
    heading.includes(language) && heading.length > language.length,
    `в ${relative} заголовок «${heading}» не называет ни язык, ни роль`,
  );
  assert(
    /class="collection"[^>]*data-collection-role="/.test(html),
    `в ${relative} подборка не помечена своей ролью`,
  );
  // Крошки и в разметке, и в JSON-LD: у среза четыре уровня, последний — роль.
  const strings = relative.startsWith('ru/') ? RU_STRINGS : STRINGS;
  const roleLabel = strings[`role.${role}`];
  const crumbText = /<nav class="crumbs"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1]?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  assert(
    crumbText.includes(language) && crumbText.trim().endsWith(roleLabel),
    `в ${relative} крошки «${crumbText}» не заканчиваются ролью «${roleLabel}»`,
  );
  const jsonLd = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const breadcrumb = jsonLd['@graph']?.find((node) => node['@type'] === 'BreadcrumbList');
  const trail = (breadcrumb?.itemListElement ?? []).map((item) => item.name);
  assert(
    trail.length === 4 && trail[2] === language && trail[3] === roleLabel,
    `в ${relative} крошки в JSON-LD [${trail.join(' → ')}] не совпадают с ролью среза`,
  );
  // Перекрёстные ссылки: та же роль в других языках и другие роли этого языка.
  const related = /<nav class="related"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  const relatedLinks = [...related.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
  assert(relatedLinks.length > 0, `в ${relative} нет перекрёстных ссылок`);
  const depth = relative.split('/').length - 1;
  for (const href of relatedLinks) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), href));
    assert(htmlFiles.includes(resolved), `в ${relative} ссылка ведёт на несуществующую страницу ${resolved}`);
    if (resolved.includes(`/${ROLE_SLUGS[role]}.html`)) linkedFromRelated += 1;
  }
}

// Страница роли должна существовать для каждого среза с 3+ записями.
for (const key of expectedSlices) {
  assert(actualSlices.has(key), `нет страницы для среза ${key} (${roleSliceCount.get(key)} записей)`);
}
// И наоборот: лишних страниц быть не должно.
for (const key of actualSlices) {
  assert(expectedSlices.has(key), `страница создана для среза ${key} с ${roleSliceCount.get(key)} записями — тонкий контент`);
}

// Со страницы языка должны вести ссылки на все её ролевые срезы.
for (const relative of languagePages) {
  const html = await fs.readFile(path.join(DIST_DIR, relative), 'utf8');
  const languageSlug = path.basename(relative, '.html');
  const language = data.libraries.find((library) => library.language && slugifyLanguage(library.language) === languageSlug)?.language;
  if (!language) continue;
  const slices = [...expectedSlices].filter((key) => key.startsWith(`${language}|`));
  for (const key of slices) {
    const role = key.split('|')[1];
    const target = `languages/${languageSlug}/${ROLE_SLUGS[role]}.html`;
    if (html.includes(target)) linkedFromLanguagePage += 1;
  }
}
assert(
  linkedFromLanguagePage > 0,
  'со страниц языка не ведёт ни одной ссылки на ролевые срезы — они недостижимы для поисковика',
);
assert(linkedFromRelated > 0, 'между срезами одной роли нет перекрёстных ссылок');

// Словарь: обе локали должны знать одни и те же ключи.
const missingInRu = Object.keys(STRINGS).filter((key) => !(key in RU_STRINGS));
const missingInEn = Object.keys(RU_STRINGS).filter((key) => !(key in STRINGS));
assert(missingInRu.length === 0, `в русском словаре нет ключей: ${missingInRu.slice(0, 5).join(', ')}`);
assert(missingInEn.length === 0, `в английском словаре нет ключей: ${missingInEn.slice(0, 5).join(', ')}`);

// ── Итог ──────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  log.info(
    `сайт в порядке: ${data.libraries.length} библиотек, ${preRendered} строк в статической разметке, ` +
      `локалей ${LOCALES.length}, страниц ${htmlFiles.length} (из них срезов «язык × роль» ${actualSlices.size}), ` +
      'сортировка/карточка/поиск из поисковика/SEO-разметка/локализация/подборка проверены',
  );
  process.exit(0);
}
log.error(`проблем: ${failures.length}`);
process.exit(1);
