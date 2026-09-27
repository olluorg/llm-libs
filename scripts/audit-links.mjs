#!/usr/bin/env node
/**
 * Аудит ссылок: проверяет, что репозиторий в записи каталога существует,
 * что ссылка указывает на корень репозитория, а не на подпапку или файл,
 * и что каноническое имя совпадает с записанным (репозитории переезжают).
 *
 * Зачем это нужно: ссылки берутся и из курируемых данных (написаны руками),
 * и из реестров. Ошибка в любом из двух источников даёт 404 и неверные звёзды.
 * Пример: у `fireworks-ai` в курируемых данных был репозиторий
 * `fireworks-ai/fireworks-python` (не существует), а реестр указывал на
 * `fw-ai-external/python-sdk`.
 *
 * node scripts/audit-links.mjs               # только отчёт
 * node scripts/audit-links.mjs --apply       # отчёт + правки в data/curated/99-link-fixes.json
 *                                          #   и поправка ссылок прямо в data/out/libraries.json
 * node scripts/audit-links.mjs --only=pypi   # по одной экосистеме
 * node scripts/audit-links.mjs --http        # дополнительно проверять docs/homepage
 */
import path from 'node:path';

import { createLogger } from './lib/log.mjs';
import { getText } from './lib/http.mjs';
import { fetchRepo, mapLimit, repoSlug } from './lib/github.mjs';
import { loadAdapter, loadEcosystems, readDataset, writeDataset, writeJson, CURATED_DIR, OUT_DIR } from './lib/store.mjs';

const log = createLogger('audit');
const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const checkHttp = Boolean(args.http);
const only = args.only ? String(args.only).split(',') : null;

const dataset = await readDataset();
const ecosystems = (await loadEcosystems()).ecosystems;

/** Кандидаты в замену: репозиторий из реестра, из курируемых данных, из homepage. */
const VERDICTS = {
  ok: 'ссылка жива и указывает на корень репозитория',
  canonical: 'репозиторий переехал, ссылка обновлена на каноническую',
  subpath: 'ссылка не на корень репозитория (подпапка, файл, .git, ssh-форма) — приведена к корню',
  nonGithub: 'ссылка не на GitHub, проверяется отдельно (--http)',
  dead: 'репозиторий не найден (404)',
  deadNoSource: 'репозиторий не найден и замены нет',
  fixed: 'ссылка была битой, заменена на найденную в реестре',
};

const results = [];
const slugs = new Set();
/** Живые ссылки, которые, по похоже имён, ведут на другой проект. */
const mismatches = [];
const libraries = dataset.libraries.filter(
  (library) => !only || only.includes(library.ecosystem) || only.includes(library.language),
);

log.info(`проверяю ${libraries.length} записей (режим: ${apply ? 'с применением правок' : 'только отчёт'})`);

