import { getJson } from '../lib/http.mjs';

export const ecosystem = 'nuget';
export const language = 'C#';

export async function search(query, { limit = 20 } = {}) {
  const url = `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(query)}&take=${limit}`;
  const { data } = await getJson(url);
  return (data?.data ?? []).map((pkg) => ({
    name: pkg.id,
    description: pkg.description ?? '',
    version: pkg.version,
    downloads: pkg.totalDownloads,
    repo: normalizeRepo(pkg.projectUrl),
    homepage: pkg.projectUrl,
    updatedAt: pkg.publishedDate ? String(publishedDate(pkg)).slice(0, 10) : undefined,
  }));
}

function publishedDate(pkg) {
  const value = pkg.publishedDate;
  if (typeof value === 'string') return value;
  return value?.['@@ticks'] ? new Date(Number(value['@@ticks'])).toISOString() : '';
}

function normalizeRepo(url) {
  if (!url || !/github\.com/i.test(url)) return undefined;
  return url
    .replace(/\/(tree|blob)\/.*$/, '')
    .replace(/\/$/, '');
}

export async function fetchMeta(name) {
  const { data } = await getJson(
    `https://azuresearch-usnc.nuget.org/query?q=packageid:${encodeURIComponent(name)}&take=1`,
  );
  const pkg = data?.data?.[0];
  if (!pkg) return null;
  return {
    name: pkg.id,
    description: pkg.description ?? '',
    repo: normalizeRepo(pkg.projectUrl),
    homepage: pkg.projectUrl,
    registry: {
      url: `https://www.nuget.org/packages/${pkg.id}`,
      version: pkg.version,
      downloads: pkg.totalDownloads,
      downloadsPeriod: 'total',
      updatedAt: publishedDate(pkg) || undefined,
    },
  };
}
