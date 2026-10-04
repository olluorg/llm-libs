import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from './log.mjs';
import { mergeRecords, normalizeRecord } from './record.mjs';
// Общий помощник приведения адреса к виду, по которому сравниваются
// репозитории. Раньше он был объявлен здесь же, вторым экземпляром, и в нём
// порядок замен шёл неверно: у ссылки «owner/repo.git/» суффикс .git не
// снимался, и такая запись не совпадала с канонической.
import { repoKey } from './fork.mjs';

const log = createLogger('store');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CONFIG_DIR = path.join(DATA_DIR, 'config');
export const CURATED_DIR = path.join(DATA_DIR, 'curated');
/** Файл исправленных адресов: он по определении переопределяет поля других. */
export const LINK_FIXES_FILE = '99-link-fixes.json';
/** Поля патча, которые правят не данные записи, а саму запись: ключ и причина. */
const PATCH_META_FIELDS = new Set(['ecosystem', 'name', 'reason']);
/** Поля курируемой записи, которые накапливаются, а не заменяются. */
const CURATED_LIST_FIELDS = new Set(['providers', 'worksWith', 'features', 'envVars', 'source']);
export const OUT_DIR = path.join(DATA_DIR, 'out');
export const DIST_DIR = path.join(ROOT, 'dist');

export async function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readConfig(name) {
  return readJson(path.join(CONFIG_DIR, name));
}

export async function loadProviders() {
  const config = await readConfig('providers.json');
  const providers = {};
  for (const provider of config.providers) providers[provider.id] = provider;
  return providers;
}

export async function loadEcosystems() {
  return readConfig('ecosystems.json');
}

const adapterCache = new Map();

export async function loadAdapter(adapterName) {
  if (adapterCache.has(adapterName)) return adapterCache.get(adapterName);
  const module = await import(path.join(ROOT, 'scripts', 'adapters', `${adapterName}.mjs`));
  if (typeof module.search !== 'function' || typeof module.fetchMeta !== 'function') {
    throw new Error(`Адаптер ${adapterName} должен экспортировать search() и fetchMeta()`);
  }
  adapterCache.set(adapterName, module);
  return module;
}

/**
 * Читает сырые строки всех курируемых файлов: [{ file, item }].
 * Вынесено отдельно от loadCurated, потому что расхождения между файлами
 * нужно видеть и до слияния, и в проверках.
 */
export async function readCuratedEntries() {
  let files = [];
  try {
    files = await fs.readdir(CURATED_DIR);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const entries = [];
  for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
    const payload = await readJson(path.join(CURATED_DIR, file));
    const list = Array.isArray(payload) ? payload : payload.libraries ?? [];
    for (const item of list) entries.push({ file, item });
  }
  return entries;
}

/**
 * Один и тот же пакет, записанный в двух курируемых файлах, — это ошибка в
 * имени, а не дополнение: 99-link-fixes.json правит поля, и совпадение с ним
 * ожидаемо, но два полных описания одного пакета означают, что одно из них
 * названо чужим именем. Так Betalgo.OpenAI был записан как «OpenAI» рядом с
 * официальной библиотекой OpenAI, которая лежит в 01-official-sdks.json под
 * тем же именем: слияние брало репозиторий из более позднего файла, и в
 * каталоге у официальной библиотеки оказывался репозиторий Betalgo.
 *
 * Возвращает расхождения по ключу записи, где файлы называют разные
 * репозитории. Файл правок ссылок не считается: он существует именно для
 * того, чтобы переопределить поле у записи, описанной в другом файле.
 */
export function curatedIdConflicts(entries) {
  const isLinkFix = (file) => file === LINK_FIXES_FILE;
  const seen = new Map();
  const conflicts = [];
  for (const { file, item } of entries) {
    if (isLinkFix(file)) continue;
    const id = `${item.ecosystem}:${item.name}`.toLowerCase();
    const previous = seen.get(id);
    if (previous && previous.item.repo && item.repo && previous.item.repo !== item.repo) {
      conflicts.push({ id, from: `${previous.file} → ${previous.item.repo}`, to: `${file} → ${item.repo}` });
    }
    seen.set(id, { file, item });
  }
  return conflicts;
}

/**
 * Доверие к записи в курируемом файле.
 *
 * Обычный курируемый список — 0.9: это ручная правка, но она могла устареть.
 * Файл исправленных адресов — 0.95: там лежит то, что проверено и найдено
 * верным, и он должен выигрывать у остальных файлов по существу, а не потому
 * что «99-» сортируется последним. Иначе достаточно переименовать файл, и в
 * каталог вернутся мёртвые адреса: у hex:ollama в 03-community-clients.json
 * лежит elixir-ollama/ollama, которого нет (404), и правильный адрес
 * aaronrussell/ollama-ex держится только на порядке файлов. То же у
 * crates:tch: pykeio/tch не существует, а tch-rs жив.
 */
