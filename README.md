# openllmdocs — каталог библиотек для работы с LLM

Сборник всех доступных библиотек для работы с LLM по всем языкам программирования.
Приоритет — **OpenAI**, затем **Anthropic**, плюс Google Gemini, AWS Bedrock, Azure OpenAI,
OpenAI-совместимые провайдеры (Ollama, vLLM, Groq, OpenRouter, Together, Mistral, Cohere и др.)
и локальные/фреймворковые решения (Hugging Face, LangChain, LlamaIndex, DSPy).

Данные собираются автоматически из реестров пакетов + GitHub API, курируются вручную там,
где автоматика не различает «SDK для LLM» и «пакет, в описании которого встретилось слово LLM»,
и публикуются в виде статического сайта с поиском.

## Что уже собрано

На первый прогон (26 сентября 2026):

| | |
| --- | --- |
| Библиотек всего | 505 (165 курируемых + 340 найденных автоматически) |
| Языков / экосистем | 18 языков, 13 реестров |
| Провайдеров в конфиге | 40 (OpenAI, Anthropic, Gemini, Bedrock, Azure, Vertex, Ollama, vLLM, Groq, OpenRouter, Mistral, Cohere, …) |
| Со ссылкой на репозиторий | 435 |
| Со звёздами GitHub | 368 |
| Статус `active` | 354 |
| Страниц на сайте | 55 (главная + срез на каждый провайдер и язык) |

Топ языков: Python 93, TypeScript 60, Java 49, Rust 45, C# 43, PHP 42, Ruby 41, Swift 30, R 23, Go 22, Elixir 21, Lua 20, плюс Scala, Kotlin, OCaml, Haskell, Clojure, C++, Dart, Zig.

## Что внутри

| Слой | Что делает |
| --- | --- |
| `data/config/providers.json` | Реестр провайдеров: id, категория, тип API, base URL, ключи окружения, ключевые слова |
| `data/config/ecosystems.json` | Экосистемы (реестры пакетов) и поисковые запросы для автообнаружения |
| `data/curated/*.json` | Курируемые записи: официальные SDK, фреймворки, комьюнити-клиенты, инфраструктура, MCP |
| `data/out/libraries.json` | Собранный датасет + отчёт о сборе |
| `dist/` | Сгенерированный сайт (`index.html`, срезы по провайдерам/языкам, `llms.txt`) |

Файлы `data/curated/`:

| Файл | Что внутри |
| --- | --- |
| `01-official-sdks.json` | SDK, которые выпускают сами провайдеры: OpenAI (Python/TS/.NET/Go/Ruby/Java), Anthropic (Python/TS/.NET/Java/Ruby/PHP), Google, AWS, Azure, Mistral, Groq, Cohere, xAI, Replicate |
| `02-frameworks.json` | LangChain/LangGraph, Vercel AI SDK, LlamaIndex, LangChain4j, Spring AI, Semantic Kernel, OpenAI Agents, Pydantic AI, DSPy, Instructor, AutoGen, CrewAI |
| `03-community-clients.json` | go-openai, go-anthropic, async-openai, rig-core, theokanning/openai-java, ruby_llm, openai-php, theodo-group/llphant, kotlin/scala/dart/haskell/clojure-клиенты |
| `04-infra.json` | Ollama, vLLM, Transformers, LiteLLM, Langfuse, Promptfoo, Ragas, векторные БД |
| `05-mcp.json` | Model Context Protocol: `mcp`, `@modelcontextprotocol/sdk`, `fastmcp`, Java-SDK |

## Быстрый старт

```bash
node scripts/collect.mjs     # собрать: курируемое + автообнаружение в реестрах
node scripts/enrich.mjs      # добавить звёзды/статус GitHub
node scripts/validate.mjs    # проверить данные
node scripts/build.mjs       # собрать сайт в dist/
node scripts/check-site.mjs  # дымовой тест собранного сайта
node scripts/stats.mjs       # сводка по датасету
node scripts/serve.mjs 8080  # локальный просмотр сайта
```

