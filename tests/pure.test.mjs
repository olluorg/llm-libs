// Тесты чистых функций. Почти все ошибки этого сеанса жили именно здесь:
// склейка описаний, нормализация лицензий, приоритет полей при слиянии,
// склонение слов. Каждый случай ниже — реальное значение из данных, на котором
// что-то пошло не так, поэтому тесты работают как напоминание, а не как формальность.
//
// Запуск: npm test (node --test, без зависимостей).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLicense, isPermissive } from '../scripts/lib/license.mjs';
import { findForks, normalizeDescription, ownerKey, repoKey } from '../scripts/lib/fork.mjs';
import { mergeRecords, normalizeRecord, makeId } from '../scripts/lib/record.mjs';
import { applyCuration, curatedConfidence, curatedIdConflicts } from '../scripts/lib/store.mjs';
import { declined, counted } from '../scripts/lib/i18n.mjs';
import { toCsv, toJson, CSV_COLUMNS } from '../scripts/lib/dataset.mjs';
import { slugify } from '../scripts/lib/site-helpers.mjs';

const record = (fields) => normalizeRecord({ confidence: 0.75, ...fields });

// ── Лицензии ───────────────────────────────────────────────────────────────

test('лицензия: короткие идентификаторы', () => {
  assert.deepEqual(normalizeLicense('MIT'), { id: 'MIT', family: 'permissive' });
  assert.deepEqual(normalizeLicense('Apache-2.0'), { id: 'Apache-2.0', family: 'permissive' });
  // Реестр может вернуть SPDX в любом регистре, а в фильтре лицензий значение
  // должно быть одно: иначе одна и та же лицензия раздвоится.
  assert.equal(normalizeLicense('apache-2.0').id, 'Apache-2.0');
  assert.equal(normalizeLicense('mit').id, 'MIT');
  assert.equal(normalizeLicense('bsd-3-clause').id, 'BSD-3-Clause');
  assert.deepEqual(normalizeLicense('BSD-3-Clause'), { id: 'BSD-3-Clause', family: 'permissive' });
});

test('лицензия: неизвестные значения дают unknown, а не family other', () => {
  // NOASSERTION и «None specified yet» — это отсутствие лицензии, а не
  // лицензия семейства other: иначе запись попадает в фильтр «прочие».
  for (const value of ['NOASSERTION', 'None specified yet', '']) {
    assert.equal(normalizeLicense(value).family, 'unknown', value);
    assert.equal(normalizeLicense(value).id, undefined, value);
  }
});

test('лицензия: обрезанное выражение идентификаторов остаётся выражением', () => {
  // PyPI обрезает значение ровно до 80 символов. Строка pypi:torch — это
  // выражение SPDX, а не текст лицензии; её нельзя читать как текст.
  const torch = 'Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause…';
  assert.equal(torch.length, 80);
  assert.equal(normalizeLicense(torch).id, 'Apache-2.0');
});

test('лицензия: обрезанный текст MIT опознаётся по началу', () => {
  // Строка pypi:bedrock-anthropic: текст лицензии, обрезанный до 80 символов.
  // Раньше уходил в family=other, и запись выпадала из фильтра лицензий.
  const truncated = 'Copyright 2023 Mustafa Aljadery, Siddharth Sharma. Permission is hereby granted…';
  assert.equal(truncated.length, 80);
  const result = normalizeLicense(truncated);
  assert.equal(result.id, 'MIT');
  assert.equal(result.family, 'permissive');
  // isPermissive ждёт строку лицензии, а не готовое семейство.
  assert.ok(isPermissive(truncated));
});

test('лицензия: полный текст без опознаваемого начала — other', () => {
  const bsd = 'Redistribution and use in source and binary forms, with or without '
    + 'modification, are permitted provided that the following conditions are met: '
    + '1. Redistributions of source code must retain…';
  assert.equal(normalizeLicense(bsd).family, 'other');
});

// ── Копии и форки ──────────────────────────────────────────────────────────

