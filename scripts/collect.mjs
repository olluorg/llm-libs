#!/usr/bin/env node
/**
 * Сбор каталога: курируемые записи + автоматическое обнаружение в реестрах.
 *
 * Примеры:
 *   node scripts/collect.mjs                          # всё
 *   node scripts/collect.mjs --ecosystems=pypi,npm     # только выбранные
 *   node scripts/collect.mjs --curated-only            # без похода в сеть
 *   node scripts/collect.mjs --min-score=5 --max-per-ecosystem=40
 */
import path from 'node:path';

import { createLogger, log as rootLog } from './lib/log.mjs';
import { repoSlug } from './lib/github.mjs';
import {
  applyCuration, dedupe, loadAdapter, loadCurated, loadCuration, loadEcosystems, loadProviders,
  writeDataset, writeJson, OUT_DIR,
} from './lib/store.mjs';
import { mergeRecords } from './lib/record.mjs';
import { inferEnvVars, inferFeatures, inferKind, inferSdkApi, inferStatus, roleForKind } from './lib/infer.mjs';
import { confidenceFromScore, scoreCandidate, tierFromScore } from './lib/score.mjs';

const log = createLogger('collect');

/**
 * Отсев шаблонных заготовок: пакеты, оставленные автором «на будущее»
 * с плейсхолдерными ссылками и описаниями-заглушками. В каталоге им не место.
 */
const PLACEHOLDER = /(your[-_ ]?(repo|url|username|name|project)|example\.(com|org)|github\.com\/(user|username|your|test|example)\b|<your|todo|change me|lorem ipsum|coming soon|добавьте|заполните)/i;

function isJunk(candidate, meta) {
  const links = [meta.repo, meta.homepage, meta.docs].filter(Boolean).join(' ');
  const description = meta.description || candidate.description || '';
  if (links && PLACEHOLDER.test(links)) return true;
  if (PLACEHOLDER.test(description)) return true;
  // Ни описания, ни репозитория, ни версии — запись не о чем.
  return !description && !meta.repo && !meta.registry?.version;
}

const args = parseArgs(process.argv.slice(2));
const options = {
  ecosystems: args.ecosystems ? String(args.ecosystems).split(',').map((s) => s.trim()) : null,
  queries: args.queries ? String(args.queries).split(',').map((s) => s.trim()) : null,
  minScore: Number(args['min-score'] ?? 3.8),
  maxPerEcosystem: Number(args['max-per-ecosystem'] ?? 40),
  curatedOnly: Boolean(args['curated-only']),
  skipCurated: Boolean(args['skip-curated']),
  noFetch: Boolean(args['no-fetch']),
};

const providers = await loadProviders();
const { ecosystems, queries: queryConfig } = await loadEcosystems();

const stats = {
  startedAt: new Date().toISOString(),
  perEcosystem: {},
  errors: [],
};

/** 1. Курируемая база — фундамент каталога. */
const curated = options.skipCurated ? [] : await verifyCurated(await loadCurated());
const discovered = [];

/**
 * Проставляет курируемым записям живые метаданные реестра (версия, загрузки,
 * лицензия, описание), не затирая ручные правки: приоритет у курируемой записи.
 */
async function verifyCurated(records) {
  if (options.curatedOnly) return records;
  const logV = createLogger('verify');
  const verified = [];

  for (const record of records) {
    const config = ecosystems[record.ecosystem];
    if (!config) {
      verified.push(record);
      continue;
    }
    try {
      const adapter = await loadAdapter(config.adapter);
      const meta = (await adapter.fetchMeta(record.name)) ?? (await resolveByName(adapter, record, logV));
      if (!meta) {
        logV.warn(`«${record.name}» не найден в реестре ${record.ecosystem} — оставляем как есть`);
        verified.push({ ...record, notes: appendNote(record.notes, 'не найден в реестре при проверке') });
        continue;
      }
      const fromRegistry = {
        name: record.name,
        description: meta.description || record.description,
        ecosystem: record.ecosystem,
        language: record.language,
        repo: meta.repo,
        docs: meta.docs,
        homepage: meta.homepage,
        license: meta.license,
        registry: meta.registry,
        github: meta.github,
        stars: meta.github?.stars,
        status: record.status === 'unknown' ? inferStatus({ description: meta.description, updatedAt: meta.registry?.updatedAt }) : record.status,
        confidence: 0.5,
        source: [`registry:${record.ecosystem}`],
      };
      // Реестр и курируемые данные могут указывать на один репозиторий по-разному
      // (`git@github.com:…`, `/blob/main/README.md`, подпапка монорепо). Сравниваем
      // по владельцу и имени репозитория; если это разные репозитории —
      // предупреждение (живость ссылки проверяет scripts/audit-links.mjs).
      const curatedSlug = repoSlug(record.repo);
      const registrySlug = repoSlug(meta.repo);
      if (meta.repo && curatedSlug && registrySlug && curatedSlug !== registrySlug) {
        logV.warn(
          `ссылка на репозиторий расходится с реестром: ${record.ecosystem}:${record.name} — ` +
            `курируемые «${curatedSlug}», реестр «${registrySlug}»`,
        );
      }

      verified.push(mergeRecords(fromRegistry, record));
    } catch (error) {
      logV.debug(`проверка ${record.name} не удалась: ${error.message}`);
      stats.errors.push({ ecosystem: record.ecosystem, package: record.name, error: error.message });
      verified.push(record);
    }
  }

  logV.info(`проверено курируемых записей: ${verified.length}`);
  return verified;
}

