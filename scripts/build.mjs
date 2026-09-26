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
import { slugify } from './lib/site-helpers.mjs';
import { ROLES, CALLS_PROVIDER_API } from './lib/record.mjs';
import { popularity as sharedPopularity } from './lib/popularity.mjs';

const log = createLogger('build');

const PRE_RENDER_LIMIT = 150; // строк в статической разметке (дальше — только JSON)

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

/** Откуда взялась дата релиза — для подсказки в таблице. */
const RELEASE_SOURCE_LABEL = {
  registry: 'релиз в реестре пакетов',
  'github-release': 'релиз на GitHub',
  'github-commit': 'последний коммит',
};

/** Пояснения к ролям: попадают в данные для сайта и в тексты для поисковиков. */
const ROLE_DESCRIPTIONS = {
  sdk: 'Прямой HTTP-клиент API провайдера. Создаёт подключение к OpenAI, Anthropic, Gemini, Bedrock и другим API.',
  framework:
    'Абстракция поверх клиентских SDK: агенты, цепочки, RAG-пайплайны, структурированный вывод. Сама к провайдеру не ходит.',
  runtime:
    'Считает модель локально или поднимает сервер инференса. К API облачного провайдера не обращается; Ollama, vLLM и llama.cpp дают OpenAI-совместимый сервер.',
  gateway: 'Прокси к провайдерам с единым форматом запросов, ретраями и учётом стоимости.',
  support:
    'Сопутствующий слой: векторные базы, наблюдаемость, оценки, токенизаторы, интерфейсы, серверы MCP.',
};

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
const providerList = providersConfig.providers.map(({ id, name, category, docs, baseUrl, envVars, models, notes }) => ({
  id, name, category, docs, baseUrl, envVars, models, notes,
}));
const providerMap = new Map(providerList.map((p) => [p.id, p]));

const libraries = dataset.libraries.map((library) => ({
  ...library,
  providers: (library.providers ?? []).map((id) => providerMap.get(id)?.id ?? id),
}));

const date = String(dataset.generatedAt).slice(0, 10);
const languageCounts = countBy(libraries, (l) => l.language);
const providerCounts = countBy(libraries, (l) => l.providers[0] ?? '—');
const languages = [...languageCounts.entries()].sort((a, b) => b[1] - a[1]);
const usedProviders = providerList.filter((p) => libraries.some((l) => l.providers.includes(p.id)));
const roleCounts = countBy(libraries, (l) => l.role);
const roleList = Object.entries(ROLES)
  .map(([id, label]) => ({ id, label, count: roleCounts.get(id) ?? 0, description: ROLE_DESCRIPTIONS[id] }))
  .filter((role) => role.count > 0);

await fs.rm(DIST_DIR, { recursive: true, force: true });
await fs.mkdir(path.join(DIST_DIR, 'assets'), { recursive: true });

// ── Данные и ассеты ───────────────────────────────────────────────────────
await write(
  path.join(DIST_DIR, 'assets', 'data.js'),
  `window.__LLMDOCS__ = ${JSON.stringify({ generatedAt: dataset.generatedAt, providers: providerList, roles: roleList, libraries })};\n`,
);
await write(path.join(DIST_DIR, 'data', 'libraries.json'), `${JSON.stringify(dataset, null, 2)}\n`);
await copy(path.join(ROOT, 'site', 'app.js'), path.join(DIST_DIR, 'assets', 'app.js'));
await copy(path.join(ROOT, 'site', 'style.css'), path.join(DIST_DIR, 'assets', 'style.css'));

const template = await fs.readFile(path.join(ROOT, 'site', 'index.html'), 'utf8');

