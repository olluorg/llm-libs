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
| По ролям | клиенты API 360 · фреймворки 55 · шлюзы 16 · локальный запуск 37 · сопутствующие 37 |
| Показывается по умолчанию | 376 — только клиенты API и шлюзы |
| Языков / экосистем | 18 языков, 13 реестров |
| Провайдеров в конфиге | 37 (OpenAI, Anthropic, Gemini, Bedrock, Azure, Vertex, Ollama, vLLM, Groq, OpenRouter, Mistral, Cohere, …) |
| Со ссылкой на репозиторий | 459 |
| Со звёздами GitHub | 389 |
| Страниц на сайте | 50 (главная, 2 оглавления, срез на каждый провайдер и язык) |

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
node scripts/audit-links.mjs # проверить ссылки на репозитории
node scripts/validate.mjs    # проверить данные
node scripts/build.mjs       # собрать сайт в dist/
node scripts/check-site.mjs  # дымовой тест собранного сайта
node scripts/lint-scripts.mjs# статическая проверка скриптов
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
| `.github/workflows/ci.yml` | каждый пуш и PR | задача «Данные и сайт»: `lint` → `validate` → `build` → `check-site` → `stats`; задача «Аудит ссылок»: `audit:links` (нужен токен) |
| `.github/workflows/refresh.yml` | ежедневно в 04:17 UTC, вручную или по кнопке | `lint` → полный `collect` → `enrich` → `audit:links --apply` → `validate` → `build` → `check-site`, коммит `data/out` и `data/curated/99-link-fixes.json` в ветку, публикация `dist/` на GitHub Pages |

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
  "providers": ["openai", "azure-openai"],   // чей API вызывается
  "worksWith": ["openai-compatible"],        // мягкая связь (роли runtime/support)
  "openaiCompatibleServer": undefined,       // true у Ollama, vLLM, llama.cpp
  "role": "sdk",                             // sdk | framework | runtime | gateway | support
  "sdkApi": "openai",                        // openai | anthropic-messages | gemini | bedrock | azure-openai | openai-compatible | n/a
  "kind": "official-sdk",                    // official-sdk | client | framework | gateway | local-runtime | retrieval | eval | orchestration | ui | util
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

## Дата последнего релиза

Дата берётся по приоритету, от самого надёжного источника к запасному:

| Приоритет | Источник | Поле | Когда применяется |
| --- | --- | --- | --- |
| 1 | Реестр пакета | `registry.updatedAt` | дата публикации версии: PyPI, npm, NuGet, crates.io, Packagist, Hex, LuaRocks, CRAN, Go |
| 2 | Релиз на GitHub | `github.releasedAt` | Maven Central (не отдаёт дату) и любой другой реестр без даты |
| 3 | Последний коммит | `github.pushedAt` | репозиторий без релизов и без даты в реестре |

Результат сохраняется в двух полях: `latestRelease` (дата) и `latestReleaseSource`
(`registry` | `github-release` | `github-commit`) — в интерфейсе это подсказка у даты,
в карточке видны все три источника. Сейчас: 488 записей из реестра, 13 из релизов GitHub,
3 по последнему коммиту, **без даты — 0**.

Пробелы были не «нет данных», а в трёх местах, где адаптеры дату не добывали:

- **NuGet** — поисковый индекс `azuresearch` часто не отдаёт `publishedDate` вообще. Дата
  и ссылка на репозиторий берутся из Registration API (`registration5-gz-semver2`); тело
  страниц сжато gzip'ом без заголовка `content-encoding`, поэтому `http.mjs` умеет
  отдавать сырой ответ через `raw: true`. Счётчик загрузок остаётся из поискового индекса,
  так как registration его не содержит.
- **CRAN** — r-universe отдаёт дату в поле `Date/Publication`, а не в `Date.Publication`.
  Заодно там лежат `_releases` (версия + дата) и период счётчика внутри ссылки
  `_downloads.source` — счётчик CRAN оказался помесячным.
- **LuaRocks** — дата загрузки версии указана в таблице истории на странице модуля.

Релизы GitHub запрашиваются с ETag-кэшем, поэтому повторные прогоны почти бесплатны:
условные запросы с `304` не тратят квоту. Режим выбирается флагом: `--releases=missing`
(по умолчанию — только там, где реестр не дал дату), `all` (у всех записей, пополняет
карточку тегом релиза) или `none`.

Проверки: `check-site` требует, чтобы дата была у **всех** записей и у всех, у кого есть
репозиторий, а также чтобы приоритет источников соблюдался. `enrich` в конце печатает
предупреждение со списком записей без даты и разбивкой по экосистемам. Удалённые
репозитории (404) тоже видны: у курируемой записи это ошибка данных (предупреждение в лог),
у автонайденной битая ссылка просто убирается.

## Ссылки на репозитории

Ссылка на репозиторий приходит из двух источников: из реестра пакета и из курируемых данных.
Оба иногда ошибаются, и цена ошибки разная — 404 в каталоге плюс неверные звёзды,
которые ещё и влияют на порядок и на срез «популярное».

