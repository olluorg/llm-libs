/**
 * Копии и форки.
 *
 * В реестрах много пакетов, которые не добавляют ничего: автор форкнул чужой
 * клиент, залил его под своим именем и скопировал описание оригинала. В
 * каталоге такая запись вредна дважды: она занимает место в выдаче и
 * приписывает чужой библиотеке свои звёзды и загрузки.
 *
 * Отличить копию от самостоятельной библиотеки можно по описанию: если
 * описания совпадают, а репозитории разные — одна из записей про другую. Какая
 * именно, решают данные: у оригинала больше загрузок и звёзд.
 *
 * Модуль ничего не удаляет сам: он находит, а решение принимает курируемый файл
 * с причиной. Признаки копии — похожие, а не равные, и среди находок бывают
 * соседние пакеты одного проекта, поэтому автоматическое удаление было бы
 * нечестным. Поэтому сигналов два: дословные копии, где сомнений нет, и
 * переписанные, где сомневаться нужно человеку.
 */

/** Репозиторий в виде, где /.git и хвостовой слэш не мешают сравнению. */
export function repoKey(repo) {
  return (repo ?? '').toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}

/**
 * Владелец репозитория — первый сегмент пути после хоста.
 *
 * Это отличает форк от варианта того же проекта. Описание openai-php/client
 * целиком содержится в описании openai-php/laravel, и llm-chain-openai в
 * описании ai-chain-qwen, но это один проект с несколькими пакетами, а не
 * копии: репозитории принадлежат одному владельцу. А копии живут под другими
 * аккаунтами — wmwgijol28/openai-php, yomorun/go-openai.
 */
export function ownerKey(repo) {
  const parts = (repo ?? '').toLowerCase().split('/').filter(Boolean);
  return parts.length >= 3 ? parts[2] : '';
}

/**
 * Приводит описание к сравнимому виду: убирает ссылки, содержимое скобок и
 * хвост про форк.
 *
 * Хвост про форк убирать обязательно: три копии openai-php/client дописали в
 * конец описания «, forked from https://github.com/openai-php/client», и без
 * этого их описание уже не содержалось бы в описании оригинала.
 */
