/* Каталог библиотек LLM: поиск, фильтры, сортировка, карточка пакета. */
(() => {
  const data = window.__LLMDOCS__;
  if (!data) return;

  const view = window.__LLMDOCS_VIEW__ ?? {};
  const { libraries, providers, roles, generatedAt } = data;
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  /** Что библиотека делает с LLM: тексты берём из данных, чтобы не расходились. */
  const roleInfo = new Map((roles ?? []).map((r) => [r.id, r]));

  /**
   * Имя провайдера под язык страницы. У провайдера может быть nameEn: без него
   * в английскую версию попадало «OpenAI-совместимые API» — и в чипы строк,
   * и в подсказку поиска.
   */
  const englishPage = (document.documentElement.lang ?? 'en') === 'en';
  function providerName(id) {
    const provider = providerMap.get(id);
    if (!provider) return id;
    return !englishPage && provider.nameEn ? provider.nameEn : provider.name;
  }

  /**
   * Группы фильтра «роль». По умолчанию показываем только то, что действительно
   * обращается к API провайдера: клиенты и шлюзы. Локальные рантаймы, фреймворки
   * и сопутствующие инструменты — отдельные группы, иначе они неотличимы от SDK.
   */
  // Словарь интерфейса встроен в страницу сборщиком: на английской странице
  // window.__LLMDOCS_I18N__ — английский, на /ru/… — русский.
  const T = window.__LLMDOCS_I18N__ ?? {};
  /** Строка из словаря; при отсутствии показываем ключ, а не пустоту. */
  const tr = (key) => T[key] ?? key;

  const ROLE_GROUPS = [
    { value: 'api', roles: ['sdk', 'gateway'] },
    { value: 'sdk', roles: ['sdk'] },
    { value: 'gateway', roles: ['gateway'] },
    { value: 'framework', roles: ['framework'] },
    { value: 'runtime', roles: ['runtime'] },
    { value: 'support', roles: ['support'] },
    { value: 'all', roles: ['sdk', 'framework', 'runtime', 'gateway', 'support'] },
  ].map((group) => ({ ...group, label: tr(`roleGroup.${group.value}`) }));

  /**
   * Семейства лицензий. Реестры отдают «MIT», «MIT License», «MIT + file LICENSE»
   * и ещё десяток написаний одной лицензии, поэтому в записи лежит приведённый
   * идентификатор (licenseId) и семейство (licenseFamily) — см. scripts/lib/license.mjs.
   * Фильтруем по семейству: по сырому значению получилось бы 274 пункта.
   */
  const LICENSE_FAMILIES = ['permissive', 'copyleft', 'source', 'other', 'unknown'];
  const LICENSE_FAMILY_LABEL = Object.fromEntries(
    LICENSE_FAMILIES.map((family) => [family, tr(`licenseFamily.${family}`)]),
  );

  const SORT_KEYS = ['name', 'language', 'popular', 'updated', 'stars', 'downloads', 'license'];

  const state = {
    q: '',
    // По умолчанию — только клиенты API провайдеров и шлюзы. На срезе языка
    // или в оглавлении показываем все роли: там человек пришёл за полным списком.
    roleGroup: view.role ?? 'api',
    language: view.language ?? '',
    provider: view.provider ?? '',
    kind: '',
    status: '',
    tier: '',
    licenseFamily: '',
    sort: 'popular',
    // 1 — по возрастанию, -1 — по убыванию. По умолчанию самое популярное сверху.
    dir: -1,
  };

  /** Колонки, для которых естественный порядок по умолчанию — по убыванию. */
  const DESCENDING_BY_DEFAULT = new Set(['popular', 'stars', 'updated', 'downloads']);

  const $ = (sel) => document.querySelector(sel);
  const el = {
    search: $('#search'),
    role: $('#f-role'),
    language: $('#f-language'),
    provider: $('#f-provider'),
    kind: $('#f-kind'),
    status: $('#f-status'),
    tier: $('#f-tier'),
    license: $('#f-license'),
    count: $('#count'),
    tbody: $('#rows'),
    drawer: $('#drawer'),
    backdrop: $('#backdrop'),
    reset: $('#reset'),
  };

  // init() вызывается в самом конце файла: выше есть const-объявления
  // (LANGUAGE_HINTS, SEARCH_ENGINES), до которых нельзя дотянуться раньше времени.

  function init() {
    fillRoleChips();
    fillSelect(el.language, uniq(libraries.map((l) => l.language)), 'filters.short.language');
    fillSelect(el.provider, providers.map((p) => [p.id, providerName(p.id)]), 'filters.short.provider');
    fillSelect(el.kind, uniq(libraries.map((l) => l.kind)), 'filters.short.kind');
    fillSelect(el.status, uniq(libraries.map((l) => l.status)), 'filters.short.status');
    fillSelect(el.tier, ['A', 'B', 'C'], 'filters.short.tier');
    fillLicenseSelect();

    applyIntent();

    if (state.language) el.language.value = state.language;
    if (state.provider) el.provider.value = state.provider;
    if (state.licenseFamily) el.license.value = state.licenseFamily;
    el.search.value = state.q;

    // Чипы ролей не входят сюда: у них нет .value, и сбрасываются отдельно.
    const filterNodes = [el.search, el.language, el.provider, el.kind, el.status, el.tier, el.license];
    for (const node of filterNodes) {
      node.addEventListener('input', () => {
        state.q = el.search.value.trim();
        state.language = el.language.value;
        state.provider = el.provider.value;
        state.kind = el.kind.value;
        state.status = el.status.value;
        state.tier = el.tier.value;
        state.licenseFamily = el.license.value;
        syncUrl();
        render();
      });
    }

    el.reset.addEventListener('click', () => {
      el.search.value = '';
      for (const node of filterNodes) node.value = '';
      syncRoleChips();
      Object.assign(state, { q: '', roleGroup: 'api', language: '', provider: '', kind: '', status: '', tier: '', licenseFamily: '' });
      syncUrl();
      render();
    });

    document.querySelectorAll('thead th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort === key) {
          state.dir *= -1;
        } else {
          state.sort = key;
          state.dir = DESCENDING_BY_DEFAULT.has(key) ? -1 : 1;
        }
        syncSortState();
        render();
      });
    });
    syncSortState();

    // Кнопка закрытия появляется только после открытия карточки, поэтому
    // слушатель один на весь контейнер (делегирование), а не на сам элемент.
    el.drawer.addEventListener('click', (event) => {
      if (event.target.closest('#drawer-close')) closeDrawer();
      const command = event.target.closest('#cmd');
      if (command) copyToClipboard(command);
    });
    el.backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement !== el.search) {
        event.preventDefault();
        el.search.focus();
      }
      if (event.key === 'Escape') closeDrawer();
      trapFocus(event);
    });

    render();
  }

  async function copyToClipboard(node) {    try {
      await navigator.clipboard.writeText(node.textContent);
      node.style.borderColor = 'var(--accent-2)';
      setTimeout(() => {
        node.style.borderColor = '';
      }, 1200);
    } catch {
      // clipboard недоступен (нет https или разрешения) — просто пропускаем
    }
  }

  // ── Понимание намерения: откуда пришёл пользователь ──────────────────────
  //
  // Человек приходит из поисковика с запросом вроде «библиотеки llm для rust».
  // Если это разобрать, сразу ставим фильтр по языку и подставляем остаток
  // запроса в поиск, а не заставляем человека кликать по спискам.
  function applyIntent() {
    // Фильтры и сортировка храним в location.hash: при переходе по ссылке
    // сервер не должен получать параметры в query string (это статический сайт).
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);
    const fromUrl = params.get('q') ?? '';
    const languageFromUrl = params.get('language') ?? '';
    if (fromUrl) state.q = fromUrl;
    if (languageFromUrl && !state.language) state.language = languageFromUrl;
    if (!view.provider && params.get('provider')) state.provider = params.get('provider');
    if (params.get('role') && ROLE_GROUPS.some((g) => g.value === params.get('role'))) {
      state.roleGroup = params.get('role');
    }
    if (params.get('license') && LICENSE_FAMILIES.includes(params.get('license'))) {
      state.licenseFamily = params.get('license');
    }
    if (params.get('sort') && SORT_KEYS.includes(params.get('sort'))) {
      state.sort = params.get('sort');
    }
    if (params.get('dir') && ['1', '-1'].includes(params.get('dir'))) {
      state.dir = Number(params.get('dir'));
    }

    if (state.q || state.language) return;

    const detected = detectIntent(document.referrer);
    if (!detected) return;

    state.language = detected.language ?? state.language;
    state.q = detected.query;
    showIntentHint(detected);
  }

  const SEARCH_ENGINES = /(google|bing|yandex|duckduckgo|brave|startpage|ecosia|mail\.ru)\./i;
  const QUERY_PARAMS = ['q', 'text', 'query', 'wd', 'word'];

  function detectIntent(referrer) {
    if (!referrer) return null;
    let url;
    try {
      url = new URL(referrer);
    } catch {
      return null;
    }
    if (!SEARCH_ENGINES.test(url.hostname)) return null;

    let raw = '';
    for (const param of QUERY_PARAMS) {
      const value = url.searchParams.get(param);
      if (value) {
        raw = value;
        break;
      }
    }
    // Некоторые поисковики кладут запрос в последний сегмент пути.
    if (!raw) {
      const segments = url.pathname.split('/').filter(Boolean);
      const last = segments.at(-1);
      if (last && last.length > 3 && !/^(search|web|searchweb)\.?/i.test(last)) raw = last;
    }
    if (!raw) return null;

    const cleaned = raw.replace(/\+/g, ' ').trim();
    const language = detectLanguage(cleaned);
    // Язык уходит в фильтр; из текста запроса он вырезается, иначе ищется дважды.
    const rest = language
      ? cleaned.replace(escapeRegExp(language.keyword), ' ').replace(/\s+/g, ' ').trim()
      : cleaned;

    return { query: meaningfulQuery(rest), language: language?.name ?? null, keyword: language?.keyword, source: url.hostname };
  }

  /**
   * Слова, которые встречаются почти в любом запросе про LLM и ничего не значат
   * внутри каталога: «библиотеки llm для rust» → фильтр Rust, а поиск по словам
   * «библиотеки llm для» не нашёл бы ничего. Если содержательных слов не осталось,
   * ограничиваемся фильтром по языку.
   */
  const GENERIC_WORDS = new Set([
    'llm', 'ai', 'sdk', 'api', 'gpt', 'chatgpt', 'chat', 'tools', 'tool', 'client', 'clients',
    'wrapper', 'bindings', 'библиотеки', 'библиотека', 'библиотеку', 'библиотек', 'библиотеками',
    'либы', 'либа', 'список', 'каталог', 'подборка', 'лучшие', 'лучший', 'топ', 'обзор',
    'сравнение', 'для', 'в', 'на', 'по', 'и', 'с', 'а', 'о', 'к', 'у',
    'best', 'top', 'list', 'library', 'libraries', 'package', 'packages', 'for', 'in', 'on',
    'the', 'a', 'of', 'with', 'and', 'to', 'guide',
  ]);

  function meaningfulQuery(text) {
    const words = tokenize(text);
    const meaningful = words.filter((word) => !GENERIC_WORDS.has(word));
    if (!meaningful.length) return '';
    return text.trim();
  }

  function escapeRegExp(value) {
    return new RegExp(`\\b${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'giu');
  }

  const LANGUAGE_HINTS = [
    { name: 'Rust', keyword: 'rust', words: ['rust', 'раст', 'крейт', 'crate', 'crates', 'cargo', 'ferris'] },
    { name: 'Go', keyword: 'golang', words: ['golang', 'go', 'гolang', 'гo'] },
    { name: 'C#', keyword: 'c#', words: ['c#', 'csharp', 'си-шарп', 'шарп', 'dotnet', '.net'] },
    { name: 'C++', keyword: 'c++', words: ['c++', 'cpp', 'си-плюс-плюс', 'плюсах'] },
    { name: 'TypeScript', keyword: 'typescript', words: ['typescript', 'тайпскрипт', 'javascript', 'жаваскрипт', 'npm', 'node', 'nodejs', 'js'] },
    { name: 'PHP', keyword: 'php', words: ['php', 'пхп', 'composer', 'packagist', 'laravel'] },
    { name: 'Ruby', keyword: 'ruby', words: ['ruby', 'руби', 'rails', 'gem', 'rubygems'] },
    { name: 'Java', keyword: 'java', words: ['java', 'джава', 'maven', 'gradle', 'jvm', 'spring'] },
    { name: 'Kotlin', keyword: 'kotlin', words: ['kotlin', 'котлин'] },
    { name: 'Scala', keyword: 'scala', words: ['scala', 'скала'] },
    { name: 'Swift', keyword: 'swift', words: ['swift', 'свифт'] },
    { name: 'Elixir', keyword: 'elixir', words: ['elixir', 'эликсир', 'hex.pm', 'phoenix'] },
    { name: 'Lua', keyword: 'lua', words: ['lua', 'луа', 'luarocks', 'neovim'] },
    { name: 'Haskell', keyword: 'haskell', words: ['haskell', 'хаскелл'] },
    { name: 'Clojure', keyword: 'clojure', words: ['clojure', 'клоджу'] },
    { name: 'Dart', keyword: 'dart', words: ['dart', 'флаттер', 'flutter'] },
    { name: 'Zig', keyword: 'zig', words: ['zig', 'зиг'] },
    { name: 'OCaml', keyword: 'ocaml', words: ['ocaml', 'окэмель'] },
    { name: 'Python', keyword: 'python', words: ['python', 'питон', 'питона', 'pypi', 'pandas', 'django', 'fastapi', 'pydantic'] },
    // R проверяем последним: короткий токен «r» не должен перебивать другие языки.
    { name: 'R', keyword: 'r', words: ['rstudio', 'r-lang', 'cran', 'r'] },
  ];

  function tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-zа-яё0-9+#.]+/gi, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function detectLanguage(text) {
    const tokens = new Set(tokenize(text));
    for (const hint of LANGUAGE_HINTS) {
      if (hint.words.some((word) => tokens.has(word.toLowerCase()))) return hint;
    }
    return null;
  }

  /** Откуда пришёл пользователь — запоминаем, но на срезе языка подсказка лишняя. */
  function showIntentHint(detected) {
    const hint = $('#hint');
    if (!hint || view.language || view.provider) return;
    const parts = [tr('intent.hintQuery').replace('%{query}', esc(detected.query))];
    if (detected.language) parts.push(tr('intent.hintLanguage').replace('%{language}', detected.language));
    hint.innerHTML = tr('intent.hint').replace('%{parts}', parts.join(' · ')) + tr('intent.hintButton');
    hint.hidden = false;
    hint.querySelector('#hint-reset').addEventListener('click', () => {
      state.q = '';
      state.language = '';
      el.search.value = '';
      el.language.value = '';
      hint.hidden = true;
      syncUrl();
      render();
    });
  }

  /**
   * Наполняет список. Подпись пустого пункта — название самого фильтра:
   * у свёрнутого селекта было видно только «все», и шесть таких списков подряд
   * ничем не отличались друг от друга. Короткое имя («Язык», «Провайдер»)
   * короче и понятнее, чем длинное пояснение из подсказки.
   */
  function fillSelect(node, options, placeholderKey) {
    const values = options.map((o) => (Array.isArray(o) ? o : [o, o])).sort((a, b) => a[1].localeCompare(b[1]));
    // Каждый список передаёт своё имя; значение по умолчанию нужно только
    // для вызова без подписи, и тогда показываем хоть что-то осмысленное.
    const label = tr(placeholderKey ?? 'filters.short.language');
    node.innerHTML = `<option value="">${esc(label)}</option>` + values
      .map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`)
      .join('');
  }

  /**
   * Роли — не выпадающий список, а ряд чипов. Список из семи пунктов с
   * подписями и счётчиками занимал больше всего места в панели и требовал
   * двух кликов ради значения, которое видно сразу. Радиогруппа означает,
   * что выбор ровно один, и позволяет стрелками переключать.
   */
  function fillRoleChips() {
    el.role.innerHTML = ROLE_GROUPS.map(({ value, label, roles }) => {
      const count = libraries.filter((l) => roles.includes(l.role)).length;
      const active = value === state.roleGroup;
      return `<button type="button" class="chip role-chip${active ? ' active' : ''}" role="radio"
        aria-checked="${active}" data-role-group="${esc(value)}" title="${esc(label)}">${esc(label)} <span class="chip-count">${count}</span></button>`;
    }).join('');
    el.role.querySelectorAll('.role-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.roleGroup = chip.dataset.roleGroup;
        syncRoleChips();
        syncUrl();
        render();
      });
    });
  }

  function syncRoleChips() {
    el.role.querySelectorAll('.role-chip').forEach((chip) => {
      const active = chip.dataset.roleGroup === state.roleGroup;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-checked', String(active));
    });
  }

  /**
   * Показывает, по какому столбцу и в какую сторону отсортировано: заголовки
   * с data-sort выглядели как обычный текст, и было не видно, что таблица
   * вообще отсортирована. aria-sort нужен скринридеру, стрелка — глазу.
   */
  function syncSortState() {
    document.querySelectorAll('thead th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === state.sort;
      th.setAttribute('aria-sort', active ? (state.dir === -1 ? 'descending' : 'ascending') : 'none');
      th.classList.toggle('sorted', active);
      th.classList.toggle('asc', active && state.dir === 1);
    });
  }

  function activeRoles() {
    return ROLE_GROUPS.find((group) => group.value === state.roleGroup)?.roles ?? ['sdk'];
  }

  /** Фильтр по лицензии: сначала то, что встречается чаще всего. */
  function fillLicenseSelect() {
    const counts = new Map();
    for (const library of libraries) {
      const family = library.licenseFamily ?? 'unknown';
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const options = LICENSE_FAMILIES.filter((family) => counts.has(family)).map((family) => [
      family,
      `${LICENSE_FAMILY_LABEL[family]} — ${counts.get(family)}`,
    ]);
    fillSelect(el.license, options, 'filters.short.license');
    el.license.value = state.licenseFamily;
  }

  /**
   * Тема. Тёмная — основная (так сайт выглядел изначально), светлая — по
   * кнопке в шапке; выбор помнится в localStorage и применяется до первой
   * отрисовки, иначе страница моргает тёмной. Системную тему намеренно не
   * следим: человек приходит из поиска и не выбирал ничего, дефолт должен
   * быть предсказуемым.
   */
  const THEME_KEY = 'llmcat.theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // localStorage может быть недоступен — тема просто не запомнится.
    }
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      const light = theme === 'light';
      toggle.setAttribute('aria-pressed', String(light));
      const label = document.getElementById('theme-label');
      if (label) label.textContent = light ? tr('theme.toggleToDark') : tr('theme.toggle');
    }
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      saved = null;
    }
    applyTheme(saved === 'light' ? 'light' : 'dark');
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    });
  }

  function render() {
    const rows = libraries.filter(matches).sort(comparator);
    el.count.textContent = tr('count.format').replace('%{shown}', rows.length).replace('%{total}', libraries.length);
    if (!rows.length) {
      el.tbody.innerHTML = `<tr><td colspan="7" class="empty">${esc(tr('empty.title'))}</td></tr>`;
      return;
    }
    el.tbody.innerHTML = rows.map(rowHtml).join('');
    el.tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => openDrawer(tr.dataset.id, tr));
    });
    el.tbody.querySelectorAll('.pkg-open').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        // Идентификатор берём у строки, а не дублируем в кнопке: иначе он
        // считается дважды при разборе разметки.
        const row = event.target.closest('tr[data-id]');
        if (row) openDrawer(row.dataset.id, button);
      });
    });
  }

  function matches(library) {
    if (!activeRoles().includes(library.role)) return false;
    if (state.language && library.language !== state.language) return false;
    if (state.provider && !(library.providers ?? []).includes(state.provider)) return false;
    if (state.kind && library.kind !== state.kind) return false;
    if (state.status && library.status !== state.status) return false;
    if (state.tier && library.tier !== state.tier) return false;
    if (state.licenseFamily && (library.licenseFamily ?? 'unknown') !== state.licenseFamily) return false;
    if (!state.q) return true;
    const needle = state.q.toLowerCase();
    const haystack = [
      library.name, library.displayName ?? '', library.description ?? '',
      library.language, library.role, library.kind, library.sdkApi, (library.features ?? []).join(' '),
      library.licenseId ?? '', library.licenseFamily ?? '',
      (library.providers ?? []).map((p) => providerName(p)).join(' '),
      (library.worksWith ?? []).map((p) => providerName(p)).join(' '),
      library.repo ?? '',
    ].join(' ').toLowerCase();
    return needle.split(/\s+/).every((token) => haystack.includes(token));
  }

  /**
   * Популярность. Копия scripts/lib/popularity.mjs — расхождение ловит check-site.
   * Логарифмы вместо сложения «сырых» чисел: счётчики реестров несопоставимы
   * (PyPI — месяц, crates.io — накопительно, Go — импорты), а выбросы вроде
   * 2.4 млрд загрузок boto3 в месяц не должны переворачивать список.
   */
  const PERIOD_WEIGHT = { month: 1, total: 0.8, imports: 0.5, none: 0 };

  function popularity(library) {
    const stars = Math.max(0, num(library.stars));
    const downloads = Math.max(0, num(library.registry?.downloads));
    const weight = PERIOD_WEIGHT[library.registry?.downloadsPeriod] ?? PERIOD_WEIGHT.total;
    return 2 * Math.log10(stars + 10) + weight * Math.log10(downloads + 10) + (library.tier === 'A' ? 0.5 : 0);
  }

  /** Дата последнего релиза и её источник: реестр → релиз на GitHub → коммит. */
  function releaseCell(library) {
    if (!library.latestRelease) return '—';
    const source = library.latestReleaseSource ? tr(`releaseSource.${library.latestReleaseSource}`) : library.latestReleaseSource;
    return `<span title="${esc(source)}">${esc(library.latestRelease)}</span>`;
  }

  function downloadsLabel(library) {
    const downloads = num(library.registry?.downloads);
    if (!downloads) return '';
    const period = library.registry?.downloadsPeriod;
    const suffix = period && period !== 'none' ? tr(`downloads.${period}`) : '';
    return `${compact(downloads)}${suffix}`;
  }

  function comparator(a, b) {
    const primary =
      state.sort === 'name' ? cmpString(a.name, b.name)
      : state.sort === 'language' ? cmpString(a.language, b.language) || cmpString(a.name, b.name)
      : state.sort === 'updated' ? cmpString(a.latestRelease ?? '', b.latestRelease ?? '')
      : state.sort === 'stars' ? num(a.stars) - num(b.stars)
      : state.sort === 'downloads' ? num(a.registry?.downloads) - num(b.registry?.downloads)
      // Лицензии сравниваем по идентификатору, а при равенстве — по популярности:
      // так порядок детерминирован и не «прыгает» между сборками.
      : state.sort === 'license' ? cmpString(a.licenseId ?? '', b.licenseId ?? '')
      : popularity(a) - popularity(b);

    // При равных значениях (у языков без звёзд метрики близки к нулю)
    // порядок иначе произвольный и «прыгает» между сборками — разводим ничьи
    // по популярности и имени.
    if (primary) return state.dir * primary;
    return popularity(b) - popularity(a) || cmpString(a.name, b.name);
  }

  function cmpString(a, b) {
    return String(a).localeCompare(String(b), 'ru');
  }

  /**
   * Строка таблицы. У неё есть id — по нему работают якоря из подборки на
   * странице языка, — и кнопка в первом столбце: клик по строке удобен мышью,
   * но с клавиатуры карточку раньше было открыть нечем.
   *
   * У ячеек есть data-label с названием столбца: на узком экране таблица
   * превращается в карточки, и без подписи «Релиз 2026-09-24» не понять,
   * что это за число.
   */
  function rowHtml(library) {
    const providerChips = (library.providers ?? [])
      .slice(0, 3)
      .map((p) => `<span class="chip p" title="${esc(providerName(p))}">${esc(providerName(p))}</span>`)
      .join('');
    const label = (key) => esc(tr(key));
    return `<tr data-id="${esc(library.id)}" id="${esc(library.id)}">
      <td class="cell-name">
        <button type="button" class="pkg-open" aria-expanded="false" aria-haspopup="dialog">
          <span class="pkg">${esc(library.name)} <span class="eco">· ${esc(library.ecosystem)}</span></span>
        </button>
        ${library.description ? `<div class="desc">${esc(library.description)}</div>` : ''}
      </td>
      <td data-label="${label('th.language')}">${esc(library.language)}</td>
      <td><div class="chips">${providerChips}${library.tier ? `<span class="chip tier-${esc(library.tier).toLowerCase()}">tier ${esc(library.tier)}</span>` : ''}</div></td>
      <td class="cell-meta" data-label="${label('th.role')}"><span class="role role-${esc(library.role)}" title="${esc(tr(`roleDesc.${library.role}`))}">${esc(tr(`role.${library.role}`))}</span></td>
      <td class="lic cell-meta" data-label="${label('th.license')}">${licenseCell(library)}</td>
      <td class="num cell-meta" data-label="${label('th.stars')}">${library.stars ? compact(library.stars) : '—'}</td>
      <td class="num cell-meta" data-label="${label('th.downloads')}">${esc(downloadsLabel(library)) || '—'}</td>
      <td class="num cell-meta" data-label="${label('th.release')}">${releaseCell(library)}</td>
    </tr>`;
  }

  /**
   * Лицензия в строке: SPDX-идентификатор короткий, поэтому показываем его,
   * а семейство и исходное значение реестра — в подсказке.
   */
  function licenseCell(library) {
    const family = library.licenseFamily ?? 'unknown';
    const title = library.license && library.license !== library.licenseId
      ? `${LICENSE_FAMILY_LABEL[family] ?? family} · в реестре: ${library.license}`
      : (LICENSE_FAMILY_LABEL[family] ?? family);
    return `<span class="lic lic-${esc(family)}" title="${esc(title)}">${esc(library.licenseId ?? '—')}</span>`;
  }

  function openDrawer(id, source) {
    const library = libraries.find((l) => l.id === id);
    if (!library) return;
    const role = roleInfo.get(library.role);
    const providerNames = (library.providers ?? []).map((p) => providerName(p));
    const worksWith = (library.worksWith ?? []).map((p) => providerName(p));
    const rows = [
      [tr('drawer.role'), `${tr(`role.${library.role}`)} — ${tr(`roleDesc.${library.role}`)}`],
      [tr('drawer.kind'), library.kind],
      [tr('drawer.status'), library.status],
      [tr('drawer.api'), library.sdkApi],
      [tr('drawer.providers'), providerNames.join(', ') || (library.role === 'runtime' ? tr('drawer.noProvider') : '—')],
      ...(worksWith.length ? [[tr('drawer.worksWith'), worksWith.join(', ')]] : []),
      ...(library.openaiCompatibleServer ? [[tr('drawer.compatibility'), tr('drawer.compatibilityText')]] : []),
      [tr('drawer.features'), (library.features ?? []).join(', ') || '—'],
      [tr('drawer.envVars'), (library.envVars ?? []).map((v) => `<code>${esc(v)}</code>`).join(' ') || '—'],
      [tr('drawer.version'), library.registry?.version ?? '—'],
      [tr('drawer.downloads'), downloadsLabel(library) || '—'],
      [tr('drawer.stars'), library.stars ? compact(library.stars) : '—'],
      [tr('drawer.popularity'), `${popularity(library).toFixed(2)} (2·log₁₀★ + log₁₀⬇${library.tier === 'A' ? ' + 0.5' : ''})`],
      [tr('drawer.license'), library.licenseId
        ? `<span class="lic lic-${esc(library.licenseFamily ?? 'unknown')}">${esc(library.licenseId)}</span> <span style="color:var(--text-dim)">${esc(LICENSE_FAMILY_LABEL[library.licenseFamily] ?? '')}</span>`
        : `<span style="color:var(--text-dim)">${esc(LICENSE_FAMILY_LABEL.unknown)}</span>`],
      [tr('license.registryValue'), library.license ?? '—'],
      [tr('drawer.release'), library.latestRelease ? `${library.latestRelease} (${tr(`releaseSource.${library.latestReleaseSource}`) || '—'})` : '—'],
      [tr('drawer.registryRelease'), library.registry?.updatedAt ?? '—'],
      [tr('drawer.githubRelease'), library.github?.latestRelease ? `${library.github.latestRelease} · ${library.github.releasedAt ?? '—'}` : '—'],
      [tr('drawer.lastCommit'), library.github?.pushedAt ?? '—'],
    ];

    el.drawer.innerHTML = `
      <button class="close" id="drawer-close" title="${esc(tr('drawer.close'))}">✕</button>
      <h2 id="drawer-title">${esc(library.name)}</h2>
      <div class="chips">
        <span class="role role-${esc(library.role)}">${esc(tr(`role.${library.role}`))}</span>
        ${providerNames.map((p) => `<span class="chip p">${esc(p)}</span>`).join('')}
        <span class="chip status-${esc(library.status)}">${esc(library.status)}</span>
        ${library.tier ? `<span class="chip tier-${esc(library.tier).toLowerCase()}">tier ${esc(library.tier)}</span>` : ''}
      </div>
      ${library.description ? `<p style="color:var(--text-dim)">${esc(library.description)}</p>` : ''}
      <p style="color:var(--text-dim);font-size:13px">${esc(tr(`roleDesc.${library.role}`))}</p>
      <h3>${esc(tr('drawer.install'))}</h3>
      <pre class="cmd" id="cmd">${esc(library.install ?? `—`)}</pre>
      <h3>${esc(tr('drawer.details'))}</h3>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      <h3>${esc(tr('drawer.links'))}</h3>
      <ul>
        ${library.repo ? `<li><a href="${esc(library.repo)}" target="_blank" rel="noopener">${esc(tr('drawer.repository'))}</a></li>` : ''}
        ${library.docs ? `<li><a href="${esc(library.docs)}" target="_blank" rel="noopener">${esc(tr('drawer.docs'))}</a></li>` : ''}
        ${library.registry?.url ? `<li><a href="${esc(library.registry.url)}" target="_blank" rel="noopener">${esc(tr('drawer.registry'))}</a></li>` : ''}
        ${library.homepage ? `<li><a href="${esc(library.homepage)}" target="_blank" rel="noopener">${esc(tr('drawer.homepage'))}</a></li>` : ''}
      </ul>
      ${library.notes ? `<h3>${esc(tr('drawer.notes'))}</h3><p style="color:var(--text-dim)">${esc(library.notes)}</p>` : ''}
      <h3>${esc(tr('drawer.sources'))}</h3>
      <div class="chips">${(library.source ?? []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
    `;
    el.drawer.classList.add('open');
    el.backdrop.classList.add('open');
    el.drawer.scrollTop = 0;

    // Доступность: карточка — это диалог. Помечаем источник, переносим фокус
    // внутрь и удерживаем Tab внутри, пока карточка открыта. Раньше фокус
    // оставался на строке таблицы, а скринридер не знал, что открылось.
    const title = el.drawer.querySelector('#drawer-title');
    if (title) {
      title.id = 'drawer-title';
      el.drawer.setAttribute('aria-labelledby', 'drawer-title');
    }
    if (source) {
      source.setAttribute('aria-expanded', 'true');
      lastFocused = source;
    }
    el.drawer.querySelector('#drawer-close')?.focus();
  }

  /** Элемент, открывший карточку: возвращаем в него фокус при закрытии. */
  let lastFocused = null;

  function closeDrawer() {
    if (!el.drawer.classList.contains('open')) return;
    el.drawer.classList.remove('open');
    el.backdrop.classList.remove('open');
    el.tbody.querySelectorAll('.pkg-open[aria-expanded="true"]').forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
    });
    // Возвращаем фокус туда, откуда карточку открыли, — иначе после Esc
    // фокус падает на body и следующий Tab начинает с начала страницы.
    if (lastFocused && document.contains?.(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  /** Tab не должен уводить фокус из открытой карточки на страницу под ней. */
  function trapFocus(event) {
    if (event.key !== 'Tab' || !el.drawer.classList.contains('open')) return;
    const focusable = el.drawer.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && el.drawer.contains(document.activeElement) && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function syncUrl() {
    const params = new URLSearchParams();
    for (const key of ['q', 'language', 'provider', 'kind', 'status', 'tier']) {
      if (state[key]) params.set(key, state[key]);
    }
    // Лицензию в адрес пишем как `license`, а не именем поля состояния.
    if (state.licenseFamily) params.set('license', state.licenseFamily);
    if (state.roleGroup !== 'api') params.set('role', state.roleGroup);
    // Сортировку пишем только если она отличается от дефолта, чтобы не мусорить в URL.
    if (state.sort !== 'popular' || state.dir !== -1) {
      params.set('sort', state.sort);
      params.set('dir', String(state.dir));
    }
    const query = params.toString();
    history.replaceState(null, '', query ? `#${query}` : location.pathname);
  }

  function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

  function compact(value) {
    const n = num(value);
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
  }

  function uniq(list) { return [...new Set(list)]; }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.getElementById('generated').textContent = new Date(generatedAt).toISOString().slice(0, 10);

  initTheme();


  init();
})();
