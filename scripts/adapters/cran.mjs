import { getJson } from '../lib/http.mjs';
import { stripTags, toInt } from '../lib/text.mjs';

export const ecosystem = 'cran';
export const language = 'R';

/** r-universe зеркалит CRAN и отдаёт удобный JSON с описаниями и метаданными. */
export async function search(query, { limit = 10 } = {}) {
  const { data } = await getJson(`https://cran.r-universe.dev/api/search?q=${encodeURIComponent(query)}`);
  return (data?.results ?? []).slice(0, limit).map((pkg) => ({
    name: pkg.Package,
    description: oneLine(pkg.Title),
    downloads: toInt(pkg._downloads ?? pkg.downloads),
    downloadsPeriod: downloadsPeriod(pkg),
  }));
}

export async function fetchMeta(name) {
  const { data } = await getJson(`https://cran.r-universe.dev/api/packages/${encodeURIComponent(name)}`);
  if (!data?.Package) return null;

  const links = [data.URL, data.BugReports, data.BugReportsURL, ...(data._user ?? [])]
    .filter(Boolean)
    .join(' ')
    .match(/https?:\/\/[^\s,]+/g) ?? [];
  const repo = links
    .map((url) => url.replace(/[.,)]$/, '').replace(/\/(issues|pull|graphs)(\/.*)?$/, ''))
    .find((url) => /github\.com/i.test(url));

  return {
    name: data.Package,
    description: oneLine(data.Description ?? data.Title).slice(0, 500),
    repo,
    homepage: firstUrl(data.URL),
    license: stripTags(data.License ?? '') || undefined,
    registry: {
      url: `https://cran.r-project.org/package=${data.Package}`,
      version: data.Version,
      downloads: toInt(data._downloads ?? data.downloads),
      downloadsPeriod: downloadsPeriod(data),
      updatedAt: publishedAt(data),
    },
  };
}

/**
 * Дата публикации на CRAN. r-universe отдаёт её в нескольких полях —
 * у разных пакетов заполнено разное, поэтому берём первую доступную.
 */
function publishedAt(data) {
  const candidates = [
    data['Date/Publication'],
    data._published,
    data._modified?.at,
    ...(data._releases ?? []).map((release) => release.date),
  ];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return undefined;
}

/** Период счётчика: r-universe прячет его в ссылке на источник. */
function downloadsPeriod(data) {
  const source = data._downloads?.source ?? '';
  if (/last-month|monthly/i.test(source)) return 'month';
  if (/last-week|daily|weekly/i.test(source)) return 'week';
  return data._downloads ? 'total' : undefined;
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstUrl(value) {
  return String(value ?? '').match(/https?:\/\/[^\s,]+/)?.[0]?.replace(/[.,)]$/, '');
}