Или всё сразу: `npm run refresh`. Только проверки (как в CI): `npm run ci`.

Рекомендуется задать токен GitHub, иначе обогащение упирается в 60 запросов в час:

```bash
export GITHUB_TOKEN=ghp_...   # 5000 запросов/час вместо 60
```

## Автоматизация (GitHub Actions)

| Workflow | Когда | Что делает |
| --- | --- | --- |
| `.github/workflows/ci.yml` | каждый пуш и PR | `validate` → `build` → `check-site` → `stats`, артефакт `site-preview` |
| `.github/workflows/refresh.yml` | ежедневно в 04:17 UTC, вручную или по кнопке | полный `collect` → `enrich` → `validate` → `build` → `check-site`, коммит `data/out` в ветку, публикация `dist/` на GitHub Pages |

Что важно знать про `refresh`:

- **`GITHUB_TOKEN` идёт в `enrich`**, поэтому в CI обогащается весь каталог (лимит 5000/час),
  а не первые 50 записей, как при локальном запуске без токена;
- **кэш ответов реестров** (`.cache/http`) сохраняется между прогонами через `actions/cache` —
  меньше нагрузки на npm/PyPI и меньше 429;
- **данные пишутся в самом конце** сбора, поэтому упавший прогон оставляет предыдущий
  каталог целым, а сайт не публикуется;
- коммит помечается `[skip ci]`, чтобы ежедневный прогон не запускал CI на собственном коммите;
- `concurrency: refresh` не даёт двум обновлениям идти одновременно;
- входные параметры при ручном запуске: `min-score` (строже отбор кандидатов) и `commit`
  (записать ли изменения в ветку);
- полный датасет всегда доступен как артефакт `libraries-json` (90 дней).

Для корректных `canonical` и `sitemap.xml` задайте в репозитории переменную `SITE_URL`
(Settings → Secrets and variables → Actions → Variables) — например `https://llm-catalog.ru`.
Без неё подставится адрес GitHub Pages проекта. Сайт публикуется через
`actions/upload-pages-artifact`; в настройках репозитория Sources должно быть выбрано
**GitHub Actions**.

## Источники данных

| Экосистема | Реестр | Поиск | Метаданные |
| --- | --- | --- | --- |
| Python | PyPI | индекс `/simple/` (46 МБ, кэш на неделю) | `pypi.org/pypi/<pkg>/json` + pypistats |
| JS/TS | npm | `registry.npmjs.org/-/v1/search` | `registry.npmjs.org/<pkg>` + api.npmjs.org |
| Rust | crates.io | `crates.io/api/v1/crates` | `crates.io/api/v1/crates/<crate>` |
| Go | pkg.go.dev | HTML-выдача `pkg.go.dev/search` | `proxy.golang.org/<module>/@latest` |
| Java/Kotlin | Maven Central | `search.maven.org/solrsearch` | `maven-metadata.xml` + POM (описание, scm, лицензия) |
| C#/.NET | NuGet | `azuresearch-usnc.nuget.org` | тот же endpoint по `packageid:` |
| Ruby | RubyGems | `rubygems.org/api/v1/search.json` | `rubygems.org/api/v1/gems/<gem>.json` |
| PHP | Packagist | `packagist.org/search.json` | `packagist.org/packages/<pkg>.json` |
| Elixir | Hex.pm | `hex.pm/api/packages?search=` | `hex.pm/api/packages/<pkg>` |
| Lua | LuaRocks | HTML `luarocks.org/search` | страница модуля |
| R | CRAN (r-universe) | `cran.r-universe.dev/api/search` | `cran.r-universe.dev/api/packages/<pkg>` |
| Прочие (C++, Kotlin, Scala, Swift, Zig, Haskell, Dart…) | GitHub Search | `api.github.com/search/repositories` | `api.github.com/repos/<slug>` |

