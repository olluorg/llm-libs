/**
 * Единая схема записи каталога и утилиты слияния/нормализации.
 *
 * Ключевое различие — между `role` и `providers`:
 *   `role`      — что библиотека делает с LLM;
 *   `providers` — ЧЬЕ API она вызывает. У рантаймов и сопутствующих инструментов
 *                 это поле обязано быть пустым, иначе «библиотека для OpenAI»
 *                 начинает означать что угодно (векторную БД, eval-инструмент, UI).
 *
 * library = {
 *   id, name, displayName, description,
 *   ecosystem,          // pypi | npm | crates | golang | maven | nuget | rubygems | packagist | hex | luarocks | cran | swift | github
 *   language,           // Python | TypeScript | Go | Rust | Java | C# | ...
 *   role,               // sdk | framework | runtime | gateway | support
 *   providers: [id],    // только для sdk/framework/gateway: чей API вызывается
 *   worksWith: [id],    // мягкая связь: рантаймы, инфраструктура, UI, MCP
 *   openaiCompatibleServer, // true, если поднимает /v1-совместимый сервер (ollama, vLLM, llama.cpp)
 *   sdkApi,             // openai | anthropic-messages | gemini | bedrock | azure-openai | openai-compatible | n/a
 *   kind,               // official-sdk | client | framework | gateway | local-runtime | retrieval | eval | orchestration | ui | util
 *   status,             // active | beta | deprecated | archived | unknown
 *   tier,               // A (must know) | B (полезно) | C (остальное)
 *   features: [],       // chat | streaming | tools | structured-output | vision | embeddings | audio | video | batch | rag | agents | evals | finetune
 *   envVars: [],
 *   install,
 *   repo, docs, homepage,
 *   license,
 *   registry: { url, version, downloads, updatedAt },
 *   github: { stars, forks, openIssues, archived, pushedAt },
 *   stars,              // дублируется из github для сортировки
 *   confidence,         // 0..1, насколько запись доверенная
 *   source: [],         // ['curated:official', 'discovery:npm', 'github:api']
 *   notes,
 *   discoveredAt, updatedAt
 * }
 */
import { normalizeLicense } from './license.mjs';

export const ECOSYSTEMS = new Set([
  'pypi', 'npm', 'crates', 'golang', 'maven', 'nuget',
  'rubygems', 'packagist', 'hex', 'luarocks', 'cran', 'swift', 'github',
]);

/**
 * Адрес страницы «язык × роль». Слаги английские и не локализуются: адрес
 * страницы не должен зависеть от языка интерфейса, иначе одна и та же подборка
 * получила бы два адреса в двух деревьях.
 */
export const ROLE_SLUGS = {
  sdk: 'api-clients',
  framework: 'frameworks',
  runtime: 'local-runtimes',
  gateway: 'gateways',
  support: 'supporting-tools',
};

/** Что библиотека делает с LLM. */
export const ROLES = {
  // Прямой HTTP-клиент API провайдера, включая OpenAI-совместимые.
  sdk: 'Клиент API провайдера',
  // Абстракция поверх клиентских SDK: агенты, цепочки, RAG-пайплайны, structured output.
  framework: 'Фреймворк поверх SDK',
  // Локальный или серверный запуск моделей: Ollama, vLLM, transformers, llama.cpp.
  runtime: 'Локальный запуск моделей',
  // Прокси к провайдерам: LiteLLM, Portkey.
  gateway: 'Шлюз к провайдерам',
  // Сопутствующее: векторные БД, наблюдаемость, eval, токенизаторы, UI, MCP-серверы.
  support: 'Сопутствующие инструменты',
};

/** Как `kind` соотносится с ролью; роль можно переопределить в курируемых данных. */
export const ROLE_BY_KIND = {
  'official-sdk': 'sdk',
  client: 'sdk',
  framework: 'framework',
  gateway: 'gateway',
  'local-runtime': 'runtime',
  retrieval: 'support',
  eval: 'support',
  orchestration: 'support',
  ui: 'support',
  util: 'support',
};

/** Роли, которые по определению обращаются к API провайдера. */
export const CALLS_PROVIDER_API = new Set(['sdk', 'framework', 'gateway']);

export const KINDS = new Set([
  'official-sdk', 'client', 'framework', 'gateway', 'local-runtime',
  'retrieval', 'eval', 'orchestration', 'ui', 'util',
]);

