import { getJson } from '../lib/http.mjs';

export const ecosystem = 'hex';
export const language = 'Elixir';

export async function search(query, { limit = 10 } = {}) {
  const { data } = await getJson(`https://hex.pm/api/packages?search=${encodeURIComponent(query)}&sort=recent_downloads`);
  return (data ?? []).slice(0, limit).map((pkg) => ({
    name: pkg.name,
    downloads: pkg.downloads?.all_time ?? pkg.downloads,
    recentDownloads: pkg.downloads?.recent,
    repo: pkg.meta?.links?.GitHub ?? pkg.repository,
    homepage: pkg.links?.Hexdocs,
    updatedAt: pkg.updated_at,
  }));
}

export async function fetchMeta(name) {
  const { data } = await getJson(`https://hex.pm/api/packages/${encodeURIComponent(name)}`);
  const pkg = data;
  if (!pkg) return null;
  return {
    name: pkg.name,
    description: pkg.meta?.description ?? '',
    repo: pkg.meta?.links?.GitHub ?? pkg.repository,
    docs: pkg.links?.Hexdocs,
    homepage: pkg.links?.Hexdocs,
    license: pkg.meta?.licenses?.[0],
    registry: {
      url: `https://hex.pm/packages/${pkg.name}`,
      version: pkg.latest_version,
      downloads: pkg.downloads?.all_time,
      updatedAt: pkg.updated_at ? String(pkg.updated_at).slice(0, 10) : undefined,
    },
  };
}
