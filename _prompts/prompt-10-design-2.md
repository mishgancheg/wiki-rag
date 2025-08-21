Объедини интерфейсы из файлов
public\index.html
public\chat.html
в области заголовка сделай закладки:

- Wiki Management - это все что в блоке wiki management и page preview
- Semantic Search - все что  блоке semantic search
- Chat - все что в файле chat.html

таким образом эндпоинт /chat больше не нужен
сведения о Queue Process Done Error перенеси из заголовка куда-нибудь в область wiki management

и вынеси основную логику из эндпоинта /api/chat в файл server/chat.ts

===========================

Перенеси Queue Process Done Error в место рядом с wiki management, чтобы освободить пространство сверху