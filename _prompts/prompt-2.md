 ПРОЕКТНЫЙ БРИФ/ПРОМПТ: Самостоятельное приложение для индексации Confluence (Wiki) и RAG-поиска

Цель
Построить автономное (самодостаточное) приложение, которое:
- Подключается к Confluence (Wiki) по персональному токену пользователя.
- Позволяет выбрать пространство (space), просмотреть дерево страниц, выбрать страницы и их потомков.
- Для выбранных страниц: получить HTML, очистить, разбить на чанки, сгенерировать вопросы, создать эмбеддинги и сохранить в PostgreSQL (pgvector) для RAG-поиска.
- Предоставляет HTTP API для семантического поиска по индексированным чанкам.

Ограничения и требования
- Node.js >= 22.17, Yarn/NPM по желанию.
- База данных: PostgreSQL с расширением pgvector.
- Хранение секретов через .env (без коммита реальных ключей).
- Код на TypeScript.

Технологический стек (рекомендации)
- Backend: Node.js + Express.
- Frontend: Простой статический HTML + JS (vanilla) или небольшой фреймворк (без сборки) — достаточно vanilla ES Modules.
- HTTP клиент: axios или fetch. 
- HTML очистка: cheerio + минималистичная логика 
- OpenAI: официальный SDK. Два типа запросов: Chat Completions (LLM) и Embeddings.
- БД: pg (node-postgres), pgvector.

Архитектура и директории
- server/
    - server.ts (Express сервер, статическая выдача, API роуты)
    - confluence.ts (клиент работы с Confluence: spaces/pages/page content)
    - cleanHtml.ts (очистка HTML — логика максимально повторяет правила ниже)
    - chunker/
        - splitIntoChunks.ts (вызов LLM для получения чанков по JSON-схеме)
        - questions.ts (вызов LLM для генерации вопросов для каждого чанка)
    - embeddings.ts (вызов OpenAI Embeddings для текста чанка и для каждого вопроса)
    - db.ts (инициализация, миграции, CRUD. Создание расширения pgvector, схемы и таблиц)
    - pipeline.ts (координация: очистка → чанкование → вопросы → эмбеддинги → сохранение)
    - config.ts (чтение .env, дефолты)
- public/
    - index.html (UI: выбор токена, пространства, дерева страниц, отметка чекбоксов, кнопки индексирования)
      index.html должен раздаваться черезз серверный эндпоинт /
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
- PGPASSWORD=*
- PGDATABASE=wiki_rag

Функциональные сценарии
1) UI индексирования Wiki
- Пользователь вводит/вставляет персональный токен Confluence (LocalStorage и передача с каждым запросом к серверу, сервер проксирует к Confluence).
- Выпадающий список пространств: GET /api/wiki/spaces → [{ key, name }]
- Выбор пространства → загрузить дерево корневых страниц: GET /api/wiki/pages?spaceKey=AS → [{ id, title, hasChildren }].
- Лениво подгружать детей: GET /api/wiki/children?parentId=123 → [{ id, title, hasChildren }].
- При выборе страницы показывать предпросмотр: GET /api/wiki/page?id=123 → { title, html } (html с уже подставленными абсолютными ссылками и встроенными картинками base64, если возможно).
- У каждой страницы чекбокс; есть «выделить все/снять все»; «Индексировать выбранные», «Индексировать всех потомков выбранной» и «Снять индексацию».
- Получение списка уже проиндексированных страниц: POST /api/indexed-ids → body: { ids: string[] } → result: string[] (существующие wikiId).

2) Индексация (серверная логика размещения информации в RAG)
   Для списка выбранных pageId:
- По каждому pageId (wiki_id):
  a) Получить HTML страницы из Confluence (REST endpoints ниже). В ответе нормализовать относительные href/src, подготовить HTML.
  b) Очистить HTML согласно правилам (см. Раздел Очистка HTML).
  c) Разбить очищенный HTML на чанки через LLM (см. Раздел Чанкование/LLM). В начало каждого чанка добавить префикс-метадату вида:
     <source title="{title}" url="{BASE}/pages/viewpage.action?pageId={id}" />\n\n{chunk}
  d) Удалить записи с текущим wiki_id из таблицы wiki_rag.chunk
  e) Удалить записи с текущим wiki_id из таблицы wiki_rag.question
  f) Для каждого чанка 
      1) получить 3–20 вопросов (LLM questions prompt).
      2) получить эмбеддинги для чанка
      3) получить эмбеддинги для вопросов
      4) Сохранить в БД:
         - Вставить в таблицу wiki_rag.chunk новую запись: wiki_id, HTML (chunk_text), очищенный HTML (embedding_text) и эмбеддинг (embedding) (см. Схема БД)
         - Создать записи в wiki_rag.question (каждый вопрос - отдельная строка)
