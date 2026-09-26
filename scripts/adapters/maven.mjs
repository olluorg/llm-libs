import { getJson, getText } from '../lib/http.mjs';
import { matchAll, stripTags } from '../lib/text.mjs';

export const ecosystem = 'maven';
export const language = 'Java';

/**
 * Поиск артефактов. Три режима:
 *  - `group:artifact` — точная координата;
 *  - `g:group` или просто `group.id` — листинг группы на repo1.maven.org
 *    (у solrsearch он отстаёт от фактических публикаций, поэтому так надёжнее);
 *  - всё остальное — текстовый поиск solrsearch.
 */
export async function search(query, { limit = 20 } = {}) {
  const trimmed = query.trim();
  const groupQuery = trimmed.match(/^g:(.+)$/i);
  if (groupQuery) {
    const artifacts = await listGroup(groupQuery[1]);
    return artifacts.slice(0, limit).map((artifact) => ({ name: `${groupQuery[1]}:${artifact}` }));
  }

  const exact = trimmed.match(/^([\w.-]+):([\w.-]+)$/);
  if (exact) {
    const [meta] = await exactSearch(exact[1], exact[2]);
    return meta ? [meta] : [];
  }

  const group = trimmed.match(/^((?:[a-z0-9-]+\.)+[a-z0-9-]+)$/i);
  if (group) {
    const artifacts = await listGroup(group[1]);
    return artifacts.slice(0, limit).map((artifact) => ({ name: `${group[1]}:${artifact}` }));
  }

  return solrSearch(trimmed, limit);
}

async function solrSearch(query, limit) {
  const { data } = await getJson(
    `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=${limit}&wt=json`,
    { timeoutMs: 20_000 },
  );
  return (data?.response?.docs ?? []).map((doc) => ({
    name: `${doc.g}:${doc.a}`,
    group: doc.g,
    artifact: doc.a,
    version: doc.latestVersion ?? doc.v,
    updatedAt: doc.timestamp ? new Date(doc.timestamp).toISOString().slice(0, 10) : undefined,
  }));
}

async function exactSearch(group, artifact) {
  const url =
    `https://search.maven.org/solrsearch/select?q=g:${encodeURIComponent(group)}` +
    `+AND+a:${encodeURIComponent(artifact)}&rows=1&wt=json`;
  const { data } = await getJson(url, { timeoutMs: 20_000 });
  const doc = data?.response?.docs?.[0];
  if (doc) return [{ name: `${doc.g}:${doc.a}`, group: doc.g, artifact: doc.a, version: doc.latestVersion }];
  // Индекс может отставать — проверяем наличие напрямую.
  const { notFound } = await getText(pomUrl(`${group}:${artifact}`, 'maven-metadata.xml'), { timeoutMs: 15_000 });
  return notFound ? [] : [{ name: `${group}:${artifact}`, group, artifact }];
}

/** Листинг артефактов группы: /maven2/<group/path>/. */
async function listGroup(group) {
  const { text, notFound } = await getText(`https://repo1.maven.org/maven2/${group.split('.').join('/')}/`, {
    timeoutMs: 20_000,
  });
  if (notFound) return [];
  return matchAll(text, /<a href="([\w.-]+)\/"[^>]*>/g)
    .filter((name) => name !== '..' && !name.startsWith('.'))
    .filter((name, index, list) => list.indexOf(name) === index);
}

export async function fetchMeta(name) {
  if (!name.includes(':')) return null;
  const { version, pom } = await fetchPom(name);
  if (!version) return null;

  return {
    name,
    description: pomDescription(pom) ?? '',
    repo: pomScm(pom),
    license: pomLicense(pom),
    registry: {
      url: `https://central.sonatype.com/artifact/${name.replace(':', '/')}`,
      version,
    },
  };
}

function pomUrl(name, file) {
  const [group, artifact] = name.split(':');
  const groupPath = group.split('.').join('/');
  return `https://repo1.maven.org/maven2/${groupPath}/${artifact}/${file}`;
}

/** POM последней версии: описание, лицензия, scm.url. */
async function fetchPom(name) {
  const { text: metadata } = await getText(pomUrl(name, 'maven-metadata.xml'), { timeoutMs: 20_000 });
  const version = matchAll(metadata, /<latest>([^<]+)<\/latest>/)[0];
  if (!version) return { version: undefined, pom: '' };
  const artifact = name.split(':')[1];
  const { text, notFound } = await getText(pomUrl(name, `${version}/${artifact}-${version}.pom`), {
    timeoutMs: 20_000,
  });
  return { version, pom: notFound ? '' : text };
}

function pomDescription(pom) {
  const description = pom?.match(/<description>([\s\S]*?)<\/description>/i)?.[1];
  if (description) return stripTags(description).slice(0, 400);
  return stripTags(pom?.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? '').slice(0, 300) || undefined;
}

function pomScm(pom) {
  const scm = pom?.match(/<scm>([\s\S]*?)<\/scm>/i)?.[1] ?? '';
  const url = stripTags(scm.match(/<url>([\s\S]*?)<\/url>/i)?.[1] ?? '');
  return url ? url.replace(/\/tree\/.*$/, '').replace(/\/$/, '') : undefined;
}

function pomLicense(pom) {
  const name = stripTags(pom?.match(/<licenses>([\s\S]*?)<\/licenses>/i)?.[1]?.match(/<name>([\s\S]*?)<\/name>/i)?.[1] ?? '');
  return name || undefined;
}