// ── Страницы ──────────────────────────────────────────────────────────────
const pages = [
  {
    file: 'index.html',
    root: '',
    view: { role: 'api' },
    roles: DEFAULT_ROLES.catalog,
    title: 'Каталог библиотек для LLM — OpenAI, Anthropic, Gemini, Bedrock на всех языках',
    description:
      `${libraries.length} библиотек для работы с LLM: OpenAI, Anthropic Claude, Google Gemini, AWS Bedrock, Azure OpenAI, ` +
      'Ollama, vLLM, Groq, OpenRouter, Mistral, Cohere и OpenAI-совместимые API. Python, TypeScript, Go, Rust, Java, ' +
      'C#, PHP, Ruby, R, Elixir, Lua, Swift и другие языки, с версиями, загрузками и звёздами GitHub.',
    heading: 'Каталог библиотек для работы с LLM',
    subheading:
      'OpenAI, Anthropic, Gemini, Bedrock, Azure и OpenAI-совместимые провайдеры — по всем языкам программирования. ' +
      'Сначала идут официальные SDK, затем фреймворки и комьюнити-клиенты.',
    keywords: 'llm библиотеки, openai sdk, anthropic claude sdk, gemini api, bedrock, ollama, vllm, litellm, langchain, llama-index',
    filter: () => libraries,
  },
  {
    file: 'providers.html',
    root: '',
    view: { role: 'all' },
    roles: DEFAULT_ROLES.hub,
    title: 'Библиотеки для LLM по провайдерам — OpenAI, Anthropic, Gemini, Bedrock',
    description:
      'Срез каталога по API-провайдерам: сколько библиотек вызывают API каждого провайдера, ссылки на документацию ' +
      'и base URL. OpenAI, Anthropic, Google Gemini, AWS Bedrock, Azure OpenAI, Ollama, vLLM, Groq, OpenRouter, Mistral, Cohere.',
    heading: 'Библиотеки по провайдерам',
    subheading: 'Здесь только то, что обращается к API провайдера: клиентские SDK и фреймворки поверх них.',
    keywords: 'llm провайдеры, openai, anthropic, gemini, bedrock, azure openai, ollama, groq, openrouter, mistral, cohere',
    filter: () => libraries,
    hub: 'providers',
  },
  {
    file: 'languages.html',
    root: '',
    view: { role: 'all' },
    roles: DEFAULT_ROLES.hub,
    title: 'Библиотеки для LLM по языкам программирования',
    description:
      'Срез каталога по языкам: Python, TypeScript, JavaScript, Go, Rust, Java, Kotlin, C#/.NET, PHP, Ruby, R, ' +
      'Elixir, Lua, Swift, Scala, Haskell, Clojure, C++, Dart, Zig, OCaml. С версиями, загрузками и звёздами GitHub.',
    heading: 'Библиотеки по языкам',
    subheading: 'Сколько клиентов API и фреймворков для работы с LLM доступно в каждом языке и экосистеме пакетов.',
    keywords: 'llm sdk по языкам, python openai, typescript anthropic, golang llm, rust llm, java openai, c# llm, php llm',
    filter: () => libraries,
    hub: 'languages',
  },
  ...usedProviders.map((provider) => {
    const subset = libraries.filter((l) => l.providers.includes(provider.id));
    return {
      file: path.join('providers', `${slugify(provider.id)}.html`),
      root: '../',
      view: { provider: provider.id, role: 'api' },
      roles: DEFAULT_ROLES.provider,
      title: `Библиотеки для ${provider.name} — ${subset.length} шт. | LLM-каталог`,
      description:
        `Готовые библиотеки и SDK для провайдера ${provider.name}: ${subset.length} пакетов для ` +
        `${topLanguages(subset).join(', ')}. Версии, загрузки, звёзды GitHub, официальные SDK и комьюнити-клиенты.` +
        (provider.docs ? ` Документация: ${provider.docs}` : ''),
      heading: `Библиотеки для ${provider.name}`,
      subheading: providerSummary(provider, subset),
      keywords: `${provider.name} sdk, ${provider.name} api библиотеки, llm ${provider.id}`,
      filter: () => subset,
      subject: provider,
    };
  }),
  ...languages.map(([language, count]) => {
    const subset = libraries.filter((l) => l.language === language);
    return {
      file: path.join('languages', `${slugify(language)}.html`),
      root: '../',
      view: { language, role: 'all' },
      roles: DEFAULT_ROLES.language,
      title: `Библиотеки для LLM на ${language} — ${count} шт. | LLM-каталог`,
      description:
        `${count} библиотек для работы с LLM на языке ${language}: ` +
        `${topPackages(subset).join(', ')}. Официальные SDK, фреймворки, локальный инференс, ` +
        'шлюзы и наблюдаемость — с версиями и загрузками.',
      heading: `Библиотеки для LLM на ${language}`,
      subheading: `${count} записей в каталоге. Нажмите на библиотеку, чтобы увидеть установку и ссылки.`,
      keywords: `llm ${language}, ${language} openai sdk, ${language} anthropic, llm библиотеки ${language}`,
      filter: () => subset,
      subject: { name: language, kind: 'language' },
    };
  }),
];

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
await write(path.join(DIST_DIR, 'llms.txt'), buildLlmsTxt(libraries, usedProviders));
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
    'Файлы:',
    '- `index.html` — каталог с поиском и фильтрами (открывается двойным кликом)',
    '- `providers.html`, `languages.html` — оглавления',
    '- `providers/<id>.html`, `languages/<lang>.html` — срезы с готовой разметкой для поисковиков',
    '- `data/libraries.json` — полный датасет в JSON',
    '- `assets/data.js` — данные, встроенные в страницу (для работы с `file://`)',
    '- `llms.txt` — краткий указатель для ИИ-агентов',
    '- `sitemap.xml`, `robots.txt` — для поисковых систем',
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
function render(tpl, { root, view, title, description, heading, subheading, keywords, subset, file, roles, total }) {
  const prefix = root ? `${root.replace(/\/+$/, '')}/` : '';
  // Канонический адрес — от корня сайта, без ../ от текущей страницы.
  const canonical = `${siteUrl}/${file.split(path.sep).join('/')}`;
  const visible = subset.filter((library) => roles.includes(library.role));
  const hidden = subset.length - visible.length;
  const sorted = sortForSeo(visible.length ? visible : subset);
  const shown = sorted.slice(0, PRE_RENDER_LIMIT);

  return tpl
    .replaceAll(/\{\{ROOT\}\}/g, prefix)
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(description))
    .replaceAll('{{KEYWORDS}}', escapeHtml(keywords))
    .replaceAll('{{CANONICAL}}', escapeHtml(canonical))
    .replaceAll('{{JSONLD}}', jsonLd({ view, title, description, canonical, subset: visible, heading }))
    .replaceAll('{{HEADING}}', escapeHtml(heading))
    .replaceAll('{{SUBHEADING}}', escapeHtml(subheading))
    .replaceAll('{{VIEW}}', JSON.stringify(view))
    .replaceAll('{{TOTAL}}', String(visible.length || total))
    .replaceAll('{{LANGUAGES}}', String(new Set(visible.map((l) => l.language)).size))
    .replaceAll('{{PROVIDERS}}', String(new Set(visible.flatMap((l) => l.providers)).size))
    .replaceAll('{{CAPTION}}', escapeHtml(heading))
    .replaceAll('{{SEO_HEADING}}', escapeHtml(seoHeading(view)))
    .replaceAll('{{SEO_TEXT}}', escapeHtml(seoText(view, visible, hidden, roles)))
    .replaceAll('{{SEO_LINKS}}', seoLinks(sorted, prefix, view))
    .replaceAll('{{ROWS}}', shown.map((library) => rowHtml(library)).join('\n'));
}

