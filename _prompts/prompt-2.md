ПРОЕКТНЫЙ БРИФ/ПРОМПТ: Самостоятельное приложение для индексации Confluence (Wiki) и RAG-поиска

Цель
Построить автономное (самодостаточное) приложение, которое:
- Подключается к Confluence (Wiki) по персональному токену пользователя.
- Позволяет выбрать пространство (space), просмотреть дерево страниц, выбрать страницы и их потомков.
- Для выбранных страниц: получить HTML, очистить, разбить на чанки, сгенерировать вопросы, создать эмбеддинги и сохранить в PostgreSQL (pgvector) для RAG-поиска.
- Предоставляет HTTP API для семантического поиска по индексированным чанкам.

Ограничения и требования
- Приложение автономное, не использовать никакие модули из существующей папки api текущего монорепо.
- Node.js >= 18.19, Yarn/NPM по желанию.
- База данных: PostgreSQL с расширением pgvector.
- Хранение секретов через .env (без коммита реальных ключей).
- Код на TypeScript (предпочтительно), допускается JS при необходимости, но придерживаться строгой структуры.

Технологический стек (рекомендации)
- Backend: Node.js + Express.
- Frontend: Простой статический HTML + JS (vanilla) или небольшой фреймворк (без сборки) — достаточно vanilla ES Modules.
- HTTP клиент: axios или fetch.
- HTML очистка: cheerio + минималистичная логика (аналог cleanHTML).
- OpenAI: официальный SDK или вызовы REST. Два типа запросов: Chat Completions (LLM) и Embeddings.
- БД: pg (node-postgres), pgvector.

Архитектура и директории
- server/
    - server.ts (Express сервер, статическая выдача, API роуты)
    - confluence.ts (клиент работы с Confluence: spaces/pages/page content)
    - cleanHtml.ts (очистка HTML — логика максимально повторяет правила ниже)
    - chunker/
        - batching.ts (prepareBatches, разбиение входного текста на батчи при необходимости)
        - splitIntoChunks.ts (вызов LLM для получения чанков по JSON-схеме)
        - questions.ts (вызов LLM для генерации вопросов для каждого чанка)
    - embeddings.ts (вызов OpenAI Embeddings для текста чанка и для каждого вопроса)
    - db.ts (инициализация, миграции, CRUD. Создание расширения pgvector, схемы и таблиц)
    - pipeline.ts (координация: очистка → чанкование → вопросы → эмбеддинги → сохранение)
    - config.ts (чтение .env, дефолты)
- public/
    - index.html (UI: выбор токена, пространства, дерева страниц, отметка чекбоксов, кнопки индексирования)
    - app.js (логика UI: загрузка пространств, дерева, предпросмотр страницы, массовые действия, индикаторы статуса)
- .env.example

Переменные окружения (.env)
- PORT=3000
- CONFLUENCE_BASE_URL=https://wiki.example.com
- OPENAI_API_KEY=...
- OPENAI_CHAT_MODEL=gpt-4o-mini (или другой, поддерживающий JSON формат ответа)
- OPENAI_EMBEDDING_MODEL=text-embedding-3-large
- PGHOST=localhost
- PGPORT=5432
- PGUSER=postgres
- PGPASSWORD=postgres
- PGDATABASE=wiki_rag

Функциональные сценарии
1) UI индексирования Wiki
- Пользователь вводит/вставляет персональный токен Confluence (LocalStorage и передача с каждым запросом к серверу, сервер проксирует к Confluence).
- Выпадающий список пространств: GET /api/wiki/spaces → [{ key, name }]
- Выбор пространства → загрузить дерево корневых страниц: GET /api/wiki/pages?spaceKey=AS → [{ id, title, hasChildren }].
- Лениво подгружать детей: GET /api/wiki/children?parentId=123 → [{ id, title, hasChildren }].
- При выборе страницы показывать предпросмотр: GET /api/wiki/page?id=123 → { title, html } (html с уже подставленными абсолютными ссылками и встроенными картинками base64, если возможно).
- У каждой страницы чекбокс; есть «выделить все/снять все»; «Индексировать выбранные», «Индексировать всех потомков выбранной» и «Снять индексацию».
- Получение списка уже проиндексированных страниц: POST /api/indexed-ids → body: { ids: string[] } → result: string[] (существующие srcId).