export function curatedConfidence(file) {
  return file === LINK_FIXES_FILE ? 0.95 : 0.9;
}

/**
 * Загружает все курируемые записи из data/curated/*.json.
 * Записи с одинаковым id сливаются, а не заменяют друг друга: так отдельный
 * файл правок (99-link-fixes.json) может нести только исправленное поле,
 * не выписывая запись целиком.
 */
/**
 * Слияние двух курируемых записей одного пакета — до normalizeRecord.
 *
 * Списки объединяются, остальное берётся из последней: у pypi:langchain в
 * 02-frameworks.json две записи с восемью и двумя провайдерами, и раньше
 * mergeRecords давал всех десятерых. Списком здесь называется только то, что
 * в normalizeRecord тоже объединяется, — остальное не накапливается.
 */
function mergeCuratedItems(base, patch) {
  const merged = { ...base };
  for (const [field, value] of Object.entries(patch)) {
    if (!CURATED_LIST_FIELDS.has(field)) {
      merged[field] = value;
      continue;
    }
    const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
    merged[field] = [...new Set([...asList(merged[field]), ...asList(value)])];
  }
  return merged;
}

export async function loadCurated() {
  // Файл правок ссылок сливается последним независимо от имени: он правит
  // адрес, и адрес из него должен побеждать устаревший в остальных файлах.
  // На порядок имён полагаться нельзя — файл можно переименовать.
  const entries = await readCuratedEntries();
  const ordered = [
    ...entries.filter(({ file }) => file !== LINK_FIXES_FILE),
    ...entries.filter(({ file }) => file === LINK_FIXES_FILE),
  ];
  const byId = new Map();
  const filesById = new Map();

  for (const { file, item } of ordered) {
    try {
      // id считаем через normalizeRecord: он учитывает явное поле id и
      // приводит имя к каноническому виду, иначе записи не сопоставятся.
      const { id } = normalizeRecord(item);
      const files = filesById.get(id) ?? new Set();
      files.add(file);
      filesById.set(id, files);
      // Слияние — до нормализации, и это главное. Раньше здесь нормализовали
      // каждую запись, а потом сливали, и частичная запись приносила в слияние
      // значения по умолчанию за те поля, которых в ней нет. В 99-link-fixes.json
      // лежит только repo, но normalizeRecord дописывала kind=client и role=sdk,
      // а уверенность файла (0.95) выше, чем у остальных, — и эти выдуманные
      // значения побеждали настоящие. У crates:tch выходило role=sdk при
      // kind=local-runtime, то есть локальный рантайм в списке клиентов API;
      // дымовой тест сайта это видел и ронял прогон.
      byId.set(id, mergeCuratedItems(byId.get(id), item));
    } catch (error) {
      log.warn(`пропущена запись в ${file}: ${error.message}`);
    }
  }

  const records = [];
  for (const [id, item] of byId) {
    try {
      const files = [...(filesById.get(id) ?? [])];
      records.push(
        normalizeRecord({
          ...item,
          // Доверие — наибольшее из файлов: проверенный адрес из файла правок
          // ссылок должен выигрывать устаревший в остальных курируемых файлах.
          confidence: Math.max(...files.map(curatedConfidence)),
          source: [...(item.source ?? []), ...files.map((file) => `curated:${file}`)],
        }),
      );
    } catch (error) {
      log.warn(`пропущена запись ${id}: ${error.message}`);
    }
  }
  log.info(`курируемых записей: ${records.length} (из ${entries.length} строк в ${new Set(entries.map((e) => e.file)).size} файлах)`);
  return records;
}

/**
 * Ручные решения по конкретным записям: data/curated/00-curation.json.
 * Это не часть курируемой базы — файл ничего не добавляет, а решает, что
 * убрать и какие поля поправить.
 */
export async function loadCuration() {
  const payload = await readJson(path.join(CURATED_DIR, '00-curation.json'), { exclude: [], keep: [], patch: [] });
  return { exclude: payload.exclude ?? [], keep: payload.keep ?? [], patch: payload.patch ?? [] };
}

/** Ключ записи в виде, по которому её ищут все списки курирования. */
export const curationKey = (ecosystem, name) => `${ecosystem}:${name}`.toLowerCase();

/**
 * Применяет ручные решения поверх готового набора записей.
 *
 * Вызывается последним, после слияния курируемых данных и автообнаружения,
 * поэтому исправления здесь авторитетны и не зависят от порядка имён файлов
 * в data/curated.
 */
