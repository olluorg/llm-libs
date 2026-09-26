import { getJson } from '../lib/http.mjs';

export const ecosystem = 'npm';
export const language = 'TypeScript';

export async function search(query, { limit = 30 } = {}) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
  const { data } = await getJson(url);
  return (data?.objects ?? []).map(({ package: pkg }) => ({
    name: pkg.name,
    description: pkg.description ?? '',
    version: pkg.version,
    downloads: undefined,
    repo: pkg.links?.repository,
    homepage: pkg.links?.homepage,
    keywords: (pkg.keywords ?? []).join(' '),
    publishedAt: pkg.date,
  }));
}

export async function fetchMeta(name) {
  const { data } = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  if (!data) return null;

  const latest = data['dist-tags']?.latest;
  const versionInfo = latest ? data.versions?.[latest] : undefined;
  const time = data.time?.[latest];

  let downloads;
  try {
    const { data: stats } = await getJson(
      `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`,
    );
    downloads = stats?.downloads;
  } catch {
    downloads = undefined;
  }

  const repoUrl = versionInfo?.repository?.url ?? versionInfo?.homepage;

  return {
    name,
    description: versionInfo?.description ?? data.description ?? '',
    repo: repoUrl?.startsWith('git+') ? repoUrl.replace(/^git\+/, '').replace(/\.git$/, '') : repoUrl,
    docs: versionInfo?.homepage,
    homepage: versionInfo?.homepage,
    license: versionInfo?.license ?? data.license,
    keywords: (versionInfo?.keywords ?? []).join(' '),
    registry: {
      url: `https://www.npmjs.com/package/${name}`,
      version: latest,
      downloads,
      downloadsPeriod: downloads === undefined ? undefined : 'month',
      updatedAt: time ? String(time).slice(0, 10) : undefined,
    },
  };
}
