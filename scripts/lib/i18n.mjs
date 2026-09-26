/**
 * Словарь интерфейса и текстов страниц.
 *
 * Английский — язык по умолчанию и `x-default` для поисковиков: чистые адреса
 * отдают английскую версию, русская лежит по префиксу `/ru/`. Обе версии
 * отдаются поисковикам целиком и связаны через `hreflang`, поэтому ни одна
 * из них не «прячется» — в отличие от подмены по referrer или cookie.
 *
 * В словаре лежит только собственный текст сайта. Описания и заметки к
 * записям приходят из реестров пакетов и остаются на языке оригинала:
 * переводить 504 описания автоматически значило бы выдумывать формулировки.
 */

export const LOCALES = ['en', 'ru'];
export const DEFAULT_LOCALE = 'en';

/** Префикс каталога для каждой локали: '' для языка по умолчанию, '/ru' для русского. */
export const LOCALE_DIR = { en: '', ru: '/ru' };

const en = {
  'site.name': 'LLM library catalog',
  'site.tagline': 'Libraries, SDKs and frameworks for LLM APIs in every programming language',

  'nav.all': 'All libraries',
  'nav.providers': 'by provider',
  'nav.languages': 'by language',
  'nav.sections': 'Catalog sections',
  'nav.breadcrumb': 'Breadcrumb',
  'nav.languageSwitcher': 'Interface language',
  'nav.switchToRu': 'Русский',
  'nav.switchToEn': 'English',

  'stats.libraries': 'libraries',
  'stats.languages': 'languages / ecosystems',
  'stats.providers': 'LLM providers',
  'stats.updated': 'updated',

  'filters.search': 'Search: openai, anthropic, rag, streaming…  ( / )',
  'filters.role': 'What the library does with an LLM',
  'filters.language': 'Programming language',
  'filters.provider': 'Whose API is called',
  'filters.kind': 'Package type',
  'filters.status': 'Maintenance status',
  'filters.tier': 'Catalog tier',
  'filters.license': 'License',
  'filters.all': 'all',
  'filters.reset': 'Reset',
  'filters.count': 'shown',

  'role.api': 'Provider API clients only',
  'role.sdk': 'API clients',
  'role.framework': 'Frameworks',
  'role.runtime': 'Local model runtimes',
  'role.support': 'Supporting tools',
  'role.gateway': 'Gateways',
  'role.all': 'All roles',

  'roleGroup.api': 'API clients and gateways',
  'roleGroup.sdk': 'API clients only',
  'roleGroup.gateway': 'Gateways',
  'roleGroup.framework': 'Frameworks',
  'roleGroup.runtime': 'Local model runtimes',
  'roleGroup.support': 'Supporting tools',
  'roleGroup.all': 'All roles',

  'roleDesc.sdk': 'A direct HTTP client for a provider API. Opens a connection to OpenAI, Anthropic, Gemini, Bedrock and similar APIs.',
  'roleDesc.framework': 'An abstraction on top of client SDKs: agents, chains, RAG pipelines, structured output. Does not talk to a provider by itself.',
  'roleDesc.runtime': 'Runs a model locally or starts an inference server. Does not call a cloud provider API; Ollama, vLLM and llama.cpp expose an OpenAI-compatible server.',
  'roleDesc.gateway': 'A proxy to several providers with one request format, retries and cost accounting.',
  'roleDesc.support': 'Supporting layer: vector databases, observability, evaluation, tokenizers, UI kits, MCP servers.',

  'licenseFamily.permissive': 'Permissive — MIT, Apache-2.0, BSD',
  'licenseFamily.copyleft': 'Copyleft — GPL, AGPL',
  'licenseFamily.source': 'File-level copyleft — MPL, EPL',
  'licenseFamily.other': 'Stated, but not reduced to SPDX',
  'licenseFamily.unknown': 'Not stated',
  'license.registryValue': 'Stated in the registry',

  'th.library': 'Library',
  'th.language': 'Language',
  'th.providers': 'Providers',
  'th.role': 'Role',
  'th.license': 'License',
  'th.stars': '★',
  'th.downloads': '⬇',
  'th.release': 'Release',
  'th.starsTitle': 'GitHub stars for the repository',
  'th.downloadsTitle': 'Package registry counter. Per month for PyPI, npm, Packagist and Hex; cumulative for crates.io, NuGet, RubyGems; import count for Go',
  'th.releaseTitle': 'Date of the latest release: registry release first, then a GitHub release, then the last commit',
  'th.licenseTitle': 'Package license reduced to SPDX. Registries write "MIT", "MIT License" and "MIT + file LICENSE" — the catalog shows one identifier',

  'empty.title': 'Nothing found — loosen the filters.',
  'drawer.role': 'Role',
  'drawer.kind': 'Type',
  'drawer.status': 'Status',
  'drawer.api': 'API',
  'drawer.providers': 'Whose API is called',
  'drawer.noProvider': 'nobody — runs the model itself',
  'drawer.worksWith': 'Related to',
  'drawer.compatibility': 'Compatibility',
  'drawer.compatibilityText': 'starts a /v1 server, reachable from the openai client via base_url',
  'drawer.details': 'Details',
  'drawer.links': 'Links',
  'drawer.homepage': 'Website',
  'drawer.notes': 'Notes',
  'drawer.sources': 'Data sources',
  'drawer.install': 'Install',
  'drawer.features': 'Features',
  'drawer.envVars': 'Environment variables',
  'drawer.version': 'Version',
  'drawer.downloads': 'Downloads',
  'drawer.stars': 'Stars',
  'drawer.popularity': 'Popularity score',
  'drawer.license': 'License',
  'drawer.release': 'Release',
  'drawer.registryRelease': 'Registry release',
  'drawer.githubRelease': 'GitHub release',
  'drawer.lastCommit': 'Last commit',
  'drawer.close': 'Close',
  'drawer.repository': 'Repository',
  'drawer.docs': 'Documentation',
  'drawer.registry': 'Registry',

  'releaseSource.registry': 'registry release',
  'releaseSource.github-release': 'GitHub release',
  'releaseSource.github-commit': 'last commit',

  'downloads.month': '/mo',
  'downloads.imports': ' imports',
  'downloads.total': ' total',
  'downloads.week': '/wk',

  'intent.title': 'Matched your search query',
  'intent.language': 'language',
  'intent.reset': 'Reset',
  'intent.hint': 'We adjusted the catalog to your query: %{parts}. ',
  'intent.hintQuery': 'you came from the query «%{query}»',
  'intent.hintLanguage': 'language: %{language}',
  'intent.hintButton': '<button type="button" id="hint-reset">Reset</button>',
  'count.format': '%{shown} of %{total}',

  'legend.title': 'Roles',
  'legend.more': 'What the roles mean and how the order is calculated',
  'legend.sdk': 'calls OpenAI, Anthropic, Gemini and similar APIs directly',
  'legend.gateway': 'proxies requests to providers (LiteLLM)',
  'legend.framework': 'an abstraction on top of SDKs (LangChain, Pydantic AI)',
  'legend.runtime': 'runs the model itself (Ollama, vLLM, transformers, llama.cpp); Ollama, vLLM and llama.cpp start a server compatible with the <code>openai</code> client through <code>base_url</code>',
  'legend.support': 'vector databases, observability, evaluation, tokenizers, UI, MCP',

  'legend.popularity': 'The default order is <b>popularity</b> = 2·log₁₀(stars) + log₁₀(registry counter) + 0.5 for tier A. Counters are log-scaled because their magnitudes are not comparable: boto3 gets 2.4 billion downloads a month, the crates.io counter is cumulative, and Go reports import counts. That is why ★ and ⬇ can be sorted separately: click a header.',

  'footer.build': 'Build:',
  'footer.machine': 'Machine-readable version:',
  'footer.agents': 'Short index for AI agents:',
  'footer.keys': '<span class="kbd">/</span> focuses search, <span class="kbd">Esc</span> closes the card.',
  'footer.noscript': 'Search and filters need JavaScript. The full dataset is in <a href="{{ROOT}}data/libraries.json">data/libraries.json</a>, the short index is in <a href="{{ROOT}}llms.txt">llms.txt</a>.',

  'collection.startHere': 'Where to start',
  'collection.startHereHint': 'A few entries that cover most needs in %{language} — the rest is in the table below, with filters.',
  'collection.intro': '%{count} entries for %{language} in this catalog: %{roles}. Most called APIs: %{providers}.',
  'collection.roles': 'roles',
  'collection.providers': 'APIs called',
  'collection.official': 'official',
  'collection.community': 'community',
  'collection.compatibleServer': 'provides an OpenAI-compatible server',
  'collection.facts': '%{stars} ★ · updated %{date}',
  'collection.features': 'supports %{features}',
  'collection.section': '%{label} — %{count}',
  'collection.sectionHint': '%{description} The most popular ones are listed below; the complete list is in the table with filters.',
  'collection.noRecords': 'No entries of this type for %{language}.',
  'collection.tableHint': 'Complete list with search and filters',

  'seo.startHere': 'Where to start',
  'seo.topProvider': 'Top libraries for %{provider}',
  'seo.topLanguage': 'Top libraries for %{language}',

  'page.index.title': 'LLM libraries catalog — OpenAI, Anthropic, Gemini, Bedrock, in every language',
  'page.index.description': '%{total} libraries for LLM work: official SDKs, frameworks, local runtimes (Ollama, vLLM, llama.cpp) and gateways. Python, TypeScript, Go, Rust, Java, C#, PHP, Ruby and more — with versions, downloads and GitHub stars.',
  'page.index.heading': 'Catalog of libraries for LLM APIs',
  'page.index.subheading': 'Official SDKs first, then frameworks and community clients. OpenAI, Anthropic, Gemini, Bedrock, Azure and OpenAI-compatible providers across every programming language.',
  'page.index.keywords': 'llm libraries, openai sdk, anthropic claude sdk, gemini api, bedrock, azure openai, ollama, vllm, litellm, langchain, python llm, typescript llm, rust llm, go llm',

  'page.providers.title': 'LLM libraries by provider — OpenAI, Anthropic, Gemini, Bedrock',
  'page.providers.description': 'The catalog split by API provider: how many libraries call each provider API, with documentation links and base URLs. OpenAI, Anthropic, Google Gemini, AWS Bedrock, Azure OpenAI, Ollama, vLLM, Groq, OpenRouter, Mistral, Cohere.',
  'page.providers.heading': 'Libraries by provider',
  'page.providers.subheading': 'Only what calls a provider API: client SDKs and the frameworks built on them.',
  'page.providers.keywords': 'llm providers, openai, anthropic, gemini, bedrock, azure openai, ollama, groq, openrouter, mistral, cohere',

  'page.languages.title': 'LLM libraries by programming language',
  'page.languages.description': 'The catalog split by language: Python, TypeScript, JavaScript, Go, Rust, Java, Kotlin, C#/.NET, PHP, Ruby, R, Elixir, Lua, Swift, Scala, Haskell, Clojure, C++, Dart, Zig, OCaml — with versions, downloads and GitHub stars.',
  'page.languages.heading': 'Libraries by language',
  'page.languages.subheading': 'How many API clients and LLM frameworks are available in each language and package ecosystem.',
  'page.languages.keywords': 'llm sdk by language, python openai, typescript anthropic, golang llm, rust llm, java openai, c# llm, php llm, ruby llm',

  'page.provider.title': 'Libraries for %{name} — %{count} | LLM catalog',
  'page.provider.description': 'Ready-made libraries and SDKs for %{name}: %{count} packages for %{top}. Versions, downloads, GitHub stars, official SDKs and community clients.',
  'page.provider.heading': 'Libraries for %{name}',
  'page.provider.keywords': '%{name} sdk, %{name} api libraries, llm %{id}',

  'page.language.title': 'LLM libraries for %{language} — %{count} | LLM catalog',
  'page.language.description': '%{count} libraries for LLM work in %{language}: %{top}. Official SDKs, frameworks, local inference, gateways and observability — with versions and downloads.',
  'page.language.heading': 'LLM libraries for %{language}',
  'page.language.subheading': '%{count} entries in the catalog. Click a library to see installation and links.',
  'page.language.keywords': 'llm %{language}, %{language} openai sdk, %{language} anthropic, llm libraries %{language}',

  'page.role.title': '%{role} for %{language} — %{count} | LLM catalog',
  'page.role.description': '%{count} %{roleLower} for LLM work in %{language}: %{top}. With versions, downloads and GitHub stars.',
  'page.role.heading': '%{role} for %{language}',
  'page.role.subheading': '%{count} entries. %{description}',
  'page.role.keywords': '%{language} %{roleSlug}, llm %{language} %{roleLower}, %{language} ai library',
  'page.role.seoText': '%{role} for %{language}: %{count} entries, sorted by popularity. %{description} The complete %{language} catalog, including other roles, is on the %{language} page.',
  'related.sameRole': 'The same in other languages',
  'related.otherRoles': 'Other roles in %{language}',

  'seoText.index': 'Only provider API clients (%{count}) are shown by default: what actually sends requests to OpenAI, Anthropic, Gemini, Bedrock and similar APIs. Everything else is available through the role filter: local model runtimes (Ollama, vLLM, transformers, llama.cpp), frameworks on top of SDKs (LangChain, Pydantic AI, DSPy), gateways (LiteLLM) and supporting tools — vector databases, observability, evaluation, tokenizers, UI kits, MCP servers. The catalog is built automatically from package registries and enriched with GitHub data; if you arrived from a search, your language is applied automatically.',
  'seoText.provider': 'API clients for %{name} and the frameworks that work through them: %{count} entries. The list is sorted by popularity (GitHub stars and monthly downloads). Need one gateway for all providers — LiteLLM; need an agent framework — LangChain or the Vercel AI SDK.',
  'seoText.language': 'LLM API clients and frameworks in %{language}: %{count} entries%{hidden}. The order is by popularity; click a header to sort, and search works by name, description, provider or features.',
  'seoText.officialSuffix': ', %{official} of them official SDKs',
  'seoText.hiddenSuffix': ', plus local runtimes and supporting tools for this language',
  'seoText.hiddenRoles': ' %{hidden} entries of other types (%{roles}) are hidden — switch the role filter to see them.',

  'summary.count': '%{count} libraries',
  'summary.official': '%{official} official SDKs',
  'summary.languages': 'languages: %{languages}',

  'llms.title': '# LLM library catalog',
  'llms.generated': '> Generated %{date}. %{total} libraries for %{languages} languages.',
  'llms.fullData': '> Full data: data/libraries.json',
  'llms.roles': '## Roles',
  'llms.providers': '## Providers',
  'llms.apiClients': '## API clients (tier A/B)',
  'llms.runtimes': '## Local model runtimes',
  'llms.openaiCompatible': ', OpenAI-compatible server',
};