await mapLimit(libraries, 8, async (library) => {
  const requested = repoSlug(library.repo);
  if (!requested) {
    results.push({
      id: library.id,
      ecosystem: library.ecosystem,
      name: library.name,
      source: (library.source ?? []).join(','),
      verdict: library.repo ? 'nonGithub' : 'none',
      note: library.repo ?? 'ссылки на репозиторий нет',
      repo: library.repo,
    });
    return;
  }
  slugs.add(requested);

  const canonical = await fetchRepo(requested);
  if (!canonical) {
    const replacement = await findReplacement(library, requested);
    results.push({
      id: library.id,
      ecosystem: library.ecosystem,
      name: library.name,
      // Курируемая запись — наша ответственность, автонайденная чинится сама.
      source: (library.source ?? []).join(','),
      verdict: replacement ? 'fixed' : 'deadNoSource',
      requested,
      replacement: replacement ?? undefined,
      repo: library.repo,
      note: replacement
        ? `404, но реестр указывает на ${replacement}`
        : '404, и реестр не даёт рабочей замены',
    });
    if (replacement) slugs.add(repoSlug(replacement));
    return;
  }

  const canonicalSlug = canonical.slug.toLowerCase();
  // Ссылка живая, но ведёт на другой проект: у pypi:jina репозиторием оказался
  // jina-ai/serve — сервис развёртывания моделей в Kubernetes, и от него же
  // пришли описание и звёзды. Такой сбой не выдаёт себя ничем: 404 нет, пакет
  // живой, а данные в записи от чужого проекта. Адрес автоматически не
  // меняется — какое имя правильное, решает человек, а не совпадение строк.
  const otherProject = nameMismatch(library.name, canonicalSlug);
  if (otherProject) mismatches.push({ id: library.id, name: library.name, repo: canonicalSlug, reason: otherProject });
  // В каталоге ссылка должна быть ровно https://github.com/владелец/репозиторий.
  // Подпапка или файл (`/blob/main/README.md`), `.git`, `git@github.com:…`, `www.`
  // и лишний слэш ссылку не ломают, но её стоит привести к канонической: так
  // каталог выглядит одинаково и ссылки не расходятся между страницами.
  const moved = canonicalSlug !== requested.toLowerCase();
  const isSubpath = linkForm(library.repo) !== `https://github.com/${canonicalSlug}`;
  const subpathNote =
    githubDepth(library.repo) > 2
      ? 'ссылка ведёт в подпапку или файл — усечена до корня'
      : 'формат ссылки приведён к виду https://github.com/владелец/репозиторий';
  const starsChanged = library.stars !== undefined && library.stars !== canonical.github.stars;

  results.push({
    id: library.id,
    ecosystem: library.ecosystem,
    name: library.name,
    source: (library.source ?? []).join(','),
    verdict: moved ? 'canonical' : isSubpath ? 'subpath' : 'ok',
    requested,
    canonical: canonical.repo,
    stars: { recorded: library.stars, actual: canonical.github.stars },
    starsChanged,
    note: moved ? VERDICTS.canonical : isSubpath ? subpathNote : VERDICTS.ok,
  });
});

const problems = results.filter((r) => r.verdict === 'deadNoSource' || r.verdict === 'dead');
const fixed = results.filter((r) => r.verdict === 'fixed' || r.verdict === 'canonical' || r.verdict === 'subpath');
const staleStars = results.filter((r) => r.starsChanged);

// Дополнительно: обычная проверка доступности docs/homepage по HTTP.
const httpProblems = [];
if (checkHttp) {
  const urls = [
    ...new Set(libraries.flatMap((l) => [l.docs, l.homepage].filter(Boolean))),
  ].slice(0, 300);
  log.info(`проверяю доступность ${urls.length} ссылок (docs/homepage)…`);
  const checks = await mapLimit(urls, 8, async (url) => {
    const { status, notFound } = await getText(url, { ttlMs: 0, noCache: true, timeoutMs: 15_000, retries: 0 });
    return { url, ok: status < 400, status, notFound };
  });
  for (const check of checks) {
    if (check && !check.ok) httpProblems.push(check);
  }
}

// Сводка по вердиктам.
const tally = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
log.info('вердикты: ' + Object.entries(tally).map(([k, v]) => `${k} — ${v}`).join(', '));

if (fixed.length) {
  log.warn(`требуют правки: ${fixed.length}`);
  for (const item of fixed.slice(0, 20)) {
    log.warn(
      `  ${item.id}: ${item.requested} → ${item.replacement ?? item.canonical}` +
        (item.starsChanged ? ` (звёзды ${item.stars.recorded} → ${item.stars.actual})` : ''),
    );
  }
}
if (problems.length) {
  log.error(`битые ссылки без замены: ${problems.length}`);
  for (const item of problems.slice(0, 20)) log.error(`  ${item.id}: ${item.requested}`);
}
if (httpProblems.length) {
  log.warn(`не отвечают docs/homepage: ${httpProblems.length}`);
  for (const item of httpProblems.slice(0, 10)) log.warn(`  ${item.url} → ${item.status}`);
}
if (staleStars.length) {
  log.info(`звёзды разошлись с записанными (enrich их обновит): ${staleStars.length}`);
}