Так было у `fireworks-ai`: в курируемых данных стоял репозиторий
`fireworks-ai/fireworks-python`, которого не существует, а PyPI указывал на
`fw-ai-external/python-sdk`. Курируемое поле при этом всегда выигрывало у реестра,
поэтому битая ссылка молча перекрывала правильные данные.

Проверяет это `scripts/audit-links.mjs`:

| Вердикт | Что означает | Что делает `--apply` |
| --- | --- | --- |
| `ok` | ссылка жива и указывает на корень репозитория | — |
| `canonical` | репозиторий переехал, GitHub отдаёт новое имя | ставит каноническую ссылку |
| `subpath` | ссылка ведёт в подпапку или файл (`/blob/main/README.md`, `.git`, `git@…`, `www.`) | усекает до корня репозитория |
| `fixed` | ссылка битая, но реестр указывает на живой репозиторий | берёт репозиторий из реестра |
| `deadNoSource` | ссылка битая и замены в реестре нет | убирает ссылку, помечает запись заметкой |
| `nonGithub` | репозиторий не на GitHub | проверяется отдельно (`--http`) |

Правила, из-за которых это работает:

- **Живость ссылки решает только проверка, а не сравнение строк.** Реестр и курируемые
  данные регулярно указывают на один репозиторий по-разному, и наоборот — разными
  строками могут быть и два разных репозитория. `collect` только предупреждает о
  расхождении, решение принимает аудит.
- **Битая ссылка в курируемой записи останавливает CI**, в автонайденной — нет: её чинит
  следующий прогон `refresh` с `--apply`.
- **Правки накапливаются в `data/curated/99-link-fixes.json`**, а не только в датасете.
  Иначе после следующего `collect` всё вернулось бы к исходному значению из реестра.
  Курируемые записи с одинаковым `id` сливаются, поэтому файл правок хранит только
  исправленное поле, а не копию записи. Битая ссылка, для которой нет замены,
  записывается флагом `repoDropped` — обычное «нет поля» означало бы «не знаю»,
  и мёртвая ссылка вернулась бы из реестра.
- **Звёзды сверяются с тем же репозиторием.** Сменился репозиторий — значит, и звёзды
  прежние; расхождение видно в отчёте.

Отчёт всегда в `data/out/link-audit.json`, в CI и `refresh` он складывается артефактом
`link-audit`. Полезные флаги: `--only=pypi,npm` (одна экосистема), `--http` (дополнительно
проверить `docs` и `homepage` обычным HTTP-запросом).

## Как устроен каталог: роль и провайдер — разные вещи

`transformers`, `ollama` и `langchain` — не клиенты API провайдера, но в каталоге они
стояли рядом с `openai` SDK, и страница «Библиотеки для OpenAI» выглядела как список
всего подряд. Поэтому в модели данных два независимых поля:

| Поле | Смысл | Пример |
| --- | --- | --- |
| `role` | что библиотека **делает** с LLM | `sdk`, `framework`, `runtime`, `gateway`, `support` |
| `providers` | чей API она **вызывает** | `["openai", "azure-openai"]` |
| `worksWith` | мягкая связь, API не вызывается | `["huggingface"]` |

| Роль | Что это | Звонит ли в API провайдера | Примеры |
| --- | --- | --- | --- |
| **Клиент API провайдера** (`sdk`) | Прямой HTTP-клиент одного или нескольких API | да | `openai` (Python/TS/.NET/Go/Ruby/Java), `@anthropic-ai/sdk`, `com.anthropic:anthropic-java`, `google-genai`, `boto3`, `azure-ai-inference`, `groq`, `mistralai`, `async-openai`, `go-openai`, `anthropic-ai/sdk` |
| **Шлюз** (`gateway`) | Прокси к провайдерам: ретраи, бюджеты, учёт стоимости | да | `litellm`, `portkey` |
| **Фреймворк поверх SDK** (`framework`) | Абстракция: агенты, цепочки, RAG, структурированный вывод | да, но через клиентские SDK | `langchain`, `langgraph`, `llama-index`, `pydantic-ai`, `dspy`, `instructor`, `ai` (Vercel AI SDK), `semantic-kernel`, `langchain4j` |
| **Локальный запуск моделей** (`runtime`) | Считает модель сам или поднимает сервер инференса | **нет** | `ollama`, `vllm`, `transformers`, `torch`, `llama.cpp`, `candle`, `mlx-lm`, `openai-whisper`, `diffusers` |
| **Сопутствующие инструменты** (`support`) | Векторные БД, наблюдаемость, eval, токенизаторы, UI, серверы MCP | **нет** | `chromadb`, `qdrant-client`, `langfuse`, `promptfoo`, `tiktoken`, `mcp`, `@lobehub/chat` |

