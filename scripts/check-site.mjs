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

/** Поднимает app.js в чистом окружении и возвращает доступ к DOM-заглушкам. */
function boot({ view = {}, referrer = '', search = '' } = {}) {
  const ids = ['search', 'f-role', 'f-language', 'f-provider', 'f-kind', 'f-status', 'f-tier', 'count', 'rows', 'drawer', 'backdrop', 'reset', 'generated', 'hint'];
  const elements = new Map(ids.map((id) => [id, createElement()]));

  const sortHeaders = ['name', 'language', 'popular', 'updated'].map((sort) => {
    const th = createElement('th');
    th.dataset.sort = sort;
    return th;
  });

  const handlers = new Map();
  const documentStub = {
    activeElement: null,
    referrer,
    querySelector: (selector) => elements.get(selector.replace('#', '')) ?? null,
    querySelectorAll: (selector) => (selector.includes('data-sort') ? sortHeaders : []),
    getElementById: (id) => elements.get(id) ?? null,
    addEventListener(type, handler) { handlers.set(type, handler); },
  };

  const context = vm.createContext({
    window: { __LLMDOCS__: data, __LLMDOCS_VIEW__: view },
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
  return { elements, sortHeaders, handlers, error };
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
const periodOf = (name) => data.libraries.find((l) => l.name === name)?.registry?.downloadsPeriod;
if (data.libraries.some((l) => l.ecosystem === 'pypi' && l.registry?.downloads)) {
  assert(periodOf('openai') === 'month', `счётчик PyPI помечен как «${periodOf('openai')}», а не month`);
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
  main.elements.get('count').textContent === `${defaultVisible.length} из ${data.libraries.length}`,
  `в режиме по умолчанию показано ${main.elements.get('count').textContent}, ` +
    `ожидалось ${defaultVisible.length} из ${data.libraries.length} (роль sdk+gateway)`,
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

main.elements.get('f-provider').value = data.providers[0].id;
main.elements.get('f-provider').dispatch('input');
const filteredCount = main.elements.get('count').textContent;
assert(
  !filteredCount.startsWith(`${data.libraries.length} из`),
  `фильтр по провайдеру «${data.providers[0].id}» не изменил выборку (${filteredCount})`,
);
main.elements.get('reset').dispatch('click');
assert(main.elements.get('rows').innerHTML.length > 0, 'после сброса фильтров список пуст');

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
  allRoles.elements.get('count').textContent === `${data.libraries.length} из ${data.libraries.length}`,
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
for (const [file, expected] of [
  ['providers/openai.html', 'OpenAI'],
  ['languages/r.html', 'R'],
  ['providers.html', 'провайдерам'],
  ['languages.html', 'языкам'],
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

// Служебные файлы для поисковиков.
for (const [file, pattern] of [
  ['robots.txt', /Sitemap: https?:\/\/\S+\/sitemap\.xml/],
  ['sitemap.xml', /<urlset[\s\S]*<url><loc>https?:\/\/[^<]*index\.html<\/loc>/],
  ['llms.txt', /## Провайдеры/],
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

// ── Итог ──────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  log.info(
    `сайт в порядке: ${data.libraries.length} библиотек, ${preRendered} строк в статической разметке, ` +
      'сортировка/карточка/поиск из поисковика/SEO-разметка проверены',
  );
  process.exit(0);
}
log.error(`проблем: ${failures.length}`);
process.exit(1);
