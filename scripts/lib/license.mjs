/**
 * Нормализация лицензий.
 *
 * Реестры отдают лицензию десятками способов: «MIT», «MIT License»,
 * «The MIT License», «MIT + file LICENSE», «Apache 2.0» и «Apache-2.0»,
 * «NOASSERTION», а иногда полный текст лицензии или SPDX-идентификатор.
 * Фильтр по сырому значению бесполезен: 274 записи с лицензией MIT разошлись
 * по 14 вариантам написания. Поэтому приводим к SPDX-идентификатору и к
 * семейству — по нему и фильтруем, а исходное значение оставляем в карточке.
 *
 * Семейства:
 *   permissive — можно использовать в коммерческом продукте с указанием авторства;
 *   copyleft   — требует открытия производных работ (GPL, AGPL, MPL, …);
 *   source     — «с исходниками», но без вирусности (MPL-2.0, EPL, CDDL);
 *   other      — лицензия есть, но не приведена к SPDX (например, NOASSERTION);
 *   unknown    — лицензия не указана.
 */

/**
 * SPDX-идентификаторы в нижнем регистре → канонический вид и семейство.
 * Ключи намеренно в нижнем регистре: реестры пишут «MIT», «mit» и «Mit»,
 * а показывать и фильтровать нужно один и тот же идентификатор.
 */
const SPDX = {
  '0bsd': ['0BSD', 'permissive'],
  afl: ['AFL-3.0', 'permissive'],
  'apache-2.0': ['Apache-2.0', 'permissive'],
  bsd: ['BSD', 'permissive'],
  'bsd-2-clause': ['BSD-2-Clause', 'permissive'],
  'bsd-3-clause': ['BSD-3-Clause', 'permissive'],
  'bsd-4-clause': ['BSD-4-Clause', 'permissive'],
  bsdzero: ['BSD-0-Clause', 'permissive'],
  cc0: ['CC0-1.0', 'permissive'],
  'blueoak-1.0.0': ['BlueOak-1.0.0', 'permissive'],
  cc_by_40: ['CC-BY-4.0', 'permissive'],
  'mit-0': ['MIT-0', 'permissive'],
  mit: ['MIT', 'permissive'],
  unlicense: ['Unlicense', 'permissive'],
  isc: ['ISC', 'permissive'],
  psf: ['PSF-2.0', 'permissive'],
  'psf-2.0': ['PSF-2.0', 'permissive'],
  'python-software-foundation-license': ['PSF-2.0', 'permissive'],
  'upl-1.0': ['UPL-1.0', 'permissive'],
  'wtfpl': ['WTFPL', 'permissive'],
  zlib: ['Zlib', 'permissive'],
  'agpl-3.0': ['AGPL-3.0', 'copyleft'],
  'agpl-3.0-only': ['AGPL-3.0-only', 'copyleft'],
  'agpl-3.0-or-later': ['AGPL-3.0-or-later', 'copyleft'],
  'gpl-2.0': ['GPL-2.0', 'copyleft'],
  'gpl-3.0': ['GPL-3.0', 'copyleft'],
  'gpl-3.0-only': ['GPL-3.0-only', 'copyleft'],
  'gpl-3.0-or-later': ['GPL-3.0-or-later', 'copyleft'],
  'lgpl-2.1': ['LGPL-2.1', 'copyleft'],
  'lgpl-2.1-only': ['LGPL-2.1-only', 'copyleft'],
  'lgpl-3.0': ['LGPL-3.0', 'copyleft'],
  'lgpl-3.0-only': ['LGPL-3.0-only', 'copyleft'],
  'lgpl-3.0-or-later': ['LGPL-3.0-or-later', 'copyleft'],
  osl: ['OSL-3.0', 'copyleft'],
  eupl_12: ['EUPL-1.2', 'copyleft'],
  'cddl-1.0': ['CDDL-1.0', 'source'],
  'cddl-1.1': ['CDDL-1.1', 'source'],
  epl: ['EPL-1.0', 'source'],
  'epl-1.0': ['EPL-1.0', 'source'],
  'epl-2.0': ['EPL-2.0', 'source'],
  'ms-pl': ['MS-PL', 'source'],
  'ms-rl': ['MS-RL', 'source'],
  'mpl-2.0': ['MPL-2.0', 'source'],
};

/** Канонический идентификатор (в том виде, как его знает SPDX) → семейство. */
const SPDX_FAMILY = Object.fromEntries(Object.values(SPDX).map(([id, family]) => [id.toLowerCase(), family]));

/** Множество подстановочных частей, если реестр отдал не SPDX, а название. */
const NAME_TO_SPDX = [
  [/apache[\s_-]?(?:software\s*)?licen[cs]e.*2|apache\s*2|apache-2/i, 'Apache-2.0'],
  [/mit[\s_-]?licen[cs]e|licen[cs]e.*mit|mit\s*license|^mit$/i, 'MIT'],
  [/bsd[\s_-]?3|new[\s_-]?bsd|bsd[\s_-]?licen[cs]e/i, 'BSD-3-Clause'],
  [/bsd[\s_-]?2|simplified[\s_-]?bsd/i, 'BSD-2-Clause'],
  [/isc[\s_-]?licen[cs]e|^isc$/i, 'ISC'],
  [/mozilla[\s_-]?public|^mpl[\s_-]?2/i, 'MPL-2.0'],
  [/eclipse[\s_-]?public/i, 'EPL-2.0'],
  [/common[\s_-]?development/i, 'CDDL-1.0'],
  [/affero|agpl/i, 'AGPL-3.0'],
  [/lesser[\s_-]?general[\s_-]?public|lgpl/i, 'LGPL-3.0'],
  [/general[\s_-]?public[\s_-]?licen[cs]e|gpl/i, 'GPL-3.0'],
  [/unlicense|public[\s_-]?domain/i, 'Unlicense'],
  [/cc0|creative[\s_-]?commons[\s_-]?zero/i, 'CC0-1.0'],
  [/zlib/i, 'Zlib'],
  [/upl|universal permissive/i, 'UPL-1.0'],
  // Начало текста лицензии MIT — реестр иногда вместо названия отдаёт текст.
  [/permission is hereby granted,? free of charge/i, 'MIT'],
];