test('описание: убираются ссылки, скобки и хвост про форк', () => {
  const withFork = 'OpenAI PHP is a supercharged PHP API client, forked from https://github.com/openai-php/client';
  const clean = 'OpenAI PHP is a supercharged PHP API client';
  assert.equal(normalizeDescription(withFork), normalizeDescription(clean));
});

test('описание: описание варианта содержит описание оригинала, но не совпадает', () => {
  // openai-php/client и openai-php/laravel — один проект, два пакета. Раньше
  // «laravel» объявлялся копией «client».
  const client = 'OpenAI PHP is a supercharged PHP API client that allows you to interact with the Open AI API';
  const laravel = 'OpenAI PHP for Laravel is a supercharged PHP API client that allows you to interact with the Open AI API';
  const forks = findForks([
    record({ id: 'packagist:openai-php/client', name: 'openai-php/client', ecosystem: 'packagist', description: client, repo: 'https://github.com/openai-php/client' }),
    record({ id: 'packagist:openai-php/laravel', name: 'openai-php/laravel', ecosystem: 'packagist', description: laravel, repo: 'https://github.com/openai-php/laravel' }),
  ]);
  assert.deepEqual(forks.copies, []);
  assert.deepEqual(forks.rewritten, []);
});

test('копии: дословная копия находится, оригинал выбирается по загрузкам', () => {
  const description = 'OpenAI PHP is a supercharged PHP API client that allows you to interact with the Open AI API';
  const forks = findForks([
    record({ id: 'packagist:openai-php/client', name: 'openai-php/client', ecosystem: 'packagist', description, repo: 'https://github.com/openai-php/client', registry: { downloads: 2369293 } }),
    record({ id: 'packagist:wmwgijol28/openai-php', name: 'wmwgijol28/openai-php', ecosystem: 'packagist', description, repo: 'https://github.com/wmwgijol28/openai-php', registry: { downloads: 0 } }),
  ]);
  assert.equal(forks.copies.length, 1);
  assert.equal(forks.copies[0].original.id, 'packagist:openai-php/client');
  assert.deepEqual(forks.copies[0].copies.map((c) => c.id), ['packagist:wmwgijol28/openai-php']);
});

test('копии: артефакты одного репозитория копиями не считаются', () => {
  // pypi:langchain и pypi:langchain-anthropic — монорепозиторий, и описания
  // у них свои.
  const forks = findForks([
    record({ id: 'pypi:langchain', name: 'langchain', ecosystem: 'pypi', description: 'A framework for developing applications powered by language models.', repo: 'https://github.com/langchain-ai/langchain' }),
    record({ id: 'pypi:langchain-anthropic', name: 'langchain-anthropic', ecosystem: 'pypi', description: 'An integration package connecting Anthropic LLMs to LangChain.', repo: 'https://github.com/langchain-ai/langchain' }),
  ]);
  assert.deepEqual(forks.copies, []);
});

test('копии: переписанное описание попадает только в список на проверку', () => {
  // Две копии go-openai отличаются на «gemini 3 pro gemini 3 flash», поэтому
  // дословным совпадением не ловятся.
  const a = 'Go OpenAI This library provides unofficial Go clients for OpenAI API . We support: ChatGPT 4o, o1 GPT-3, GPT-4, DALL·E 2, DALL·E 3, GPT Image 1, Whisper installation currently Go OpenAI require';
  const b = 'Go OpenAI This library provides unofficial Go clients for OpenAI API . We support: ChatGPT 4o, o1 GPT-3, GPT-4, DALL·E 2, DALL·E 3, GPT Image 1, Whisper gemini 3 pro gemini 3 flash installation';
  const forks = findForks([
    record({ id: 'golang:m/go-openai', name: 'github.com/m/go-openai', ecosystem: 'golang', description: a, repo: 'https://github.com/m/go-openai' }),
    record({ id: 'golang:y/go-openai', name: 'github.com/y/go-openai', ecosystem: 'golang', description: b, repo: 'https://github.com/y/go-openai' }),
  ]);
  assert.deepEqual(forks.copies, []);
  assert.equal(forks.rewritten.length, 1);
  assert.deepEqual(
    [forks.rewritten[0].original.id, forks.rewritten[0].other.id].sort(),
    ['golang:m/go-openai', 'golang:y/go-openai'],
  );
});

