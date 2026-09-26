import zlib from 'node:zlib';

import { getJson } from '../lib/http.mjs';
import { createLogger } from '../lib/log.mjs';

const log = createLogger('nuget');

export const ecosystem = 'nuget';
export const language = 'C#';

/**
 * Поисковый индекс NuGet отдаёт версию, но часто не отдаёт ни дату публикации,
 * ни ссылку на репозиторий. Registration API даёт и то, и другое, но тело
 * страниц сжато gzip'ом без заголовка content-encoding — распаковываем вручную.
 */
const REGISTRATION = 'https://api.nuget.org/v3/registration5-gz-semver2';

export async function search(query, { limit = 20 } = {}) {
  const url = `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(query)}&take=${limit}`;
  const { data } = await getJson(url);
  return (data?.data ?? []).map((pkg) => ({
    name: pkg.id,
    description: pkg.description ?? '',
    version: pkg.version,
    downloads: pkg.totalDownloads,
    downloadsPeriod: 'total',
    repo: normalizeRepo(pkg.projectUrl),
  }));
}

function normalizeRepo(url) {
  if (!url) return undefined;
  const match = String(url).match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/i);
  return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

function gunzip(buffer) {
  return buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer).toString() : buffer.toString();
}

export async function fetchMeta(name) {
  // Поисковый индекс нужен ради счётчика загрузок, registration — ради даты
  // публикации, репозитория и лицензии. Ни один из них не покрывает всё.
  const [searched, registered] = await Promise.all([searchPackage(name), fromRegistration(name)]);
  if (!searched && !registered) return null;
  if (!searched) {
    log.debug(`${name}: нет данных в поисковом индексе, беру только registration`);
    return registered;
  }
  if (!registered) {
    log.debug(`${name}: registration не ответил, беру поисковый индекс`);
    return searched;
  }

  return {
    ...searched,
    description: registered.description || searched.description,
    repo: registered.repo ?? searched.repo,
    docs: registered.docs ?? searched.docs,
    homepage: searched.homepage ?? registered.homepage,
    license: registered.license ?? searched.license,
    registry: {
      ...searched.registry,
      version: registered.registry.version ?? searched.registry.version,
      updatedAt: registered.registry.updatedAt ?? searched.registry.updatedAt,
    },
  };
}

async function searchPackage(name) {
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
      updatedAt: searchDate(pkg),
    },
  };
}

function searchDate(pkg) {
  const value = pkg.publishedDate ?? pkg.lastEdited;
  if (!value) return undefined;
  const iso = typeof value === 'object' ? value['@ticks'] ? new Date(Number(value['@ticks'])).toISOString() : undefined : String(value);
  return iso ? iso.slice(0, 10) : undefined;
}

async function fromRegistration(name) {
  const indexUrl = `${REGISTRATION}/${encodeURIComponent(name.toLowerCase())}/index.json`;
  const pages = await readPages(indexUrl);
  if (!pages.length) return null;

  const lastEntry = pages.at(-1)?.items?.at(-1)?.catalogEntry;
  if (!lastEntry) return null;

  return {
    name,
    description: lastEntry.description ?? '',
    repo: normalizeRepo(lastEntry.repositoryUrl),
    docs: normalizeRepo(lastEntry.projectUrl),
    homepage: lastEntry.projectUrl ?? undefined,
    license: lastEntry.licenseExpression ?? undefined,
    registry: {
      url: `https://www.nuget.org/packages/${name}`,
      version: lastEntry.version,
      downloadsPeriod: 'total',
      updatedAt: lastEntry.published ? String(lastEntry.published).slice(0, 10) : undefined,
    },
  };
}

/** Читает index.json и догружает страницы, где версии не встроены. */
async function readPages(indexUrl) {
  const index = await rawJson(indexUrl);
  if (!index) return [];

  const pages = [];
  for (const page of index.items ?? []) {
    if (page.items?.length) {
      pages.push(page);
      continue;
    }
    const loaded = page['@id'] ? await rawJson(page['@id']) : null;
    if (loaded?.items?.length) pages.push(loaded);
  }
  return pages;
}

async function rawJson(url) {
  const { data } = await getJson(url, { raw: true });
  if (!data) return null;
  if (typeof data === 'object') return data;
  return JSON.parse(gunzip(data));
}