/** Способы, которыми реестр честно говорит «лицензии нет». */
const NO_LICENSE = /^(noassertion|none(\s+specified(\s+yet)?)?|unknown|proprietary|unlicensed|no[\s_-]?license|not[\s_-]?specified|unrestricted|see[\s_-]?license[\s_-]?in[\s_-]?\w*|commercial)$/i;

/**
 * Приводит значение реестра к SPDX-идентификатору.
 * Возвращает { id, family } либо { id: undefined, family: 'unknown' }.
 */
/**
 * Узнаёт лицензию по узнаваемому началу полного текста.
 * Возвращает SPDX-идентификатор либо null, если это не текст лицензии.
 */
function licenseFromText(value) {
  if (/apache licen[cs]e/i.test(value)) return 'apache-2.0';
  // Хвост «free of charge» в обрезанном тексте отсутствует, а начало
  // «Permission is hereby granted» — каноническое начало лицензии MIT, и
  // другой лицензии с таким началом не существует.
  if (/mit licen[cs]e|permission is hereby granted/i.test(value)) return 'mit';
  if (/mozilla public licen[cs]e/i.test(value)) return 'mpl-2.0';
  if (/gnu (general|affero|lesser) public licen[cs]e/i.test(value)) return 'gpl-3.0';
  return null;
}

export function normalizeLicense(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || NO_LICENSE.test(value)) return { id: undefined, family: 'unknown' };

  // Полный текст лицензии или ссылка на неё — SPDX из URL не достать,
  // но узнать можно по узнаваемому началу.
  //
  // Длина — грубый признак «это текст, а не идентификатор», и на границе он
  // ломался: PyPI обрезает значение лицензии ровно до 80 символов, и обрезанный
  // текст уходил в family=other, то есть запись выпадала из фильтра лицензий.
  //
  // Обрезанное значение разбирается в два захода: сначала как текст, иначе как
  // выражение идентификаторов. Обе формы PyPI обрезает одинаково и на вид они
  // неразличимы: у torch «Apache-2.0 AND BSD-3-Clause…» — выражение
  // идентификаторов, у bedrock-anthropic «…Permission is hereby granted…» —
  // текст лицензии MIT.
  const text = licenseFromText(value);
  const truncated = /(?:…|\.\.\.)\s*$/.test(value);
  if (text && (value.length > 80 || truncated)) return classify(text);
  if (value.length > 80) return { id: undefined, family: 'other' };

  // «MIT + file LICENSE», «Apache-2.0 OR MIT» и подобные — берём первую
  // известную часть: уточнение в скобках для фильтра не важно.
  const parts = value
    .replace(/[()]/g, ' ')
    .split(/\s*(?:\+|\bOR\b|\bAND\b|,|;|\/)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const cleaned = part
      .replace(/^licen[cs]e[:\s_-]*/i, '')
      .replace(/[^\w.+-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const direct = classify(cleaned);
    if (direct) return direct;
    // «MIT (MIT License)» и «GPL-2.0+» — пробуем без хвоста.
    const trimmed = classify(cleaned.replace(/[-+].*$/, ''));
    if (trimmed) return trimmed;
  }

  for (const part of parts) {
    for (const [pattern, spdx] of NAME_TO_SPDX) {
      if (pattern.test(part)) return classify(spdx.toLowerCase());
    }
  }

  // Последний проход по значению целиком: номер версии часто отделён
  // запятой («The Apache Software License, Version 2.0») и попадает
  // в другую часть после разделения.
  for (const [pattern, spdx] of NAME_TO_SPDX) {
    if (pattern.test(value)) return classify(spdx.toLowerCase());
  }

  return { id: undefined, family: 'other' };
}

/** Возвращает { id, family } или null, если такого идентификатора нет. */
function classify(key) {
  const entry = SPDX[key];
  if (!entry) return null;
  return { id: entry[0], family: entry[1] };
}

export const LICENSE_FAMILIES = ['permissive', 'copyleft', 'source', 'other', 'unknown'];

/** Подписи семейств для интерфейса. Ключи используются в i18n. */
export const LICENSE_FAMILY_LABEL = {
  permissive: 'разрешающая',
  copyleft: 'с обязательным открытием кода',
  source: 'открывающая исходники, без вирусности',
  other: 'прочее / SPDX не указан',
  unknown: 'не указана',
};

/** Разрешающие — их ищут чаще всего: фильтр по умолчанию их не прячет. */
export function isPermissive(raw) {
  return normalizeLicense(raw).family === 'permissive';
}
