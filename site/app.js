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
   * Группы фильтра «роль». По умолчанию показываем только то, что действительно
   * обращается к API провайдера: клиенты и шлюзы. Локальные рантаймы, фреймворки
   * и сопутствующие инструменты — отдельные группы, иначе они неотличимы от SDK.
   */
  const ROLE_GROUPS = [
    { value: 'api', label: 'Клиенты и шлюзы', roles: ['sdk', 'gateway'] },
    { value: 'sdk', label: 'Только клиенты API', roles: ['sdk'] },
    { value: 'framework', label: 'Фреймворки', roles: ['framework'] },
    { value: 'runtime', label: 'Локальный запуск моделей', roles: ['runtime'] },
    { value: 'support', label: 'Сопутствующие инструменты', roles: ['support'] },
    { value: 'all', label: 'Все роли', roles: ['sdk', 'framework', 'runtime', 'gateway', 'support'] },
  ];

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
    sort: 'popular',
    // 1 — по возрастанию, -1 — по убыванию. По умолчанию самое популярное сверху.
    dir: -1,
  };

  /** Колонки, для которых естественный порядок по умолчанию — по убыванию. */
  const DESCENDING_BY_DEFAULT = new Set(['popular', 'updated', 'downloads', 'tier']);

  const $ = (sel) => document.querySelector(sel);
  const el = {
    search: $('#search'),
    role: $('#f-role'),
    language: $('#f-language'),
    provider: $('#f-provider'),
    kind: $('#f-kind'),
    status: $('#f-status'),
    tier: $('#f-tier'),
    count: $('#count'),
    tbody: $('#rows'),
    drawer: $('#drawer'),
    backdrop: $('#backdrop'),
    reset: $('#reset'),
  };

  // init() вызывается в самом конце файла: выше есть const-объявления
  // (LANGUAGE_HINTS, SEARCH_ENGINES), до которых нельзя дотянуться раньше времени.

  function init() {
    fillRoleSelect();
    fillSelect(el.language, uniq(libraries.map((l) => l.language)));
    fillSelect(el.provider, providers.map((p) => [p.id, p.name]));
    fillSelect(el.kind, uniq(libraries.map((l) => l.kind)));
    fillSelect(el.status, uniq(libraries.map((l) => l.status)));
    fillSelect(el.tier, ['A', 'B', 'C']);

    applyIntent();

    if (state.language) el.language.value = state.language;
    if (state.provider) el.provider.value = state.provider;
    el.search.value = state.q;

    const filterNodes = [el.search, el.role, el.language, el.provider, el.kind, el.status, el.tier];
    for (const node of filterNodes) {
      node.addEventListener('input', () => {
        state.q = el.search.value.trim();
        state.roleGroup = el.role.value;
        state.language = el.language.value;
        state.provider = el.provider.value;
        state.kind = el.kind.value;
        state.status = el.status.value;
        state.tier = el.tier.value;
        syncUrl();
        render();
      });
    }

    el.reset.addEventListener('click', () => {
      el.search.value = '';
      for (const node of filterNodes) node.value = '';
      Object.assign(state, { q: '', roleGroup: 'api', language: '', provider: '', kind: '', status: '', tier: '' });
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
        render();
      });
    });

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
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('q') ?? '';
    const languageFromUrl = params.get('language') ?? '';
    if (fromUrl) state.q = fromUrl;
    if (languageFromUrl && !state.language) state.language = languageFromUrl;
    if (!view.provider && params.get('provider')) state.provider = params.get('provider');
    if (params.get('role') && ROLE_GROUPS.some((g) => g.value === params.get('role'))) {
      state.roleGroup = params.get('role');
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
    const parts = [`пришли с запросом «${esc(detected.query)}»`];
    if (detected.language) parts.push(`язык: ${detected.language}`);
    hint.innerHTML =
      `Подстроили каталог под ваш запрос: ${parts.join(' · ')}. ` +
      '<button type="button" id="hint-reset">Сбросить</button>';
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

  function fillSelect(node, options) {
    const values = options.map((o) => (Array.isArray(o) ? o : [o, o])).sort((a, b) => a[1].localeCompare(b[1]));
    node.innerHTML = `<option value="">все</option>` + values
      .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
      .join('');
  }

  function fillRoleSelect() {
    el.role.innerHTML = ROLE_GROUPS
      .map(({ value, label, roles }) => {
        const count = libraries.filter((l) => roles.includes(l.role)).length;
        return `<option value="${value}">${esc(label)} — ${count}</option>`;
      })
      .join('');
    el.role.value = state.roleGroup;
  }

  function activeRoles() {
    return ROLE_GROUPS.find((group) => group.value === state.roleGroup)?.roles ?? ['sdk'];
  }

  function render() {
    const rows = libraries.filter(matches).sort(comparator);
    el.count.textContent = `${rows.length} из ${libraries.length}`;
    if (!rows.length) {
      el.tbody.innerHTML = `<tr><td colspan="6" class="empty">Ничего не найдено — ослабьте фильтры.</td></tr>`;
      return;
    }
    el.tbody.innerHTML = rows.map(rowHtml).join('');
    el.tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => openDrawer(tr.dataset.id));
    });
  }

  function matches(library) {
    if (!activeRoles().includes(library.role)) return false;
    if (state.language && library.language !== state.language) return false;
    if (state.provider && !(library.providers ?? []).includes(state.provider)) return false;
    if (state.kind && library.kind !== state.kind) return false;
    if (state.status && library.status !== state.status) return false;
    if (state.tier && library.tier !== state.tier) return false;
    if (!state.q) return true;
    const needle = state.q.toLowerCase();
    const haystack = [
      library.name, library.displayName ?? '', library.description ?? '',
      library.language, library.role, library.kind, library.sdkApi, (library.features ?? []).join(' '),
      (library.providers ?? []).map((p) => providerMap.get(p)?.name ?? p).join(' '),
      (library.worksWith ?? []).map((p) => providerMap.get(p)?.name ?? p).join(' '),
      library.repo ?? '',
    ].join(' ').toLowerCase();
    return needle.split(/\s+/).every((token) => haystack.includes(token));
  }

  function comparator(a, b) {
    const primary =
      state.sort === 'name' ? cmpString(a.name, b.name)
      : state.sort === 'language' ? cmpString(a.language, b.language) || cmpString(a.name, b.name)
      : state.sort === 'updated' ? cmpString(a.registry?.updatedAt ?? '', b.registry?.updatedAt ?? '')
      : state.sort === 'downloads' ? num(a.registry?.downloads) - num(b.registry?.downloads)
      : state.sort === 'tier' ? cmpString(a.tier ?? 'Z', b.tier ?? 'Z')
      : popularity(a) - popularity(b);

    // При равных значениях (у языков без звёзд и загрузок метрики нулевые)
    // порядок иначе произвольный и «прыгает» между сборками — разводим ничьи
    // по популярности и имени.
    if (primary) return state.dir * primary;
    return popularity(b) - popularity(a) || cmpString(a.name, b.name);
  }

  function cmpString(a, b) {
    return String(a).localeCompare(String(b), 'ru');
  }

  function popularity(library) {
    return num(library.stars) * 20 + num(library.registry?.downloads) / 1000 + (library.tier === 'A' ? 50 : 0);
  }

  function rowHtml(library) {
    const providerChips = (library.providers ?? [])
      .slice(0, 3)
      .map((p) => `<span class="chip p" title="${esc(providerMap.get(p)?.name ?? p)}">${esc(providerMap.get(p)?.name ?? p)}</span>`)
      .join('');
    const role = roleInfo.get(library.role);
    return `<tr data-id="${esc(library.id)}">
      <td>
        <div class="pkg">${esc(library.name)} <span class="eco">· ${esc(library.ecosystem)}</span></div>
        ${library.description ? `<div class="desc">${esc(library.description)}</div>` : ''}
      </td>
      <td>${esc(library.language)}</td>
      <td><div class="chips">${providerChips}${library.tier ? `<span class="chip tier-${esc(library.tier).toLowerCase()}">tier ${esc(library.tier)}</span>` : ''}</div></td>
      <td><span class="role role-${esc(library.role)}" title="${esc(role?.description ?? '')}">${esc(role?.label ?? library.role)}</span></td>
      <td class="num">${metricsHtml(library)}</td>
      <td>${library.registry?.updatedAt ?? '—'}</td>
    </tr>`;
  }

  /** У монорепозиториев (langchain-*, @ai-sdk/*) звёзды общие, поэтому показываем и загрузки. */
  function metricsHtml(library) {
    const parts = [];
    if (library.stars) parts.push(`<span title="Звёзды GitHub">★ ${compact(library.stars)}</span>`);
    if (library.registry?.downloads) {
      parts.push(`<span title="Загрузки за месяц">⬇ ${compact(library.registry.downloads)}</span>`);
    }
    return parts.join('<br>') || '—';
  }

  function openDrawer(id) {
    const library = libraries.find((l) => l.id === id);
    if (!library) return;
    const role = roleInfo.get(library.role);
    const providerNames = (library.providers ?? []).map((p) => providerMap.get(p)?.name ?? p);
    const worksWith = (library.worksWith ?? []).map((p) => providerMap.get(p)?.name ?? p);
    const rows = [
      ['Роль', `${role?.label ?? library.role} — ${role?.description ?? ''}`],
      ['Тип', library.kind],
      ['Статус', library.status],
      ['API', library.sdkApi],
      ['Чей API вызывается', providerNames.join(', ') || (library.role === 'runtime' ? 'никого — считает модель сам' : '—')],
      ...(worksWith.length ? [['Связана с', worksWith.join(', ')]] : []),
      ...(library.openaiCompatibleServer
        ? [['Совместимость', 'поднимает сервер /v1, доступен из openai-клиента через base_url']]
        : []),
      ['Возможности', (library.features ?? []).join(', ') || '—'],
      ['Переменные', (library.envVars ?? []).map((v) => `<code>${esc(v)}</code>`).join(' ') || '—'],
      ['Версия', library.registry?.version ?? '—'],
      ['Загрузки', library.registry?.downloads ? compact(library.registry.downloads) : '—'],
      ['Звёзды', library.stars ? compact(library.stars) : '—'],
      ['Лицензия', library.license ?? '—'],
      ['Обновлено', library.registry?.updatedAt ?? '—'],
    ];

    el.drawer.innerHTML = `
      <button class="close" id="drawer-close">✕</button>
      <h2>${esc(library.name)}</h2>
      <div class="chips">
        <span class="role role-${esc(library.role)}">${esc(role?.label ?? library.role)}</span>
        ${providerNames.map((p) => `<span class="chip p">${esc(p)}</span>`).join('')}
        <span class="chip status-${esc(library.status)}">${esc(library.status)}</span>
        ${library.tier ? `<span class="chip tier-${esc(library.tier).toLowerCase()}">tier ${esc(library.tier)}</span>` : ''}
      </div>
      ${library.description ? `<p style="color:var(--text-dim)">${esc(library.description)}</p>` : ''}
      ${role?.description ? `<p style="color:var(--text-dim);font-size:13px">${esc(role.description)}</p>` : ''}
      <h3>Установка</h3>
      <pre class="cmd" id="cmd">${esc(library.install ?? `—`)}</pre>
      <h3>Детали</h3>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      <h3>Ссылки</h3>
      <ul>
        ${library.repo ? `<li><a href="${esc(library.repo)}" target="_blank" rel="noopener">Репозиторий</a></li>` : ''}
        ${library.docs ? `<li><a href="${esc(library.docs)}" target="_blank" rel="noopener">Документация</a></li>` : ''}
        ${library.registry?.url ? `<li><a href="${esc(library.registry.url)}" target="_blank" rel="noopener">Реестр</a></li>` : ''}
        ${library.homepage ? `<li><a href="${esc(library.homepage)}" target="_blank" rel="noopener">Сайт</a></li>` : ''}
      </ul>
      ${library.notes ? `<h3>Примечания</h3><p style="color:var(--text-dim)">${esc(library.notes)}</p>` : ''}
      <h3>Источники данных</h3>
      <div class="chips">${(library.source ?? []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
    `;
    el.drawer.classList.add('open');
    el.backdrop.classList.add('open');
    el.drawer.scrollTop = 0;
  }

  function closeDrawer() {
    el.drawer.classList.remove('open');
    el.backdrop.classList.remove('open');
  }

  function syncUrl() {
    const params = new URLSearchParams();
    for (const key of ['q', 'language', 'provider', 'kind', 'status', 'tier']) {
      if (state[key]) params.set(key, state[key]);
    }
    if (state.roleGroup !== 'api') params.set('role', state.roleGroup);
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
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

  init();
})();
