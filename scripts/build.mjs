#!/usr/bin/env node
/**
 * Генерация статического сайта каталога в dist/.
 *
 * Что важно для SEO:
 *  - строки таблицы рендерятся на этапе сборки, а не только в браузере,
 *    иначе поисковик видит пустую страницу;
 *  - у каждой страницы свои title, description, canonical и JSON-LD;
 *  - есть оглавления providers.html и languages.html, sitemap.xml и robots.txt;
 *  - страница языка или провайдера доступна по человекочитаемому адресу.
 *
 * Домен берётся из SITE_URL (по умолчанию — https://<owner>.github.io/<repo>).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from './lib/log.mjs';
import { readConfig, readDataset, DIST_DIR, ROOT } from './lib/store.mjs';
import { toCsv, toDictionary, toJson } from './lib/dataset.mjs';
import { slugify } from './lib/site-helpers.mjs';
import { ROLES, ROLE_SLUGS, CALLS_PROVIDER_API } from './lib/record.mjs';
import { LOCALES, DEFAULT_LOCALE, LOCALE_DIR, counted, localeStrings, t } from './lib/i18n.mjs';
import { popularity as sharedPopularity } from './lib/popularity.mjs';

const log = createLogger('build');

const PRE_RENDER_LIMIT = 150; // строк в статической разметке (дальше — только JSON)

// Порог для страницы «язык × роль»: меньше трёх записей — тонкий контент.
const ROLE_SLICE_MIN = 3;

// Порядок подбора в «с чего начать», если официальных SDK в языке меньше,
// чем нужно: SDK → фреймворк → рантайм → шлюз.
// Сколько языков показывать в ряду тегов.
const TAG_LIMIT = 10;

// Порядок подбора в «с чего начать».
const PICK_ROLE_ORDER = ['sdk', 'framework', 'runtime', 'gateway'];

// Сколько записей перечислять в секции подборки на странице языка.
const COLLECTION_SECTION_LIMIT = 8;

/**
 * Роли по умолчанию зависят от типа страницы:
 *  - главная и страница провайдера — только клиенты API и шлюзы (то, что
 *    действительно отправляет запросы провайдеру);
 *  - срез языка и оглавления — все роли: человек пришёл за списком именно
 *    для этого языка, и про рантаймы с фреймворками он знает.
 */
const DEFAULT_ROLES = {
  catalog: ['sdk', 'gateway'],
  provider: ['sdk', 'gateway'],
  language: ['sdk', 'framework', 'runtime', 'gateway', 'support'],
  hub: ['sdk', 'framework', 'runtime', 'gateway', 'support'],
};

const ALL_ROLES = DEFAULT_ROLES.language;

/** Пояснения к ролям лежат в словаре локализации: ключи roleDesc.<роль>. */

const siteUrl =
  process.env.SITE_URL ??
  `https://${process.env.GITHUB_REPOSITORY_OWNER ?? 'example'}.github.io/${
    process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : 'openllmdocs'
  }`;

const dataset = await readDataset();
if (!dataset.libraries?.length) {
  log.error('Датасет пуст — сначала выполните node scripts/collect.mjs');
  process.exit(1);
}

const providersConfig = await readConfig('providers.json');
// nameEn обязателен в этом списке: без него providerName() всегда возвращает
// русское имя, потому что условие по nameEn молча ложно. Именно так «OpenAI-совместимые
// API» снова оказались в английских страницах, хотя правка в конфиге была.
const providerList = providersConfig.providers.map(({ id, name, nameEn, category, docs, baseUrl, envVars, models, notes }) => ({
  id, name, nameEn, category, docs, baseUrl, envVars, models, notes,
}));
const providerMap = new Map(providerList.map((p) => [p.id, p]));

const libraries = dataset.libraries.map((library) => ({
  ...library,
  providers: (library.providers ?? []).map((id) => providerMap.get(id)?.id ?? id),
}));

/**
 * Имя провайдера под текущую локаль.
 *
 * Имена лежат в конфиге, и одно из них — «OpenAI-совместимые API» — попадало
 * русским текстом в английские страницы: и в чипы строк, и во вступление
 * подборки, и в метаданные. Поэтому у провайдера может быть nameEn, а выбор
 * делается по локали страницы.
 */
function providerName(locale, id) {
  const provider = providerMap.get(id);
  if (!provider) return id;
  if (locale === DEFAULT_LOCALE && provider.nameEn) return provider.nameEn;
  return provider.name;
}

const date = String(dataset.generatedAt).slice(0, 10);
const languageCounts = countBy(libraries, (l) => l.language);
const providerCounts = countBy(libraries, (l) => l.providers[0] ?? '—');
const languages = [...languageCounts.entries()].sort((a, b) => b[1] - a[1]);
const usedProviders = providerList.filter((p) => libraries.some((l) => l.providers.includes(p.id)));
const roleCounts = countBy(libraries, (l) => l.role);
// Подписи ролей и их пояснения живут в словаре локализации (role.<роль>,
// roleDesc.<роль>), поэтому здесь только идентификаторы и счётчики.
const roleList = Object.keys(ROLES)
  .map((id) => ({ id, count: roleCounts.get(id) ?? 0 }))
  .filter((role) => role.count > 0);

await fs.rm(DIST_DIR, { recursive: true, force: true });
await fs.mkdir(path.join(DIST_DIR, 'assets'), { recursive: true });

// ── Данные и ассеты ───────────────────────────────────────────────────────
//
// Ассеты и данные копируются в каждое дерево локали: и dist/, и dist/ru/.
// Благодаря этому префиксы в разметке относительны «внутри дерева» (../),
// а не от корня сайта, и каждую папку можно скачать и открыть отдельно.
//
// Содержимое этих файлов от локали не зависит, поэтому оно готовится один раз:
// датасет весит меньше мегабайта, и сериализовать его дважды — значило бы
// потратить строку в 700 КБ впустую и держать в памяти две копии.
const dataScript = `window.__LLMDOCS__ = ${JSON.stringify({ generatedAt: dataset.generatedAt, providers: providerList, roles: roleList, libraries })};\n`;
// JSON публикуется без отступов: файл машинный, его читает парсер, а отступы
// стоили 250 КБ на дерево. Словарь рядом нужен human-readable, но не JSON.
const datasetJson = toJson(dataset);
const csv = toCsv(libraries);