await writeJson(path.join(OUT_DIR, 'link-audit.json'), {
  generatedAt: new Date().toISOString(),
  checked: libraries.length,
  uniqueSlugs: slugs.size,
  tally,
  descriptions: VERDICTS,
  // Живые ссылки, которые, по похоже имён, ведут на другой проект. Отдельным
  // списком, а не вердиктом: вердикт здесь означал бы решение, а это только
  // повод посмотреть. Разбор — в data/curated/00-curation.json.
  nameMismatches: mismatches,
  // В отчёт идут все записи, кроме полностью совпавших: расхождения по
  // звёздам — тоже повод посмотреть запись.
  results: results.filter((r) => r.verdict !== 'ok' || r.starsChanged),
  httpProblems,
});

if (apply) {
  const written = await writeFixes(results);
  if (written) log.info(`правки записаны: data/curated/99-link-fixes.json (${written} записей)`);
  await patchDataset(results);
}

// Битая ссылка в курируемой записи — ошибка данных, такой провал останавливает CI.
// В автонайденной записи она чинится следующим прогоном с --apply, поэтому это
// предупреждение, а не ошибка.
const deadCurated = problems.filter((problem) => (problem.source ?? '').includes('curated'));
const deadDiscovered = problems.filter((problem) => !(problem.source ?? '').includes('curated'));

if (deadCurated.length) {
  log.error(`битые ссылки в курируемых записях: ${deadCurated.length}`);
  for (const item of deadCurated.slice(0, 20)) log.error(`  ${item.id}: ${item.requested}`);
  process.exitCode = 1;
}
if (deadDiscovered.length) {
  log.warn(
    `битые ссылки в автонайденных записях: ${deadDiscovered.length} — ` +
      'будут убраны при следующем прогоне с --apply',
  );
  for (const item of deadDiscovered.slice(0, 10)) log.warn(`  ${item.id}: ${item.requested}`);
}

if (mismatches.length) {
  // Не ошибка и не автоправка: у npm-пакета cohere-ai репозиторий cohere-node,
  // и это один проект. Совпадение имён — повод посмотреть глазами, решение
  // принимается в data/curated/00-curation.json.
  log.warn(`живые ссылки, похожие на другой проект: ${mismatches.length} — нужно решение вручную`);
  for (const item of mismatches.slice(0, 20)) log.warn(`  ${item.id}: ${item.reason} (репозиторий ${item.repo})`);
}

report();

async function writeFixes(items) {
  const entries = items
    .filter((item) => ['fixed', 'canonical', 'subpath', 'deadNoSource'].includes(item.verdict))
    .map((item) => {
      if (item.verdict === 'deadNoSource') {
        return {
          name: item.name,
          ecosystem: item.ecosystem,
          repoDropped: true,
          notes: `Аудит удалил ссылку: репозиторий ${item.requested} не найден, замены в реестре нет`,
        };
      }
      return {
        name: item.name,
        ecosystem: item.ecosystem,
        repo: item.replacement ?? item.canonical,
        notes: `Ссылка исправлена аудитом: ${item.requested} → ${item.replacement ?? item.canonical}`,
      };
    });
  if (!entries.length) return 0;

  const file = path.join(CURATED_DIR, '99-link-fixes.json');
  const existing = await readIfExists(file);
  const merged = new Map();
  for (const item of existing?.libraries ?? []) merged.set(`${item.ecosystem}:${item.name}`, item);
  for (const entry of entries) merged.set(`${entry.ecosystem}:${entry.name}`, entry);

  await writeJson(file, {
    $comment:
      'Автоматические правки ссылок, созданные scripts/audit-links.mjs --apply. ' +
      'Не редактировать руками: следующий аудит перезапишет файл.',
    generatedAt: new Date().toISOString(),
    libraries: [...merged.values()],
  });
  return entries.length;
}

