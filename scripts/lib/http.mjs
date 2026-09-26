import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from './log.mjs';

const log = createLogger('http');

const CACHE_DIR = path.resolve('.cache/http');
const USER_AGENT =
  process.env.USER_AGENT ??
  'openllmdocs/0.1 (+automated package-metadata collector for the LLM libraries catalog)';

/** ETag-aware cache, so повторные запуски почти не тратят квоту GitHub. */
const etags = new Map();

let cacheDirReady = null;
function ensureCacheDir() {
  cacheDirReady ??= fs.mkdir(CACHE_DIR, { recursive: true });
  return cacheDirReady;
}

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** Минимальный лимитер: последовательная очередь на хост + минимальный интервал. */
const hostLocks = new Map();
const hostGaps = new Map();

function acquireHost(host, gapMs) {
  const previous = hostLocks.get(host) ?? Promise.resolve();
  const previousGap = hostGaps.get(host) ?? 0;
  const now = Date.now();
  const wait = Math.max(0, previousGap - now);

  let release;
  const mine = new Promise((resolve) => {
    release = resolve;
  });
  hostLocks.set(host, previous.then(() => mine));
  hostGaps.set(host, Math.max(now, previousGap) + gapMs);

  return previous.then(() => (wait > 0 ? new Promise((r) => setTimeout(r, wait)) : undefined)).then(release);
}

const DEFAULT_GAP_MS = Number(process.env.HTTP_GAP_MS ?? 120);

function cachePath(url) {
  return path.join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.json`);
}

async function readCache(url) {
  try {
    return JSON.parse(await fs.readFile(cachePath(url), 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(url, entry) {
  try {
    await ensureCacheDir();
    await fs.writeFile(cachePath(url), JSON.stringify(entry));
  } catch (error) {
    log.debug(`кэш не записан (${url}): ${error.message}`);
  }
}

/**
 * GET любой endpoint, отдаёт { text, status, fromCache, notFound }.
 * Кэш на диске + ETag + повторы с backoff + учёт x-ratelimit-reset.
 */
export async function getText(url, options = {}) {
  const {
    ttlMs = 6 * 60 * 60 * 1000,
    gapMs = DEFAULT_GAP_MS,
    noCache = false,
    headers = {},
    timeoutMs = 45_000,
    retries = 3,
  } = options;

  const cached = noCache ? null : await readCache(url);
  if (cached) {
    // Отрицательный кэш (404) живёт недолго: реестры быстро меняются.
    const lifetime = cached.status === 404 ? 15 * 60 * 1000 : ttlMs;
    if (cached.fetchedAt + lifetime > Date.now()) {
      log.debug(`CACHE ${cached.status} ${url} (${Math.round((Date.now() - cached.fetchedAt) / 1000)}s)`);
      return { text: cached.text, status: cached.status, fromCache: true, notFound: cached.status === 404 };
    }
  }

  const host = new URL(url).host;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await acquireHost(host, gapMs);
    const started = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          ...(etags.get(url) ? { 'if-none-match': etags.get(url) } : {}),
          ...headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      const etag = response.headers.get('etag');
      if (etag) etags.set(url, etag);
      log.debug(`GET ${response.status} ${url} (${Date.now() - started}ms)`);

      if (response.status === 304) {
        if (cached) {
          await writeCache(url, { ...cached, fetchedAt: Date.now() });
          return { text: cached.text, status: 304, fromCache: true };
        }
        // Кэша нет, а сервер ответил 304 — повторяем без условного заголовка.
        etags.delete(url);
        if (attempt === retries) {
          throw new HttpError(`HTTP 304 без кэша для ${url}`, { status: 304, url });
        }
        continue;
      }

      if (response.status === 404) {
        await writeCache(url, { url, fetchedAt: Date.now(), status: 404, text: '' });
        return { text: '', status: 404, fromCache: false, notFound: true };
      }

      if (response.status === 429 || response.status >= 500) {
        const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000;
        const retryAfter = Number(response.headers.get('retry-after') ?? 0) * 1000;
        const wait = Math.min(
          Math.max(retryAfter, reset - Date.now(), 2 ** attempt * 1000),
          180_000,
        );
        if (attempt === retries) {
          throw new HttpError(`HTTP ${response.status} для ${url}`, { status: response.status, url });
        }
        log.warn(`${url} → ${response.status}, ждём ${Math.round(wait / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }

      if (!response.ok) {
        throw new HttpError(`HTTP ${response.status} для ${url}`, { status: response.status, url });
      }

      const text = await response.text();
      await writeCache(url, { url, fetchedAt: Date.now(), status: response.status, text });
      return { text, status: response.status, fromCache: false };
    } catch (error) {
      lastError = error;
      const status = error instanceof HttpError ? error.status : undefined;
      if (status && status < 500 && status !== 429) throw error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 750));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson(url, options = {}) {
  const { text, status, fromCache, notFound } = await getText(url, {
    accept: 'application/json',
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
  });
  if (notFound || !text) return { data: null, status, fromCache };
  try {
    return { data: JSON.parse(text), status, fromCache };
  } catch (error) {
    throw new HttpError(`Ответ не JSON: ${url}`, { status, url, body: text.slice(0, 200) });
  }
}