2) Индексация (серверная логика)
   Для списка выбранных pageId:
- По каждому pageId:
  a) Получить HTML страницы из Confluence (REST endpoints ниже). В ответе нормализовать относительные href/src, подготовить HTML.
  b) Очистить HTML согласно правилам (см. Раздел Очистка HTML).
  c) Разбить очищенный HTML на чанки через LLM (см. Раздел Чанкование/LLM). На каждый чанк добавить префикс-метадату вида:
     <source title="{title}" url="{BASE}/pages/viewpage.action?pageId={id}" />\n\n{chunk}
  d) Для каждого чанка получить 3–7 вопросов (LLM questions prompt).
  e) Сохранить в БД:
     - Строки таблицы wiki.dataset (см. Схема БД) с текстом чанка и списком вопросов (вопросы можно хранить как JSONB или как текст c маркировкой). На базе этих данных далее создаются отдельные записи в wiki.chunks.
     - Создать (или пересоздать) записи в wiki.chunks (каждый чанк отдельная строка), затем получить эмбеддинги для:
       • текста чанка (обязательно)
       • каждого вопроса (по желанию — можно хранить отдельно в wiki.questions как расширение, но достаточно хранить только эмбеддинг чанка для базового RAG). Если делаете эмбеддинги и для вопросов — храните их в wiki.questions с ссылкой на chunk_id.
- Параллельный запуск: отправлять обработку страниц параллельно, но со сдвигом старта ~10 мс между задачами, чтобы не бить лимиты Confluence/OpenAI.
- По завершении страницы — обновить маркеры состояния и выслать событие прогресса на фронт (через SSE или периодический поллинг).

3) API RAG
- POST /api/rag/search
  Вход:
  {
  "query": "string",
  "threshold": 0.65,
  "chunksLimit": 10
  }
  Действия:
    - Создать эмбеддинг для query (тем же embedding model).
    - Выполнить поиск по таблице wiki.chunks с помощью pgvector cosine similarity: cosine_distance(embedding, query_embedding) или 1 - cosine_similarity.
    - Оставить только записи с similarity >= threshold.
    - Вернуть top-N (chunksLimit) записей: [{ chunk_id, src_id, title, url, text, score }].

Интеграция с Confluence
HTTP запросы с заголовком Authorization: Bearer <token>:
- Список пространств: GET {CONFLUENCE_BASE_URL}/rest/api/space?start=0&limit=1000 → { results: [{ key, name }, ...] }
- Корневые страницы по space: GET {BASE}/rest/api/content?spaceKey={spaceKey}&type=page&expand=ancestors&start=0&limit=1000 → results (фильтруем с ancestors.length === 0)
- Дети: GET {BASE}/rest/api/content/{parentId}/child/page?start=0&limit=1000
- Страница: GET {BASE}/rest/api/content/{id}?expand=body.view → { title, body.view.value: HTML }
    - Заменить (src|href)="/" на абсолютные: (src|href)="{BASE}/"
    - Извлечь <img src="..."> ссылки; попытаться скачать и заменить на data:<mime>;base64,... . Если не удалось — оставить исходные URL.

Очистка HTML (cleanHtml.ts)
Ориентируйтесь на следующие правила (аналог коду в репо):
- Удалить: комментарии, script/noscript, style/link[rel=stylesheet], form-элементы, скрытые элементы ([hidden], style*=display:none|visibility:hidden), meta (кроме допустимых в head, но тело очищаем), title внутри body.
- Удалить декоративные/служебные теги: head, meta, title, base, link, style, script, noscript, object, embed, applet, iframe, frame, frameset, noframes, audio, video, source, track, canvas, svg, math, button, input, textarea, select, option, optgroup, label, fieldset, legend, datalist, output, progress, meter, form, footer, header, nav, font. Также div.footer, div.header.
- По умолчанию изображения удалить (img, picture, figure, figcaption, svg). Можно опцией keepImages=true разрешить img src/alt.
- Удалить все атрибуты у элементов, кроме href у ссылок (добавить target=_blank по желанию) и src/alt у img, если keepImages.
- Удалять пустые элементы, а также элементы, содержащие только один self-closing (например, одиночный <br>), с многократным проходом.
- Упростить вложенность (ограничить maxNestingLevel, заменить глубокую вложенность на текст), убрать избыточные div/span, заменить strong/b на <b>, em/i на <i>. Удалить <br> перед закрывающими блочными тегами.
- Минифицировать HTML: удалить лишние пробелы/пустые атрибуты/комментарии; итог — компактная строка без <html>/<body> оболочки.