**Инвариант** (проверяется в `validate`): у ролей `runtime` и `support` поле `providers`
обязано быть пустым. Нарушение — ошибка сборки, а не предупреждение. Так `transformers`
знает про Hugging Face, но не считается клиентом его API: у Hugging Face нет одного
инференс-API, который вызывал бы `transformers` — он грузит веса и считает локально.

Тонкость про локальные рантаймы: `ollama`, `vLLM`, `llama.cpp` и LM Studio поднимают
**OpenAI-совместимый сервер**, поэтому ими можно пользоваться *тем же* официальным
`openai`-клиентом, просто с другим `base_url`. Такие записи помечены флагом
`openaiCompatibleServer`, чтобы эта связь не потерялась.

**Что показывается по умолчанию.** На главной и на странице провайдера — только клиенты API
и шлюзы (376 из 505 записей): фреймворки, рантаймы и инфраструктура доступны через фильтр
ролей. На срезе языка и в оглавлениях показываются все роли — туда приходят за полным
списком по языку.

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
4. **`audit-links.mjs`** проверяет каждую ссылку на репозиторий: репозиторий существует,
   ссылка ведёт именно на него, а не на подпапку или файл, и звёзды соответствуют
   записанным. Битые ссылки чинит: заменяет на репозиторий из реестра, убирает ссылку,
   если замены нет, приводит к канонической. Подробности — в разделе «Ссылки на репозитории».
5. **`validate.mjs`** ловит дубликаты, незаполненные описания, провайдеров,
   которых нет в конфиге, и потерю курируемых записей. `--online` дополнительно проверяет
   доступность ссылок.
6. **`build.mjs`** собирает статический сайт: главная страница, оглавления, срезы по
   каждому провайдеру и языку, `data/libraries.json`, `llms.txt`, `sitemap.xml`, `robots.txt`.
7. **`check-site.mjs`** запускает `site/app.js` на настоящем датасете в имитации DOM и
   проверяет сценарии: список непуст до первого клика, сортировка по популярности,
   фильтр ролей, открытие/закрытие карточки, разбор поискового запроса, наличие статической
   разметки. **`lint-scripts.mjs`** ловит ошибки, которые видны только в рантайме: `const`,
   объявленный после верхнеуровневого `await` (временная мёртвая зона), — на этом мы
   споткнулись трижды, теперь это ошибка в CI.

## Сортировка и SEO

**Порядок по умолчанию — «популярность»**, и формула намеренно неочевидна: наивная ломается
на реальных данных.

```
популярность = 2·log₁₀(звёзды + 10)        ← одна и та же величина у всех реестров
           + вес · log₁₀(загрузки + 10)    ← вес зависит от смысла счётчика
           + 0.5                            ← курируемая запись уровня A
```

| Что измеряет счётчик | Реестры | Вес |
| --- | --- | --- |
| `month` — за последний месяц | PyPI (pypistats), npm, Packagist (`monthly`), Hex (`recent`) | 1.0 |
| `total` — накопительно с публикации | crates.io, NuGet, RubyGems, LuaRocks | 0.8 |
| `imports` — число импортов модуля | Go (pkg.go.dev) | 0.5 |
| счётчика нет | Maven, CRAN, GitHub-репозитории | — |

Почему логарифм, а не `звёзды × 20 + загрузки / 1000`:

- **Величины несопоставимы.** Одна звезда в старой формуле «весила» 20 000 загрузок, поэтому
  любой пакет с тысячей звёзд забивал всё остальное, а помесячные счётчики PyPI сравнивались
  с накопительными счётчиками crates.io.
- **Выбросы переворачивали список.** `boto3` ставят ~2.4 млрд раз в месяц (CI на AWS), и
  линейная сумма ставила его первым, хотя звёзд 9.9k против 59.7k у `litellm`. С логарифмом
  вклад каждой метрики лежит в [0, 10], и порядок становится `litellm 18.00 → openai 17.96
  → boto3 17.88`.
- `check-site` требует **монотонности** метрики: кто выигрывает и по звёздам, и по загрузкам,
  обязан стоять выше. Старая формула это правило нарушала.

Счётчики не выравниваются и не подгоняются: `npm run stats` показывает, что именно измеряет
каждый (`month` 209, `total` 194, `imports` 25, без счётчика 77), в интерфейсе подпись
уточняет период («/мес», «всего», «импортов»), а ★ и ⬇ сортируются отдельно. При равных
метриках вторичная сортировка по популярности и имени, иначе порядок был бы произвольным
(у R, Clojure, OCaml метрики близки к нулю).

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
  "role": "sdk",                 // sdk | framework | runtime | gateway | support
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
node scripts/enrich.mjs --releases=all    # даты релизов GitHub у всех записей
node scripts/audit-links.mjs             # отчёт по ссылкам на репозитории
node scripts/audit-links.mjs --apply     # отчёт + починить ссылки и звёзды
node scripts/audit-links.mjs --only=pypi  # только одна экосистема
node scripts/audit-links.mjs --http      # дополнительно проверить docs и homepage
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
