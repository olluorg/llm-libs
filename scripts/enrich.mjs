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
import { fetchLatestRelease, fetchRepo, hasToken, mapLimit, rateLimit, repoSlug } from './lib/github.mjs';
import { mergeRecords } from './lib/record.mjs';
import { readDataset, writeDataset, writeJson, OUT_DIR } from './lib/store.mjs';

const log = createLogger('enrich');
const args = parseArgs(process.argv.slice(2));
const limit = Number(args.limit ?? Infinity);
const concurrency = Number(args.concurrency ?? 4);
// all — обновлять дату релиза у всех записей, missing — только там, где реестр
// её не дал (экономит квоту: в daily-запуске разница невелика).
const releaseMode = args.releases ?? 'missing';
if (!['all', 'missing', 'none'].includes(releaseMode)) {
  log.error(`--releases принимает all | missing | none, а не «${releaseMode}»`);
  process.exit(1);
}

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
let releasesFetched = 0;
let releasesWithDate = 0;

/**
 * Исчерпана ли часовая квота GitHub — и тогда прогон пора останавливать.
 *
 * Раньше любой 403 считался исчерпанием квоты, и прогон обрывался на 70-й
 * записи из 430: GitHub отдаёт 403 ещё и за вторичный лимит запросов (слишком
 * много параллельных обращений), который через минуту проходит сам. Теперь
 * останавливаемся только когда `x-ratelimit-remaining: 0` — это настоящее
 * ограничение часовой квоты, ждать его бессмысленно.
 */
function isHourlyQuotaExhausted(error) {
  if (error?.status === 429) return true;
  return error?.status === 403 && (error.rateLimitRemaining === 0 || error.retryAfter);
}

await mapLimit(queue, concurrency, async ({ record, slug }) => {
  if (quotaExhausted) return;
  // Сетевая ошибка и «репозитория нет» — разные вещи: при ошибке запись
  // оставляем как есть (вернёмся к ней в следующем прогоне), иначе транзиентный
  // 403 молча удалил бы сотни ссылок на репозитории.
  let meta = null;
  let failed = false;
  try {
    meta = await fetchRepo(slug);
  } catch (error) {
    failed = true;
    if (isHourlyQuotaExhausted(error)) {
      quotaExhausted = true;
      log.warn('Часовая квота GitHub исчерпана — останавливаю обогащение');
    } else if (error?.status === 403) {
      log.debug(`${slug}: 403 без признаков лимита, пропускаю до следующего прогона`);
    } else {
      log.debug(`GitHub ${slug}: ${error.message}`);
    }
  }
  if (failed) {
    byId.set(record.id, record);
    return;
  }
  if (!meta) {
    notFound += 1;
    // Репозиторий 404: у курируемой записи это ошибка данных (показываем явно),
    // у автонайденной — убираем битую ссылку, чтобы сайт не вёл в никуда.
    if (isCurated(record)) {
      log.warn(`репозиторий не найден у курируемой записи: ${record.ecosystem}:${record.name} → ${slug}`);
      byId.set(record.id, record);
    } else {
      byId.set(record.id, { ...record, repo: undefined, repoMissing: true });
    }
    return;
  }
  fetched += 1;

  // Дата релиза на GitHub — запасной источник там, где реестр её не отдал.
  const needsRelease = releaseMode === 'all' || (releaseMode === 'missing' && !record.registry?.updatedAt);
  let release = null;
  if (needsRelease) {
    releasesFetched += 1;
    release = await fetchLatestRelease(slug).catch((error) => {
      if (isHourlyQuotaExhausted(error)) quotaExhausted = true;
      log.debug(`release ${slug}: ${error.message}`);
      return null;
    });
    if (release?.publishedAt) releasesWithDate += 1;
  }

  byId.set(record.id, {
    ...record,
    repo: meta.repo ?? record.repo,
    homepage: record.homepage ?? meta.homepage,
    description: record.description ?? meta.description,
    license: record.license ?? meta.license,
    stars: meta.github.stars,
    github: {
      ...meta.github,
      releasedAt: release?.publishedAt ?? record.github?.releasedAt,
      latestRelease: release?.tag ?? record.github?.latestRelease,
    },
    status: meta.github.archived ? 'archived' : record.status,
  });
  if (fetched % 25 === 0) log.info(`обработано ${fetched}/${queue.length}`);
});

const enriched = dataset.libraries.map((record) => byId.get(record.id) ?? record);

// Пересчёт статуса по свежести: ориентируемся на релиз, если он есть,
// иначе — на последний коммит.
const today = Date.now();
const final = enriched.map((record) => {
  if (record.status === 'archived') return record;
  if (record.status === 'active' || record.status === 'deprecated') return record;
  const fresh = record.latestRelease ?? record.github?.pushedAt;
  if (!fresh) return record;
  const ageDays = (today - new Date(`${fresh}T00:00:00Z`).getTime()) / 86_400_000;
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
    releases: { mode: releaseMode, requested: releasesFetched, withDate: releasesWithDate },
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
if (releasesFetched) {
  log.info(`релизы на GitHub (${releaseMode}): запросов ${releasesFetched}, с датой ${releasesWithDate}`);
}

// Отчёт по источникам даты: видно, что осталось без даты и почему.
const withoutDate = final.filter((r) => !r.latestRelease);
if (withoutDate.length) {
  const byEcosystem = withoutDate.reduce((acc, r) => ({ ...acc, [r.ecosystem]: (acc[r.ecosystem] ?? 0) + 1 }), {});
  log.warn(
    `без даты релиза: ${withoutDate.length} записей (${Object.entries(byEcosystem)
      .sort((a, b) => b[1] - a[1])
      .map(([eco, count]) => `${eco} ${count}`)
      .join(', ')})`,
  );
}

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