Чанкование (LLM)
- Параметры:
    - CHAT_MODEL (из .env OPENAI_CHAT_MODEL), PROMPT_CHUNKING (в конфиге).
- Процесс:
    - Подготовить batches (если текст очень большой): измерить токены (оценочно), нарезать на группы, каждая проходит один и тот же запрос к LLM.
    - Вызов Chat Completions с сообщениями:
      [
      { role: 'system', content: PROMPT_CHUNKING },
      { role: 'user', content: CLEANED_HTML },
      { role: 'system', content: PROMPT_CHUNKING }
      ]
    - Ожидать JSON по заранее описанной JSON-схеме: { chunks: string[] }.
    - Суммарный размер и кол-во чанков логировать, чтобы контролировать стоимость.
    - Для каждого чанка выполнить генерацию вопросов.

Генерация вопросов (LLM)
- PROMPT_QUESTIONS фиксировать в коде (системная роль), вход: текст чанка в user, опциональный контекст в system.
- Ожидать JSON { questions: string[] } (3–7 коротких вопросов), пригодных для поиска или обучения retriever’а.

Эмбеддинги (OpenAI)
- Для базового RAG достаточно эмбеддинга текста чанка (text-embedding-3-large). Вариант: дополнительно эмбеддинги вопросов и хранить их в отдельной таблице.
- Сохранять вектор как vector тип (pgvector) длиной согласно модели.

Схема БД (PostgreSQL + pgvector)
Используйте схему wiki (или public, но лучше выделить):
- Таблица wiki.pages
    - id (serial PK)
    - src_id TEXT (Confluence pageId), UNIQUE
    - space_key TEXT
    - title TEXT
    - url TEXT
    - created_at TIMESTAMP, updated_at TIMESTAMP

- Таблица wiki.dataset (черновик хранения, как источник генерации)
    - id (serial PK)
    - src_id TEXT (ссылка на pages.src_id)
    - title TEXT
    - content TEXT (очищенный HTML или сырой текст)
    - tags TEXT[] (опционально)
    - created_at, updated_at

- Таблица wiki.chunks
    - id (serial PK)
    - src_id TEXT (ссылка на pages.src_id)
    - title TEXT
    - url TEXT
    - text TEXT (текст чанка)
    - embedding VECTOR (dimension соответствует выбранной модели)
    - tokens INT (опционально)
    - created_at, updated_at
      Индекс: ivfflat по embedding (cosine), а также btree по src_id.

- (Опционально) Таблица wiki.questions
    - id (serial PK)
    - chunk_id INT (FK → wiki.chunks.id)
    - question TEXT
    - embedding VECTOR (если делаем эмбеддинги для вопросов)

Миграции
- Создайте миграцию, включающую: CREATE EXTENSION IF NOT EXISTS vector;
- Создание схемы и таблиц; индексы для быстрого поиска по embedding и фильтрации по src_id.

REST API дизайн (сервер)
- GET /api/wiki/spaces → [{ key, name }]
- GET /api/wiki/pages?spaceKey=KEY → [{ id, title, hasChildren }]
- GET /api/wiki/children?parentId=123 → [{ id, title, hasChildren }]
- GET /api/wiki/page?id=123 → { title, html }
- POST /api/indexed-ids → body: { ids: string[] } → result: string[]
- POST /api/index → body: { pages: [{ id, spaceKey, title }], blockId?: number, tags?: string[] }
    - Сервер для каждого id получает HTML → очищает → чанкование → вопросы → эмбеддинги → сохраняет.
- DELETE /api/index/:id → снять индексацию (удалить из chunks и pages/dataset по src_id).
- POST /api/rag/search → { query, threshold, chunksLimit } → top-N результатов.

