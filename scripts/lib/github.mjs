import { getJson } from './http.mjs';
import { createLogger } from './log.mjs';

const log = createLogger('github');

const API = 'https://api.github.com';
const HEADERS = { accept: 'application/vnd.github+json' };

export const hasToken = Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

export function authHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return token ? { ...HEADERS, authorization: `Bearer ${token}` } : HEADERS;
}

/**
 * Интервал между запросами к api.github.com.
 *
 * Часовая квота с токеном — 5000 запросов, то есть около 83 в минуту.
 * Прежний общий интервал в 120 мс давал 480 в минуту, шестикратный перерасход:
 * квота заканчивалась в середине сбора, и дальше каждый запрос упирался в 403.
 * 800 мс — это 75 запросов в минуту, 4500 в час: запас есть.
 */
export function githubGapMs() {
  return hasToken ? Number(process.env.GITHUB_GAP_MS ?? 800) : Number(process.env.GITHUB_GAP_MS ?? 61_000);
}

/** Из URL вида https://github.com/openai/openai-node → "openai/openai-node". */
export function repoSlug(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) return null;
  const [, owner, repo] = match;
  if (['orgs', 'users', 'topics', 'settings', 'apps', 'collections'].includes(owner)) return null;
  return `${owner}/${repo}`;
}

export async function rateLimit() {
  const { data } = await getJson(`${API}/rate_limit`, { headers: authHeaders(), noCache: true });
  return data?.resources?.core ?? null;
}

export async function fetchRepo(slug) {
  const { data, status } = await getJson(`${API}/repos/${slug}`, { headers: authHeaders(), gapMs: githubGapMs() });
  if (!data || status === 404 || data.message) return null;
  return {
    slug: data.full_name,
    description: data.description ?? '',
    repo: data.html_url,
    homepage: data.homepage || undefined,
    license: data.license?.spdx_id && data.license.spdx_id !== 'NOASSERTION' ? data.license.spdx_id : undefined,
    topics: (data.topics ?? []).join(' '),
    language: data.language ?? undefined,
    github: {
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      archived: data.archived === true,
      pushedAt: data.pushed_at ? data.pushed_at.slice(0, 10) : undefined,
    },
  };
}

/**
 * Последний релиз на GitHub. Нужен там, где реестр пакета не отдаёт дату
 * (Maven Central, часть записей NuGet и CRAN) или не отдаёт её вовсе.
 * Репозиторий без релизов отвечает 404 — это не ошибка, а отсутствие данных.
 */
export async function fetchLatestRelease(slug) {
  const { data, status } = await getJson(`${API}/repos/${slug}/releases/latest`, {
    headers: authHeaders(),
    gapMs: githubGapMs(),
  });
  if (status === 404 || !data || data.message || data.tag_name === undefined) return null;
  return {
    tag: data.tag_name,
    publishedAt: data.published_at ? String(data.published_at).slice(0, 10) : undefined,
    url: data.html_url,
  };
}

/** Пул с ограничением параллелизма. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { __error: error.message };
        log.debug(`ошибка на элементе ${index}: ${error.message}`);
      }
    }
  });
  await Promise.all(runners);
  return results;
}
