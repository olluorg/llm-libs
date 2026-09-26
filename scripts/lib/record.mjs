/**
 * Единая схема записи каталога и утилиты слияния/нормализации.
 *
 * library = {
 *   id, name, displayName, description,
 *   ecosystem,          // pypi | npm | crates | golang | maven | nuget | rubygems | packagist | hex | luarocks | cran | swift | github
 *   language,           // Python | TypeScript | Go | Rust | Java | C# | ...
 *   providers: [id],    // провайдеры, с которыми работает библиотека
 *   sdkApi,             // openai | openai-responses | anthropic-messages | gemini | bedrock | azure-openai | openai-compatible | n/a
 *   kind,               // official-sdk | client | framework | gateway | local-runtime | eval | orchestration | ui
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

export const ECOSYSTEMS = new Set([
  'pypi', 'npm', 'crates', 'golang', 'maven', 'nuget',
  'rubygems', 'packagist', 'hex', 'luarocks', 'cran', 'swift', 'github',
]);

export const KINDS = new Set([
  'official-sdk', 'client', 'framework', 'gateway', 'local-runtime', 'eval', 'orchestration', 'retrieval', 'ui',
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

  const record = {
    id: cleanString(input.id) ?? makeId(ecosystem, name),
    name,
    displayName: cleanString(input.displayName, 200) ?? name,
    description: cleanString(input.description, 600),
    ecosystem,
    language: cleanString(input.language, 60) ?? languageFor(ecosystem),
    providers: uniq(input.providers ?? (input.provider ? [input.provider] : [])),
    sdkApi: cleanString(input.sdkApi, 60) ?? 'n/a',
    kind: KINDS.has(input.kind) ? input.kind : 'client',
    status: STATUSES.has(input.status) ? input.status : 'unknown',
    tier: TIERS.has(input.tier) ? input.tier : undefined,
    features: uniq(input.features ?? []).slice(0, 20),
    envVars: uniq(input.envVars ?? []).slice(0, 10),
    install: cleanString(input.install, 300),
    repo: cleanUrl(input.repo),
    docs: cleanUrl(input.docs),
    homepage: cleanUrl(input.homepage),
    license: cleanString(input.license, 80),
    registry: {
      url: cleanUrl(registry.url),
      version: cleanString(registry.version, 60),
      downloads: numberOr(registry.downloads),
      updatedAt: isoDate(registry.updatedAt),
    },
    github: {
      stars: numberOr(github.stars),
      forks: numberOr(github.forks),
      openIssues: numberOr(github.openIssues),
      archived: github.archived === true ? true : github.archived === false ? false : undefined,
      pushedAt: isoDate(github.pushedAt),
    },
    confidence: clamp(numberOr(input.confidence) ?? 0.5, 0, 1),
    source: uniq(input.source ?? []),
    notes: cleanString(input.notes, 1000),
    discoveredAt: isoDate(input.discoveredAt) ?? new Date().toISOString().slice(0, 10),
    updatedAt: isoDate(input.updatedAt) ?? new Date().toISOString().slice(0, 10),
  };

  record.stars = record.github.stars;
  if (record.status === 'active' && record.github.archived === true) record.status = 'archived';
  if (record.notes === undefined) delete record.notes;
  if (record.tier === undefined) delete record.tier;
  if (record.displayName === record.name) delete record.displayName;
  if (!record.registry.url) delete record.registry.url;
  if (!record.registry.version) delete record.registry.version;
  if (record.registry.downloads === undefined) delete record.registry.downloads;
  if (!record.registry.updatedAt) delete record.registry.updatedAt;
  if (record.github.stars === undefined) delete record.github.stars;
  if (record.github.forks === undefined) delete record.github.forks;
  if (record.github.openIssues === undefined) delete record.github.openIssues;
  if (record.github.archived === undefined) delete record.github.archived;
  if (!record.github.pushedAt) delete record.github.pushedAt;
  if (record.stars === undefined) delete record.stars;
  if (record.description === undefined) delete record.description;
  if (record.homepage === undefined && !record.repo) delete record.homepage;
  if (record.license === undefined) delete record.license;
  if (record.install === undefined) delete record.install;
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

const RANK = { archived: 0, deprecated: 1, unknown: 2, beta: 3, active: 4 };

/**
 * Сливает две записи об одном пакете: берём лучшее из каждого поля,
 * объединяем списки providers/features/source.
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
    providers: uniq([...a.providers, ...b.providers]),
    features: uniq([...a.features, ...b.features]),
    envVars: uniq([...a.envVars, ...b.envVars]),
    source: uniq([...a.source, ...b.source]),
    sdkApi: b.sdkApi !== 'n/a' ? b.sdkApi : a.sdkApi,
    kind: moreSpecificKind(a.kind, b.kind),
    status: (RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b.status : a.status,
    tier: bestTier(a.tier, b.tier),
    repo: b.repo ?? a.repo,
    docs: b.docs ?? a.docs,
    homepage: b.homepage ?? a.homepage,
    license: b.license ?? a.license,
    install: b.install ?? a.install,
    registry: {
      url: b.registry.url ?? a.registry.url,
      version: b.registry.version ?? a.registry.version,
      downloads: max(a.registry.downloads, b.registry.downloads),
      updatedAt: newest(a.registry.updatedAt, b.registry.updatedAt),
    },
    github: {
      stars: max(a.github.stars, b.github.stars),
      forks: max(a.github.forks, b.github.forks),
      openIssues: max(a.github.openIssues, b.github.openIssues),
      archived: a.github.archived ?? b.github.archived,
      pushedAt: newest(a.github.pushedAt, b.github.pushedAt),
    },
    confidence: Math.max(a.confidence, b.confidence),
    notes: longer(a.notes, b.notes),
    discoveredAt: older(a.discoveredAt, b.discoveredAt),
    updatedAt: newest(a.updatedAt, b.updatedAt),
  });
}

const KIND_SPECIFICITY = {
  client: 1,
  ui: 2,
  retrieval: 3,
  gateway: 4,
  eval: 4,
  orchestration: 5,
  framework: 6,
  'local-runtime': 7,
  'official-sdk': 8,
};

function moreSpecificKind(a, b) {
  return (KIND_SPECIFICITY[b] ?? 0) > (KIND_SPECIFICITY[a] ?? 0) ? b : a;
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
