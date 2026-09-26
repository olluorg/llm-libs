import { getJson } from '../lib/http.mjs';

export const ecosystem = 'packagist';
export const language = 'PHP';

export async function search(query, { limit = 15 } = {}) {
  const url = `https://packagist.org/search.json?q=${encodeURIComponent(query)}`;
  const { data } = await getJson(url);
  return (data?.results ?? []).slice(0, limit).map((pkg) => ({
    name: pkg.name,
    description: pkg.description ?? '',
    downloads: pkg.downloads,
    repo: pkg.repository,
    homepage: pkg.homepage,
  }));
}

export async function fetchMeta(name) {
  // Основной источник — страница пакета; при его недоступности (rate limit)
  // откатываемся на зеркало метаданных repo.packagist.org.
  const { data } = await getJson(`https://packagist.org/packages/${name}.json`).catch(() => ({ data: null }));
  if (data?.package) return fromPage(data.package);
  return fetchFromMirror(name).catch(() => null);
}

function fromPage(pkg) {
  const stable = Object.values(pkg.versions ?? {})
    .filter((info) => info.version && !/^dev-|-dev-|\+|@|alpha|beta|rc/i.test(info.version))
    .sort((a, b) => compareNewestFirst(a.version_normalized, b.version_normalized))[0];

  return {
    name: pkg.name,
    description: pkg.description ?? '',
    repo: pkg.repository,
    homepage: pkg.homepage,
    license: Array.isArray(pkg.license) ? pkg.license.join(', ') : pkg.license,
    registry: {
      url: `https://packagist.org/packages/${pkg.name}`,
      version: stable?.version,
      downloads: typeof pkg.downloads === 'object' ? pkg.downloads.total : pkg.downloads,
      updatedAt: stable?.time ? String(stable.time).slice(0, 10) : undefined,
    },
  };
}

async function fetchFromMirror(name) {
  const { data } = await getJson(`https://repo.packagist.org/p2/${name}.json`);
  const versions = data?.packages?.[name];
  if (!versions) return null;

  const stable = Object.values(versions)
    .filter((info) => info.version && !/^dev-|-dev-|\+|@|alpha|beta|rc/i.test(info.version))
    .map((info) => ({ ...info, sortKey: normalizeVersion(info.version) }))
    .sort((a, b) => compareNewestFirst(a.sortKey, b.sortKey))[0];
  if (!stable) return null;

  return {
    name,
    description: stable.description ?? stable.desc ?? '',
    repo: stable.source?.url,
    registry: {
      url: `https://packagist.org/packages/${name}`,
      version: stable.version,
      updatedAt: stable.time ? String(stable.time).slice(0, 10) : undefined,
    },
  };
}

/** v1.2.3-beta.1 → 1.2.3.0 (для сравнения версий). */
function normalizeVersion(version = '') {
  const [core] = version.split('-');
  return core.split('.').map((part) => Number(part) || 0).slice(0, 4).map((n) => n).concat([0, 0, 0, 0]).join('.');
}

/** Компаратор для sort(): ставит более новую версию раньше. */
function compareNewestFirst(a = '', b = '') {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return -diff;
  }
  return 0;
}