export function applyCuration(records, curation) {
  /**
   * Адрес этой записи пришёл из файла правок ссылок, то есть его проверили по
   * GitHub API в этом же прогоне. Отличить его от адреса, написанного человеком
   * руками, можно по провенансу: loadCurated помечает источник именем файла, и
   * mergeRecords сохраняет эту пометку. Проверенный адрес, по которому не
   * 404, предпочтительнее патча — патч мог устареть.
   *
   * Если аудит удалил ссылку (repoDropped), адреса у записи нет, и патч может
   * его вернуть: это единственный источник, который тут что-то знает.
   */
  const hasAuditedRepo = (record) =>
    Boolean(record.repo) && (record.source ?? []).includes(`curated:${LINK_FIXES_FILE}`);
  // Ключ сравнивается в нижнем регистре, как строится id записи: в CRAN пакет
  // называется `LLM`, а в исключении его естественно написать как `llm`, и при
  // регистрозависимом сравнении правило молча не срабатывало.
  const keyOf = (ecosystem, name) => `${ecosystem}:${name}`.toLowerCase();
  const excluded = new Map(curation.exclude.map((item) => [keyOf(item.ecosystem, item.name), item]));
  // Несколько патчей на одну запись должны сливаться полями, а не вытеснять
  // друг друга. Раньше здесь стоял new Map(curation.patch.map(...)), и записи с
  // одинаковым ключом схлопывались: в Map попадала последняя, а её поля —
  // единственные. У swift:kuarezma/macllm патч role=support стоит выше патча
  // tier=C и молча исчезал, а роль возвращалась к выведенной из описания.
  // Ровно один такой случай был, и он стоил ночного прогона: роль «sdk»
  // вместо «support» — расхождение, которое validate видит как потерю правки.
  const patches = new Map();
  for (const item of curation.patch) {
    const key = keyOf(item.ecosystem, item.name);
    patches.set(key, { ...patches.get(key), ...item });
  }
  const kept = [];
  const dropped = [];
  const patched = [];

  for (const record of records) {
    const key = keyOf(record.ecosystem, record.name);
    if (excluded.has(key)) {
      dropped.push(`${record.ecosystem}:${record.name}`);
      excluded.delete(key);
      continue;
    }
    const patch = patches.get(key);
    if (!patch) {
      kept.push(record);
      continue;
    }
    // ecosystem и name — ключ, по которому запись найдена, а reason —
    // объяснение для человека; исправляемых полей среди них нет. Раньше они
    // попадали и в override, и в отчёт «исправлено полей», где выглядели как
    // правки данных. Набор полей-исключений тот же, что и в validate.mjs.
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([field]) => !PATCH_META_FIELDS.has(field)),
    );
    const { reason } = patch;
    // Адрес, проверенный аудитом, важнее патча, и его надо исключить здесь, а
    // не в цикле ниже: override собирается из полей патча, поэтому мёртвый адрес
    // попал бы в запись через слияние, даже если последнее присваивание
    // пропущено. Патч писали, когда репозиторий был жив; потом его переименовали
    // или удалили, аудит увидел 404 и записал нынешний адрес.
    //
    // Без этого правила порядок шагов refresh (collect → derive → audit →
    // validate) даёт замкнутый круг: derive возвращает адрес, которого больше
    // нет, аудит ломает его заново, validate падает, коммит не происходит — и
    // правка аудита теряется до следующей ночи. Проверяем до того, как адрес
    // перезаписан, иначе слияние успевает подставить патч.
    if (hasAuditedRepo(record)) delete fields.repo;
    // Важно:override собирается из самой записи, а не только из полей патча.
    // normalizeRecord подставляет значения по умолчанию во все поля, и в слиянии
    // более уверенный аргумент побеждал по confidence: патч без поля role
    // возвращал записи роль по умолчанию. Так crates:llm-chain из framework
    // молча стал sdk из-за патча, который трогал только tier.
    const override = normalizeRecord({
      ...record,
      ...fields,
      confidence: 0.95,
      source: ['curation'],
    });
    const merged = mergeRecords(record, override);
    // Явно названное патчем поле авторитетно. Для слияния это неверно: оно
    // выбирает «лучшее» или более специфичное значение, а не более новое, —
    // и патч, который понижает tier или меняет роль на менее «специфичную»,
    // молча не действовал. Правило распространено на все простые поля:
    // списки и объекты не трогаем, их слияние объединяет содержимое.
    for (const [field, value] of Object.entries(fields)) {
      if (value === null || typeof value === 'object') continue;
      merged[field] = value;
    }
    kept.push(merged);
    patched.push({ id: `${record.ecosystem}:${record.name}`, reason, fields: Object.keys(fields) });
    patches.delete(key);
  }

  // Правила, которые ничего не нашли: либо запись уже исчезла и правило
  // устарело, либо в нём опечатка. Молча такое проходить не должно.
  const unmatched = [
    ...[...excluded.values()].map((item) => `${item.ecosystem}:${item.name} (исключение)`),
    ...[...patches.values()].map((item) => `${item.ecosystem}:${item.name} (исправление)`),
  ];
  return { records: kept, dropped, patched, unmatched };
}