/** Статическая разметка строки таблицы: тот же вид, что рисует app.js. */
function rowHtml(library) {
  const providerChips = (library.providers ?? [])
    .slice(0, 3)
    .map((id) => `<span class="chip p">${escapeHtml(providerMap.get(id)?.name ?? id)}</span>`)
    .join('');
  const role = roleList.find((item) => item.id === library.role);
  const metrics = [
    library.stars ? `<span title="Звёзды GitHub">★ ${compact(library.stars)}</span>` : '',
    downloadsLabel(library) ? `<span title="Счётчик реестра пакетов">⬇ ${escapeHtml(downloadsLabel(library))}</span>` : '',
  ].filter(Boolean).join('');

  return `<tr data-id="${escapeHtml(library.id)}">
        <td>
          <div class="pkg">${escapeHtml(library.name)} <span class="eco">· ${escapeHtml(library.ecosystem)}</span></div>
          ${library.description ? `<div class="desc">${escapeHtml(library.description)}</div>` : ''}
        </td>
        <td>${escapeHtml(library.language)}</td>
        <td><div class="chips">${providerChips}${library.tier ? `<span class="chip tier-${escapeHtml(library.tier).toLowerCase()}">tier ${escapeHtml(library.tier)}</span>` : ''}</div></td>
        <td><span class="role role-${escapeHtml(library.role)}">${escapeHtml(role?.label ?? library.role)}</span></td>
        <td class="num">${library.stars ? compact(library.stars) : '—'}</td>
        <td class="num">${escapeHtml(downloadsLabel(library)) || '—'}</td>
        <td class="num">${releaseCell(library)}</td>
      </tr>`;
}

