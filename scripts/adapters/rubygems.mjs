import { getJson } from '../lib/http.mjs';

export const ecosystem = 'rubygems';
export const language = 'Ruby';

export async function search(query, { limit = 15 } = {}) {
  const url = `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(query)}`;
  const { data } = await getJson(url);
  return (data ?? [])
    .filter((gem) => gem.name !== 'api')
    .slice(0, limit)
    .map((gem) => ({
      name: gem.name,
      description: gem.info ?? '',
      downloads: gem.downloads,
      repo: normalizeRepo(gem.source_code_uri),
    }));
}

function normalizeRepo(url) {
  if (!url || !/github\.com/i.test(url)) return undefined;
  return url.replace(/\/tree\/.*$/, '').replace(/\/$/, '');
}

export async function fetchMeta(name) {
  const { data } = await getJson(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`);
  if (!data) return null;
  return {
    name: data.name ?? name,
    description: data.info ?? '',
    repo: normalizeRepo(data.source_code_uri),
    docs: normalizeRepo(data.documentation_uri),
    homepage: data.homepage_uri,
    license: Array.isArray(data.licenses) ? data.licenses.join(', ') : data.license,
    registry: {
      url: data.project_uri ?? `https://rubygems.org/gems/${name}`,
      version: data.version,
      downloads: data.downloads,
      downloadsPeriod: 'total',
      updatedAt: data.version_created_at ? String(data.version_created_at).slice(0, 10) : undefined,
    },
  };
}