UI (public/index.html + app.js)
- Интерфейс:
    - Поле для ввода персонального токена Confluence (сохранение в localStorage и отправка в заголовке Authorization при запросах к своему серверу, который проксирует к Confluence).
    - Select пространств; q-tree аналог реализовать как список с ленивой загрузкой детей, отображение «уже индексировано» (зелёная точка) на основе /api/indexed-ids.
    - Предпросмотр выбранной страницы (title + html). Если встречен meta refresh — показать предупреждение и удалить этот тег из предпросмотра/очистки.
    - Выбор страниц чекбоксами, кнопки: «Индексировать», «Индексировать потомков», «Снять индексацию».
    - Индикатор фоновой индексации: простейший прогресс (кол-во в очереди/готово) через SSE или периодический GET /api/status.

Обработка очередей/параллельности
- На POST /api/index принимать массив страниц; для каждого запускать задачу с искусственной задержкой старта ~10 мс.
- Параллельность ограничить (например, p-limit 3–5), чтобы не упираться в rate limit Confluence/OpenAI.
- Хранить состояние в памяти (вектор текущих задач) и отдавать в /api/status: { queued, processing, done, errors }.

Безопасность и ключи
- Персональный Confluence Token не хранить на сервере; сервер получает его от клиента и использует только для проксирования запросов (не логировать!).
- OPENAI_API_KEY хранить в .env сервера.
- Включить базовую валидацию входных параметров и ограничение на объемы.

Конфигурация и настройки
- PROMPT_CHUNKING и PROMPT_QUESTIONS — держать как строки в config.ts с возможностью переопределения через .env или конфиг-файл.
- Модели OpenAI — настраиваемые через .env.
- Параметры батчинга (целевой размер по токенам, количество чанков в батче, и т.п.) — в config.ts.

Псевдо-алгоритмы/скелеты
- confluence.ts
    - fetchSpaces(token)
    - fetchPagesBySpace(token, spaceKey)
    - fetchChildren(token, parentId)
    - fetchPageHtml(token, id) → нормализовать ссылки, встроить изображения
- cleanHtml.ts
    - export async function cleanHTML(html, { keepImages=false, maxNestingLevel=10, linkTarget="_blank", noMinify=false }) { ...правила как выше... }
- splitIntoChunks.ts
    - chatCompletion с JSON-схемой { chunks: string[] }
- questions.ts
    - chatCompletion с JSON-схемой { questions: string[] }
- embeddings.ts
    - getEmbeddingForText(text)
- pipeline.ts
    - processPage({ id, spaceKey, title })
      • html = fetchPageHtml → cleanHTML → batches → splitIntoChunks → add <source .../> в начало каждого чанка
      • for each chunk: questions = getQuestionsForChunk
      • save: upsert page in wiki.pages, insert into wiki.chunks with embedding, optionally wiki.questions
- db.ts
    - init: create extension vector, create tables if not exist, create indexes
    - query helpers

Пример JSON-схем (для LLM)
- Для чанков:
  { "type": "object", "properties": { "chunks": { "type": "array", "items": { "type": "string" } } }, "required": ["chunks"] }
- Для вопросов:
  { "type": "object", "properties": { "questions": { "type": "array", "items": { "type": "string" } } }, "required": ["questions"] }

Тестирование
- Моки: вместо реального Confluence добавить возможность чтения тестовой страницы из файла при отсутствии токена.
- Интеграционный маршрут: POST /api/index с 1–2 тестовыми страницами (локальные HTML) для проверки пайплайна без внешних вызовов.
- Юнит-тесты для cleanHTML и разбиения на чанки (ожидаемые кейсы: удаление скриптов/стилей, упрощение вложенности).

Результат
- Репозиторий с работоспособным сервером и статическим UI, .env.example, миграциями.
- Документация README:
    - Установка и запуск
    - Настройка .env
    - Создание БД и расширения pgvector
    - Ключевые команды и эндпоинты
    - Схема БД
    - Примечания по лимитам OpenAI/Confluence

Подсказки по производительности и качеству
- Кэшировать ответы Confluence кратковременно, чтобы снизить нагрузку при повторном открытии той же страницы.
- Дедупликация чанков: убирать полностью идентичные тексты.
- Вопросы можно хранить вместе с чанком, но для гибкости лучше отдельная таблица.
- Встраивать в чанк ссылку на оригинальную страницу (<source />), чтобы при RAG-ответах можно было формировать источники.
