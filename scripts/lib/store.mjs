import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from './log.mjs';
import { mergeRecords, normalizeRecord } from './record.mjs';

const log = createLogger('store');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CONFIG_DIR = path.join(DATA_DIR, 'config');
export const CURATED_DIR = path.join(DATA_DIR, 'curated');
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
 * Загружает все курируемые записи из data/curated/*.json.
 * Записи с одинаковым id сливаются, а не заменяют друг друга: так отдельный
 * файл правок (99-link-fixes.json) может нести только исправленное поле,
 * не выписывая запись целиком.
 */
export async function loadCurated() {
  const byId = new Map();
  let files = [];
  try {
    files = await fs.readdir(CURATED_DIR);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  files = files.filter((f) => f.endsWith('.json')).sort();
  let total = 0;

  for (const file of files) {
    const payload = await readJson(path.join(CURATED_DIR, file));
    const list = Array.isArray(payload) ? payload : payload.libraries ?? [];
    for (const item of list) {
      try {
        const record = normalizeRecord({
          confidence: 0.9,
          ...item,
          source: [...(item.source ?? []), `curated:${file}`],
        });
        const existing = byId.get(record.id);
        byId.set(record.id, existing ? mergeRecords(existing, record) : record);
        total += 1;
      } catch (error) {
        log.warn(`пропущена запись в ${file}: ${error.message}`);
      }
    }
  }
  const records = [...byId.values()];
  log.info(`курируемых записей: ${records.length} (из ${total} строк в ${files.length} файлах)`);
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
  // Ключ сравнивается в нижнем регистре, как строится id записи: в CRAN пакет
  // называется `LLM`, а в исключении его естественно написать как `llm`, и при
  // регистрозависимом сравнении правило молча не срабатывало.
  const keyOf = (ecosystem, name) => `${ecosystem}:${name}`.toLowerCase();
  const excluded = new Map(curation.exclude.map((item) => [keyOf(item.ecosystem, item.name), item]));
  const patches = new Map(curation.patch.map((item) => [keyOf(item.ecosystem, item.name), item]));
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
    const { reason, ...fields } = patch;
    const override = normalizeRecord({
      ...fields,
      ecosystem: record.ecosystem,
      name: record.name,
      confidence: 0.95,
      source: ['curation'],
    });
    const merged = mergeRecords(record, override);
    // mergeRecords выбирает лучшее значение, а не более новое: tier, например,
    // не понижается никогда. Для ручного решения это неверно — «исправлено» со
    // значением ниже исходного должно означать именно понижение, иначе запись
    // с недоказанным качеством невозможно исправить.
    if (patch.tier !== undefined) merged.tier = patch.tier;
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
  await writeJson(path.join(OUT_DIR, 'libraries.json'), payload);
  log.info(`датасет сохранён: ${deduped.length} записей`);
  return payload;
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

const repoKey = (repo) => (repo ?? '').toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');

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
