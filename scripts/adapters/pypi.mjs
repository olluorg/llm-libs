import { getJson, getText } from '../lib/http.mjs';
import { createLogger } from '../lib/log.mjs';
import { unique } from '../lib/text.mjs';

const log = createLogger('pypi');

export const ecosystem = 'pypi';
export const language = 'Python';

const SIMPLE_INDEX = 'https://pypi.org/simple/';

/**
 * У PyPI нет JSON-поиска, а HTML-страница поиска рендерится на клиенте.
 * Поэтому берём официальный индекс /simple/ (≈45 МБ, кэшируется на неделю)
 * и фильтруем названия пакетов по поисковым терминам.
 */
async function index() {
  const { text } = await getText(SIMPLE_INDEX, { ttlMs: 7 * 24 * 60 * 60 * 1000, timeoutMs: 120_000 });
  const names = new Set();
  for (const match of text.matchAll(/>([A-Za-z0-9][A-Za-z0-9._-]{0,80})</g)) names.add(match[1].toLowerCase());
  log.debug(`в индексе PyPI ${names.size} пакетов`);
  return names;
}

export async function search(query, { limit = 40 } = {}) {
  const names = await index();
  const needle = query.toLowerCase();
  const tokens = needle.split(/[^a-z0-9.+]+/).filter((t) => t.length >= 3);

  const scored = [];
  for (const name of names) {
    if (name === needle) scored.push([0, name]);
    else if (name.includes(needle) && needle.length >= 4) scored.push([1, name]);
    else if (tokens.length > 1 && tokens.every((t) => name.includes(t))) scored.push([2, name]);
    else if (tokens.length > 1 && tokens.some((t) => name.includes(t))) scored.push([3, name]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, limit).map(([, name]) => ({ name }));
}

function normalizeRepo(url) {
  if (!url) return undefined;
  if (/github\.com/i.test(url)) return url.replace(/\/tree\/.*$/, '').replace(/\/$/, '');
  return undefined;
}

export async function fetchMeta(name) {
  const { data } = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!data?.info) return null;

  const info = data.info;
  const projectUrls = info.project_urls ?? {};
  const urlValues = Object.values(projectUrls);
  const repo =
    normalizeRepo(info.home_page) ??
    normalizeRepo(urlValues.find((u) => /github\.com/i.test(u))) ??
    normalizeRepo(urlValues.find((u) => /gitlab|bitbucket|codeberg/i.test(u)));

  const docs = urlValues.find((u) => /readthedocs|docs?\.|documentation/i.test(u) && !/github\.com/i.test(u));
  const uploads = (data.urls ?? []).map((f) => f.upload_time_iso_8601).sort();
  const latestUpload = uploads.at(-1);

  let downloads;
  try {
    // pypistats — бесплатный сервис с IP-лимитом и обновлением данных раз
    // в сутки. Кэшируем на сутки: их же рекомендация — не дёргать один
    // эндпоинт чаще раза в день. Без этого каждый прогон получал десятки
    // 429 и упирался в ожидания.
    const { data: stats } = await getJson(`https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`, {
      gapMs: 1500,
      retries: 2,
      timeoutMs: 15_000,
      ttlMs: 24 * 60 * 60 * 1000,
    });
    downloads = stats?.data?.last_month;
  } catch (error) {
    log.debug(`pypistats недоступен для ${name}: ${error.message}`);
  }

  return {
    name,
    description: info.summary ?? '',
    repo,
    docs,
    homepage: info.home_page,
    license: info.license_expression || info.license || undefined,
    registry: {
      url: `https://pypi.org/project/${name}/`,
      version: info.version,
      downloads,
      downloadsPeriod: downloads === undefined ? undefined : 'month',
      updatedAt: latestUpload ? latestUpload.slice(0, 10) : undefined,
    },
  };
}

