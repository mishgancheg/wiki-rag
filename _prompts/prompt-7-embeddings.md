1) Перепиши функцию getEmbeddingsForTexts
   таким образом:
   когда на вход подаются тексты для эмбеддинга, очередной батч набирается из текстов так, чтобы не превысить 8000 токенов.
   Токены подсчитывать с помошью функций подсчета токенов из npm пакета 'openai-chat-tokens'

import { stringTokens } from 'openai-chat-tokens';
tokens = stringTokens(text);

getEmbeddingsForTexts должна вызывать openai.embeddings.create передавая в input массив текстов общей длиной не более 8000 токенов
getEmbeddingForText - обертка над getEmbeddingsForTexts, которая передает в getEmbeddingsForTexts массив из одного текста

2) Поменяй логику получения эмбеддингов:
   После обработки очередной страницы в плане разбиения на чанки и получения вопросов, только после этого должны вычисляться эмбеддинки для всех чанков и всех вопросов, используя getEmbeddingsForTexts
