#!/usr/bin/env node
/**
 * Проверка качества датасета: дубликаты, битые ссылки, незаполненные поля,
 * провайдеры, которых нет в конфиге. Возвращает ненулевой код выхода,
 * если найдены критичные проблемы (для CI).
 *
 *   node scripts/validate.mjs            # статические проверки
 *   node scripts/validate.mjs --online   # + проверка доступности ссылок
 */
import { createLogger } from './lib/log.mjs';
import { getText } from './lib/http.mjs';
import { mapLimit, repoSlug } from './lib/github.mjs';
import { curationKey, loadCuration, loadProviders, readDataset, CURATED_DIR } from './lib/store.mjs';
import { findCopies, findDeclaredForks, findRewrittenCandidates } from './lib/fork.mjs';
import { makeId, CALLS_PROVIDER_API, ROLES } from './lib/record.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const log = createLogger('validate');
const online = process.argv.includes('--online');
const dataset = await readDataset();
const providers = await loadProviders();

const problems = { errors: [], warnings: [], info: [] };
const seen = new Map();

for (const library of dataset.libraries ?? []) {
  const label = `${library.ecosystem}:${library.name}`;

  if (seen.has(library.id)) problems.errors.push(`дубликат id: ${label}`);
  seen.set(library.id, true);

  if (!library.description) problems.warnings.push(`нет описания: ${label}`);
  if (!library.registry?.version && !library.stars) {
    problems.warnings.push(`нет версии и звёзд (не проверено в реестре): ${label}`);
  }
  if (library.repo && !/^https?:\/\//.test(library.repo)) problems.errors.push(`битый repo: ${label} → ${library.repo}`);
  if (library.repo && /github\.com/i.test(library.repo) && !repoSlug(library.repo)) {
    problems.errors.push(`не разбирается ссылка на GitHub: ${label} → ${library.repo}`);
  }
  for (const provider of library.providers ?? []) {
    if (!providers[provider]) problems.warnings.push(`неизвестный провайдер «${provider}» у ${label}`);
  }
  // Главный инвариант каталога: «библиотека для провайдера» = вызывает его API.
  if (!CALLS_PROVIDER_API.has(library.role)) {
    if ((library.providers ?? []).length) {
      problems.errors.push(
        `роль «${library.role}» не должна иметь провайдеров: ${label} → ${library.providers.join(', ')}`,
      );
    }
    if (library.role === 'runtime' && (library.envVars ?? []).some((key) => /API_KEY|BEARER|TOKEN/.test(key))) {
      problems.warnings.push(`у рантайма подозрительные ключи API: ${label}`);
    }
  } else if (!(library.providers ?? []).length) {
    problems.warnings.push(`роль «${library.role}», но провайдеры не указаны: ${label}`);
  }
  for (const related of library.worksWith ?? []) {
    if (!providers[related]) problems.warnings.push(`неизвестная связь «${related}» у ${label}`);
  }
  if (library.status === 'unknown') problems.info.push(`статус неизвестен: ${label}`);
  if (library.registry?.updatedAt && library.registry.updatedAt > new Date().toISOString().slice(0, 10)) {
    problems.errors.push(`дата обновления в будущем: ${label} → ${library.registry.updatedAt}`);
  }
}

// Неиспользуемые провайдеры конфига.
const used = new Set((dataset.libraries ?? []).flatMap((l) => l.providers ?? []));
for (const id of Object.keys(providers)) {
  if (!used.has(id)) problems.info.push(`провайдер «${id}» из конфига не найден ни в одной библиотеке`);
}

// Курируемые записи не должны молча исчезать из каталога.
const curatedIds = await collectCuratedIds();
const datasetIds = new Set((dataset.libraries ?? []).map((l) => l.id));
const lost = [...curatedIds].filter((id) => !datasetIds.has(id));
if (lost.length) problems.errors.push(`потеряны курируемые записи (${lost.length}): ${lost.slice(0, 10).join(', ')}`);

const curatedCount = (dataset.libraries ?? []).filter((l) =>
  (l.source ?? []).some((s) => s.startsWith('curated:')),
).length;

if ((dataset.libraries?.length ?? 0) < 100) {
  problems.errors.push(`каталог подозрительно мал: ${dataset.libraries?.length ?? 0} записей`);
}

if (online) {
  const urls = [...new Set(
    (dataset.libraries ?? []).flatMap((l) => [l.repo, l.docs, l.homepage, l.registry?.url].filter(Boolean)),
  )].slice(0, 300);
  log.info(`проверка ${urls.length} ссылок…`);
  const results = await mapLimit(urls, 8, async (url) => {
    try {
      const { status } = await getText(url, { ttlMs: 0, noCache: true, timeoutMs: 15_000, retries: 0 });
      return { url, ok: status < 400 };
    } catch (error) {
      return { url, ok: false, error: error.message };
    }
  });
  for (const result of results) {
    if (result && !result.ok) problems.warnings.push(`ссылка не отвечает: ${result.url}${result.error ? ` (${result.error})` : ''}`);
  }
}

for (const [label, list] of Object.entries(problems)) {
  if (!list.length) continue;
  const logFn = label === 'errors' ? log.error : label === 'warnings' ? log.warn : log.info;
  logFn(`${label}: ${list.length}`);
  for (const item of list.slice(0, 60)) logFn(`  - ${item}`);
  if (list.length > 60) logFn(`  … и ещё ${list.length - 60}`);
}

// Итоговые метрики: в CI это то, на что смотрят в первую очередь.
const total = dataset.libraries?.length ?? 0;
const withStars = (dataset.libraries ?? []).filter((l) => l.stars).length;
const withRepo = (dataset.libraries ?? []).filter((l) => l.repo).length;
const byRole = Object.fromEntries(
  Object.keys(ROLES)
    .map((role) => [role, (dataset.libraries ?? []).filter((l) => l.role === role).length])
    .filter(([, count]) => count > 0),
);
log.info(
  `итог: ${total} записей · курируемых ${curatedCount} из ${curatedIds.size} · автоматически ${total - curatedCount}` +
    ` · со звёздами ${withStars} · с репозиторием ${withRepo}`,
);
log.info(
  `роли: ${Object.entries(byRole)
    .map(([role, count]) => `${ROLES[role].toLowerCase()} ${count}`)
    .join(' · ')}`,
);

// Ручные решения: исключённых записей в датасете быть не должно, а
// исправленные — должны нести исправленное значение. Иначе механизм молча
// перестал работать: правило нашлось, но не применилось.
{
  const curation = await loadCuration();
  const byId = new Map((dataset.libraries ?? []).map((library) => [library.id.toLowerCase(), library]));
  for (const item of curation.exclude) {
    const key = `${item.ecosystem}:${item.name}`.toLowerCase();
    if (byId.has(key)) {
      problems.errors.push(`запись исключена ручным решением, но попала в датасет: ${key}`);
    }
    if (!item.reason) problems.warnings.push(`исключение без причины: ${key}`);
  }
  for (const item of curation.patch) {
    const key = `${item.ecosystem}:${item.name}`.toLowerCase();
    const library = byId.get(key);
    if (!library) {
      problems.warnings.push(`исправление не нашло запись (запись исчезла или опечатка): ${key}`);
      continue;
    }
    for (const [field, value] of Object.entries(item)) {
      // ecosystem и name — ключ, по которому запись найдена, а reason —
      // объяснение для человека; исправляемых полей среди них нет.
      if (field === 'reason' || field === 'ecosystem' || field === 'name') continue;
      if (library[field] !== value) {
        problems.errors.push(`ручное исправление не применилось: ${key}.${field} = ${JSON.stringify(library[field])}, ожидалось ${JSON.stringify(value)}`);
      }
    }
    if (!item.reason) problems.warnings.push(`исправление без причины: ${key}`);
  }
  for (const item of curation.keep) {
    if (!item.reason) problems.warnings.push(`решение оставить без причины: ${curationKey(item.ecosystem, item.name)}`);
  }
  if (curation.exclude.length || curation.patch.length || curation.keep.length) {
    log.info(
      `ручные решения: исключено ${curation.exclude.length}, исправлено полей у ${curation.patch.length}, оставлено ${curation.keep.length}`,
    );
  }
}

/**
 * Копии и форки: каждое найденное совпадение должно иметь записанное решение.
 *
 * Без этого новые копии появлялись бы молча — форк с чужим описанием ничем не
 * отличается от самостоятельной библиотеки, пока не посмотришь описание целиком.
 * Дословные копии и заявленные форки — ошибка, потому что решение по ним
 * однозначно: убрать или оставить с причиной. Переписанные описания — только
 * предупреждение: под этот признак попадают и соседние пакеты одного проекта.
 */
{
  const curation = await loadCuration();
  const decided = new Set([
    ...curation.exclude.map((item) => curationKey(item.ecosystem, item.name)),
    ...curation.keep.map((item) => curationKey(item.ecosystem, item.name)),
  ]);
  const libraries = dataset.libraries ?? [];

  for (const family of findCopies(libraries)) {
    // Решение требуется только по копиям: оригинал остаётся по умолчанию,
    // иначе каждое семейство требовало бы лишней записи о себе.
    for (const copy of family.copies) {
      if (decided.has(copy.id.toLowerCase())) continue;
      problems.errors.push(
        `описание совпадает с описанием ${family.original.id} (загрузок ${family.original.registry?.downloads ?? 0}, звёзд ${family.original.stars ?? 0}), но решения нет: ${copy.id}. Добавьте её в exclude или keep с причиной.`,
      );
    }
  }

  for (const { id, source } of findDeclaredForks(libraries)) {
    if (decided.has(id.toLowerCase())) continue;
    problems.errors.push(
      `описание сообщает о форке (${source}), но решения нет: ${id}. Добавьте её в exclude или keep с причиной.`,
    );
  }

  const unreviewed = findRewrittenCandidates(libraries).filter(
    (pair) => !decided.has(pair.original.id.toLowerCase()) && !decided.has(pair.other.id.toLowerCase()),
  );
  for (const pair of unreviewed) {
    problems.warnings.push(
      `описания пересекаются, но не совпадают (содержание ${pair.containment.toFixed(2)}, общих слов ${pair.shared}): ${pair.original.id} ↔ ${pair.other.id}. Похоже на копию, но под признак попадают и соседние пакеты — посмотрите глазами.`,
    );
  }

  const copies = findCopies(libraries).reduce((sum, family) => sum + family.copies.length, 0);
  if (copies || findDeclaredForks(libraries).length || unreviewed.length) {
    log.info(`копии и форки: дословных копий ${copies}, заявленных форков ${findDeclaredForks(libraries).length}, на проверку ${unreviewed.length}`);
  }
}

// Список проблем печатается, а не только считается: «критичные проблемы
// найдены» без единого слова о том, какие, бесполезны — приходится гадать,
// где чинить. Предупреждений бывает много, поэтому они ограничены.
const shownWarnings = problems.warnings.slice(0, 20);
for (const error of problems.errors) log.error(error);
for (const warning of shownWarnings) log.warn(warning);
for (const note of problems.info) log.info(note);
if (problems.warnings.length > shownWarnings.length) {
  log.warn(`…и ещё предупреждений: ${problems.warnings.length - shownWarnings.length}`);
}

if (problems.errors.length) {
  log.error(`критичных проблем: ${problems.errors.length}`);
  process.exit(1);
}

/** Идентификаторы всех записей из data/curated/*.json. */
async function collectCuratedIds() {
  const ids = new Set();
  let files = [];
  try {
    files = await fs.readdir(CURATED_DIR);
  } catch {
    return ids;
  }
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const payload = JSON.parse(await fs.readFile(path.join(CURATED_DIR, file), 'utf8'));
    for (const item of Array.isArray(payload) ? payload : payload.libraries ?? []) {
      ids.add(makeId(item.ecosystem, item.name));
    }
  }
  return ids;
}
