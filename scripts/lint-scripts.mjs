#!/usr/bin/env node
/**
 * Статическая проверка скриптов без зависимостей.
 *
 * Главное, что здесь ловится, — «временная мёртвая зона» в ES-модулях с
 * верхнеуровневым await: если `const` объявлен ниже места, где уже выполняется
 * код, обращение к нему бросает ReferenceError в рантайме, и скрипт молча
 * делает не то (мы на этом споткнулись трижды: app.js, build.mjs, collect.mjs).
 *
 *   node scripts/lint-scripts.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from './lib/log.mjs';
import { ROOT } from './lib/store.mjs';

const log = createLogger('lint');
const problems = [];

const SCRIPT_DIRS = ['scripts', 'site'];
const IGNORED = new Set(['node_modules', 'dist', '.cache', '.git']);

async function collectScripts(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await collectScripts(full)));
    else if (/\.(mjs|js)$/.test(entry.name)) found.push(full);
  }
  return found;
}

for (const dir of SCRIPT_DIRS) {
  for (const file of await collectScripts(path.join(ROOT, dir))) {
    const source = await fs.readFile(file, 'utf8');
    const lines = source.split('\n');
    const relative = path.relative(ROOT, file);
    const isLibrary = relative.startsWith('scripts/lib') || relative.startsWith('scripts/adapters');

    let firstAwaitLine = null;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
      // Объявления и await верхнего уровня идут без отступа — по стилю проекта.
      const isTopLevel = !/^\s/.test(line) && !isComment;
      const isDeclaration = /^(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(line);
      const isTopLevelAwait =
        /^(?:await|for\s+await)\b/.test(line) || /^(?:const|let)\s+[^=]+=\s*await\b/.test(line);

      if (isTopLevel && isTopLevelAwait && firstAwaitLine === null) {
        firstAwaitLine = lineNumber;
        return;
      }
      if (isTopLevel && firstAwaitLine !== null && isDeclaration) {
        const [, name] = isDeclaration;
        // Опасно только реальное обращение выше объявления: без него порядок
        // не важен (например, `const pages` после await используется дальше).
        // Строковые литералы, комментарии и обращения через точку
        // (dataset.libraries) в счёт не идут.
        const mentions = (line) =>
          !/^\s*(\/\/|\*|\/\*)/.test(line) &&
          new RegExp(`(?<![.\\w$])${name}(?![\\w$])`).test(stripLiterals(line));
        const usedEarlier = lines.slice(0, lineNumber - 1).some(mentions);
        if (usedEarlier) {
          problems.push(
            `${relative}:${lineNumber} — «${name}» используется выше объявления, а верхнеуровневый await ` +
              `уже выполняется (строка ${firstAwaitLine}); будет ReferenceError из-за временной мёртвой зоны. ` +
              'Перенесите объявление выше по файлу.',
          );
        }
      }

      if (isLibrary && !isComment && /\bconsole\.(log|debug|warn)\(/.test(line)) {
        problems.push(
          `${relative}:${lineNumber} — console.${/console\.(\w+)\(/.exec(line)[1]} в библиотечном коде, используйте createLogger`,
        );
      }
    });
  }
}

if (problems.length) {
  for (const problem of problems) log.error(problem);
  log.error(`проблем: ${problems.length}`);
  process.exit(1);
}
log.info('скрипты в порядке: порядок объявлений и отсутствие console.log проверены');

/** Убирает комментарии и содержимое строковых литералов с одной строки. */
function stripLiterals(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}