test('форки: «based on» форком не считается', () => {
  // Так описывают сгенерированные по спецификации SDK.
  const forks = findForks([
    record({ id: 'nuget:tryagi.openai', name: 'tryagi.openai', ecosystem: 'nuget', description: 'Generated C# SDK based on official OpenAI OpenAPI specification. Includes C# Source Generator.' }),
  ]);
  assert.deepEqual(forks.declared, []);
});

test('форки: «fork of X» распознаётся, а владелец репозитория отличает форк от варианта', () => {
  const forks = findForks([
    record({ id: 'crates:async-openai-thinking', name: 'async-openai-thinking', ecosystem: 'crates', description: 'Fork of async-openai 0.41.3 adding reasoning_content (thinking tokens) to chat completion responses.' }),
  ]);
  assert.equal(forks.declared.length, 1);
  assert.equal(forks.declared[0].id, 'crates:async-openai-thinking');
  assert.equal(ownerKey('https://github.com/crow-cli/async-openai'), 'crow-cli');
  assert.equal(repoKey('https://github.com/a/b.git/'), 'https://github.com/a/b');
});

// ── Слияние записей ────────────────────────────────────────────────────────

test('слияние: уверенный источник выигрывает, а не «лучшее» значение', () => {
  // Пять записей, которым в курируемых файлах объявлен tier C, выходили с B.
  const merged = mergeRecords(
    record({ id: 'crates:huggingface', name: 'huggingface', ecosystem: 'crates', tier: 'B' }),
    record({ id: 'crates:huggingface', name: 'huggingface', ecosystem: 'crates', tier: 'C', confidence: 0.9 }),
  );
  assert.equal(merged.tier, 'C');
});

test('слияние: статус unknown не побеждает известный', () => {
  // unknown — это отсутствие данных, и оно не должно выигрывать у deprecated:
  // иначе запись выглядит живее, чем есть.
  const merged = mergeRecords(
    record({ id: 'crates:huggingface', name: 'huggingface', ecosystem: 'crates', status: 'unknown' }),
    record({ id: 'crates:huggingface', name: 'huggingface', ecosystem: 'crates', status: 'deprecated', confidence: 0.9 }),
  );
  assert.equal(merged.status, 'deprecated');
  // Обратный порядок аргументов ничего не меняет.
  const flipped = mergeRecords(
    record({ id: 'x', name: 'x', ecosystem: 'crates', status: 'deprecated', confidence: 0.9 }),
    record({ id: 'x', name: 'x', ecosystem: 'crates', status: 'unknown' }),
  );
  assert.equal(flipped.status, 'deprecated');
});

test('слияние: репозиторий берётся из уверенного источника', () => {
  // Автосбор подставлял jina-ai/serve вместо клиента jina-ai/jina, и от чужого
  // репозитория приходили описание, звёзды и дата релиза.
  const merged = mergeRecords(
    record({ id: 'pypi:jina', name: 'jina', ecosystem: 'pypi', repo: 'https://github.com/jina-ai/serve' }),
    record({ id: 'pypi:jina', name: 'jina', ecosystem: 'pypi', repo: 'https://github.com/jina-ai/jina', confidence: 0.9 }),
  );
  assert.equal(merged.repo, 'https://github.com/jina-ai/jina');
});

test('слияние: тип API остаётся только у ролей, которые его вызывают', () => {
  // У токенизатора и переводчика стоял openai, и фильтр «по типу API» показывал
  // им чужой тип.
  const tokenizer = mergeRecords(
    record({ id: 'luarocks:tiktoken_core', name: 'tiktoken_core', ecosystem: 'luarocks', role: 'support', sdkApi: 'openai' }),
    record({ id: 'luarocks:tiktoken_core', name: 'tiktoken_core', ecosystem: 'luarocks', role: 'support', sdkApi: 'openai', confidence: 0.9 }),
  );
  assert.equal(tokenizer.sdkApi, 'n/a');

  const client = mergeRecords(
    record({ id: 'pypi:openai', name: 'openai', ecosystem: 'pypi', role: 'sdk', sdkApi: 'openai' }),
    record({ id: 'pypi:openai', name: 'openai', ecosystem: 'pypi', role: 'sdk', sdkApi: 'openai', confidence: 0.9 }),
  );
  assert.equal(client.sdkApi, 'openai');
});