- Параллельный запуск: отправлять обработку страниц параллельно, но со сдвигом старта ~30 мс между задачами, чтобы не бить лимиты Confluence/OpenAI.
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
    - Выполнить поиск по таблице wiki_rag.question с помощью pgvector cosine similarity (cs) (оператор <=>).
    - Оставить только записи с similarity <= threshold.
    - Выполнить поиск по таблице wiki_rag.chunk с помощью pgvector cosine similarity (cs) (оператор <=>).
    - Оставить только записи с similarity <= threshold.
    - Выбрать уникальные chunk_id
    - Вернуть top-N (chunksLimit) записей: [{ chunk_id, wiki_id, text, cs }].

Интеграция с Confluence
HTTP запросы с заголовком Authorization: Bearer <token>:
- Список пространств: GET {CONFLUENCE_BASE_URL}/rest/api/space?start=0&limit=1000 → { results: [{ key, name }, ...] }
- Корневые страницы по space: GET {BASE}/rest/api/content?spaceKey={spaceKey}&type=page&expand=ancestors&start=0&limit=1000 → results (фильтруем с ancestors.length === 0)
- Дети: GET {BASE}/rest/api/content/{parentId}/child/page?start=0&limit=1000
- Страница: GET {BASE}/rest/api/content/{id}?expand=body.view → { title, body.view.value: HTML }
    - Заменить (src|href)="/" на абсолютные: (src|href)="{BASE}/"

Очистка HTML (cleanHtml.ts)
Ориентируйтесь на следующие правила:
- Удалить: комментарии, script/noscript, style/link[rel=stylesheet], form-элементы, скрытые элементы ([hidden], style*=display:none|visibility:hidden), meta (кроме допустимых в head, но тело очищаем), title внутри body.
- Удалить декоративные/служебные теги: head, meta, title, base, link, style, script, noscript, object, embed, applet, iframe, frame, frameset, noframes, audio, video, source, track, canvas, svg, math, button, input, textarea, select, option, optgroup, label, fieldset, legend, datalist, output, progress, meter, form, footer, header, nav, font. Также div.footer, div.header.
- По умолчанию изображения удалить (img, picture, figure, figcaption, svg).
- Удалить все атрибуты у элементов, кроме href у ссылок (добавить target=_blank).
- Удалять пустые элементы, а также элементы, содержащие только один self-closing (например, одиночный <br>), с многократным проходом.
- Упростить вложенность (ограничить maxNestingLevel, заменить глубокую вложенность на текст), убрать избыточные div/span, заменить strong/b на <b>, em/i на <i>. Удалить <br> перед закрывающими блочными тегами.
- Минифицировать HTML: удалить лишние пробелы/пустые атрибуты/комментарии; итог — компактная строка без <html>/<body> оболочки.

Чанкование (LLM)
- Параметры:
    - CHAT_MODEL (из .env OPENAI_CHAT_MODEL), PROMPT_CHUNKING (в конфиге).
- Процесс:
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
- Ожидать JSON { questions: string[] } (3–20 вопросов), пригодных для поиска или обучения retriever’а.

Эмбеддинги (OpenAI)
- Для базового RAG - text-embedding-3-large
- эмбеддинги вопросов хранить их в таблице wiki_rag.question.
- Сохранять вектор как vector тип (pgvector) длиной 1024.