Все ответы складываются в `.cache/http` с ETag — повторный прогон почти не тратит квоту.

## Модель данных

Запись в `libraries.json`:

```jsonc
{
  "id": "pypi:openai",
  "name": "openai",
  "description": "The official Python library for the openai API",
  "ecosystem": "pypi",
  "language": "Python",
  "providers": ["openai", "azure-openai"],   // каких провайдеров касается
  "sdkApi": "openai",                        // openai | anthropic-messages | gemini | bedrock | azure-openai | openai-compatible | n/a
  "kind": "official-sdk",                    // official-sdk | client | framework | gateway | local-runtime | eval | orchestration | retrieval | ui
  "status": "active",                        // active | beta | deprecated | archived | unknown
  "tier": "A",                               // A — must know, B — полезно, C — остальное
  "features": ["chat", "streaming", "tools", "vision", "embeddings"],
  "envVars": ["OPENAI_API_KEY"],
  "install": "pip install openai",
  "repo": "https://github.com/openai/openai-python",
  "registry": { "url": "...", "version": "3.19.2", "downloads": 284217868, "updatedAt": "2026-09-24" },
  "github": { "stars": 12000, "forks": 900, "archived": false, "pushedAt": "2026-09-20" },
  "confidence": 0.9,                         // 0.9 — курируемое, 0.3–0.75 — автообнаружение
  "source": ["curated:01-official-sdks.json", "registry:pypi"]
}
```

## Как это работает

1. **`collect.mjs`** загружает курируемые записи и для каждой подтягивает живые метаданные
   реестра (версия, загрузки, лицензия, описание) — ручные правки при этом выигрывают.
2. Для каждой экосистемы выполняются поисковые запросы из `ecosystems.json`; кандидаты
   оцениваются эвристикой (`lib/score.mjs`): совпадение имени с ключевым словом провайдера,
   LLM-признаки в описании, популярность, штрафы за «туториалы/awesome-списки/коллекции».
   Всё, что набрало выше порога, попадает в датасет как кандидат с низким `confidence`;
   уровень A остаётся только за курируемыми записями.
3. **`enrich.mjs`** подтягивает GitHub-статистику, переводит архивные репозитории в
   статус `archived`, а давно не обновлявшиеся — в `deprecated`. Обогащает сначала
   курируемые записи, чтобы при ограниченной квоте пострадали менее важные.
4. **`validate.mjs`** ловит дубликаты, битые ссылки, незаполненные описания, провайдеров,
   которых нет в конфиге, и потерю курируемых записей. `--online` дополнительно проверяет
   доступность ссылок.
5. **`build.mjs`** собирает статический сайт: главная страница, оглавления, срезы по
   каждому провайдеру и языку, `data/libraries.json`, `llms.txt`, `sitemap.xml`, `robots.txt`.
6. **`check-site.mjs`** запускает `site/app.js` на настоящем датасете в имитации DOM и
   проверяет сценарии: список непуст до первого клика, сортировка по популярности,
   открытие/закрытие карточки, разбор поискового запроса, наличие статической разметки.

## Сортировка и SEO

**Порядок по умолчанию** — по убыванию популярности: `звёзды × 20 + загрузки/мес + 50 за tier A`.
При равных метриках (у языков без звёзд и загрузок, например R или Clojure) вторичная
сортировка по популярности и имени — иначе порядок был бы произвольным и «прыгал» между сборками.
Клик по заголовку меняет направление, текстовые колонки (название, язык) по умолчанию
сортируются по возрастанию.

**SEO обеспечивается сборкой, а не клиентским JS:**

- строки таблицы рендерятся на этапе сборки (до 150 на страницу) — без JavaScript поисковик
  видит реальный список, а не пустую таблицу;
