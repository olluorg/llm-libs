/**
 * Единая формула «популярности» — и для генератора сайта, и для stats.
 * Копия этой функции живёт в site/app.js; расхождение ловит check-site.
 *
 * Почему не `звёзды × 20 + загрузки / 1000`:
 *  - величины несопоставимы: 1 звезда «весит» 20 000 загрузок, поэтому
 *    любой пакет с тысячей звёзд забивал всё остальное;
 *  - счётчики загрузок у реестров разные по смыслу: у PyPI и npm это месяц,
 *    у crates.io, NuGet и RubyGems — накопительно с публикации, у Go —
 *    число импортов модуля;
 *  - выбросы ломают порядок: boto3 ставят 2.4 млрд загрузок в месяц
 *    (CI на AWS), и линейная сумма ставила его первым, хотя звёзд у него
 *    в 6 раз меньше, чем у litellm.
 *
 * Поэтому каждый член — логарифм, а период счётчика учитывается коэффициентом:
 *
 *   pop = 2·log10(звёзды + 10)            ← одна и та же величина у всех
 *       + log10(загрузки + 10)            ← помесячные счётчики
 *       + 0.8·log10(накопительные + 10)   ← всего с публикации
 *       + 0.5·log10(импорты + 10)         ← число импортов модуля (Go)
 *       + 0.5                             ← курируемая запись уровня A
 *
 * Все члены лежат примерно в [0, 10], поэтому ни одна метрика не может
 * «затопить» остальные, а разница в один порядок величины видна, но не
 * переворачивает список.
 */

/** Насколько весом счётчик загрузок в зависимости от того, что он измеряет. */
const PERIOD_WEIGHT = {
  month: 1, // загрузки за последний месяц — сопоставимо между реестрами
  total: 0.8, // накопительно с публикации — больше, но это другая величина
  imports: 0.5, // число импортов Go-модуля, не загрузки
  none: 0, // счётчика нет
};

/** Бонус за курируемую запись верхнего уровня. */
const TIER_BONUS = 0.5;

export function popularity(library) {
  const stars = Math.max(0, Number(library.stars) || 0);
  const downloads = Math.max(0, Number(library.registry?.downloads) || 0);
  const period = library.registry?.downloadsPeriod ?? 'total';
  const weight = PERIOD_WEIGHT[period] ?? PERIOD_WEIGHT.total;

  const starTerm = 2 * Math.log10(stars + 10);
  const downloadTerm = weight * Math.log10(downloads + 10);
  const tier = library.tier === 'A' ? TIER_BONUS : 0;

  return Number((starTerm + downloadTerm + tier).toFixed(3));
}

/** Человекочитаемая расшифровка вклада — показывается в подсказке. */
export function popularityBreakdown(library) {
  const stars = Math.max(0, Number(library.stars) || 0);
  const downloads = Math.max(0, Number(library.registry?.downloads) || 0);
  const period = library.registry?.downloadsPeriod ?? 'total';
  return {
    stars: Number((2 * Math.log10(stars + 10)).toFixed(2)),
    downloads: Number(((PERIOD_WEIGHT[period] ?? 0.8) * Math.log10(downloads + 10)).toFixed(2)),
    tier: library.tier === 'A' ? TIER_BONUS : 0,
    period,
    total: popularity(library),
  };
}
