#!/usr/bin/env node
/**
 * Пересчитывает производные поля записи на уже собранном датасете.
 *
 * Нужен, когда в схеме появляется новое производное поле (например,
 * `licenseId` и `licenseFamily`): чтобы поле появилось в каталоге, не требуется
 * заново ходить по всем реестрам и тратить на это несколько минут и сотни
 * запросов. Сеть не используется вовсе.
 *
 * Скрипт идемпотентен: нормализация записи не меняет её, если поля уже
 * посчитаны, поэтому повторный запуск ничего не портит.
 *
 *   node scripts/derive.mjs
 */
import { createLogger } from './lib/log.mjs';
import { applyCuration, loadCuration, readDataset, writeDataset } from './lib/store.mjs';

const log = createLogger('derive');

const dataset = await readDataset();
if (!dataset.libraries.length) {
  log.error('датасет пуст — сначала выполните node scripts/collect.mjs');
  process.exit(1);
}

// writeDataset прогоняет записи через dedupe → normalizeRecord, то есть
// пересчитывает все производные поля, включая дату релиза и лицензию.
const curation = await loadCuration();
const { records: cleaned, dropped, patched, unmatched } = applyCuration(dataset.libraries, curation);
const before = dataset.libraries.length;
const payload = await writeDataset(cleaned);
if (dropped.length) log.info(`исключено по ручному решению: ${dropped.length}`);
if (patched.length) log.info(`исправлено полей: ${patched.map((p) => p.id).join(", ")}`);
if (unmatched.length) log.info(`правила, уже сработавшие или устаревшие: ${unmatched.join(", ")}`);

const sample = payload.libraries.find((library) => library.licenseId);
log.info(`пересчитано записей: ${before} → ${payload.libraries.length}`);
log.info(
  sample
    ? `например, ${sample.id}: ${sample.license} → ${sample.licenseId} (${sample.licenseFamily})`
    : 'в датасете нет лицензий — проверьте сборку реестров',
);
