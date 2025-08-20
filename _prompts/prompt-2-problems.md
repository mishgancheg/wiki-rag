проект не собирается. Измени tsconfig.json
=====
При обращении к эндпоинту Wiki axios не может выполнить запрос:

cause: Error: unable to verify the first certificate
at TLSSocket.onConnectSecure (node:_tls_wrap:1677:34)
at TLSSocket.emit (node:events:524:28)
at TLSSocket._finishInit (node:_tls_wrap:1076:8)
at ssl.onhandshakedone (node:_tls_wrap:862:12) {
code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'

Как обойти эту пролему. Она вызвана особенностями запросов из nodejs.

