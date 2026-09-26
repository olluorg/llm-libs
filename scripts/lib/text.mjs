const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/', '#47': '/', '#x3D': '=',
};

export function decodeEntities(text = '') {
  return String(text)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
      if (ENTITIES[entity]) return ENTITIES[entity];
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
      return match;
    });
}

export function stripTags(html = '') {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function matchAll(html, regex) {
  const global = regex.flags.includes('g') ? regex : new RegExp(regex.source, `${regex.flags}g`);
  return [...String(html).matchAll(global)].map((m) => m[1]);
}

export function toInt(value) {
  if (value === null || value === undefined) return undefined;
  const cleaned = String(value).replace(/[^\d]/g, '');
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

export function unique(list) {
  return [...new Set(list.filter((v) => v !== undefined && v !== null && v !== ''))];
}

/** «10k» → 10000 */
export function parseCompactNumber(value) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim().toLowerCase().replace(/,/g, '');
  const match = text.match(/^([\d.]+)\s*([km])?$/);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  return Math.round(base * (match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : 1));
}

export function takeTitleCase(value) {
  return String(value ?? '').trim();
}
