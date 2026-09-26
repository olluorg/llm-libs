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
  return [...byId.values()].sort(
    (a, b) => (b.stars ?? b.registry.downloads ?? 0) - (a.stars ?? a.registry.downloads ?? 0) || a.id.localeCompare(b.id),
  );
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
