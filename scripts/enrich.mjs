#!/usr/bin/env node
/**
 * Обогащение метаданными GitHub: звёзды, форки, статус архива, лицензия,
 * дата последнего коммита. Использует ETag-кэш, поэтому повторные запуски
 * почти не тратят квоту.
 *
 *   GITHUB_TOKEN=ghp_... node scripts/enrich.mjs     # 5000 запросов/час
 *   node scripts/enrich.mjs                            # 60 запросов/час
 *   node scripts/enrich.mjs --limit=200 --concurrency=4
 */
import path from 'node:path';

import { createLogger } from './lib/log.mjs';
import { fetchRepo, hasToken, mapLimit, rateLimit, repoSlug } from './lib/github.mjs';
import { mergeRecords } from './lib/record.mjs';
import { readDataset, writeDataset, writeJson, OUT_DIR } from './lib/store.mjs';

const log = createLogger('enrich');
const args = parseArgs(process.argv.slice(2));
const limit = Number(args.limit ?? Infinity);
const concurrency = Number(args.concurrency ?? 4);

const dataset = await readDataset();
if (!dataset.libraries?.length) {
  log.error('Датасет пуст — сначала выполните node scripts/collect.mjs');
  process.exit(1);
}

const limitInfo = await rateLimit().catch(() => null);
if (limitInfo) {
  log.info(`GitHub API: осталось ${limitInfo.remaining}/${limitInfo.limit} запросов${hasToken ? ' (с токеном)' : ' (без токена)'}`);
  if (!hasToken && limitInfo.remaining < dataset.libraries.length) {
    log.warn('Без GITHUB_TOKEN хватит не на все записи — используйте ETag-кэш или задайте токен.');
  }
}

const records = dataset.libraries
  .map((record) => ({ record, slug: repoSlug(record.repo) ?? repoSlug(record.homepage) ?? repoSlug(record.registry?.url) }))
  .filter((entry) => entry.slug)
  // Сначала важные записи: курируемые, затем по уверенности и популярности.
  // Так при ограниченной квоте GitHub обогащается именно то, что смотрят чаще.
  .sort(
    (a, b) =>
      Number(isCurated(b.record)) - Number(isCurated(a.record)) ||
      b.record.confidence - a.record.confidence ||
      (b.record.stars ?? b.record.registry?.downloads ?? 0) - (a.record.stars ?? a.record.registry?.downloads ?? 0),
  );

const targets = records.slice(0, Number.isFinite(limit) ? limit : records.length);
log.info(`репозиториев к обновлению: ${targets.length} из ${records.length} записей с ссылкой на GitHub`);

// Без токена GitHub отдаёт 60 запросов в час: обрабатываем столько, сколько осталось.
let queue = targets;
if (limitInfo && limitInfo.remaining < targets.length) {
  queue = targets.slice(0, limitInfo.remaining);
  log.warn(
    `Доступно только ${limitInfo.remaining} запросов GitHub — обработано ${queue.length} из ${targets.length}. ` +
      'Задайте GITHUB_TOKEN и запустите снова: оставшиеся записи доберутся с ETag-кэшем.',
  );
}

const byId = new Map();
let fetched = 0;
let notFound = 0;
let quotaExhausted = false;

await mapLimit(queue, concurrency, async ({ record, slug }) => {
  if (quotaExhausted) return;
  const meta = await fetchRepo(slug).catch((error) => {
    if (error.status === 403 || error.status === 429) {
      quotaExhausted = true;
      log.warn('Квота GitHub исчерпана — останавливаю обогащение');
    }
    log.debug(`GitHub ${slug}: ${error.message}`);
    return null;
  });
  if (!meta) {
    notFound += 1;
    return;
  }
  fetched += 1;
  byId.set(record.id, {
    ...record,
    repo: meta.repo ?? record.repo,
    homepage: record.homepage ?? meta.homepage,
    description: record.description ?? meta.description,
    license: record.license ?? meta.license,
    stars: meta.github.stars,
    github: meta.github,
    status: meta.github.archived ? 'archived' : record.status,
  });
  if (fetched % 25 === 0) log.info(`обработано ${fetched}/${queue.length}`);
});

const enriched = dataset.libraries.map((record) => byId.get(record.id) ?? record);

// Пересчёт: статус «unknown» + свежие коммиты → active; давно без коммитов → deprecated.
const today = Date.now();
const final = enriched.map((record) => {
  if (record.status === 'archived') return record;
  if (record.status === 'active' || record.status === 'deprecated') return record;
  const pushed = record.github?.pushedAt;
  if (!pushed) return record;
  const ageDays = (today - new Date(`${pushed}T00:00:00Z`).getTime()) / 86_400_000;
  const status = ageDays > 730 ? 'deprecated' : ageDays < 400 ? 'active' : 'unknown';
  return status === record.status ? record : mergeRecords(record, { ...record, status });
});

const payload = await writeDataset(final, { stats: dataset.stats });
await writeJson(path.join(OUT_DIR, 'report.json'), {
  ...(dataset.stats ?? {}),
  enrichedAt: new Date().toISOString(),
  github: {
    queued: queue.length,
    fetched,
    notFound,
    skipped: targets.length - queue.length,
    quotaExhausted,
    rateLimit: limitInfo,
    token: hasToken,
  },
  counts: payload.counts,
});

log.info(
  `обогащено записей: ${fetched}, репозиториев не найдено: ${notFound}` +
    (targets.length > queue.length ? `, пропущено из-за квоты: ${targets.length - queue.length}` : ''),
);

function isCurated(record) {
  return (record.source ?? []).some((s) => s.startsWith('curated:'));
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    result[key] = value ?? true;
  }
  return result;
}