export const STATUSES = new Set(['active', 'beta', 'deprecated', 'archived', 'unknown']);

export const TIERS = new Set(['A', 'B', 'C']);

export const ECOSYSTEM_LANGUAGE = {
  pypi: 'Python',
  npm: 'TypeScript',
  crates: 'Rust',
  golang: 'Go',
  maven: 'Java',
  nuget: 'C#',
  rubygems: 'Ruby',
  packagist: 'PHP',
  hex: 'Elixir',
  luarocks: 'Lua',
  cran: 'R',
  swift: 'Swift',
  github: 'GitHub',
};

export function makeId(ecosystem, name) {
  return `${String(ecosystem).toLowerCase()}:${String(name).toLowerCase()}`;
}

export function languageFor(ecosystem) {
  return ECOSYSTEM_LANGUAGE[ecosystem] ?? 'Other';
}

function cleanString(value, max = 4000) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cleanUrl(value) {
  const text = cleanString(value, 500);
  if (!text) return undefined;
  try {
    const url = new URL(text.startsWith('http') ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** Приводит произвольный объект к схеме записи. */
export function normalizeRecord(input) {
  const ecosystem = String(input.ecosystem ?? 'github').toLowerCase();
  const name = cleanString(input.name, 300);
  if (!name) throw new Error('Запись без name');

  const github = input.github ?? {};
  const registry = input.registry ?? {};

  const kind = KINDS.has(input.kind) ? input.kind : 'client';
  const role = ROLES[input.role] ? input.role : ROLE_BY_KIND[kind];
  // Рантаймы и сопутствующие инструменты не вызывают API провайдера:
  // переносим список провайдеров в worksWith, чтобы не выдавать их за клиентов.
  const rawProviders = uniq(input.providers ?? (input.provider ? [input.provider] : []));
  const rawWorksWith = uniq(input.worksWith ?? []);
  const providers = CALLS_PROVIDER_API.has(role) ? rawProviders : [];
  const worksWith = CALLS_PROVIDER_API.has(role)
    ? rawWorksWith
    : uniq([...rawWorksWith, ...rawProviders]);

  const record = {
    id: cleanString(input.id) ?? makeId(ecosystem, name),
    name,
    displayName: cleanString(input.displayName, 200) ?? name,
    description: cleanString(input.description, 600),
    ecosystem,
    language: cleanString(input.language, 60) ?? languageFor(ecosystem),
    role,
    kind,
    providers,
    worksWith,
    openaiCompatibleServer:
      input.openaiCompatibleServer === true && role === 'runtime' ? true : undefined,
    sdkApi: cleanString(input.sdkApi, 60) ?? 'n/a',
    status: STATUSES.has(input.status) ? input.status : 'unknown',
    tier: TIERS.has(input.tier) ? input.tier : undefined,
    features: uniq(input.features ?? []).slice(0, 20),
    envVars: uniq(input.envVars ?? []).slice(0, 10),
    install: cleanString(input.install, 300),
    // repoDropped ставит только аудит ссылок: репозиторий проверен и не найден,
    // поэтому ссылку нужно убрать, а не «не знать».
    repo: input.repoDropped === true ? undefined : cleanUrl(input.repo),
    repoDropped: input.repoDropped === true ? true : undefined,
    docs: cleanUrl(input.docs),
    homepage: cleanUrl(input.homepage),
    license: cleanString(input.license, 80),
    // Приведённая лицензия: SPDX-идентификатор и семейство. Реестры пишут
    // «MIT», «MIT License» и «MIT + file LICENSE» — по сырому значению
    // фильтр бесполезен, поэтому фильтруем по семейству, а показываем SPDX.
    licenseId: cleanString(normalizeLicense(input.license).id, 40),
    licenseFamily: normalizeLicense(input.license).family,
    registry: {
      url: cleanUrl(registry.url),
      version: cleanString(registry.version, 60),
      downloads: numberOr(registry.downloads),
      // Что измеряет счётчик: month (за месяц), total (с публикации),
      // imports (число импортов модуля), none (счётчика нет).
      downloadsPeriod: ['month', 'week', 'total', 'imports', 'none'].includes(registry.downloadsPeriod)
        ? registry.downloadsPeriod
        : registry.downloads === undefined
          ? undefined
          : 'total',
      updatedAt: isoDate(registry.updatedAt),
    },
    github: {
      stars: numberOr(github.stars),
      forks: numberOr(github.forks),
      openIssues: numberOr(github.openIssues),
      archived: github.archived === true ? true : github.archived === false ? false : undefined,
      pushedAt: isoDate(github.pushedAt),
      // Дата последнего релиза на GitHub — запасной источник даты, когда
      // реестр пакетов её не отдаёт (Maven, часть записей CRAN и NuGet).
      releasedAt: isoDate(github.releasedAt),
      latestRelease: cleanString(github.latestRelease, 60),
    },
    confidence: clamp(numberOr(input.confidence) ?? 0.5, 0, 1),
    source: uniq(input.source ?? []),
    notes: cleanString(input.notes, 1000),
    discoveredAt: isoDate(input.discoveredAt) ?? new Date().toISOString().slice(0, 10),
    updatedAt: isoDate(input.updatedAt) ?? new Date().toISOString().slice(0, 10),
  };

  record.stars = record.github.stars;
  if (record.status === 'active' && record.github.archived === true) record.status = 'archived';

  // Дата последнего релиза: сначала реестр паке��ов (это то, что ставит
  // пользователь), затем релиз на GitHub, затем последний коммит.
  const release = [
    [record.registry.updatedAt, 'registry'],
    [record.github.releasedAt, 'github-release'],
    [record.github.pushedAt, 'github-commit'],
  ].find(([date]) => date);
  if (release) {
    record.latestRelease = release[0];
    record.latestReleaseSource = release[1];
  }

  if (record.notes === undefined) delete record.notes;
  if (record.tier === undefined) delete record.tier;
  if (!record.worksWith.length) delete record.worksWith;
  if (record.openaiCompatibleServer === undefined) delete record.openaiCompatibleServer;
  if (record.displayName === record.name) delete record.displayName;
  if (!record.registry.url) delete record.registry.url;
  if (!record.registry.version) delete record.registry.version;
  if (record.registry.downloads === undefined) delete record.registry.downloads;
  if (record.registry.downloadsPeriod === undefined) delete record.registry.downloadsPeriod;
  if (!record.registry.updatedAt) delete record.registry.updatedAt;
  if (record.github.stars === undefined) delete record.github.stars;
  if (record.github.forks === undefined) delete record.github.forks;
  if (record.github.openIssues === undefined) delete record.github.openIssues;
  if (record.github.archived === undefined) delete record.github.archived;
  if (!record.github.pushedAt) delete record.github.pushedAt;
  if (!record.github.releasedAt) delete record.github.releasedAt;
  if (!record.github.latestRelease) delete record.github.latestRelease;
  if (record.latestReleaseSource === undefined) delete record.latestReleaseSource;
  if (record.stars === undefined) delete record.stars;
  if (record.description === undefined) delete record.description;
  if (record.homepage === undefined && !record.repo) delete record.homepage;
  if (record.license === undefined) delete record.license;
  if (record.licenseId === undefined) delete record.licenseId;
  if (record.install === undefined) delete record.install;
  if (record.repoDropped === undefined) delete record.repoDropped;
  if (record.docs === undefined) delete record.docs;

  return record;
}

function uniq(list) {
  return [...new Set(list.filter(Boolean).map((v) => String(v)))];
}

function numberOr(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isoDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

// Ранг статуса: чем выше, тем «живее» запись.
//
// Значение unknown стоит ниже любого известного, а не между deprecated и beta:
// это отсутствие данных, и оно не должно побеждать. Иначе курируемый
// статус deprecated терялся при слиянии с записью, для которой реестр
// статуса не отдал, и у crates:huggingface и crates:mistralai он превращался
// в unknown — то есть запись выглядела живее, чем есть.
const RANK = { unknown: -1, archived: 0, deprecated: 1, beta: 3, active: 4 };

/**
 * Сливает две записи об одном пакете: берём лучшее из каждого поля,
 * объединяем списки providers/worksWith/features/source.
 *
 * Роль выбирает более «осмысленный» вариант: явную роль из курируемых данных
 * не должен перебивать автоматический kind.
 */
export function mergeRecords(base, patch) {
  const a = normalizeRecord(base);
  const b = normalizeRecord(patch);
  const preferB = pickPreferred(a, b);

  return normalizeRecord({
    ...a,
    ...b,
    displayName: preferB.displayName ?? a.displayName,
    description: longer(a.description, b.description),
    language: b.language !== 'GitHub' ? b.language : a.language,
    providers: uniq([...(a.providers ?? []), ...(b.providers ?? [])]),
    worksWith: uniq([...(a.worksWith ?? []), ...(b.worksWith ?? [])]),
    features: uniq([...(a.features ?? []), ...(b.features ?? [])]),
    envVars: uniq([...(a.envVars ?? []), ...(b.envVars ?? [])]),
    source: uniq([...(a.source ?? []), ...(b.source ?? [])]),
    sdkApi: b.sdkApi !== 'n/a' ? b.sdkApi : a.sdkApi,
    kind: moreSpecificKind(a.kind, b.kind),
    role: preferRole(a, b),
    openaiCompatibleServer: a.openaiCompatibleServer === true || b.openaiCompatibleServer === true,
    status: (RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b.status : a.status,
    // Tier берётся из более доверенного источника, как role и остальные
    // выбираемые поля. Раньше здесь стоял «лучший из двух», из-за чего
    // курируемая запись с tier C проигрывала автосбору с tier B: человек
    // ставил C в data/curated, а выходило B, и правка молча не действовала.
    // Подтвердилось на crates:huggingface, crates:mistralai, crates:llm-chain,
    // packagist:openai-php/symfony и rubygems:ruby-openai.
    tier: pickPreferred(a, b).tier ?? bestTier(a.tier, b.tier),
    // Аудит ссылок может явно пометить ссылку как нерабочую — тогда она
    // не восстанавливается из реестра, а удаляется.
    repo: b.repoDropped === true ? undefined : b.repo ?? a.repo,
    repoDropped: b.repoDropped === true ? true : a.repoDropped,
    docs: b.docs ?? a.docs,
    homepage: b.homepage ?? a.homepage,
    license: b.license ?? a.license,
    install: b.install ?? a.install,
    registry: {
      url: b.registry.url ?? a.registry.url,
      version: b.registry.version ?? a.registry.version,
      downloads: max(a.registry.downloads, b.registry.downloads),
      // Период берём у той записи, у которой счётчик больше: максимум
      // накопительного счётчика нельзя сравнивать с месячным.
      downloadsPeriod:
        (a.registry.downloads ?? 0) >= (b.registry.downloads ?? 0)
          ? a.registry.downloadsPeriod
          : b.registry.downloadsPeriod,
      updatedAt: newest(a.registry.updatedAt, b.registry.updatedAt),
    },
    github: {
      stars: max(a.github.stars, b.github.stars),
      forks: max(a.github.forks, b.github.forks),
      openIssues: max(a.github.openIssues, b.github.openIssues),
      archived: a.github.archived ?? b.github.archived,
      pushedAt: newest(a.github.pushedAt, b.github.pushedAt),
      releasedAt: newest(a.github.releasedAt, b.github.releasedAt),
      latestRelease: b.github.latestRelease ?? a.github.latestRelease,
    },
    confidence: Math.max(a.confidence, b.confidence),
    notes: longer(a.notes, b.notes),
    discoveredAt: older(a.discoveredAt, b.discoveredAt),
    updatedAt: newest(a.updatedAt, b.updatedAt),
  });
}

const KIND_SPECIFICITY = {
  client: 1,
  util: 2,
  ui: 3,
  retrieval: 4,
  gateway: 5,
  eval: 5,
  orchestration: 6,
  framework: 7,
  'local-runtime': 8,
  'official-sdk': 9,
};

function moreSpecificKind(a, b) {
  return (KIND_SPECIFICITY[b] ?? 0) > (KIND_SPECIFICITY[a] ?? 0) ? b : a;
}

/**
 * Роль: явно заданная в курируемых данных побеждает автоматически выведенную
 * из kind, а при равной уверенности решает более специфичный kind.
 */
function preferRole(a, b) {
  if (a.role === b.role) return a.role;
  if (b.confidence > a.confidence) return b.role;
  if (a.confidence > b.confidence) return a.role;
  return moreSpecificKind(a.kind, b.kind) === a.kind ? a.role : b.role;
}

function pickPreferred(a, b) {
  return b.confidence >= a.confidence ? b : a;
}

function bestTier(a, b) {
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

function longer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function max(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function newest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function older(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
