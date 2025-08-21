1) в модуле server/server.ts Вынеси все await import, которые прописаны внутри функций в заголовки модуля
2) В модуле server/server.ts вынеси функционал эндпоинта /api/rag/search в отдельную функцию в отдельный модуль server/rag.ts
