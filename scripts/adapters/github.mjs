import { getJson } from '../lib/http.mjs';

export const ecosystem = 'github';
export const language = 'Other';

/**
 * Универсальный discovery через GitHub Search: покрывает языки без
 * нормальных реестров (C++, Kotlin, Scala, Swift, Zig, Haskell, OCaml, Clojure).
 */
export async function search(query, { limit = 25 } = {}) {
  const url =
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}` +
    `&sort=stars&order=desc&per_page=${Math.min(limit, 30)}`;
  const { data } = await getJson(url, { headers: { accept: 'application/vnd.github+json' } });
  return (data?.items ?? []).map((repo) => ({
    name: repo.full_name,
    description: repo.description ?? '',
    repo: repo.html_url,
    homepage: repo.homepage || undefined,
    language: repo.language ?? undefined,
    stars: repo.stargazers_count,
    downloads: repo.forks_count,
    topics: (repo.topics ?? []).join(' '),
    updatedAt: repo.pushed_at ? repo.pushed_at.slice(0, 10) : undefined,
    license: repo.license?.spdx_id,
  }));
}

export async function fetchMeta(name) {
  const { data } = await getJson(`https://api.github.com/repos/${name}`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!data || data.message) return null;
  return {
    name,
    description: data.description ?? '',
    repo: data.html_url,
    homepage: data.homepage || undefined,
    language: data.language ?? undefined,
    license: data.license?.spdx_id,
    topics: (data.topics ?? []).join(' '),
    github: {
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      archived: data.archived,
      pushedAt: data.pushed_at ? data.pushed_at.slice(0, 10) : undefined,
    },
    registry: {
      url: data.html_url,
      downloads: data.forks_count,
      updatedAt: data.pushed_at ? data.pushed_at.slice(0, 10) : undefined,
    },
  };
}