function sortForSeo(subset) {
  return [...subset].sort(
    (a, b) => popularity(b) - popularity(a) || String(a.name).localeCompare(String(b.name)),
  );
}

/** Дата последнего релиза: реестр → релиз на GitHub → последний коммит. */
function releaseCell(library) {
  if (!library.latestRelease) return '—';
  const source = RELEASE_SOURCE_LABEL[library.latestReleaseSource] ?? library.latestReleaseSource ?? '';
  return `<span title="${escapeHtml(source)}">${escapeHtml(library.latestRelease)}</span>`;
}

/** Популярность — логарифмическая, с учётом периода счётчика. Формула в lib/popularity.mjs. */
function popularity(library) {
  return sharedPopularity(library);
}

/** Счётчик загрузок: подпись зависит от того, что он измеряет. */
function downloadsLabel(library) {
  const downloads = num(library.registry?.downloads);
  if (!downloads) return '';
  const period = library.registry?.downloadsPeriod;
  const suffix = { month: '/мес', imports: ' импортов', total: ' всего', none: '' }[period] ?? '';
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

function seoHeading(view) {
  if (view.provider) return `Популярные библиотеки для ${providerMap.get(view.provider)?.name ?? view.provider}`;
  if (view.language) return `Популярные библиотеки на ${view.language}`;
  return 'С чего начать';
}

function seoText(view, subset, hidden, roles) {
  const count = subset.length;
  const hiddenRoles = roleList.filter((role) => !roles.includes(role.id) && role.count);
  const tail = hidden
    ? ` Ещё ${hidden} записей типов «${hiddenRoles.map((r) => `${r.label.toLowerCase()} — ${r.count}`).join(', ')}» — ` +
      'переключите фильтр ролей, чтобы их увидеть.'
    : '';

  if (view.provider) {
    const provider = providerMap.get(view.provider);
    const official = subset.filter((l) => l.kind === 'official-sdk').length;
    return (
      `Клиенты API ${provider.name} и фреймворки, которые через них работают: ${count} записей` +
      (official ? `, из них ${official} официальных SDK` : '') +
      `. Список по убыванию популярности (звёзды GitHub и загрузки за месяц).` +
      ` Нужен единый шлюз ко всем провайдерам — LiteLLM; нужен агентный фреймворк — LangChain или Vercel AI SDK.${tail}`
    );
  }
  if (view.language) {
    return (
      `Клиенты API LLM и фреймворки на языке ${view.language}: ${count} записей` +
      (hidden ? `, плюс локальные рантаймы и сопутствующие инструменты для этого языка` : '') +
      `. Сортировка — по популярности; клик по заголовку меняет порядок, поиск работает по названию, ` +
      `описанию, провайдерам и возможностям.${tail}`
    );
  }
  return (
    `По умолчанию показаны только клиенты API провайдеров (${count}${hidden ? ` из ${count + hidden}` : ''}) — те, ` +
    'кто действительно отправляет запросы в OpenAI, Anthropic, Gemini, Bedrock и другие API. ' +
    'Остальное доступно через фильтр ролей: локальный запуск моделей (Ollama, vLLM, transformers, llama.cpp), ' +
    'фреймворки поверх SDK (LangChain, Pydantic AI, DSPy), шлюзы (LiteLLM) и сопутствующие инструменты — ' +
    'векторные базы, наблюдаемость, eval, токенизаторы, интерфейсы, серверы MCP. ' +
    'Каталог собран автоматически из реестров пакетов и обогащён данными GitHub; если вы пришли из поиска, ' +
    'язык из запроса подставляется автоматически.'
  );
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

function providerSummary(provider, subset) {
  const parts = [`${subset.length} библиотек`];
  const official = subset.filter((l) => l.kind === 'official-sdk').length;
  if (official) parts.push(`${official} официальных SDK`);
  parts.push(`языки: ${topLanguages(subset).join(', ')}`);
  if (provider.docs) parts.push(provider.docs);
  return parts.join(' · ');
}

// ── Разметка для поисковиков ──────────────────────────────────────────────

function jsonLd({ view, title, description, canonical, subset, heading }) {
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
        inLanguage: 'ru',
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
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Каталог', item: `${siteUrl}/index.html` },
          ...(view.provider
            ? [{ '@type': 'ListItem', position: 2, name: providerMap.get(view.provider)?.name ?? view.provider, item: canonical }]
            : view.language
              ? [{ '@type': 'ListItem', position: 2, name: view.language, item: canonical }]
              : []),
        ],
      },
    ],
  };

  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function buildLlmsTxt(libs, providers) {
  const lines = [
    '# Каталог библиотек для работы с LLM',
    '',
    `> Сгенерировано ${date}. ${libs.length} библиотек для ${new Set(libs.map((l) => l.language)).size} языков.`,
    '> Полные данные: data/libraries.json',
    '',
    '## Роли',
    '',
    ...roleList.map((role) => `- **${role.label}** (${role.count}): ${role.description}`),
    '',
    '## Провайдеры',
    '',
  ];
  for (const provider of providers) {
    const count = libs.filter((l) => l.providers.includes(provider.id)).length;
    if (!count) continue;
    lines.push(`- [${provider.name}](${provider.docs ?? 'https://platform.openai.com/docs'}) — ${count} библиотек вызывают этот API${provider.baseUrl ? `, base URL: ${provider.baseUrl}` : ''}`);
  }

  lines.push('', '## Клиенты API (tier A/B)', '');
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

  lines.push('', '## Локальный запуск моделей', '');
  for (const library of sortForSeo(libs.filter((l) => l.role === 'runtime')).slice(0, 40)) {
    const link = library.repo ?? library.registry?.url ?? '';
    const server = library.openaiCompatibleServer ? ', OpenAI-совместимый сервер' : '';
    lines.push(`- [${library.name}](${link}) (${library.ecosystem})${server}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildSitemap(pagesList) {
  const today = date;
  const entries = [
    { loc: '/index.html', priority: '1.0' },
    { loc: '/providers.html', priority: '0.7' },
    { loc: '/languages.html', priority: '0.7' },
    ...pagesList
      .filter((p) => p.file !== 'index.html')
      .map((p) => ({ loc: `/${p.file.split(path.sep).join('/')}`, priority: p.view.provider ? '0.8' : '0.6' })),
  ];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map(
        (entry) =>
          `  <url><loc>${siteUrl}${entry.loc}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>${entry.priority}</priority></url>`,
      )
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