export function normalizeDescription(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\((?:[^()]*)\)/g, ' ')
    .replace(/[,;.]?\s*\b(?:fork(?:ed)?\s+(?:of|from)|copy(?:ied)?\s+(?:of|from)|based\s+on)\b[^,;.]*/g, ' ')
    .replace(/[^a-z0-9а-я]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Сколько данных записи подтверждают, что она настоящая. */
function evidence(record) {
  return { downloads: record.registry?.downloads ?? 0, stars: record.stars ?? 0 };
}

/** true, если a подтверждена большим числом загрузок и звёзд, чем b. */
function better(a, b) {
  const ea = evidence(a);
  const eb = evidence(b);
  if (ea.downloads !== eb.downloads) return ea.downloads > eb.downloads;
  if (ea.stars !== eb.stars) return ea.stars > eb.stars;
  return a.id.localeCompare(b.id) < 0;
}

const JACCARD = 0.9;
const CONTAINMENT = 0.85;
const MIN_TOKENS = 6;
const MIN_SHARED = 12;

const tokensOf = (text) => new Set(normalizeDescription(text).split(' ').filter(Boolean));

/**
 * Пары записей с похожими описаниями: shared — число общих токенов, jaccard —
 * мера похожести, containment — доля меньшего описания в большем.
 *
 * Порог по числу общих токенов обязателен в обоих случаях. Официальные описания
 * одного проекта под разные провайдеры устроены как «The official TypeScript
 * library for the <provider> API» и различаются одним словом, а короткое
 * «Rust library for OpenAI» содержится в любом другом коротком описании.
 */
function pairsBySimilarity(records) {
  const described = records
    .map((record) => ({ record, tokens: tokensOf(record.description) }))
    .filter((entry) => entry.tokens.size >= MIN_TOKENS);
  const pairs = [];

  for (let i = 0; i < described.length; i += 1) {
    for (let j = i + 1; j < described.length; j += 1) {
      const left = described[i];
      const right = described[j];
      // Записи одного репозитория — это артефакты монорепозитория, а не форки.
      if (repoKey(left.record.repo) === repoKey(right.record.repo)) continue;
      const a = left.tokens;
      const b = right.tokens;
      if (a.size < MIN_TOKENS || b.size < MIN_TOKENS) continue;
      let shared = 0;
      for (const token of a) if (b.has(token)) shared += 1;
      if (shared < MIN_SHARED) continue;
      pairs.push({
        left: left.record,
        right: right.record,
        shared,
        jaccard: shared / (a.size + b.size - shared),
        containment: shared / Math.min(a.size, b.size),
      });
    }
  }
  return pairs;
}

/**
 * Все три сигнала разом, а пары сравниваются один раз.
 *
 * Раньше findRewrittenCandidates внутри себя вызывал findCopies, а validate
 * звал и то и другое, — сравнение всех пар записей проходило дважды. Для
 * 456 записей это около ста тысяч пар, и на втором прогоне смысла не было.
 */
export function findForks(records) {
  const pairs = pairsBySimilarity(records);
  return {
    copies: groupsFromPairs(records, pairs.filter((pair) => pair.jaccard >= JACCARD)),
    rewritten: rewrittenFromPairs(records, pairs.filter((pair) => pair.containment >= CONTAINMENT)),
    declared: declaredForks(records),
  };
}

/**
 * Дословные копии: описание совпадает с чужим почти слово в слово.
 *
 * Возвращает [{ original, copies }]: оригинал — запись с наибольшим числом
 * загрузок и звёзд, копии — остальные записи той же группы. Это единственный
 * сигнал, годный для автоматического решения: проверен на всём каталоге и не
 * даёт ложных срабатываний.
 *
 * Группы строятся компонентами связности, и здесь это безопасно: дословное
 * совпадение описаний не соединяет разные библиотеки. Для переписанных копий
 * так не было бы — openai-php/client и openai-php/laravel различаются на трёх
 * словах, а копии обоих завёл один автор, и связность объединила бы два
 * пакета одного проекта в одну группу.
 *
 * Жадный разбор пар здесь тоже не годился: после того как оригинал забирал
 * первую копию, остальные копии образовывали пары между собой, и копия с
 * девятью загрузками становилась «оригиналом» для другой копии.
 */
function groupsFromPairs(records, pairs) {
  const byId = new Map(records.map((record) => [record.id, record]));

  const related = new Map(records.map((record) => [record.id, new Set()]));
  for (const pair of pairs) {
    related.get(pair.left.id).add(pair.right.id);
    related.get(pair.right.id).add(pair.left.id);
  }

  const visited = new Set();
  const families = [];
  for (const record of records) {
    if (visited.has(record.id) || !related.get(record.id)?.size) continue;
    const component = [];
    const queue = [record.id];
    visited.add(record.id);
    while (queue.length) {
      const id = queue.pop();
      component.push(byId.get(id));
      for (const next of related.get(id) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    if (component.length < 2) continue;
    const sorted = [...component].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    families.push({ original: sorted[0], copies: sorted.slice(1) });
  }
  return families;
}

/**
 * Переписанные копии: описание не совпало, но почти содержится в чужом.
 *
 * Это не основание исключать запись, а повод посмотреть глазами. Признак слабее
 * дословного: под него попадают и форки, и соседние пакеты. Например
 * llm-chain-openai и ai-chain-qwen — два разных крата разных авторов с
 * шаблонным описанием «A library implementing llm-chains for …», и описания
 * отличаются одним словом. Сливать их нельзя.
 */
function rewrittenFromPairs(records, pairs) {
  const known = new Set(
    groupsFromPairs(records, pairs.filter((pair) => pair.jaccard >= JACCARD))
      .flatMap((family) => [family.original.id, ...family.copies.map((copy) => copy.id)]),
  );
  return pairs
    .filter((pair) => ownerKey(pair.left.repo) !== ownerKey(pair.right.repo))
    .filter((pair) => !known.has(pair.left.id) && !known.has(pair.right.id))
    .map((pair) => {
      const original = better(pair.left, pair.right) ? pair.left : pair.right;
      return {
        original,
        other: original === pair.left ? pair.right : pair.left,
        containment: pair.containment,
        shared: pair.shared,
      };
    })
    .sort((a, b) => b.containment - a.containment);
}

/**
 * Записи, которые сами признаются форком: в описании есть «fork of X» или
 * «copy of X». Форк может добавлять своё, поэтому это не приговор, но решение
 * должно быть записано явно, а не достаться по умолчанию.
 *
 * Формулировка «based on X» сюда не входит: ею описывают сгенерированные по
 * спецификации SDK («based on the official OpenAI OpenAPI specification»), и
 * она встречается в описаниях вовсе не о форках.
 */
function declaredForks(records) {
  const pattern = /\b(?:fork(?:ed)?\s+(?:of|from)|cop(?:y|ied)\s+(?:of|from))\s+([^,;.(]{2,60})/i;
  const declared = [];
  for (const record of records) {
    const match = pattern.exec(record.description ?? '');
    if (!match) continue;
    declared.push({ id: record.id, source: match[1].trim() });
  }
  return declared;
}