test('слияние: совместимый сервер поднимает рантайм и шлюз, но не клиент', () => {
  const runtime = normalizeRecord({ name: 'ollama', role: 'runtime', kind: 'local-runtime', openaiCompatibleServer: true });
  assert.equal(runtime.openaiCompatibleServer, true);
  const gateway = normalizeRecord({ name: 'litellm', role: 'gateway', kind: 'gateway', openaiCompatibleServer: true });
  assert.equal(gateway.openaiCompatibleServer, true);
  const client = normalizeRecord({ name: 'openai', role: 'sdk', kind: 'client', openaiCompatibleServer: true });
  assert.equal(client.openaiCompatibleServer, undefined);
});

test('слияние: списки объединяются, а не заменяются', () => {
  const merged = mergeRecords(
    record({ id: 'x', name: 'x', ecosystem: 'pypi', providers: ['openai'], features: ['chat'] }),
    record({ id: 'x', name: 'x', ecosystem: 'pypi', providers: ['anthropic'], features: ['tools'], confidence: 0.9 }),
  );
  assert.deepEqual([...merged.providers].sort(), ['anthropic', 'openai']);
  assert.deepEqual([...merged.features].sort(), ['chat', 'tools']);
});

test('слияние: пометка об удалённой ссылке сильнее любого адреса', () => {
  const merged = mergeRecords(
    record({ id: 'x', name: 'x', ecosystem: 'pypi', repo: 'https://github.com/a/b' }),
    record({ id: 'x', name: 'x', ecosystem: 'pypi', repo: 'https://github.com/c/d', repoDropped: true, confidence: 0.9 }),
  );
  assert.equal(merged.repo, undefined);
  assert.equal(merged.repoDropped, true);
});

test('идентификатор приводится к нижнему регистру', () => {
  assert.equal(makeId('cran', 'LLM'), 'cran:llm');
});

// ── Ручные исправления ─────────────────────────────────────────────────────

test('исправление авторитетно для названных полей', () => {
  // Патч, понижающий tier, обязан действовать: слияние выбирает лучшее
  // значение, а не более новое.
  const { records } = applyCuration(
    [record({ id: 'crates:huggingface', name: 'huggingface', ecosystem: 'crates', tier: 'B', status: 'deprecated' })],
    { exclude: [], patch: [{ ecosystem: 'crates', name: 'huggingface', tier: 'C', reason: 'пример' }] },
  );
  assert.equal(records[0].tier, 'C');
  assert.equal(records[0].status, 'deprecated');
});

test('исправление не сбрасывает неназванные поля', () => {
  // Патч, трогавший только tier, возвращал записи роль по умолчанию, и
  // crates:llm-chain молча стал sdk вместо framework.
  const { records } = applyCuration(
    [record({ id: 'crates:llm-chain', name: 'llm-chain', ecosystem: 'crates', role: 'framework', kind: 'framework', tier: 'B' })],
    { exclude: [], patch: [{ ecosystem: 'crates', name: 'llm-chain', tier: 'C', reason: 'пример' }] },
  );
  assert.equal(records[0].role, 'framework');
  assert.equal(records[0].kind, 'framework');
  assert.equal(records[0].tier, 'C');
});

test('исправление меняет роль на менее специфичную', () => {
  // preferRole при равной уверенности решал по kind, и патч проигрывал.
  const { records } = applyCuration(
    [record({ id: 'x', name: 'x', ecosystem: 'pypi', role: 'sdk', kind: 'framework', confidence: 0.95 })],
    { exclude: [], patch: [{ ecosystem: 'pypi', name: 'x', role: 'framework', reason: 'пример' }] },
  );
  assert.equal(records[0].role, 'framework');
});