- у каждой страницы свои `title`, `description`, `keywords`, `canonical`, Open Graph;
- JSON-LD: `CollectionPage` с `ItemList` из `SoftwareSourceCode` (со звёздами как
  `InteractionCounter`) и `BreadcrumbList`;
- текстовый блок над таблицей с описанием среза и списком ссылок;
- `sitemap.xml` c `lastmod`/`changefreq`, `robots.txt`, оглавления `providers.html` и `languages.html`;
- `llms.txt` — указатель для ИИ-агентов.

Домен для `canonical`/`sitemap` задаётся переменной `SITE_URL` (в workflow берётся из
репозиторной переменной `SITE_URL`, иначе подставляется `https://<owner>.github.io/<repo>`).

**Учёт поискового запроса.** Если человек приходит из Google, Яндекса, Bing, Brave или
DuckDuckGo, каталог разбирает `document.referrer`: определяет язык (в том числе русские
написания — «питон», «крейт», «жаваскрипт», «си-шарп») и ставит фильтр по нему, а
содержательную часть запроса подставляет в поиск. Служебные слова («библиотеки», «llm»,
«для», «sdk») отбрасываются: запрос «библиотеки llm для rust» превращается в фильтр
«Rust» без бесполезного текстового поиска. Показывается подсказка с источником запроса и
кнопкой сброса. Срез языка или провайдера важнее referrer — страница `languages/r.html`
останется на R. То же работает для прямых ссылок `?q=…&language=…`.

## Как добавить библиотеку

Курируемый способ (для важных библиотек) — запись в `data/curated/*.json`:

```json
{
  "name": "my-llm-client",
  "ecosystem": "pypi",
  "providers": ["openai"],
  "kind": "client",
  "tier": "B",
  "features": ["chat", "streaming"],
  "repo": "https://github.com/me/my-llm-client",
  "notes": "Почему библиотека в каталоге и когда стоит брать её вместо официального SDK."
}
```

При каждом `collect` курируемая запись сверяется с реестром: подтягиваются версия, загрузки,
лицензия и описание, а если пакета с таким именем нет — пишется предупреждение в лог.
Именно так в каталоге обнаружились расхождения вроде того, что пакет `azure-ai-openai` для Python
не существует (Azure OpenAI доступен через класс `AzureOpenAI` в пакете `openai`), а официальный
PHP-SDK Anthropic публикуется как `anthropic-ai/sdk`, а не `anthropic-php/client`.

Новый реестр пакетов — адаптер в `scripts/adapters/*.mjs` с экспортами `search()` и
`fetchMeta()` плюс строчка в `data/config/ecosystems.json` и поисковые запросы в `queries`.

## Полезные флаги

```bash
node scripts/collect.mjs --ecosystems=pypi,npm   # только выбранные экосистемы
node scripts/collect.mjs --queries=openai         # один запрос вместо всех
node scripts/collect.mjs --min-score=6            # строже порог отбора
node scripts/collect.mjs --max-per-ecosystem=60  # больше кандидатов
node scripts/collect.mjs --curated-only           # без обращения к сети
node scripts/collect.mjs --skip-curated           # только автообнаружение
node scripts/collect.mjs --no-fetch               # без дозагрузки метаданных

node scripts/enrich.mjs --limit=200 --concurrency=4
node scripts/validate.mjs --online
LOG_LEVEL=debug node scripts/collect.mjs           # подробный лог запросов
```

## Ограничения

- Поиск в PyPI идёт через индекс пакетов, а не через поисковый API: возможны лишние кандидаты,
  поэтому автонайденные записи всегда проверяются эвристикой и имеют низкий `confidence`.
- Без `GITHUB_TOKEN` обогащение ограничено 60 запросами в час — на большой каталог нужен токен.
- Числа загрузок у разных реестров не сравнимы напрямую (PyPI — за месяц, npm — за месяц,
  crates.io — с момента публикации), в рейтинге они лишь нормированы.
- Сборки Maven Central идля каждого артефакта качают POM: медленно, но кэшируется.
