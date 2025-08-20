в папке wiki-mock-server создай эмулятор API WIKI на ванильном js
Он должен работать по порту 3001 и реализовывать все используемые в проекте эндпоинты:
- Список пространств: GET {BASE}/rest/api/space?start=0&limit=1000 → { results: [{ key, name }, ...] }
- Корневые страницы по space: GET {BASE}/rest/api/content?spaceKey={spaceKey}&type=page&expand=ancestors&start=0&limit=1000 → results (фильтруем с ancestors.length === 0)
- Дети: GET {BASE}/rest/api/content/{parentId}/child/page?start=0&limit=1000
- Страница: GET {BASE}/rest/api/content/{id}?expand=body.view → { title, body.view.value: HTML }

Тестовые данные лежат в папке wiki-mock-server/mock-data
- в файле wiki-mock-server/mock-data/spaces.json - ответ эндпоинта /rest/api/space?start=0&limit=1000
- в файле wiki-mock-server/mock-data/AI/structure.json - структура пространства AI. Должна быть использована для эмуляции эндпоинтов получения "Корневые страницы по space" и "Дети"
- в папке wiki-mock-server/mock-data/AI/pages - все страницы простарнства AI. Имена файлов: <pageId>.html

Создай эмулятор API WIKI