function appendNote(notes, extra) {
  return notes ? `${notes}; ${extra}` : extra;
}

/**
 * Страховка для записей, у которых поменялся путь в реестре (например, репозиторий
 * переехал или переименован): ищем точное совпадение по имени и подставляем найденное.
 * Нечёткие совпадения игнорируем — лучше потерять автозаполнение, чем записать
 * в каталог чужой репозиторий.
 */
async function resolveByName(adapter, record, logV) {
  if (record.ecosystem !== 'github') return null;
  const wanted = record.name.toLowerCase();
  const found = await adapter.search(`${record.name} in:name`, { limit: 10 }).catch(() => []);
  const exact = found.find((item) => item.name.toLowerCase() === wanted);
  if (!exact) return null;
  logV.info(`«${record.name}» не подтвердился, но найден в поиске GitHub — репозиторий актуален`);
  return { ...exact, name: record.name };
}

if (!options.curatedOnly) {
  const targets = Object.entries(ecosystems).filter(
    ([id]) => !options.ecosystems || options.ecosystems.includes(id),
  );

  for (const [id, config] of targets) {
    const queries = (options.queries ?? queryConfig[id] ?? []).slice(0, 60);
    if (!queries.length) {
      log.info(`${id}: запросов нет, пропускаем`);
      continue;
    }

    const adapter = await loadAdapter(config.adapter);
    const logAd = createLogger(id);
    const candidates = new Map();

    for (const query of queries) {
      try {
        const found = await adapter.search(query, { limit: config.limit });
        for (const item of found) {
          if (!item?.name) continue;
          const scored = scoreCandidate({ ...item, query }, providers);
          const previous = candidates.get(item.name);
          if (!previous || scored.score > previous.score) {
            candidates.set(item.name, { ...item, query, ...scored, ecosystem: id });
          }
        }
        logAd.debug(`«${query}» → ${found.length} результатов`);
      } catch (error) {
        logAd.warn(`запрос «${query}» не удался: ${error.message}`);
        stats.errors.push({ ecosystem: id, query, error: error.message });
      }
    }

    const accepted = [...candidates.values()]
      .filter((c) => c.score >= options.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxPerEcosystem);

    logAd.info(`${candidates.size} кандидатов → ${accepted.length} прошли порог (score ≥ ${options.minScore})`);

    const collected = [];
    // Флаг «квота GitHub кончилась»: он ставится, когда запрос упал с таким
    // признаком, и тогда экосистема заканчивается досрочно, а не зависает.
    let quotaHit = false;
    for (const candidate of accepted) {
      if (options.noFetch) {
        collected.push(candidateToRecord(candidate, { registry: {} }, config, id, adapter));
        continue;
      }
      try {
        const meta = await adapter.fetchMeta(candidate.name);
        if (!meta) {
          logAd.debug(`fetchMeta → null для ${candidate.name}`);
          continue;
        }
        if (!languageAllowed(config, meta, candidate, logAd)) continue;
        if (isJunk(candidate, meta)) {
          logAd.debug(`${candidate.name}: похоже на шаблонную заготовку, пропускаем`);
          continue;
        }
        collected.push(candidateToRecord(candidate, meta, config, id, adapter));
      } catch (error) {
        // Исчерпана часовая квота GitHub: ждать до сброса бессмысленно,
        // запись без звёзд соберётся в следующем прогоне. Останавливаем
        // только текущую экосистему — остальные реестры не от GitHub.
        if (error.quotaExhausted) {
          quotaHit = true;
          logAd.warn(`${id}: часовая квота GitHub исчерпана, часть записей останется без звёзд до следующего прогона`);
          break;
        }
        logAd.debug(`fetchMeta ${candidate.name}: ${error.message}`);
        stats.errors.push({ ecosystem: id, package: candidate.name, error: error.message });
      }
    }

    discovered.push(...collected);
    stats.perEcosystem[id] = { candidates: candidates.size, accepted: accepted.length, collected: collected.length };
    rootLog.info(`${id}: готово, ${collected.length} записей`);
  }
}