for (const locale of LOCALES) {
  const tree = LOCALE_DIR[locale] ? path.join(DIST_DIR, LOCALE_DIR[locale].replace(/^\//, '')) : DIST_DIR;
  await fs.mkdir(path.join(tree, 'assets'), { recursive: true });
  await write(path.join(tree, 'assets', 'data.js'), dataScript);
  // Словарь одинаков для всех страниц дерева, поэтому лежит один файл, а не
  // повторяется в каждой странице: 12 КБ × 84 страницы были чистым повтором.
  await write(path.join(tree, 'assets', 'i18n.js'), `window.__LLMDOCS_I18N__ = ${JSON.stringify(localeStrings(locale))};
`);
  // Публичный датасет: три файла. Один JSON без словаря полей бесполезен
  // постороннему — что означает tier и откуда взялся licenseId, не написано
  // нигде. CSV нужен тем, кто хочет открыть каталог в таблице, а словарь
  // собирается из самих записей, поэтому новое поле попадает в него само.
  await write(path.join(tree, 'data', 'libraries.json'), datasetJson);
  await write(path.join(tree, 'data', 'libraries.csv'), csv);
  await write(
    path.join(tree, 'data', 'README.md'),
    toDictionary(libraries, { generatedAt: dataset.generatedAt, siteUrl, locale }),
  );
  await copy(path.join(ROOT, 'site', 'app.js'), path.join(tree, 'assets', 'app.js'));
  await copy(path.join(ROOT, 'site', 'style.css'), path.join(tree, 'assets', 'style.css'));
}

const template = await fs.readFile(path.join(ROOT, 'site', 'index.html'), 'utf8');

// ── Страницы ──────────────────────────────────────────────────────────────
//
// Страница описывается один раз, тексты берутся из словаря под нужную локаль.
// Английский вариант лежит по чистому адресу (это x-default для поисковиков),
// русский — по префиксу /ru/; обе версии отдаются целиком и связаны hreflang.
const pages = [];

for (const locale of LOCALES) {
  const dir = LOCALE_DIR[locale];
  const treeRoot = `${dir}/`.replace(/^\/+/, '');
  // Путь внутри dist: у русского дерева это dist/ru/…
  const inTree = (relative) => (dir ? path.join(dir.replace(/^\//, ''), relative) : relative);
  // Настоящий адрес страницы на сайте (без префикса сайта), нужен для hreflang.
  // С индексной страницей адрес оставляем как /index.html: так canonical,
  // hreflang и sitemap.xml сходятся, и при смене хостинга ничего не ломается.
  const urlPath = (relative) => `${treeRoot}${relative}`;
  // Префикс относительных ссылок ВНУТРИ дерева локали: ассеты и соседние
  // страницы лежат рядом, поэтому от глубины зависит только число ../.
  const up = (depth) => '../'.repeat(depth);

  pages.push(
    {
      locale,
      file: inTree('index.html'),
      root: up(0),
      urlPath: urlPath('index.html'),
      view: { role: 'api' },
      roles: DEFAULT_ROLES.catalog,
      // Число языков и список языков берутся из данных: зашитое перечисление
      // разошлось с каталогом и называло JavaScript, Dart и Zig, для которых
      // нет ни одной записи.
      title: t(locale, 'page.index.title', { languages: languageCounts.size }),
      description: t(locale, 'page.index.description', { total: libraries.length }),
      heading: t(locale, 'page.index.heading'),
      // Подзаголовка на главной нет: он пересказывал то, что уже видно
      // в счётчиках над таблицей и в чипах ролей.
      subheading: '',
      keywords: t(locale, 'page.index.keywords'),
      filter: () => libraries,
    },
    {
      locale,
      file: inTree('providers.html'),
      root: up(0),
      urlPath: urlPath('providers.html'),
      view: { role: 'all' },
      roles: DEFAULT_ROLES.hub,
      title: t(locale, 'page.providers.title'),
      description: t(locale, 'page.providers.description'),
      heading: t(locale, 'page.providers.heading'),
      subheading: t(locale, 'page.providers.subheading'),
      keywords: t(locale, 'page.providers.keywords'),
      filter: () => libraries,
      hub: 'providers',
    },
    {
      locale,
      file: inTree('languages.html'),
      root: up(0),
      urlPath: urlPath('languages.html'),
      view: { role: 'all' },
      roles: DEFAULT_ROLES.hub,
      title: t(locale, 'page.languages.title'),
      description: t(locale, 'page.languages.description', { top: topLanguages(libraries).join(', ') }),
      heading: t(locale, 'page.languages.heading'),
      subheading: t(locale, 'page.languages.subheading'),
      keywords: t(locale, 'page.languages.keywords'),
      filter: () => libraries,
      hub: 'languages',
    },
    ...usedProviders.map((provider) => {
      const subset = libraries.filter((l) => l.providers.includes(provider.id));
      const slug = `providers/${slugify(provider.id)}.html`;
      return {
        locale,
        file: inTree(path.join('providers', `${slugify(provider.id)}.html`)),
        root: up(1),
        urlPath: urlPath(slug),
        view: { provider: provider.id, role: 'api' },
        roles: DEFAULT_ROLES.provider,
        title: t(locale, 'page.provider.title', { name: providerName(locale, provider.id), count: subset.length }),
        description: t(locale, 'page.provider.description', {
          name: providerName(locale, provider.id),
          count: subset.length,
          top: topLanguages(subset).join(', '),
        }),
        heading: t(locale, 'page.provider.heading', { name: providerName(locale, provider.id) }),
        subheading: providerSummary(locale, provider, subset),
        keywords: t(locale, 'page.provider.keywords', { name: providerName(locale, provider.id), id: provider.id }),
        filter: () => subset,
        subject: provider,
      };
    }),
    ...languages.map(([language, count]) => {
      const subset = libraries.filter((l) => l.language === language);
      const slug = `languages/${slugify(language)}.html`;
      return {
        locale,
        file: inTree(path.join('languages', `${slugify(language)}.html`)),
        root: up(1),
        urlPath: urlPath(slug),
        view: { language, role: 'all' },
        roles: DEFAULT_ROLES.language,
        title: t(locale, 'page.language.title', { language, count }),
        description: t(locale, 'page.language.description', {
          language,
          // counted(): в русском «1 библиотека», «2 библиотеки», «5 библиотек»,
          // а подстановка %{count} рядом со словом давала «1 библиотек».
          count: counted(locale, subset.length, t(locale, 'stats.libraries')),
          top: topPackages(subset).join(', '),
        }),
        heading: t(locale, 'page.language.heading', { language }),
        subheading: t(locale, 'page.language.subheading', {
          count: counted(locale, subset.length, t(locale, 'stats.entries')),
        }),
        keywords: t(locale, 'page.language.keywords', { language }),
        filter: () => subset,
        subject: { name: language, kind: 'language' },
      };
    }),
    // Страницы «язык × роль». Это то, ради чего затевалась подборка: срез
    // «официальные клиенты API на Go» или «шлюзы на TypeScript» отвечает на
    // конкретный запрос, но раньше был доступен только кликом по фильтру,
    // то есть для поисковика не существовал. Срез с 1-2 записями страницей
    // не становится: это тонкий контент без пользы.
    ...roleSlices(libraries).map(({ language, role, subset }) => {
      const roleSlug = ROLE_SLUGS[role];
      const slug = `languages/${slugify(language)}/${roleSlug}.html`;
      const roleLabel = t(locale, `role.${role}`);
      return {
        locale,
        file: inTree(path.join('languages', slugify(language), `${roleSlug}.html`)),
        root: up(2),
        urlPath: urlPath(slug),
        view: { language, role },
        roles: [role],
        title: t(locale, 'page.role.title', { role: roleLabel, language, count: subset.length }),
        description: t(locale, 'page.role.description', {
          role: roleLabel,
          roleLower: roleLabel.toLowerCase(),
          language,
          count: subset.length,
          top: topPackages(subset).join(', '),
        }),
        heading: t(locale, 'page.role.heading', { role: roleLabel, language }),
        subheading: t(locale, 'page.role.subheading', {
          count: subset.length,
          description: t(locale, `roleDesc.${role}`),
        }),
        keywords: t(locale, 'page.role.keywords', {
          language,
          roleSlug: roleSlug.replace(/-/g, ' '),
          roleLower: roleLabel.toLowerCase(),
        }),
        filter: () => subset,
        subject: { name: language, kind: 'language', role },
      };
    }),
  );
}

function roleSlices(allLibraries) {
  const byLanguage = new Map();
  for (const library of allLibraries) {
    if (!library.language) continue;
    if (!byLanguage.has(library.language)) byLanguage.set(library.language, new Map());
    const roles = byLanguage.get(library.language);
    if (!roles.has(library.role)) roles.set(library.role, []);
    roles.get(library.role).push(library);
  }
  const slices = [];
  for (const [language, roles] of byLanguage) {
    for (const [role, subset] of roles) {
      if (subset.length >= ROLE_SLICE_MIN && ROLE_SLUGS[role]) slices.push({ language, role, subset });
    }
  }
  // Порядок стабильный: язык, затем порядок ролей в ROLES.
  const order = Object.keys(ROLES);
  return slices.sort(
    (a, b) => a.language.localeCompare(b.language) || order.indexOf(a.role) - order.indexOf(b.role),
  );
}

/** Адрес той же страницы на другом языке: меняется только префикс /ru. */
function alternatePath(locale, urlPath) {
  const clean = urlPath.replace(/^\/?ru\//, '');
  return locale === DEFAULT_LOCALE ? clean : `ru/${clean}`;
}

for (const page of pages) {
  const subset = page.filter();
  const html = render(template, {
    ...page,
    subset,
    file: page.file,
    root: page.root,
    roles: page.roles ?? DEFAULT_ROLES.catalog,
    total: subset.length,
    languages: new Set(subset.map((l) => l.language)).size,
    providers: new Set(subset.flatMap((l) => l.providers)).size,
  });
  await write(path.join(DIST_DIR, page.file), html);
}

// ── Служебные файлы ───────────────────────────────────────────────────────
// llms.txt — указатель для ИИ-агентов: по языку, чтобы агент мог прочитать
// нужную версию, не разбирая весь каталог.
for (const locale of LOCALES) {
  const inTree = LOCALE_DIR[locale] ? path.join(LOCALE_DIR[locale].replace(/^\//, ''), 'llms.txt') : 'llms.txt';
  await write(path.join(DIST_DIR, inTree), buildLlmsTxt(locale, libraries, usedProviders));
}
await write(path.join(DIST_DIR, 'sitemap.xml'), buildSitemap(pages));
await write(
  path.join(DIST_DIR, 'robots.txt'),
  [`User-agent: *`, `Allow: /`, `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n'),
);
await write(
  path.join(DIST_DIR, 'README.md'),
  [
    '# Каталог LLM-библиотек (сгенерированная папка)',
    '',
    `Собрано: ${dataset.generatedAt}`,
    '',
    'Структура:',
    '- `index.html` — каталог с поиском и фильтрами (открывается двойным кликом)',
    '- `providers.html`, `languages.html` — оглавления',
    '- `providers/<id>.html`, `languages/<lang>.html` — срезы с готовой разметкой для поисковиков',
    '- `languages/<lang>/<role>.html` — срезы «язык × роль», например `python/api-clients.html`',
    '- `assets/data.js` — данные, встроенные в страницу (для работы с `file://`)',
    '- `data/libraries.json` — полный датасет в JSON',
    '- `data/libraries.csv` — тот же датасет плоскими колонками, для таблицы',
    '- `data/README.md` — словарь полей: что означает каждое и у скольких записей заполнено',
    '- `llms.txt` — краткий указатель для ИИ-агентов',
    '- `sitemap.xml`, `robots.txt` — для поисковых систем',
    '',
    'Локализация: английский лежит в корне, русский — в `ru/`. Каждое дерево',
    'самодостаточно: ассеты и `data/libraries.json` лежат рядом, ссылки внутри',
    'дерева относительные, поэтому папку можно скачать и открыть отдельно.',
    '',
    'Пересобрать: `npm run refresh`',
    '',
  ].join('\n'),
);

log.info(`сайт собран: ${pages.length} страниц, ${libraries.length} библиотек → ${path.relative(ROOT, DIST_DIR)}/`);
log.info(`адрес сайта: ${siteUrl}`);
for (const [language, count] of languages) log.info(`  ${language.padEnd(14)} ${String(count).padStart(4)}`);

// ── Рендер страницы ───────────────────────────────────────────────────────

/** Роли, которые попадают в статическую разметку и в JSON-LD по умолчанию. */
function render(tpl, { locale, root, urlPath, view, title, description, heading, subheading, keywords, subset, file, roles, total }) {
  const prefix = root ? `${root.replace(/\/+$/, '')}/` : '';
  // Канонический адрес — от корня сайта, без ../ от текущей страницы.
  const canonical = `${siteUrl}/${urlPath}`;
  const visible = subset.filter((library) => roles.includes(library.role));
  const hidden = subset.length - visible.length;
  const sorted = sortForSeo(visible.length ? visible : subset);
  const shown = sorted.slice(0, PRE_RENDER_LIMIT);

  return tpl
    .replaceAll('{{LANG}}', locale)
    .replaceAll('{{ALTERNATES}}', alternatesHtml(locale, urlPath))
    .replaceAll('{{SWITCHER}}', switcherHtml(locale, urlPath, prefix))
    .replaceAll(/\{\{ROOT\}\}/g, prefix)
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(description))
    .replaceAll('{{KEYWORDS}}', escapeHtml(keywords))
    .replaceAll('{{CANONICAL}}', escapeHtml(canonical))
    .replaceAll('{{JSONLD}}', jsonLd({ locale, view, title, description, canonical, urlPath, subset: visible, heading }))
    .replaceAll('{{HEADING}}', escapeHtml(heading))
    .replaceAll('{{SUBHEADING}}', escapeHtml(subheading ?? ''))
    .replaceAll('{{VIEW}}', JSON.stringify(view))
    .replaceAll('{{TOTAL}}', String(visible.length || total))
    .replaceAll('{{LANGUAGES}}', String(new Set(visible.map((l) => l.language)).size))
    .replaceAll('{{PROVIDERS}}', String(new Set(visible.flatMap((l) => l.providers)).size))
    .replaceAll('{{CAPTION}}', escapeHtml(heading))
    .replaceAll('{{SEO_HEADING}}', escapeHtml(seoHeading(locale, view)))
    .replaceAll('{{SEO_TEXT}}', escapeHtml(seoText(locale, view, visible, hidden, roles)))
    .replaceAll('{{SEO_LINKS}}', seoLinks(sorted, prefix, view))
    .replaceAll('{{COLLECTION}}', collectionHtml(locale, view, visible))
    .replaceAll('{{CRUMBS}}', crumbsHtml(locale, view, prefix))
    .replaceAll('{{TAGS}}', tagBarHtml(locale, view, prefix))
    .replaceAll('{{RELATED}}', relatedHtml(locale, view, prefix))
    .replaceAll('{{ROWS}}', shown.map((library) => rowHtml(library, locale)).join('\n'))
    // Служебные подстановки: часть строк содержит свою разметку (<b>, <code>),
    // поэтому подставляется как есть — все они из словаря, не из данных.
    .replaceAll('{{SITE_NAME}}', escapeHtml(t(locale, 'site.name')))
    .replaceAll('{{STATS_LIBRARIES}}', escapeHtml(t(locale, 'stats.libraries')))
    .replaceAll('{{STATS_LANGUAGES}}', escapeHtml(t(locale, 'stats.languages')))
    .replaceAll('{{STATS_PROVIDERS}}', escapeHtml(t(locale, 'stats.providers')))
    .replaceAll('{{STATS_UPDATED}}', escapeHtml(t(locale, 'stats.updated')))
    .replaceAll('{{NAV_SECTIONS}}', escapeHtml(t(locale, 'nav.sections')))
    .replaceAll('{{NAV_ALL}}', escapeHtml(t(locale, 'nav.all')))
    .replaceAll('{{NAV_PROVIDERS}}', escapeHtml(t(locale, 'nav.providers')))
    .replaceAll('{{NAV_LANGUAGES}}', escapeHtml(t(locale, 'nav.languages')))
    .replaceAll('{{SEARCH}}', escapeHtml(t(locale, 'filters.search')))
    .replaceAll('{{FILTER_ROLE}}', escapeHtml(t(locale, 'filters.role')))
    .replaceAll('{{FILTER_LANGUAGE}}', escapeHtml(t(locale, 'filters.language')))
    .replaceAll('{{FILTER_PROVIDER}}', escapeHtml(t(locale, 'filters.provider')))
    .replaceAll('{{FILTER_KIND}}', escapeHtml(t(locale, 'filters.kind')))
    .replaceAll('{{FILTER_STATUS}}', escapeHtml(t(locale, 'filters.status')))
    .replaceAll('{{FILTER_TIER}}', escapeHtml(t(locale, 'filters.tier')))
    .replaceAll('{{FILTER_LICENSE}}', escapeHtml(t(locale, 'filters.license')))
    .replaceAll('{{FILTER_RESET}}', escapeHtml(t(locale, 'filters.reset')))
    .replaceAll('{{FILTER_COUNT}}', escapeHtml(t(locale, 'filters.count')))
    .replaceAll('{{SKIP_LINK}}', escapeHtml(t(locale, 'skip.link')))
    .replaceAll('{{THEME_TOGGLE}}', escapeHtml(t(locale, 'theme.toggle')))
    .replaceAll('{{LEGEND_TITLE}}', escapeHtml(t(locale, 'legend.more')))
    .replaceAll('{{LEGEND_SDK_TEXT}}', escapeHtml(t(locale, 'legend.sdk')))
    .replaceAll('{{LEGEND_SDK}}', escapeHtml(t(locale, 'role.api')))
    .replaceAll('{{LEGEND_GATEWAY}}', escapeHtml(t(locale, 'role.gateway')))
    .replaceAll('{{LEGEND_GATEWAY_TEXT}}', escapeHtml(t(locale, 'legend.gateway')))
    .replaceAll('{{LEGEND_FRAMEWORK}}', escapeHtml(t(locale, 'role.framework')))
    .replaceAll('{{LEGEND_FRAMEWORK_TEXT}}', escapeHtml(t(locale, 'legend.framework')))
    .replaceAll('{{LEGEND_RUNTIME}}', escapeHtml(t(locale, 'role.runtime')))
    .replaceAll('{{LEGEND_RUNTIME_TEXT}}', t(locale, 'legend.runtime'))
    .replaceAll('{{LEGEND_SUPPORT}}', escapeHtml(t(locale, 'role.support')))
    .replaceAll('{{LEGEND_SUPPORT_TEXT}}', escapeHtml(t(locale, 'legend.support')))
    .replaceAll('{{LEGEND_POPULARITY}}', t(locale, 'legend.popularity'))
    .replaceAll('{{FOOTER_NOSCRIPT}}', t(locale, 'footer.noscript').replaceAll('{{ROOT}}', prefix))
    .replaceAll('{{FOOTER_BUILD}}', escapeHtml(t(locale, 'footer.build')))
    .replaceAll('{{FOOTER_MACHINE}}', escapeHtml(t(locale, 'footer.machine')))
    .replaceAll('{{FOOTER_SCHEMA}}', escapeHtml(t(locale, 'footer.schema')))
    .replaceAll('{{FOOTER_AGENTS}}', escapeHtml(t(locale, 'footer.agents')))
    .replaceAll('{{FOOTER_KEYS}}', t(locale, 'footer.keys'))
    .replaceAll('{{TH_LIBRARY}}', escapeHtml(t(locale, 'th.library')))
    .replaceAll('{{TH_LANGUAGE}}', escapeHtml(t(locale, 'th.language')))
    .replaceAll('{{TH_PROVIDERS}}', escapeHtml(t(locale, 'th.providers')))
    .replaceAll('{{TH_ROLE}}', escapeHtml(t(locale, 'th.role')))
    .replaceAll('{{TH_LICENSE}}', escapeHtml(t(locale, 'th.license')))
    .replaceAll('{{TH_LICENSE_TITLE}}', escapeHtml(t(locale, 'th.licenseTitle')))
    .replaceAll('{{TH_STARS}}', escapeHtml(t(locale, 'th.stars')))
    .replaceAll('{{TH_STARS_TITLE}}', escapeHtml(t(locale, 'th.starsTitle')))
    .replaceAll('{{TH_DOWNLOADS}}', escapeHtml(t(locale, 'th.downloads')))
    .replaceAll('{{TH_DOWNLOADS_TITLE}}', escapeHtml(t(locale, 'th.downloadsTitle')))
    .replaceAll('{{TH_RELEASE}}', escapeHtml(t(locale, 'th.release')))
    .replaceAll('{{TH_RELEASE_TITLE}}', escapeHtml(t(locale, 'th.releaseTitle')));
}

/**
 * hreflang: у каждой страницы ссылка на все локали и на версию по умолчанию.
 * Английский — x-default: это язык, который показывают, когда язык системы не
 * распознан, и на него указывают поисковики при отсутствии предпочтений.
 */
function alternatesHtml(locale, urlPath) {
  const links = LOCALES.map(
    (other) => `<link rel="alternate" hreflang="${other}" href="${escapeHtml(`${siteUrl}/${alternatePath(other, urlPath)}`)}">`,
  );
  links.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${siteUrl}/${alternatePath(DEFAULT_LOCALE, urlPath)}`)}">`,
  );
  return links.join('\n');
}

/**
/**
 * Роль среза, если страница посвящена одной роли. У страницы языка в view.role
 * стоит группа 'all' — это «все роли», а не роль, поэтому их надо различать.
 */
function singleRole(view) {
  return view.language && view.role && view.role !== 'all' ? view.role : null;
}

/**
 * Переключатель языка — обычная ссылка, работает и без JavaScript.
 * Адрес собирается из префикса страницы (сколько уровней вверх до корня)
 * и пути на другой локали: иначе на вложенной странице вроде
 * providers/openai.html ссылка ушла бы в providers/ru/… и не открылась.
 */
function switcherHtml(locale, urlPath, prefix) {
  const other = locale === DEFAULT_LOCALE ? 'ru' : DEFAULT_LOCALE;
  const label = t(locale, other === 'ru' ? 'nav.switchToRu' : 'nav.switchToEn');
  const href = `${prefix}${alternatePath(other, urlPath)}`;
  return `<a class="lang-switch" href="${escapeHtml(href)}" hreflang="${other}" lang="${other}" data-locale-link="${other}" title="${escapeHtml(t(locale, 'nav.languageSwitcher'))}">${escapeHtml(label)}</a>`;
}

/** Статическая разметка строки таблицы: тот же вид, что рисует app.js. */
function rowHtml(library, locale = DEFAULT_LOCALE) {
  const providerChips = (library.providers ?? [])
    .slice(0, 3)
    .map((id) => `<span class="chip p">${escapeHtml(providerName(locale, id))}</span>`)
    .join('');

  const l = (key) => escapeHtml(t(locale, key));
  return `<tr data-id="${escapeHtml(library.id)}" id="${escapeHtml(library.id)}">
        <td class="cell-name">
          <button type="button" class="pkg-open" aria-expanded="false" aria-haspopup="dialog"><span class="pkg">${escapeHtml(library.name)} <span class="eco">· ${escapeHtml(library.ecosystem)}</span></span></button>
          ${library.description ? `<div class="desc">${escapeHtml(library.description)}</div>` : ''}
        </td>
        <td data-label="${l('th.language')}">${escapeHtml(library.language)}</td>
        <td><div class="chips">${providerChips}${library.tier ? `<span class="chip tier-${escapeHtml(library.tier).toLowerCase()}">${escapeHtml(t(locale, 'chip.tier'))} ${escapeHtml(library.tier)}</span>` : ''}</div></td>
        <td class="cell-meta" data-label="${l('th.role')}"><span class="role role-${escapeHtml(library.role)}" title="${escapeHtml(t(locale, `roleDesc.${library.role}`))}">${escapeHtml(t(locale, `role.${library.role}`))}</span></td>
        <td class="lic cell-meta" data-label="${l('th.license')}">${licenseCell(locale, library)}</td>
        <td class="num cell-meta" data-label="${l('th.stars')}">${library.stars ? compact(library.stars) : '—'}</td>
        <td class="num cell-meta" data-label="${l('th.downloads')}">${escapeHtml(downloadsLabel(locale, library)) || '—'}</td>
        <td class="num cell-meta" data-label="${l('th.release')}">${releaseCell(locale, library)}</td>
      </tr>`;
}

/**
 * Лицензия в строке: SPDX-идентификатор короткий, поэтому показываем его,
 * а семейство и исходное значение реестра — в подсказке. Нормализация —
 * в scripts/lib/license.mjs, без неё «MIT», «MIT License» и «MIT + file LICENSE»
 * были бы тремя разными значениями.
 */
function licenseCell(locale, library) {
  const family = library.licenseFamily ?? 'unknown';
  const label = t(locale, `licenseFamily.${family}`);
  const title = library.license && library.license !== library.licenseId
    ? `${label} · ${t(locale, 'license.registryValue')}: ${library.license}`
    : label;
  return `<span class="lic lic-${escapeHtml(family)}" title="${escapeHtml(title)}">${escapeHtml(library.licenseId ?? '—')}</span>`;
}

function sortForSeo(subset) {
  return [...subset].sort(
    (a, b) => popularity(b) - popularity(a) || String(a.name).localeCompare(String(b.name)),
  );
}

/** Дата последнего релиза: реестр → релиз на GitHub → последний коммит. */
function releaseCell(locale, library) {
  if (!library.latestRelease) return '—';
  const source = library.latestReleaseSource
    ? t(locale, `releaseSource.${library.latestReleaseSource}`)
    : '';
  return `<span title="${escapeHtml(source)}">${escapeHtml(library.latestRelease)}</span>`;
}

/** Популярность — логарифмическая, с учётом периода счётчика. Формула в lib/popularity.mjs. */
function popularity(library) {
  return sharedPopularity(library);
}

/** Счётчик загрузок: подпись зависит от того, что он измеряет. */
function downloadsLabel(locale, library) {
  const downloads = num(library.registry?.downloads);
  if (!downloads) return '';
  const period = library.registry?.downloadsPeriod;
  const suffix = period && period !== 'none' ? t(locale, `downloads.${period}`) : '';
  return `${compact(downloads)}${suffix}`;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compact(value) {
  const parsed = num(value);
  if (parsed >= 1e9) return `${(parsed / 1e9).toFixed(1)}B`;
  if (parsed >= 1e6) return `${(parsed / 1e6).toFixed(1)}M`;
  if (parsed >= 1e3) return `${(parsed / 1e3).toFixed(1)}k`;
  return String(parsed);
}

// ── Подборка для страницы языка ────────────────────────────────────────────
//
// Смысл в том, чтобы страница отвечала на вопрос «что взять под мою задачу»,
// а не просто выдавала таблицу. Текст собирается только из полей записи:
// роль, вид, звёзды, дата релиза, возможности, наличие OpenAI-совместимого

/**
 * Одна строка «почему эта запись» — только факты из записи.
 * `short` убирает перечень возможностей: в блоке «с чего начать» он лишний,
 * там важны официальность, провайдер, звёзды и свежесть.
 */
function pickFacts(locale, library, { short = false } = {}) {
  const parts = [];
  // Роль в факты не берём: в русском «официальный клиенты API» читается
  // неграмотно, а роль и так видна в секции и в колонке таблицы.
  const kind = library.kind === 'official-sdk' ? t(locale, 'collection.official') : t(locale, 'collection.community');
  parts.push(escapeHtml(kind));
  if (library.providers?.length) {
    parts.push(
      escapeHtml(
        library.providers.slice(0, 3).map((id) => providerName(locale, id)).join(', '),
      ),
    );
  }
  const date = library.latestRelease ? t(locale, 'collection.facts')
    .replace('%{stars}', library.stars ? compact(library.stars) : '—')
    .replace('%{date}', library.latestRelease)
    : (library.stars ? `★ ${compact(library.stars)}` : '');
  if (date) parts.push(escapeHtml(date));
  if (library.openaiCompatibleServer) parts.push(escapeHtml(t(locale, 'collection.compatibleServer')));
  if (!short) {
    const features = (library.features ?? []).slice(0, 3).join(', ');
    if (features) parts.push(escapeHtml(t(locale, 'collection.features').replace('%{features}', features)));
  }
  return parts.filter(Boolean).join(' · ');
}

function pickLink(library) {
  return library.repo ?? library.registry?.url ?? library.homepage ?? '#';
}

/** «С чего начать»: официальные SDK и по одному самому популярному на провайдера. */
/**
 * «С чего начать»: сначала официальные SDK, по одному на провайдера.
 *
 * Две тонкости, которые стоили неправильного списка:
 *  - дедупликация по первому провайдеру, а не по всем. boto3 вызывает
 *    Anthropic, Mistral и Bedrock и занимал их слоты, из-за чего
 *    настоящие anthropic и mistralai в список не попадали;
 *  - в запасном проходе пропускаем сопутствующие инструменты: «с чего
 *    начать» — это не токенизатор, а SDK, фреймворк или рантайм.
 */

function starterPicks(locale, subset, limit = 5) {
  const sorted = sortForSeo(subset);
  const picked = [];
  const seen = new Set();
  const primary = (library) => (library.providers ?? [])[0];

  for (const library of sorted) {
    if (picked.length >= limit) break;
    if (library.kind !== 'official-sdk') continue;
    if (seen.has(primary(library))) continue;
    picked.push(library);
    seen.add(primary(library));
  }

  if (picked.length < limit) {
    // Порог: сто звёзд. У записи с восемью звёздами и 22 тысячами загрузок
    // ответ на вопрос «с чего начать» — тот же, что у трёхсотзвёздного
    // проекта, нет. Исключение — официальные SDK: их берёт первый проход,
    // где порога нет, потому что у нишевых провайдеров звёзд мало, а SDK
    // всё равно верный ответ.
    const notable = (library) => (library.stars ?? 0) >= 100;
    for (const role of PICK_ROLE_ORDER) {
      for (const library of sorted) {
        if (picked.length >= limit) break;
        if (picked.includes(library) || library.role !== role) continue;
        if (!notable(library)) continue;
        // Провайдеры сверяем только среди клиентов API: иначе в списке
        // оказываются пять вариантов одного OpenAI-клиента (async-openai,
        // llm-chain-openai, llm-chain-openai-compatible…). У фреймворков и
        // рантаймов сверки нет: они по определению работают со многими
        // провайдерами, и по первому провайдеру выпадал rig-core (8.7k звёзд).
        if (role === 'sdk' && library.providers?.length && seen.has(primary(library))) continue;
        picked.push(library);
        if (role === 'sdk' && library.providers?.length) seen.add(primary(library));
      }
    }
  }
  // В совсем ничевых языках порог может не оставить ничего — тогда показываем
  // просто популярное, иначе блок останется пустым.
  if (!picked.length) return sorted.slice(0, Math.min(limit, 2));
  return picked;
}

/**
 * Подборка для страницы языка: вводный абзац, «с чего начать» и секции по
 * ролям. Полный список остаётся в таблице с фильтрами — здесь только навигация
 * и пояснения, чтобы страница не дублировала саму себя.
 */
function collectionHtml(locale, view, subset) {
  if (!view.language) return '';
  // На срезе «язык × роль» секция одна: роль уже выбрана, разбивать не на что.
  const roleOrder = singleRole(view) ? [singleRole(view)] : roleList.map((role) => role.id);

  const language = view.language;
  const roleCounts = countBy(subset, (library) => library.role);
  const roles = roleList
    .filter((role) => roleCounts.get(role.id))
    .map((role) => `${t(locale, `role.${role.id}`).toLowerCase()} — ${roleCounts.get(role.id)}`)
    .join(', ');
  const providers = [...countBy(subset.flatMap((library) => library.providers), (id) => id).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => `${providerName(locale, id)} (${count})`)
    .join(', ');

  const picks = starterPicks(locale, subset).map(
    (library) => `        <li><a href="#${escapeHtml(library.id)}"><b>${escapeHtml(library.name)}</b></a> — ${pickFacts(locale, library, { short: true })}</li>`,
  );

  const sections = roleOrder
    .filter((role) => roleCounts.get(role))
    .map((role) => {
      const inRole = sortForSeo(subset.filter((library) => library.role === role));
      const shown = inRole.slice(0, COLLECTION_SECTION_LIMIT);
      const items = shown
        .map((library) => `          <li><a href="#${escapeHtml(library.id)}">${escapeHtml(library.name)}</a> — ${pickFacts(locale, library)}</li>`)
        .join('\n');
      return `      <section class="collection-section" data-role="${escapeHtml(role)}">
        <h3>${escapeHtml(t(locale, 'collection.section', { label: t(locale, `role.${role}`), count: inRole.length }))}</h3>
        <p class="section-hint">${escapeHtml(t(locale, 'collection.sectionHint', { description: t(locale, `roleDesc.${role}`) }))}</p>
        <ul>
${items}
        </ul>
      </section>`;
    })
    .join('\n');

  return `  <section class="collection" data-collection="${escapeHtml(language)}"${view.role ? ` data-collection-role="${escapeHtml(singleRole(view))}"` : ''}>
    <p class="collection-intro">${escapeHtml(t(locale, 'collection.intro', { count: subset.length, language, roles, providers }))}</p>

    <h2>${escapeHtml(t(locale, 'collection.startHere'))}</h2>
    <ul class="picks">
${picks.join('\n')}
    </ul>

${sections}

    <p class="collection-more"><a href="#catalog">${escapeHtml(t(locale, 'collection.tableHint'))} ↓</a></p>
  </section>`;
}

/**
 * Хлебные крошки и перекрёстные ссылки.
 *
 * Страница «язык × роль» существует только если на неё можно прийти из
 * содержимого сайта: из оглавления языков, со страницы языка и с такой же
 * страницы другого языка. Поэтому у среза есть крошка до языка и до каталога,
 * а у страницы языка — список её ролевых срезов.
 */
/** Элементы крошек — общий источник и для разметки, и для JSON-LD. */
function crumbItems(locale, view, prefix) {
  const items = [
    { href: `${prefix}index.html`, label: t(locale, 'nav.all'), url: `${siteUrl}/${alternatePath(locale, 'index.html')}` },
    {
      href: `${prefix}languages.html`,
      label: t(locale, 'nav.languages'),
      url: `${siteUrl}/${alternatePath(locale, 'languages.html')}`,
    },
  ];
  if (view.language) {
    const languageSlug = `${prefix}languages/${slugify(view.language)}.html`;
    const languageUrl = `${siteUrl}/${alternatePath(locale, `languages/${slugify(view.language)}.html`)}`;
    if (singleRole(view)) {
      items.push({ href: languageSlug, label: view.language, url: languageUrl });
      items.push({ href: null, label: t(locale, `role.${singleRole(view)}`), url: canonicalOf(locale, view) });
    } else {
      items.push({ href: null, label: view.language, url: canonicalOf(locale, view) });
    }
  }
  return items;
}

/** Адрес текущей страницы: сайт + путь в дереве локали. */
function canonicalOf(locale, view) {
  const viewPath = singleRole(view)
    ? `languages/${slugify(view.language)}/${ROLE_SLUGS[singleRole(view)]}.html`
    : view.language
      ? `languages/${slugify(view.language)}.html`
      : 'index.html';
  return `${siteUrl}/${alternatePath(locale, viewPath)}`;
}

function crumbsHtml(locale, view, prefix) {
  const items = crumbItems(locale, view, prefix);
  return items
    .map((item, index) =>
      index === items.length - 1
        ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
        : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a><span class="sep">/</span>`,
    )
    .join(' ');
}

/**
 * Ряд тегов с самыми крупными языками под хлебными крошками.
 *
 * Крошки отвечают на вопрос «где я», а теги — на вопрос «куда пойти»: с
 * любой страницы (в том числе со среза по провайдеру) одним кликом — в крупнейшую
 * подборку по языку. Заодно это внутренние ссылки с каждой из 166 страниц на
 * главные разделы, а не только наоборот.
 */
function tagBarHtml(locale, view, prefix) {
  // Текущий язык в ряд попадает всегда, даже если он не в десятке: на странице
  // C++ (одна запись в каталоге) должно быть видно, где вы находитесь.
  const top = [...languages].slice(0, view.language ? TAG_LIMIT - 1 : TAG_LIMIT);
  if (view.language && !top.some(([language]) => language === view.language)) {
    const entry = languages.find(([language]) => language === view.language);
    if (entry) top.push(entry);
  }
  if (!top.length) return '';
  const items = top
    .map(([language, count]) => {
      const active = view.language === language;
      return `<a class="tag${active ? ' active' : ''}" href="${escapeHtml(`${prefix}languages/${slugify(language)}.html`)}"` +
        `${active ? ' aria-current="page"' : ''}>` +
        `${escapeHtml(language)} <span class="tag-count">${count}</span></a>`;
    })
    .join('\n      ');
  return `  <nav class="tags" aria-label="${escapeHtml(t(locale, 'tags.label'))}">
      ${items}
  </nav>`;
}

function relatedHtml(locale, view, prefix) {
  if (!view.language) return '';
  const blocks = [];

  // Та же роль в других языках: показываем самые населённые, иначе блок
  // разрастается на весь каталог.
  const sameRole = roleSlices(libraries)
    .filter((slice) => slice.role === singleRole(view) && slice.language !== view.language)
    .sort((a, b) => b.subset.length - a.subset.length)
    .slice(0, 8);
  if (sameRole.length) {
    const links = sameRole
      .map(
        (slice) =>
          `<li><a href="${escapeHtml(`${prefix}languages/${slugify(slice.language)}/${ROLE_SLUGS[slice.role]}.html`)}">${escapeHtml(slice.language)}</a> <span class="muted">${slice.subset.length}</span></li>`,
      )
      .join('');
    blocks.push(
      `      <div><h3>${escapeHtml(t(locale, 'related.sameRole'))}</h3><ul class="chips-list">${links}</ul></div>`,
    );
  }

  // Другие роли этого же языка.
  const otherRoles = roleSlices(libraries).filter((slice) => slice.language === view.language && slice.role !== singleRole(view));
  if (otherRoles.length) {
    const links = otherRoles
      .map(
        (slice) =>
          `<li><a href="${escapeHtml(`${prefix}languages/${slugify(slice.language)}/${ROLE_SLUGS[slice.role]}.html`)}">${escapeHtml(t(locale, `role.${slice.role}`))}</a> <span class="muted">${slice.subset.length}</span></li>`,
      )
      .join('');
    blocks.push(
      `      <div><h3>${escapeHtml(t(locale, 'related.otherRoles', { language: view.language }))}</h3><ul class="chips-list">${links}</ul></div>`,
    );
  }

  if (!blocks.length) return '';
  return `  <nav class="related" aria-label="${escapeHtml(t(locale, 'nav.sections'))}">\n${blocks.join('\n')}\n  </nav>`;
}

function seoHeading(locale, view) {
  if (view.provider) {
    const name = providerName(locale, view.provider);
    return t(locale, 'seo.topProvider', { provider: name });
  }
  if (singleRole(view)) return t(locale, `role.${singleRole(view)}`);
  if (view.language) return t(locale, 'seo.topLanguage', { language: view.language });
  return t(locale, 'seo.startHere');
}

function seoText(locale, view, subset, hidden, roles) {
  const count = subset.length;
  const hiddenRoles = roleList.filter((role) => !roles.includes(role.id) && role.count);
  const tail = hidden
    ? t(locale, 'seoText.hiddenRoles', {
        hidden,
        roles: hiddenRoles.map((r) => `${t(locale, `role.${r.id}`).toLowerCase()} — ${r.count}`).join(', '),
      })
    : '';

  if (view.provider) {
    const provider = providerMap.get(view.provider);
    const official = subset.filter((l) => l.kind === 'official-sdk').length;
    // «Самые популярные здесь» — из данных этой страницы, а не из чужого
    // совета: раньше здесь стояло «нужен шлюз — LiteLLM», и это печаталось на
    // странице Perplexity, где LiteLLM не имеет отношения к делу.
    const top = subset.slice(0, 3).map((l) => l.name).join(', ');
    return (
      t(locale, 'seoText.provider', { name: providerName(locale, provider.id), count, official, top }) +
      (official ? t(locale, 'seoText.officialSuffix', { official }) : '') +
      tail
    );
  }
  if (singleRole(view)) {
    return t(locale, 'page.role.seoText', {
      role: t(locale, `role.${singleRole(view)}`),
      language: view.language,
      count,
      description: t(locale, `roleDesc.${singleRole(view)}`),
    });
  }
  if (view.language) {
    return (
      t(locale, 'seoText.language', {
        language: view.language,
        count: counted(locale, count, t(locale, 'stats.entries')),
        hidden: hidden ? t(locale, 'seoText.hiddenSuffix') : '',
      }) + tail
    );
  }
  return t(locale, 'seoText.index', { count: hidden ? t(locale, 'stats.of', { shown: count, total: count + hidden }) : count });
}

function seoLinks(sorted, prefix, view) {
  return sorted
    .slice(0, 12)
    .map((library) => {
      const href = library.repo ?? library.registry?.url ?? library.homepage;
      const label = library.repo ? library.name : `${library.name} (${library.ecosystem})`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a> — ${escapeHtml(truncate(library.description ?? '', 110))}</li>`;
    })
    .join('\n      ');
}

function topPackages(subset) {
  return sortForSeo(subset).slice(0, 4).map((l) => l.name);
}

function topLanguages(subset) {
  return [...countBy(subset, (l) => l.language).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([language]) => language);
}

function providerSummary(locale, provider, subset) {
  const parts = [t(locale, 'summary.count', { count: subset.length })];
  const official = subset.filter((l) => l.kind === 'official-sdk').length;
  if (official) parts.push(t(locale, 'summary.official', { official }));
  parts.push(t(locale, 'summary.languages', { languages: topLanguages(subset).join(', ') }));
  if (provider.docs) parts.push(provider.docs);
  return parts.join(' · ');
}

// ── Разметка для поисковиков ──────────────────────────────────────────────

/**
 * Хлебные крошки для JSON-LD. У среза «язык × роль» три уровня: каталог,
 * язык, роль. Последний элемент — сама страница, у неё свой адрес.
 */
function breadcrumbItems(locale, view, canonical) {
  if (view.provider) {
    return [
      { '@type': 'ListItem', position: 1, name: t(locale, 'nav.all'), item: `${siteUrl}/${alternatePath(locale, 'index.html')}` },
      { '@type': 'ListItem', position: 2, name: providerName(locale, view.provider), item: canonical },
    ];
  }
  if (!view.language) {
    return [{ '@type': 'ListItem', position: 1, name: t(locale, 'nav.all'), item: `${siteUrl}/${alternatePath(locale, 'index.html')}` }];
  }
  return crumbItems(locale, view, '').map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.label,
    item: item.url,
  }));
}

function jsonLd({ locale, view, title, description, canonical, urlPath, subset, heading }) {
  const items = sortForSeo(subset).slice(0, 100).map((library) => ({
    '@type': 'SoftwareSourceCode',
    name: library.name,
    description: truncate(library.description ?? '', 160) || undefined,
    url: canonical,
    codeRepository: library.repo ?? undefined,
    programmingLanguage: library.language,
    applicationCategory: 'DeveloperApplication',
    ...(library.stars ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: library.stars } } : {}),
  }));

  const payload = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: title,
        description,
        url: canonical,
        inLanguage: locale,
        dateModified: dataset.generatedAt,
        mainEntity: {
          '@type': 'ItemList',
          name: heading,
          numberOfItems: subset.length,
          itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, item })),
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbItems(locale, view, canonical),
      },
    ],
  };

  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function buildLlmsTxt(locale, libs, providers) {
  const lines = [
    t(locale, 'llms.title'),
    '',
    t(locale, 'llms.generated', {
      date,
      total: libs.length,
      languages: new Set(libs.map((l) => l.language)).size,
    }),
    t(locale, 'llms.fullData'),
    '',
    t(locale, 'llms.roles'),
    '',
    ...roleList.map((role) => `- **${t(locale, `role.${role.id}`)}** (${role.count}): ${t(locale, `roleDesc.${role.id}`)}`),
    '',
    t(locale, 'llms.providers'),
    '',
  ];
  for (const provider of providers) {
    const count = libs.filter((l) => l.providers.includes(provider.id)).length;
    if (!count) continue;
    lines.push(`- [${providerName(locale, provider.id)}](${provider.docs ?? 'https://platform.openai.com/docs'}) — ${count} ${t(locale, 'stats.libraries')}${provider.baseUrl ? `, base URL: ${provider.baseUrl}` : ''}`);
  }

  lines.push('', t(locale, 'llms.apiClients'), '');
  const top = sortForSeo(libs.filter((l) => (DEFAULT_ROLES.catalog.includes(l.role)) && (l.tier === 'A' || l.tier === 'B'))).slice(0, 200);
  let currentLanguage = null;
  for (const library of top) {
    if (library.language !== currentLanguage) {
      currentLanguage = library.language;
      lines.push('', `### ${currentLanguage}`, '');
    }
    const link = library.repo ?? library.registry?.url ?? '';
    const install = library.install ? ` — \`${library.install}\`` : '';
    lines.push(`- [${library.name}](${link}) (${library.ecosystem}, ${library.kind})${install}`);
  }

  lines.push('', t(locale, 'llms.runtimes'), '');
  for (const library of sortForSeo(libs.filter((l) => l.role === 'runtime')).slice(0, 40)) {
    const link = library.repo ?? library.registry?.url ?? '';
    const server = library.openaiCompatibleServer ? t(locale, 'llms.openaiCompatible') : '';
    lines.push(`- [${library.name}](${link}) (${library.ecosystem})${server}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Sitemap: обе локали, каждая со ссылками на альтернативы, чтобы поисковик
 * не считал их дубликатами. x-default отдаём отдельным urlset-элементом
 * только для главной — на остальных страницах хватает hreflang в <head>.
 */
function buildSitemap(pagesList) {
  const today = date;
  const raw = [
    { loc: '/index.html', priority: '1.0' },
    { loc: '/providers.html', priority: '0.7' },
    { loc: '/languages.html', priority: '0.7' },
    ...pagesList
      .filter((page) => page.urlPath !== 'index.html')
      .map((page) => ({ loc: `/${page.urlPath}`, priority: page.view.provider ? '0.8' : '0.6' })),
  ];
  // providers.html и languages.html есть и в списке выше, и в pages: раньше они
  // попадали в sitemap дважды, потому что фильтр исключал только index.html.
  // Первое вхождение выигрывает, то есть с более высоким приоритетом.
  const seen = new Set();
  const entries = raw.filter((entry) => !seen.has(entry.loc) && seen.add(entry.loc));

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    entries
      .map((entry) => {
        const alternates = LOCALES.filter((locale) => `${siteUrl}/${alternatePath(locale, entry.loc.replace(/^\//, ''))}` !== `${siteUrl}${entry.loc}`)
          .map((locale) => `    <xhtml:link rel="alternate" hreflang="${locale}" href="${siteUrl}/${alternatePath(locale, entry.loc.replace(/^\//, ''))}"/>`)
          .join('\n');
        // x-default отдаём только для главной: это адрес, который получает
        // посетитель, чей язык не удалось определить.
        const xDefault = entry.loc === '/index.html'
          ? `    <xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}/index.html"/>`
          : '';
        return `  <url>\n    <loc>${siteUrl}${entry.loc}</loc>\n${alternates}${xDefault ? `\n${xDefault}` : ''}\n    <lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>${entry.priority}</priority>\n  </url>`;
      })
      .join('\n') +
    '\n</urlset>\n'
  );
}

// ── Утилиты ───────────────────────────────────────────────────────────────

function countBy(items, fn) {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function truncate(text, length) {
  const value = String(text);
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function copy(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}
