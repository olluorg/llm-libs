#!/usr/bin/env node
/** Сводка по датасету: сколько библиотек, как они распределены. */
import { readDataset } from './lib/store.mjs';
import { ROLES } from './lib/record.mjs';
import { popularity } from './lib/popularity.mjs';

const dataset = await readDataset();
const libraries = dataset.libraries ?? [];
const counts = dataset.counts ?? {};

const total = libraries.length;
const withRepo = libraries.filter((l) => l.repo).length;
const withStars = libraries.filter((l) => l.stars).length;
const withVersion = libraries.filter((l) => l.registry?.version).length;
const active = libraries.filter((l) => l.status === 'active').length;
const curated = libraries.filter((l) => l.source.some((s) => s.startsWith('curated:'))).length;

console.log(`\nКаталог собран: ${String(dataset.generatedAt ?? '—').slice(0, 10)}`);
console.log(`Всего библиотек: ${total} (из них курируемых: ${curated}, найдено автоматически: ${total - curated})`);
console.log(`С репозиторием: ${withRepo} · со звёздами: ${withStars} · с версией: ${withVersion} · статус active: ${active}\n`);

const table = (title, object) => {
  const rows = Object.entries(object ?? {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return;
  const width = Math.max(...rows.map(([key]) => key.length));
  console.log(title);
  for (const [key, value] of rows) {
    const bar = '█'.repeat(Math.max(1, Math.round((value / rows[0][1]) * 24)));
    console.log(`  ${key.padEnd(width)}  ${String(value).padStart(4)}  ${bar}`);
  }
  console.log();
};

table('По ролям (что библиотека делает с LLM):', counts.byRole);
table('По экосистемам:', counts.byEcosystem);
table('По языкам:', counts.byLanguage);
table('По типам:', counts.byKind);
table('По провайдерам (чьё API вызывается):', counts.byProvider);
table('По статусам:', counts.byStatus);
table(
  'Что измеряет счётчик загрузок:',
  libraries.reduce((acc, l) => {
    const key = l.registry?.downloadsPeriod ?? 'нет';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {}),
);

console.log('Топ-10 по популярности (2·log₁₀★ + log₁₀⬇ + 0.5 за tier A):');
const top = [...libraries].sort((a, b) => popularity(b) - popularity(a) || a.name.localeCompare(b.name));
for (const library of top.slice(0, 10)) {
  const downloads = library.registry?.downloads;
  console.log(
    `  ${popularity(library).toFixed(2).padStart(6)}  ${(library.role ?? '?').padEnd(9)} ` +
      `${library.name.padEnd(26)} ★${String(library.stars ?? 0).padStart(7)} ` +
      `⬇${downloads ? String(Math.round(downloads / 1000)).padStart(8) + 'k' : '       -'} ` +
      `${library.registry?.downloadsPeriod ?? '-'}`,
  );
}
console.log();

console.log('Роли:');
for (const [id, label] of Object.entries(ROLES)) {
  console.log(`  ${id.padEnd(10)} ${label}`);
}