test('правила сравниваются без учёта регистра', () => {
  // В CRAN пакет называется LLM, и регистрозависимое сравнение молча не
  // срабатывало: правило было написано, а запись оставалась.
  const { records, unmatched } = applyCuration(
    [record({ id: 'cran:llm', name: 'LLM', ecosystem: 'cran' })],
    { exclude: [{ ecosystem: 'cran', name: 'llm', reason: 'пример' }], patch: [] },
  );
  assert.equal(records.length, 0);
  assert.deepEqual(unmatched, []);
});

test('несработавшее правило попадает в unmatched', () => {
  const { unmatched } = applyCuration(
    [record({ id: 'pypi:openai', name: 'openai', ecosystem: 'pypi' })],
    { exclude: [{ ecosystem: 'pypi', name: 'несуществующий', reason: 'пример' }], patch: [] },
  );
  assert.equal(unmatched.length, 1);
  assert.match(unmatched[0], /исключение/);
});

// ── Склонение ──────────────────────────────────────────────────────────────

test('русское слово склоняется по числу', () => {
  const word = 'библиотека|библиотеки|библиотек';
  const forms = { 1: 'библиотека', 2: 'библиотеки', 5: 'библиотек', 11: 'библиотек', 21: 'библиотека', 22: 'библиотеки', 25: 'библиотек', 101: 'библиотека', 111: 'библиотек' };
  for (const [n, expected] of Object.entries(forms)) {
    assert.equal(declined('ru', Number(n), word), expected, `n=${n}`);
    assert.equal(counted('ru', Number(n), word), `${n} ${expected}`, `n=${n}`);
  }
});

test('английскому хватает двух форм', () => {
  assert.equal(declined('en', 1, 'library|libraries'), 'library');
  assert.equal(declined('en', 5, 'library|libraries'), 'libraries');
  assert.equal(counted('en', 1, 'library|libraries'), '1 library');
  assert.equal(counted('en', 5, 'library|libraries'), '5 libraries');
});

test('слово без разделителя не склоняется', () => {
  assert.equal(declined('en', 7, 'libraries'), 'libraries');
  assert.equal(counted('ru', 7, 'библиотеки'), '7 библиотеки');
});

// ── Публичный датасет ──────────────────────────────────────────────────────

test('CSV: кавычки удваиваются, переводы строк убираются', () => {
  const csv = toCsv([
    normalizeRecord({
      id: 'npm:x',
      name: 'x',
      ecosystem: 'npm',
      description: 'С кавычками "и", запятой, и\nпереносом строки',
      providers: ['openai', 'ollama'],
    }),
  ]);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.ok(lines[1].includes('""и""'), 'кавычки удвоены');
  assert.ok(!lines[1].includes('\n'), 'внутри ячейки нет перевода строки');
  assert.ok(lines[1].includes('openai|ollama'), 'список склеен через |');
});

test('CSV: одна запись — одна строка', () => {
  const libraries = Array.from({ length: 50 }, (_, index) =>
    normalizeRecord({ id: `pypi:p${index}`, name: `p${index}`, ecosystem: 'pypi', description: 'x' }));
  const lines = toCsv(libraries).trimEnd().split('\n');
  assert.equal(lines.length, libraries.length + 1);
});

test('публичный JSON компактный и с переводом строки', () => {
  const json = toJson({ generatedAt: '2026-01-01', libraries: [{ id: 'pypi:openai', description: 'a'.repeat(200) }] });
  assert.ok(json.endsWith('\n'));
  assert.ok(!json.includes('\n  '), 'нет отступов');
  assert.equal(JSON.parse(json).libraries[0].id, 'pypi:openai');
});

// ── Адреса страниц ─────────────────────────────────────────────────────────

test('slugify: знаки, из-за которых страницы становились недостижимы', () => {
  assert.equal(slugify('C#'), 'c-sharp');
  assert.equal(slugify('C++'), 'c-plus-plus');
  assert.equal(slugify('F#'), 'f-sharp');
  assert.equal(slugify('Objective-C'), 'objective-c');
  assert.equal(slugify('Python'), 'python');
});

