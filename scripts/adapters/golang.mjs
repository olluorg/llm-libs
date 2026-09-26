import { getJson, getText } from '../lib/http.mjs';
import { matchAll, stripTags, toInt } from '../lib/text.mjs';

export const ecosystem = 'golang';
export const language = 'Go';

/** pkg.go.dev отдаёт только HTML, но разметка выдачи стабильна. */
export async function search(query, { limit = 20 } = {}) {
  const { text } = await getText(`https://pkg.go.dev/search?q=${encodeURIComponent(query)}&m=package`);
  const modules = [...new Set(matchAll(text, /data-clicked-package="([^"]+)"/g))].slice(0, limit);
  const licenses = matchAll(text, /data-test-id="snippet-license">\s*<a[^>]*>\s*([^<]+?)\s*</g);
  const importedBy = matchAll(text, /Imported by\s*<\/span>\s*<strong>([\d.,]+)</g);

  return modules.map((module, index) => ({
    name: module,
    repo: module.startsWith('github.com/') ? `https://${module}` : undefined,
    license: licenses[index],
    downloads: toInt(importedBy[index]),
    // У Go нет счётчика загрузок: pkg.go.dev показывает, сколько модулей
    // импортирует пакет. Это другая величина — помечаем её отдельно.
    downloadsPeriod: 'imports',
  }));
}

export async function fetchMeta(name) {
  const module = await resolveModule(name);
  if (!module) return null;
  const { data: latest } = await getJson(`https://proxy.golang.org/${encode(module)}/@latest`);

  return {
    name: module,
    aliasOf: module === name ? undefined : name,
    description: await fetchDescription(module),
    repo: module.startsWith('github.com/') ? `https://${module}` : undefined,
    registry: {
      url: `https://pkg.go.dev/${module}`,
      version: latest?.Version,
      updatedAt: latest?.Time ? String(latest.Time).slice(0, 10) : undefined,
    },
  };
}

/**
 * Поиск pkg.go.dev выдаёт и подпакеты (repo/llms/openai), у которых нет
 * собственных релизов. Поднимаемся по пути до ближайшего модуля с версиями.
 */
async function resolveModule(name) {
  const parts = encode(name).split('/');
  // Минимальный валидный путь модуля — два сегмента (google.golang.org/genai),
  // для github.com — три (owner/repo), но пробуем все длины по убыванию.
  for (let i = parts.length; i >= 2; i -= 1) {
    const candidate = parts.slice(0, i).join('/');
    const { text, notFound } = await getText(`https://proxy.golang.org/${candidate}/@v/list`, {
      timeoutMs: 15_000,
    });
    if (!notFound && (text ?? '').trim()) return candidate;
  }
  return null;
}

function encode(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

export async function fetchDescription(name) {
  const { text } = await getText(`https://pkg.go.dev/${name}`);
  const readme = text.match(/<div class="Overview-readmeContent js-readmeContent">([\s\S]*?)<\/div>/)?.[1];
  if (readme) {
    const plain = stripTags(readme.replace(/<(pre|code)[^>]*>[\s\S]*?<\/\1>/gi, ' '));
    if (plain) return plain.slice(0, 400);
  }
  const doc = text.match(/<h2[^>]*id="pkg-documentation"[\s\S]*?<p class="lead">([\s\S]*?)<\/p>/)?.[1];
  return doc ? stripTags(doc).slice(0, 400) : undefined;
}
