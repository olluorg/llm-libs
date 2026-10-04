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
import { curationKey, curatedIdConflicts, LINK_FIXES_FILE, loadCuration, loadProviders, readCuratedEntries, readDataset, CURATED_DIR, OUT_DIR } from './lib/store.mjs';
import { findForks } from './lib/fork.mjs';
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

// Тип API заполнен только у ролей, которые этот API вызывают. Проверка в
// нормализации записи не заменяет её: правило может разъехаться с ролью при
// правке курируемого файла, и тогда фильтр «по типу API» снова начнёт показывать
// токенизаторам и приложениям чужой тип.
{
  const strayApi = (dataset.libraries ?? []).filter(
    (library) => library.sdkApi && library.sdkApi !== 'n/a' && !CALLS_PROVIDER_API.has(library.role),
  );
  if (strayApi.length) {
    problems.errors.push(
      `у ${strayApi.length} записей тип API задан, хотя роль его не вызывает: ${strayApi.slice(0, 5).map((l) => `${l.id} (${l.role}, ${l.sdkApi})`).join(', ')}`,
    );
  }
  // Обратная сторона: роль клиента без типа API — это запись, у которой тип
  // вывести не удалось. Предупреждение, а не ошибка: из курируемых файлов тип
  // часто не задан, и это не ошибка данных.
  const withoutApi = (dataset.libraries ?? []).filter(
    (library) => CALLS_PROVIDER_API.has(library.role) && (!library.sdkApi || library.sdkApi === 'n/a'),
  );
  if (withoutApi.length) {
    problems.warnings.push(
      `у ${withoutApi.length} записей с ролью клиента не указан тип API — фильтр «по типу API» их не покажет`,
    );
  }
}

