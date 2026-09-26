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
import { loadProviders, readDataset, CURATED_DIR } from './lib/store.mjs';
import { makeId } from './lib/record.mjs';
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
log.info(
  `итог: ${total} записей · курируемых ${curatedCount} из ${curatedIds.size} · автоматически ${total - curatedCount}` +
    ` · со звёздами ${withStars} · с репозиторием ${withRepo}`,
);

if (problems.errors.length) {
  log.error('критичные проблемы найдены');
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
