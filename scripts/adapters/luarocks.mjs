import { getText } from '../lib/http.mjs';
import { decodeEntities, parseCompactNumber, stripTags, toInt } from '../lib/text.mjs';

export const ecosystem = 'luarocks';
export const language = 'Lua';

/** LuaRocks не имеет JSON API — аккуратно вычитываем HTML выдачи. */
export async function search(query, { limit = 10 } = {}) {
  const { text } = await getText(`https://luarocks.org/search?q=${encodeURIComponent(query)}`);
  const rows = [...text.matchAll(/<li class="module_row">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  return rows.slice(0, limit).map((row) => {
    const modulePath = row.match(/<a href="\/modules\/([^"]+)" class="title">/)?.[1];
    if (!modulePath) return null;
    return {
      name: modulePath.split('/').pop(),
      module: modulePath,
      description: stripTags(row.match(/<div class="summary">([\s\S]*?)<\/div>/)?.[1] ?? ''),
      downloads: parseCompactNumber(
        decodeEntities(row.match(/downloads:\s*<span title="([\d,]+)"/)?.[1] ?? ''),
      ),
    };
  }).filter(Boolean);
}

export async function fetchMeta(name) {
  const modulePath = await resolveModulePath(name);
  if (!modulePath) return null;

  const { text, notFound } = await getText(`https://luarocks.org/modules/${modulePath}`);
  if (notFound) return null;

  const summary = stripTags(text.match(/<p class="module_summary">([\s\S]*?)<\/p>/)?.[1] ?? '');
  const repo = text.match(/class="external_url" href="(https:\/\/github\.com\/[^"]+)"/)?.[1];
  const license = stripTags(text.match(/<h3>License<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
  const version = stripTags(
    text.match(/<span class="version_label">([\s\S]*?)<\/span>/)?.[1] ?? text.match(/Current version[\s\S]*?<strong>([^<]+)<\/strong>/)?.[1] ?? '',
  );
  const rockers = toInt(stripTags(text.match(/Rocks?[\s\S]{0,40}?(\d[\d,]*)\s*depend/i)?.[1] ?? ''));
  const totalDownloads = [...text.matchAll(/<span class="sub">([\d,]+) downloads<\/span>/g)]
    .map((m) => toInt(m[1]) ?? 0)
    .reduce((sum, value) => sum + value, 0);

  return {
    name: modulePath.split('/').pop(),
    module: modulePath,
    description: summary,
    repo,
    license: license || undefined,
    downloads: totalDownloads || undefined,
    registry: {
      url: `https://luarocks.org/modules/${modulePath}`,
      version: version || undefined,
      downloads: totalDownloads || undefined,
    },
  };
}

/** У страницы модуля путь включает автора: /modules/<user>/<rock>. */
async function resolveModulePath(name) {
  const { text: direct, notFound } = await getText(`https://luarocks.org/modules/${encodeURIComponent(name)}`);
  if (!notFound) return name;

  const { text: searchHtml } = await getText(`https://luarocks.org/search?q=${encodeURIComponent(name)}`);
  const paths = [...searchHtml.matchAll(/<a href="\/modules\/([^"]+)" class="title">([^<]+)<\/a>/g)]
    .map((m) => ({ path: m[1], name: m[2].trim() }))
    .filter((item) => item.name === name);
  return paths[0]?.path ?? null;
}