Схема БД (PostgreSQL + pgvector)
```postgresql
CREATE TABLE wiki_rag.chunk
(
    chunk_id       SERIAL PRIMARY KEY,
    wiki_id        TEXT                                               NOT NULL,
    text           TEXT                                               NOT NULL,
    embedding_text TEXT                                               NOT NULL,
    embedding      public.vector(1024)                                NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);


COMMENT ON TABLE wiki_rag.chunk IS 'Stores text chunks and their vector embeddings for RAG retrieval system';
COMMENT ON COLUMN wiki_rag.chunk.chunk_id IS 'Primary key, auto-incrementing identifier for each text chunk record';
COMMENT ON COLUMN wiki_rag.chunk.wiki_id IS 'Id страницы в WIKI, с которой получен чанк';
COMMENT ON COLUMN wiki_rag.chunk.text IS 'Original text chunk content (may contain HTML tags or other formatting)';
COMMENT ON COLUMN wiki_rag.chunk.embedding_text IS 'Processed text used for embedding generation (e.g., HTML stripped version of chunk_text)';
COMMENT ON COLUMN wiki_rag.chunk.embedding IS 'Vector embedding representation of the embedding_text with dimension 1024';
COMMENT ON COLUMN wiki_rag.chunk.updated_at IS 'Timestamp indicating when the record was created or last updated';

CREATE INDEX idx_texts_embedding_vector ON wiki_rag.chunk USING ivfflat (embedding vector_cosine_ops);


CREATE TABLE wiki_rag.question
(
    question_id SERIAL PRIMARY KEY,
    chunk_id    TEXT                                               NOT NULL,
    wiki_id     TEXT                                               NOT NULL,
    text        TEXT                                               NOT NULL,
    embedding   public.vector(1024)                                NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);


COMMENT ON TABLE wiki_rag.question IS 'Stores user questions and their vector embeddings for RAG query processing';
COMMENT ON COLUMN wiki_rag.question.question_id IS 'Primary key, auto-incrementing identifier for each question record';
COMMENT ON COLUMN wiki_rag.question.chunk_id IS 'chunk_id из таблицы wiki_rag.chunk';
COMMENT ON COLUMN wiki_rag.question.wiki_id IS 'Id страницы в WIKI, к которой относятся воппросы';
COMMENT ON COLUMN wiki_rag.question.text IS 'Text content of the user question or query';
COMMENT ON COLUMN wiki_rag.question.embedding IS 'Vector embedding representation of the question_text with dimension 1024';
COMMENT ON COLUMN wiki_rag.question.updated_at IS 'Timestamp indicating when the record was created or last updated';



CREATE INDEX idx_questions_embedding_vector ON wiki_rag.question USING ivfflat (embedding vector_cosine_ops);

```


REST API дизайн (сервер, при обращении к вики)
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
- На POST /api/index принимать массив страниц; для каждого запускать задачу с искусственной задержкой старта ~30 мс.
- Параллельность ограничить (например, p-limit 3–5), чтобы не упираться в rate limit Confluence/OpenAI.
- Хранить состояние в памяти (вектор текущих задач) и отдавать в /api/status: { queued, processing, done, errors }.

Безопасность и ключи
- Персональный Confluence Token не хранить на сервере; сервер получает его от клиента и использует только для проксирования запросов (не логировать!).
- OPENAI_API_KEY хранить в .env сервера.
- Включить базовую валидацию входных параметров и ограничение на объемы.

Конфигурация и настройки
- PROMPT_CHUNKING и PROMPT_QUESTIONS — держать как строки в config.ts.
- Модели OpenAI — настраиваемые через .env.

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
      • save: upsert page in wiki.pages, insert into wiki_rag.question with embedding, optionally wiki.questions
- db.ts
    - init: create extension vector, create tables if not exist, create indexes
    - query helpers

Пример JSON-схем (для LLM)
- Для чанков:
  { "type": "object", "properties": { "chunks": { "type": "array", "items": { "type": "string" } } }, "required": ["chunks"] }
- Для вопросов:
  { "type": "object", "properties": { "questions": { "type": "array", "items": { "type": "string" } } }, "required": ["questions"] }

Тестирование
- Моки: вместо реального Confluence добавить возможность: чтения тестовой страницы из файла при отсутствии токена.
    - чтения списка пространсттв
    - для оддного простарнства замокать несколько html страниц
- Юнит-тесты для cleanHTML и разбиения на чанки (ожидаемые кейсы: удаление скриптов/стилей, упрощение вложенности).

Результат
- Репозиторий с работоспособным сервером и статическим UI, .env.example.
- Документация README:
    - Установка и запуск
    - Настройка .env
    - Создание БД и расширения pgvector
    - Ключевые команды и эндпоинты

Подсказки по производительности и качеству
- Кэшировать ответы Confluence кратковременно, чтобы снизить нагрузку при повторном открытии той же страницы.
- Дедупликация чанков: убирать полностью идентичные тексты.
