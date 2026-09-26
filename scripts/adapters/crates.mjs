import { getJson } from '../lib/http.mjs';

export const ecosystem = 'crates';
export const language = 'Rust';

export async function search(query, { limit = 20 } = {}) {
  const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=${limit}`;
  const { data } = await getJson(url);
  return (data?.crates ?? []).map((crate) => ({
    name: crate.id,
    description: crate.description ?? '',
    version: crate.max_stable_version ?? crate.max_version,
    downloads: crate.downloads,
    recentDownloads: crate.recent_downloads,
    repo: crate.repository,
    homepage: crate.homepage,
    updatedAt: crate.updated_at,
  }));
}

export async function fetchMeta(name) {
  const { data } = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
  const crate = data?.crate;
  if (!crate) return null;
  return {
    name,
    description: crate.description ?? '',
    repo: crate.repository,
    homepage: crate.homepage,
    license: crate.license ?? undefined,
    downloads: crate.downloads,
    recentDownloads: crate.recent_downloads,
    registry: {
      url: `https://crates.io/crates/${name}`,
      version: crate.max_stable_version ?? crate.max_version,
      downloads: crate.downloads,
      updatedAt: crate.updated_at ? String(crate.updated_at).slice(0, 10) : undefined,
    },
  };
}
