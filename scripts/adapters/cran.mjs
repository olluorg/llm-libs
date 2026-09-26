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
      updatedAt: data._modified?.at
        ? String(data._modified.at).slice(0, 10)
        : data.Date?.Publication
          ? String(data.Date.Publication).slice(0, 10)
          : undefined,
    },
  };
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstUrl(value) {
  return String(value ?? '').match(/https?:\/\/[^\s,]+/)?.[0]?.replace(/[.,)]$/, '');
}