// Живые ссылки, которые ведут на другой проект, должны получить решение.
// Аудит умеет находить такое только с сетью, поэтому проверка читает его отчёт
// и молчит, если отчёта нет: локально validate работает без сети.
{
  const report = await fs.readFile(path.join(OUT_DIR, 'link-audit.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  if (report?.nameMismatches?.length) {
    const curation = await loadCuration();
    const decided = new Set([
      ...curation.exclude.map((item) => curationKey(item.ecosystem, item.name)),
      ...curation.keep.map((item) => curationKey(item.ecosystem, item.name)),
    ]);
    const undecided = report.nameMismatches.filter((item) => !decided.has(item.id.toLowerCase()));
    if (undecided.length) {
      problems.warnings.push(
        `ссылка, похожая на другой проект, без решения: ${undecided.length}. ` +
          `Например ${undecided.slice(0, 3).map((item) => `${item.id} → ${item.repo}`).join('; ')}. ` +
          'Добавьте запись в exclude или keep с причиной.',
      );
    } else {
      log.info(`ссылки на другие проекты: ${report.nameMismatches.length}, все с решением`);
    }
  }
}

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
  // Адреса, которые аудит признал верными, — тоже курация: они лежат в
  // data/curated/99-link-fixes.json и по доверию стоят выше остальных файлов.
  // Сверять запись только с 00-curation.json нельзя: там у двенадцати записей
  // лежат адреса, которых больше нет (404), и аудит в этом же прогоне
  // заменил их на актуальные. Проверка видела расхождение и роняла validate
  // каждую ночь, хотя данные к этому моменту уже были верными.
  const audited = await readLinkFixes();
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
      // Адрес сверяется с тем, что аудит признал верным: если аудит заменил
      // мёртвый адрес из патча на живой, расхождения с патчем быть не должно —
      // патч просто устарел, а данные верны.
      const expected = field === 'repo' ? (audited.get(key) ?? value) : value;
      if (library[field] !== expected) {
        problems.errors.push(`ручное исправление не применилось: ${key}.${field} = ${JSON.stringify(library[field])}, ожидалось ${JSON.stringify(expected)}`);
      }
    }
    if (!item.reason) problems.warnings.push(`исправление без причины: ${key}`);
  }
  for (const item of curation.keep) {
    if (!item.reason) problems.warnings.push(`решение оставить без причины: ${curationKey(item.ecosystem, item.name)}`);
  }
  // Один пакет под двумя именами в курируемых файлах: слияние берёт поля из
  // более позднего файла, и расхождение не видно нигде. Betalgo.OpenAI был
  // записан как «OpenAI» рядом с официальной библиотекой OpenAI, и в каталог
  // попал репозиторий Betalgo.
  for (const conflict of curatedIdConflicts(await readCuratedEntries())) {
    problems.errors.push(`один пакет в двух курируемых файлах: ${conflict.id} — ${conflict.from} и ${conflict.to}`);
  }
  // Примечание на странице записи пишет человек; признаки опознавания лежат
  // в matchReasons. Машинный текст в примечании — 321 запись из 456 показывали
  // «Признаки: LLM-признаки в описании», что читателю ничего не сообщает.
  for (const library of dataset.libraries ?? []) {
    if (library.notes?.startsWith('Признаки: ')) {
      problems.errors.push(`машинный текст в примечании: ${library.id}`);
    }
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
  // Один проход по всем парам записей на все три сигнала сразу.
  const forks = findForks(libraries);

  for (const family of forks.copies) {
    // Решение требуется только по копиям: оригинал остаётся по умолчанию,
    // иначе каждое семейство требовало бы лишней записи о себе.
    for (const copy of family.copies) {
      if (decided.has(copy.id.toLowerCase())) continue;
      problems.errors.push(
        `описание совпадает с описанием ${family.original.id} (загрузок ${family.original.registry?.downloads ?? 0}, звёзд ${family.original.stars ?? 0}), но решения нет: ${copy.id}. Добавьте её в exclude или keep с причиной.`,
      );
    }
  }

  for (const { id, source } of forks.declared) {
    if (decided.has(id.toLowerCase())) continue;
    problems.errors.push(
      `описание сообщает о форке (${source}), но решения нет: ${id}. Добавьте её в exclude или keep с причиной.`,
    );
  }

  const unreviewed = forks.rewritten.filter(
    (pair) => !decided.has(pair.original.id.toLowerCase()) && !decided.has(pair.other.id.toLowerCase()),
  );
  for (const pair of unreviewed) {
    problems.warnings.push(
      `описания пересекаются, но не совпадают (содержание ${pair.containment.toFixed(2)}, общих слов ${pair.shared}): ${pair.original.id} ↔ ${pair.other.id}. Похоже на копию, но под признак попадают и соседние пакеты — посмотрите глазами.`,
    );
  }

  const copies = forks.copies.reduce((sum, family) => sum + family.copies.length, 0);
  if (copies || forks.declared.length || unreviewed.length) {
    log.info(`копии и форки: дословных копий ${copies}, заявленных форков ${forks.declared.length}, на проверку ${unreviewed.length}`);
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

/**
 * Адреса, признанные верными аудитом: data/curated/99-link-fixes.json.
 * Ключ — id записи в нижнем регистре, значение — адрес.
 *
 * Файл пишет scripts/audit-links.mjs --apply, и в ночном прогоне он обновляется
 * до validate, поэтому проверка видит решения текущей ночи, а не прошлой.
 * Записи с repoDropped адреса не имеют: там, где аудит удалил ссылку, решает
 * патч, и в map такая запись не попадает.
 */
async function readLinkFixes() {
  const repos = new Map();
  const file = path.join(CURATED_DIR, LINK_FIXES_FILE);
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return repos; // файла нет — проверяем датасет только по 00-curation.json
  }
  for (const item of payload.libraries ?? []) {
    if (item.repoDropped || !item.repo) continue;
    repos.set(makeId(item.ecosystem, item.name), item.repo);
  }
  return repos;
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