const ru = {
  'site.name': 'Каталог библиотек LLM',
  'site.tagline': 'Библиотеки, SDK и фреймворки для API LLM на всех языках программирования',

  'nav.all': 'Все библиотеки',
  'nav.providers': 'по провайдерам',
  'nav.languages': 'по языкам',
  'nav.sections': 'Разделы каталога',
  'nav.breadcrumb': 'Навигационная цепочка',
  'nav.languageSwitcher': 'Язык интерфейса',
  'nav.switchToRu': 'Русский',
  'nav.switchToEn': 'English',

  'stats.libraries': 'библиотек',
  'stats.languages': 'языков / экосистем',
  'stats.providers': 'провайдеров LLM',
  'stats.updated': 'обновлено',

  'filters.search': 'Поиск: openai, anthropic, rag, streaming…  ( / )',
  'filters.role': 'Что библиотека делает с LLM',
  'filters.language': 'Язык программирования',
  'filters.provider': 'Чей API вызывается',
  'filters.kind': 'Тип пакета',
  'filters.status': 'Состояние поддержки',
  'filters.tier': 'Уровень каталога',
  'filters.license': 'Лицензия',
  'filters.all': 'все',
  'filters.reset': 'Сбросить',
  'filters.count': 'показано',

  'role.api': 'Только клиенты API',
  'role.sdk': 'Клиенты API',
  'role.framework': 'Фреймворки',
  'role.runtime': 'Локальный запуск моделей',
  'role.support': 'Сопутствующие инструменты',
  'role.gateway': 'Шлюзы',
  'role.all': 'Все роли',

  'roleGroup.api': 'Клиенты и шлюзы',
  'roleGroup.sdk': 'Только клиенты API',
  'roleGroup.gateway': 'Шлюзы',
  'roleGroup.framework': 'Фреймворки',
  'roleGroup.runtime': 'Локальный запуск моделей',
  'roleGroup.support': 'Сопутствующие инструменты',
  'roleGroup.all': 'Все роли',

  'roleDesc.sdk': 'Прямой HTTP-клиент API провайдера. Создаёт подключение к OpenAI, Anthropic, Gemini, Bedrock и другим API.',
  'roleDesc.framework': 'Абстракция поверх клиентских SDK: агенты, цепочки, RAG-пайплайны, структурированный вывод. Сама к провайдеру не ходит.',
  'roleDesc.runtime': 'Считает модель локально или поднимает сервер инференса. К API облачного провайдера не обращается; Ollama, vLLM и llama.cpp дают OpenAI-совместимый сервер.',
  'roleDesc.gateway': 'Прокси к провайдерам с единым форматом запросов, ретраями и учётом стоимости.',
  'roleDesc.support': 'Сопутствующий слой: векторные базы, наблюдаемость, оценки, токенизаторы, интерфейсы, серверы MCP.',

  'licenseFamily.permissive': 'Разрешающая — MIT, Apache-2.0, BSD',
  'licenseFamily.copyleft': 'С обязательным открытием кода — GPL, AGPL',
  'licenseFamily.source': 'Открывает исходники, без вирусности — MPL, EPL',
  'licenseFamily.other': 'Указана, но не приведена к SPDX',
  'licenseFamily.unknown': 'Не указана',
  'license.registryValue': 'В реестре указано',

  'th.library': 'Библиотека',
  'th.language': 'Язык',
  'th.providers': 'Провайдеры',
  'th.role': 'Роль',
  'th.license': 'Лицензия',
  'th.stars': '★',
  'th.downloads': '⬇',
  'th.release': 'Релиз',
  'th.starsTitle': 'Звёзды GitHub у репозитория',
  'th.downloadsTitle': 'Счётчик реестра пакетов. У PyPI, npm, Packagist и Hex — за месяц, у crates.io, NuGet, RubyGems — накопительно, у Go — число импортов',
  'th.releaseTitle': 'Дата последнего релиза: сначала релиз в реестре пакета, затем релиз на GitHub, затем последний коммит',
  'th.licenseTitle': 'Лицензия пакета, приведённая к SPDX. Реестры пишут «MIT», «MIT License» и «MIT + file LICENSE» — в каталоге это один идентификатор',

  'empty.title': 'Ничего не найдено — ослабьте фильтры.',
  'drawer.role': 'Роль',
  'drawer.kind': 'Тип',
  'drawer.status': 'Состояние',
  'drawer.api': 'API',
  'drawer.providers': 'Чей API вызывается',
  'drawer.noProvider': 'никого — считает модель сам',
  'drawer.worksWith': 'Связана с',
  'drawer.compatibility': 'Совместимость',
  'drawer.compatibilityText': 'поднимает сервер /v1, доступен из openai-клиента через base_url',
  'drawer.details': 'Детали',
  'drawer.links': 'Ссылки',
  'drawer.homepage': 'Сайт',
  'drawer.notes': 'Примечания',
  'drawer.sources': 'Источники данных',
  'drawer.install': 'Установка',
  'drawer.features': 'Возможности',
  'drawer.envVars': 'Переменные',
  'drawer.version': 'Версия',
  'drawer.downloads': 'Загрузки',
  'drawer.stars': 'Звёзды',
  'drawer.popularity': 'Популярность',
  'drawer.license': 'Лицензия',
  'drawer.release': 'Релиз',
  'drawer.registryRelease': 'Релиз в реестре',
  'drawer.githubRelease': 'Релиз на GitHub',
  'drawer.lastCommit': 'Последний коммит',
  'drawer.close': 'Закрыть',
  'drawer.repository': 'Репозиторий',
  'drawer.docs': 'Документация',
  'drawer.registry': 'Реестр',

  'releaseSource.registry': 'релиз в реестре пакетов',
  'releaseSource.github-release': 'релиз на GitHub',
  'releaseSource.github-commit': 'последний коммит',

  'downloads.month': '/мес',
  'downloads.imports': ' импортов',
  'downloads.total': ' всего',
  'downloads.week': '/нед',

  'intent.title': 'Подстроили каталог под ваш запрос',
  'intent.language': 'язык',
  'intent.reset': 'Сбросить',
  'intent.hint': 'Подстроили каталог под ваш запрос: %{parts}. ',
  'intent.hintQuery': 'пришли с запросом «%{query}»',
  'intent.hintLanguage': 'язык: %{language}',
  'intent.hintButton': '<button type="button" id="hint-reset">Сбросить</button>',
  'count.format': '%{shown} из %{total}',

  'legend.title': 'Роли',
  'legend.more': 'Что значат роли и как считается порядок',
  'legend.sdk': 'звонит напрямую в OpenAI, Anthropic, Gemini и т. д.',
  'legend.gateway': 'прокси к провайдерам (LiteLLM)',
  'legend.framework': 'абстракция поверх SDK (LangChain, Pydantic AI)',
  'legend.runtime': 'считает модель сам (Ollama, vLLM, transformers, llama.cpp); Ollama, vLLM и llama.cpp поднимают сервер, совместимый с <code>openai</code>-клиентом через <code>base_url</code>',
  'legend.support': 'векторные БД, наблюдаемость, eval, токенизаторы, UI, MCP',

  'legend.popularity': 'Порядок по умолчанию — <b>популярность</b> = 2·log₁₀(звёзды) + log₁₀(счётчик реестра) + 0.5 за tier A. Счётчики приведены к логарифму, потому что величины несопоставимы: boto3 ставят 2.4 млрд загрузок в месяц, у crates.io счётчик накопительный, у Go — число импортов. Поэтому ★ и ⬇ можно сортировать отдельно: клик по заголовку.',

  'footer.build': 'Сборка каталога:',
  'footer.machine': 'Машиночитаемая версия:',
  'footer.agents': 'Краткий указатель для ИИ-агентов:',
  'footer.keys': '<span class="kbd">/</span> — фокус на поиск, <span class="kbd">Esc</span> — закрыть карточку.',
  'footer.noscript': 'Поиск и фильтры требуют JavaScript. Полный датасет — в <a href="{{ROOT}}data/libraries.json">data/libraries.json</a>, краткий указатель — в <a href="{{ROOT}}llms.txt">llms.txt</a>.',

  'collection.startHere': 'С чего начать',
  'collection.startHereHint': 'Несколько записей, которые закрывают большинство задач на %{language}; остальное — в таблице ниже, с фильтрами.',
  'collection.intro': 'Записей для %{language} в каталоге: %{count}. По ролям: %{roles}. Чаще всего вызываемые API: %{providers}.',
  'collection.roles': 'роли',
  'collection.providers': 'вызываемые API',
  'collection.official': 'официальный',
  'collection.community': 'комьюнити',
  'collection.compatibleServer': 'даёт OpenAI-совместимый сервер',
  'collection.facts': '%{stars} ★ · обновлён %{date}',
  'collection.features': 'умеет %{features}',
  'collection.section': '%{label} — %{count}',
  'collection.sectionHint': '%{description} Ниже самые популярные; полный список — в таблице с фильтрами.',
  'collection.noRecords': 'Записей такого типа для %{language} нет.',
  'collection.tableHint': 'Полный список с поиском и фильтрами',

  'seo.startHere': 'С чего начать',
  'seo.topProvider': 'Популярные библиотеки для %{provider}',
  'seo.topLanguage': 'Популярные библиотеки на %{language}',

  'page.index.title': 'Каталог библиотек для LLM — OpenAI, Anthropic, Gemini, Bedrock на всех языках',
  'page.index.description': '%{total} библиотек для работы с LLM: официальные SDK, фреймворки, локальные рантаймы (Ollama, vLLM, llama.cpp) и шлюзы. Python, TypeScript, Go, Rust, Java, C#, PHP, Ruby и другие языки, с версиями, загрузками и звёздами GitHub.',
  'page.index.heading': 'Каталог библиотек для работы с LLM',
  'page.index.subheading': 'Сначала идут официальные SDK, затем фреймворки и комьюнити-клиенты. OpenAI, Anthropic, Gemini, Bedrock, Azure и OpenAI-совместимые провайдеры — по всем языкам программирования.',
  'page.index.keywords': 'llm библиотеки, openai sdk, anthropic claude sdk, gemini api, bedrock, azure openai, ollama, vllm, litellm, langchain, python llm, typescript llm, rust llm, go llm',

  'page.providers.title': 'Библиотеки для LLM по провайдерам — OpenAI, Anthropic, Gemini, Bedrock',
  'page.providers.description': 'Срез каталога по API-провайдерам: сколько библиотек вызывают API каждого провайдера, ссылки на документацию и base URL. OpenAI, Anthropic, Google Gemini, AWS Bedrock, Azure OpenAI, Ollama, vLLM, Groq, OpenRouter, Mistral, Cohere.',
  'page.providers.heading': 'Библиотеки по провайдерам',
  'page.providers.subheading': 'Здесь только то, что обращается к API провайдера: клиентские SDK и фреймворки поверх них.',
  'page.providers.keywords': 'llm провайдеры, openai, anthropic, gemini, bedrock, azure openai, ollama, groq, openrouter, mistral, cohere',

  'page.languages.title': 'Библиотеки для LLM по языкам программирования',
  'page.languages.description': 'Срез каталога по языкам: Python, TypeScript, JavaScript, Go, Rust, Java, Kotlin, C#/.NET, PHP, Ruby, R, Elixir, Lua, Swift, Scala, Haskell, Clojure, C++, Dart, Zig, OCaml. С версиями, загрузками и звёздами GitHub.',
  'page.languages.heading': 'Библиотеки по языкам',
  'page.languages.subheading': 'Сколько клиентов API и фреймворков для работы с LLM доступно в каждом языке и экосистеме пакетов.',
  'page.languages.keywords': 'llm sdk по языкам, python openai, typescript anthropic, golang llm, rust llm, java openai, c# llm, php llm, ruby llm',

  'page.provider.title': 'Библиотеки для %{name} — %{count} шт. | LLM-каталог',
  'page.provider.description': 'Готовые библиотеки и SDK для провайдера %{name}: %{count} пакетов для %{top}. Версии, загрузки, звёзды GitHub, официальные SDK и комьюнити-клиенты.',
  'page.provider.heading': 'Библиотеки для %{name}',
  'page.provider.keywords': '%{name} sdk, %{name} api библиотеки, llm %{id}',

  'page.language.title': 'Библиотеки для LLM на %{language} — %{count} шт. | LLM-каталог',
  'page.language.description': '%{count} библиотек для работы с LLM на языке %{language}: %{top}. Официальные SDK, фреймворки, локальный инференс, шлюзы и наблюдаемость — с версиями и загрузками.',
  'page.language.heading': 'Библиотеки для LLM на %{language}',
  'page.language.subheading': '%{count} записей в каталоге. Нажмите на библиотеку, чтобы увидеть установку и ссылки.',
  'page.language.keywords': 'llm %{language}, %{language} openai sdk, %{language} anthropic, llm библиотеки %{language}',

  'page.role.title': '%{role} для %{language} — %{count} шт. | LLM-каталог',
  'page.role.description': '%{count} %{roleLower} для работы с LLM на языке %{language}: %{top}. С версиями, загрузками и звёздами GitHub.',
  'page.role.heading': '%{role} для %{language}',
  'page.role.subheading': '%{count} записей. %{description}',
  'page.role.keywords': '%{language} %{roleSlug}, llm %{language} %{roleLower}, библиотеки ai %{language}',
  'page.role.seoText': '%{role} для %{language}: %{count} записей, по убыванию популярности. %{description} Полный каталог для %{language}, включая другие роли, — на странице языка %{language}.',
  'related.sameRole': 'То же в других языках',
  'related.otherRoles': 'Другие роли в %{language}',

  'seoText.index': 'По умолчанию показаны только клиенты API провайдеров (%{count}) — кто действительно отправляет запросы в OpenAI, Anthropic, Gemini, Bedrock и другие API. Остальное доступно через фильтр ролей: локальный запуск моделей (Ollama, vLLM, transformers, llama.cpp), фреймворки поверх SDK (LangChain, Pydantic AI, DSPy), шлюзы (LiteLLM) и сопутствующие инструменты — векторные базы, наблюдаемость, eval, токенизаторы, интерфейсы, серверы MCP. Каталог собран автоматически из реестров пакетов и обогащён данными GitHub; если вы пришли из поиска, язык из запроса подставляется автоматически.',
  'seoText.provider': 'Клиенты API %{name} и фреймворки, которые через них работают: %{count} записей. Список по убыванию популярности (звёзды GitHub и загрузки за месяц). Нужен единый шлюз ко всем провайдерам — LiteLLM; нужен агентный фреймворк — LangChain или Vercel AI SDK.',
  'seoText.language': 'Клиенты API LLM и фреймворки на языке %{language}: %{count} записей%{hidden}. Сортировка — по популярности; клик по заголовку меняет порядок, поиск работает по названию, описанию, провайдеру и возможностям.',
  'seoText.officialSuffix': ', из них %{official} официальных SDK',
  'seoText.hiddenSuffix': ', плюс локальные рантаймы и сопутствующие инструменты для этого языка',
  'seoText.hiddenRoles': ' Ещё %{hidden} записей типов «%{roles}» — переключите фильтр ролей, чтобы их увидеть.',

  'summary.count': '%{count} библиотек',
  'summary.official': '%{official} официальных SDK',
  'summary.languages': 'языки: %{languages}',

  'llms.title': '# Каталог библиотек для работы с LLM',
  'llms.generated': '> Сгенерировано %{date}. %{total} библиотек для %{languages} языков.',
  'llms.fullData': '> Полные данные: data/libraries.json',
  'llms.roles': '## Роли',
  'llms.providers': '## Провайдеры',
  'llms.apiClients': '## Клиенты API (tier A/B)',
  'llms.runtimes': '## Локальный запуск моделей',
  'llms.openaiCompatible': ', OpenAI-совместимый сервер',
};

const DICTIONARIES = { en, ru };

/**
 * Строка из словаря с подстановкой `%{param}`.
 * Отсутствующий ключ — это ошибка сборки, а не тихая пустая строка:
 * иначе непереведённый текст обнаруживается пользователем, а не тестом.
 */
export function t(locale, key, params) {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const template = dictionary[key] ?? DICTIONARIES[DEFAULT_LOCALE][key];
  if (template === undefined) throw new Error(`нет строки в словаре: ${key}`);
  if (!params) return template;
  return template.replace(/%\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

/** Все ключи, встречающиеся в обоих словарях, — проверка полноты перевода. */
export function dictionaryKeys() {
  const enKeys = Object.keys(DICTIONARIES.en).sort();
  const ruKeys = new Set(Object.keys(DICTIONARIES.ru));
  return {
    keys: enKeys,
    missingInRu: enKeys.filter((key) => !ruKeys.has(key)),
    extraInRu: [...ruKeys].filter((key) => !DICTIONARIES.en[key]),
  };
}

/** Словарь текущей локали целиком — для встраивания в страницу. */
export function localeStrings(locale) {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}