export async function readDataset() {
  return readJson(path.join(OUT_DIR, 'libraries.json'), { generatedAt: null, libraries: [] });
}

export async function writeDataset(libraries, extra = {}) {
  const deduped = dedupe(libraries);
  const payload = {
    generatedAt: new Date().toISOString(),
    counts: countBy(deduped),
    libraries: deduped,
    ...extra,
  };

  // Файл переписывается, только если содержимое действительно изменилось.
  // Раньше каждый прогон ставил новую метку времени, и в истории репозитория
  // появлялся коммит, где единственное изменение — timestamp: данных в нём
  // нет, а diff занимает место. В ежедневном прогоне данные меняются всегда,
  // и тогда файл пишется как обычно.
  const file = path.join(OUT_DIR, 'libraries.json');
  const previous = await readJson(file, null);
  if (previous && sameData(previous, payload)) {
    log.info(`датасет не изменился: ${deduped.length} записей, файл оставлен как есть`);
    return previous;
  }
  await writeJson(file, payload);
  log.info(`датасет сохранён: ${deduped.length} записей`);
  return payload;
}

/** Одинаково ли содержание двух наборов данных, если не смотреть на метку времени. */
function sameData(previous, next) {
  const strip = (payload) => JSON.stringify({ ...payload, generatedAt: null });
  return strip(previous) === strip(next);
}

export function dedupe(libraries) {
  const byId = new Map();
  for (const raw of libraries) {
    const record = normalizeRecord(raw);
    const existing = byId.get(record.id);
    byId.set(record.id, existing ? mergeRecords(existing, record) : record);
  }
  return collapseGithubDuplicates([...byId.values()]).sort(
    (a, b) => (b.stars ?? b.registry.downloads ?? 0) - (a.stars ?? a.registry.downloads ?? 0) || a.id.localeCompare(b.id),
  );
}

/**
 * Одна библиотека, посчитанная дважды: запись из GitHub и запись реестра на
 * тот же репозиторий. Признаки одни и те же — те же звёзды, то же описание,
 * — а различается только инструкция установки, и у записи из GitHub она
 * заведомо худшая: «git clone» вместо `luarocks install` или SwiftPM.
 *
 * Остаётся запись реестра, а поля дубля переносятся в неё: у записи из GitHub
 * иногда проставлены провайдеры или описание, которых у записи реестра нет.
 * Порядок слияния обратный именно поэтому — `install` берётся у второго
 * аргумента, то есть у записи реестра.
 */
function collapseGithubDuplicates(records) {
  const byRepo = new Map();
  for (const record of records) {
    const key = repoKey(record.repo);
    if (!key) continue;
    byRepo.set(key, [...(byRepo.get(key) ?? []), record]);
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  const dropped = [];
  for (const group of byRepo.values()) {
    const fromGithub = group.filter((record) => record.ecosystem === 'github');
    const fromRegistry = group.filter((record) => record.ecosystem !== 'github');
    if (!fromGithub.length || !fromRegistry.length) continue;

    for (const target of fromRegistry) {
      for (const duplicate of fromGithub) {
        byId.set(target.id, mergeRecords(duplicate, byId.get(target.id)));
      }
    }
    for (const duplicate of fromGithub) {
      byId.delete(duplicate.id);
      dropped.push(`${duplicate.id} → ${fromRegistry.map((r) => r.id).join(', ')}`);
    }
  }

  if (dropped.length) {
    log.info(`записей GitHub, дублирующих запись реестра: ${dropped.length}, поля перенесены в записи реестра`);
    for (const line of dropped) log.info(`  ${line}`);
  }
  return [...byId.values()];
}

export function countBy(records) {
  const counts = { total: records.length, byEcosystem: {}, byLanguage: {}, byProvider: {}, byRole: {}, byKind: {}, byStatus: {} };
  for (const record of records) {
    bump(counts.byEcosystem, record.ecosystem);
    bump(counts.byLanguage, record.language);
    bump(counts.byKind, record.kind);
    bump(counts.byRole, record.role);
    bump(counts.byStatus, record.status);
    for (const provider of record.providers) bump(counts.byProvider, provider);
  }
  return counts;
}

function bump(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}
