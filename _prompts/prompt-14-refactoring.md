Что делает кнопка Index descendants?

=======================================

Вынеси логику эндпоинта /api/index/descendants в отдельный модуль server/api/index-descendants.ts

=======================================

Вынеси логику эндпоинта /api/index в отдельный модуль server/api/index.ts

=======================================

Вынеси indexingTasks, taskQueue из server/server.ts в файл server/api/index.ts


======================================

Есть ли смысл тащить indexingTasks в createIndexHandler и createIndexDescendantsHandler?

Тот же вопрос про taskQueue?

Может их использовать в
server/api/index.ts напрямую, а в server/api/index-descendants.ts импортировать из server/api/index.ts

=======================================

Вынеси логику эндпоинта /api/status в отдельный модуль server/api/index.ts