const merged = dedupe([...curated, ...discovered]);
// Ручные решения (исключения и исправления полей) — последними: они авторитетны
// и не должны зависеть от того, в каком файле лежат курируемые записи.
const curation = await loadCuration();
const { records: curated2, dropped, patched, unmatched } = applyCuration(merged, curation);
if (dropped.length) rootLog.info(`исключено по ручному решению: ${dropped.length} (${dropped.join(", ")})`);
if (patched.length) rootLog.info(`исправлено полей по ручному решению: ${patched.map((p) => p.id).join(", ")}`);
if (unmatched.length) rootLog.warn(`ручные решения ничего не нашли: ${unmatched.join(", ")} — опечатка или правило устарело`);
const payload = await writeDataset(curated2, { stats });
await writeJson(path.join(OUT_DIR, 'report.json'), {
  ...stats,
  finishedAt: new Date().toISOString(),
  counts: payload.counts,
});

log.info(`всего: ${all.length} записей (курируемых ${curated.length}, найдено ${discovered.length})`);
for (const [ecosystem, data] of Object.entries(payload.counts.byEcosystem)) {
  log.info(`  ${ecosystem.padEnd(10)} ${String(data).padStart(4)}`);
}
if (stats.errors.length) {
  log.warn(`ошибок сбора: ${stats.errors.length} (см. data/out/report.json)`);
}

/**
 * GitHub-репозиторий может попасть в поиск по чужому языку: в срез «Swift»
 * не должны попадать Go- и Python-проекты, и наоборот.
 */
function languageAllowed(config, meta, candidate, logAd) {
  const language = meta.language ?? candidate.language;
  if (config.languageFilter && language !== config.languageFilter) {
    logAd.debug(`${candidate.name}: язык ${language ?? 'не определён'} ≠ ${config.languageFilter}, пропускаем`);
    return false;
  }
  if (config.excludeLanguages?.includes(language)) {
    logAd.debug(`${candidate.name}: язык ${language} исключён для этой экосистемы`);
    return false;
  }
  return true;
}

function candidateToRecord(candidate, meta, config, ecosystem, adapter) {
  const name = meta.name ?? candidate.name;
  const description = meta.description || candidate.description || '';
  const providersForRecord = candidate.providers?.length ? candidate.providers : inferProvidersFromText(`${name} ${description}`);
  const downloads = meta.registry?.downloads ?? meta.downloads ?? candidate.downloads;
  const updatedAt = meta.registry?.updatedAt ?? candidate.updatedAt;
  const confidence = confidenceFromScore(candidate.score);
  const kind = inferKind(name, description, providersForRecord);
  const role = roleForKind(kind);

  return {
    name,
    displayName: meta.displayName ?? name,
    description,
    ecosystem,
    language: meta.language ?? candidate.language ?? adapter.language ?? config.language,
    // Рантаймы и сопутствующие инструменты не вызывают API провайдера:
    // normalizeRecord перенесёт их провайдеров в worksWith.
    role,
    kind,
    providers: providersForRecord,
    worksWith: meta.worksWith,
    openaiCompatibleServer: meta.openaiCompatibleServer,
    sdkApi: inferSdkApi(providersForRecord),
    status: inferStatus({ description, updatedAt }),
    tier: capTier(tierFromScore(candidate.score, downloads), confidence),
    features: inferFeatures(name, description),
    // Ключи окружения нужны только клиентам API: у рантаймов их нет.
    envVars: role === 'sdk' ? inferEnvVars(providersForRecord, providers) : [],
    install: (config.install ?? '{name}').replace('{name}', name).replace('{group}', meta.group ?? '').replace('{artifact}', meta.artifact ?? ''),
    repo: meta.repo ?? candidate.repo,
    docs: meta.docs,
    homepage: meta.homepage ?? candidate.homepage,
    license: meta.license,
    registry: {
      url: meta.registry?.url,
      version: meta.registry?.version ?? candidate.version,
      downloads,
      // Адаптер сообщает, что измеряет его счётчик: месяц, накопительно
      // с публикации или число импортов модуля.
      downloadsPeriod: meta.registry?.downloadsPeriod ?? meta.downloadsPeriod ?? candidate.downloadsPeriod,
      updatedAt,
    },
    github: meta.github,
    stars: meta.github?.stars ?? candidate.stars,
    confidence,
    source: [`discovery:${ecosystem}`],
    notes: candidate.reasons?.length ? `Признаки: ${candidate.reasons.slice(0, 2).join('; ')}` : undefined,
  };
}

/** Уровень A оставляем только за курируемыми записями: автонайденное подтверждаем на глаз. */
function capTier(tier, confidence) {
  if (!tier) return tier;
  if (tier === 'A' && confidence < 0.8) return 'B';
  return tier;
}

function inferProvidersFromText(text) {
  const haystack = text.toLowerCase();
  const found = [];
  for (const provider of Object.values(providers)) {
    if ((provider.keywords ?? []).some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      found.push(provider.id);
    }
  }
  return found;
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