/** Ищем замену: репозиторий из реестра, затем из homepage, затем из docs. */
async function findReplacement(library, requested) {
  const config = ecosystems[library.ecosystem];
  const candidates = [];

  if (config) {
    try {
      const adapter = await loadAdapter(config.adapter);
      const meta = await adapter.fetchMeta(library.name);
      if (meta?.repo) candidates.push(meta.repo);
    } catch {
      // Реестр может быть недоступен — это не повод прерывать аудит.
    }
  }
  candidates.push(library.homepage, library.docs, library.registry?.url);

  for (const candidate of candidates) {
    const slug = repoSlug(candidate);
    if (!slug || slug.toLowerCase() === requested.toLowerCase()) continue;
    const found = await fetchRepo(slug);
    if (found) return found.repo;
  }
  return null;
}

/**
 * Похоже ли имя пакета на имя репозитория.
 *
 * Сигнал осторожный: у npm-пакета cohere-ai репозиторий cohere-node, и это
 * один и тот же проект, так что расхождение — повод посмотреть, а не приговор.
 * Поэтому сравниваются не строки, а общие значимые куски: имя пакета без
 * области (@scope/… и @modelcontextprotocol/), без префиксов python-,
 * js-, node- и golang- и без типичных слов openai-sdk, client, api.
 *
 * @returns {string|null} причина расхождения либо null, если похоже
 */
function nameMismatch(packageName, slug) {
  const repoName = slug.split('/').pop()?.toLowerCase() ?? '';
  if (!repoName || !packageName) return null;

  const strip = (value) => value
    .toLowerCase()
    .replace(/^@[^/]+\//, '')                 // область действия npm
    .replace(/^(python|py|js|javascript|node|golang|go|java|dotnet|rust|php|ruby)-/, '')
    .replace(/[-_.]?(sdk|client|api|lib|library|wrapper|bindings?)$/, '');
  const words = (value) => new Set(
    strip(value).split(/[-_.\s]+/).filter((word) => word.length > 2),
  );

  const a = words(packageName);
  const b = words(repoName);
  if (!a.size || !b.size) return null;
  const shared = [...a].filter((word) => b.has(word));
  if (shared.length) return null;
  return `имя пакета «${packageName}» не похоже на имя репозитория «${repoName}» — возможно, это другой проект`;
}


function githubDepth(url) {
  const match = /github\.com[/:]([\w.-]+\/[\w.-]+)(?:\/(.*))?/i.exec(url ?? '');
  if (!match) return 0;
  const rest = (match[2] ?? '').split('/').filter(Boolean);
  return 2 + rest.length;
}

/**
 * Убирает из ссылки только шум (ssh-форму, `www.`, `.git`, слэш в конце),
 * но сохраняет путь внутри репозитория — иначе `/blob/main/README.md`
 * сравнялся бы с корнем репозитория и ошибка проскочила бы.
 */
function linkForm(url) {
  return String(url ?? '')
    .trim()
    .replace(/^git\+/i, '')
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@/i, 'https://')
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, 'https://github.com/')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

/**
 * Применяет найденные правки к датасету: ссылка (или её отсутствие) и звёзды.
 * Нужно, чтобы опубликованный в этом же прогоне сайт уже содержал верные
 * ссылки — иначе правки «доедут» до сайта только на следующем запуске.
 */
async function patchDataset(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  let patched = 0;

  const libraries = dataset.libraries.map((library) => {
    const item = byId.get(library.id);
    if (!item) return library;
    const next = { ...library };

    if (item.verdict === 'deadNoSource' && next.repo) delete next.repo;
    else if (item.replacement ?? item.canonical) {
      const repo = item.replacement ?? item.canonical;
      if (next.repo !== repo) next.repo = repo;
    }
    if (item.stars?.actual !== undefined && next.stars !== item.stars.actual) {
      next.stars = item.stars.actual;
    }
    if (JSON.stringify(next) === JSON.stringify(library)) return library;
    patched += 1;
    return next;
  });

  if (patched) {
    await writeDataset(libraries);
    log.info(`датасет поправлен на месте: ${patched} записей`);
  }
  return patched;
}

async function readIfExists(file) {
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function report() {
  const broken = problems.length;
  if (!broken) log.info('аудит ссылок: все ссылки на репозиторий живы');
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
