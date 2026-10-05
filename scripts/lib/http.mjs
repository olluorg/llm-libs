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
  constructor(message, { status, url, body, rateLimitRemaining, retryAfter, quotaExhausted } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
    // Заголовки нужны, чтобы отличать исчерпание часовой квоты (останавливаем
    // прогон) от вторичного лимита (достаточно подождать и повторить).
    this.rateLimitRemaining = rateLimitRemaining;
    this.retryAfter = retryAfter;
    this.quotaExhausted = quotaExhausted === true;
  }
}

/** Минимальный лимитер: последовательная очередь на хост + минимальный интервал. */
const hostLocks = new Map();
const hostGaps = new Map();

// Ожидание считается в момент, когда подошла очередь, а не при постановке в неё:
// иначе паузы ожидающих складывались, и при N параллельных запросах интервал
// вырастал примерно в N раз.
function acquireHost(host, gapMs) {
  const previous = hostLocks.get(host) ?? Promise.resolve();
  const mine = previous.then(async () => {
    const wait = (hostGaps.get(host) ?? 0) - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    hostGaps.set(host, Date.now() + gapMs);
  });
  hostLocks.set(host, mine);
  return mine;
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

      // 403 от GitHub бывает двух видов: запрет доступа (повтор не поможет)
      // и вторичный лимит запросов (нужно подождать). Различаем по заголовкам.
      const remainingHeader = response.headers.get('x-ratelimit-remaining');
      const retryAfterHeader = Number(response.headers.get('retry-after') ?? 0);
      const isRateLimited =
        response.status === 429 ||
        (response.status === 403 && (remainingHeader === '0' || retryAfterHeader > 0));

      if (isRateLimited || response.status >= 500) {
        const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000;
        // Исчерпанная часовая квота: ждать бесполезно, до сброса до часа.
        // Такой запрос сразу помечаем в ошибке и отдаём вызывающему — он
        // остановит фазу. Иначе collect ждал по 180 секунд на каждый
        // репозиторий и прогон упирался в таймаут.
        const hourlyExhausted = remainingHeader === '0';
        if (hourlyExhausted) {
          throw new HttpError(`HTTP ${response.status} для ${url}: часовая квота исчерпана`, {
            status: response.status,
            url,
            rateLimitRemaining: 0,
            retryAfter: retryAfterHeader || undefined,
            quotaExhausted: true,
          });
        }
        const wait = Math.min(
          Math.max(retryAfterHeader * 1000, reset - Date.now(), 2 ** attempt * 1000),
          180_000,
        );
        if (attempt === retries) {
          throw new HttpError(`HTTP ${response.status} для ${url}`, {
            status: response.status,
            url,
            rateLimitRemaining: remainingHeader === null ? undefined : Number(remainingHeader),
            retryAfter: retryAfterHeader || undefined,
          });
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
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 750));    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson(url, options = {}) {
  const { text, status, fromCache } = await getText(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
  });
  // Некоторые API (например, NuGet registration) отдают тело, сжатое gzip'ом
  // без заголовка content-encoding: такие ответы адаптер распаковывает сам.
  if (options.raw) return { data: text, status, fromCache };
  if (!text) return { data: null, status, fromCache };
  try {
    return { data: JSON.parse(text), status, fromCache };
  } catch (error) {
    throw new HttpError(`Ответ не JSON: ${url}`, { status, url, body: text.slice(0, 200) });
  }
}