// ── Один пакет под двумя именами ───────────────────────────────────────────

test('curatedIdConflicts: два файла с одним пакетом и разными репозиториями', () => {
  // Случай из данных: Betalgo.OpenAI был записан как «OpenAI» рядом с
  // официальной библиотекой OpenAI, и в каталог попал репозиторий Betalgo.
  const conflicts = curatedIdConflicts([
    { file: '01-official-sdks.json', item: { ecosystem: 'nuget', name: 'OpenAI', repo: 'https://github.com/openai/openai-dotnet' } },
    { file: '03-community-clients.json', item: { ecosystem: 'nuget', name: 'OpenAI', repo: 'https://github.com/betalgo/openai' } },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, 'nuget:openai');
  assert.match(conflicts[0].from, /openai\/openai-dotnet/);
  assert.match(conflicts[0].to, /betalgo\/openai/);
});

test('curatedIdConflicts: файл правок ссылок переопределять имеет право', () => {
  assert.deepEqual(
    curatedIdConflicts([
      { file: '04-infra.json', item: { ecosystem: 'crates', name: 'tch', repo: 'https://github.com/pykeio/tch' } },
      { file: '99-link-fixes.json', item: { ecosystem: 'crates', name: 'tch', repo: 'https://github.com/LaurentMazare/tch-rs' } },
    ]),
    [],
  );
});

test('curatedConfidence: исправленный адрес выигрывает не порядком файлов, а доверием', () => {
  // pykeio/tch не существует, elixir-ollama/ollama не существует: правильные
  // адреса лежат в файле правок и должны побеждать по существу.
  assert.ok(curatedConfidence('99-link-fixes.json') > curatedConfidence('03-community-clients.json'));
  assert.equal(curatedConfidence('03-community-clients.json'), 0.9);
  const merged = mergeRecords(
    normalizeRecord({ ecosystem: 'crates', name: 'tch', repo: 'https://github.com/pykeio/tch', confidence: curatedConfidence('04-infra.json') }),
    normalizeRecord({ ecosystem: 'crates', name: 'tch', repo: 'https://github.com/LaurentMazare/tch-rs', confidence: curatedConfidence('99-link-fixes.json') }),
  );
  assert.equal(merged.repo, 'https://github.com/LaurentMazare/tch-rs');
});

test('curatedIdConflicts: одинаковый репозиторий и разные экосистемы — не конфликт', () => {
  assert.deepEqual(
    curatedIdConflicts([
      { file: '01-official-sdks.json', item: { ecosystem: 'pypi', name: 'openai', repo: 'https://github.com/openai/openai-python' } },
      { file: '02-frameworks.json', item: { ecosystem: 'npm', name: 'openai', repo: 'https://github.com/openai/openai-node' } },
      { file: '03-community-clients.json', item: { ecosystem: 'pypi', name: 'openai', repo: 'https://github.com/openai/openai-python' } },
    ]),
    [],
  );
});

// ── Примечание записи ─────────────────────────────────────────────────────

test('normalizeRecord: машинный текст не попадает в примечание, признаки — в своё поле', () => {
  // 321 запись из 456 показывала на странице «Признаки: LLM-признаки в
  // описании (openai)»: это рассуждение сборщика о записи, а не о библиотеке.
  const record = normalizeRecord({
    ecosystem: 'pypi',
    name: 'openai',
    notes: 'Признаки: LLM-признаки в описании (openai)',
    matchReasons: ['LLM-признаки в описании (openai)'],
  });
  assert.equal(record.notes, undefined);
  assert.deepEqual(record.matchReasons, ['LLM-признаки в описании (openai)']);
});

test('normalizeRecord: написанное человеком примечание остаётся', () => {
  const record = normalizeRecord({
    ecosystem: 'pypi',
    name: 'jina',
    notes: 'Исторически клиент jina, переименован в jina-ai/serve.',
  });
  assert.match(record.notes, /переименован/);
});
