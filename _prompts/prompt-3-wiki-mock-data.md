напиши ванильный js код, который выгрузит содержимое всего пространства WIKI с ключем AI в папку
wiki-mock-server/mock-data/AI/pages/
имя файлов <pageId>.html
Код размести в файле wiki-mock-server/fetch-ai-pages.js

=================
напиши ванильный js код, который выгрузит список проектов в файл 
wiki-mock-server/mock-data/spaces.json
Код размести в файле wiki-mock-server/fetch-spaces.js

================
напиши ванильный js код, который выгрузит структуру страниц пространства WIKI AI в файл
wiki-mock-server/mock-data/AI/structure.json
Этот файл потом будет использоваться в mock-сервере для эмуляции эндпоинтов
- Корневые страницы по space: GET {BASE}/rest/api/content?spaceKey={spaceKey}&type=page&expand=ancestors&start=0&limit=1000 → results (фильтруем с ancestors.length === 0)
- Дети: GET {BASE}/rest/api/content/{parentId}/child/page?start=0&limit=1000
Его структура должна обеспечивать работу такого эмулятора

Код размести в файле wiki-mock-server/fetch-ai-structure.js



