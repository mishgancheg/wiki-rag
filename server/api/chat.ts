import { Request, Response } from 'express';
import { config } from '../config';
import { ragSearch } from './rag';
import { INTENT_DETECTOR_PROMPT, getChatRagPrompt } from '../prompts';
import { chatCompletionRequest } from '../llm/openai-chat';

/**
 * Chat endpoint handler: intent -> rag -> answer
 */
export async function handleChatRequest(req: Request, res: Response) {
  try {
    const MAX_USED_MESSAGES_FROM_HISTORY = 10;

    const { messages = [], threshold = 0.65, chunksLimit = 6 } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    // Keep only last 10 messages for safety
    const recent = messages.slice(-MAX_USED_MESSAGES_FROM_HISTORY);

    // Create plain text history for intent detection
    const messageHistory = recent
      .map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content.replace(/\n{2,}/g, '\n') : ''}`)
      .join('\n\n');

    // Intent detection with structured output
    const intentSchema = {
      name: 'intent_schema',
      schema: {
        type: 'object',
        required: ['shortIntent'],
        properties: {
          shortIntent: {
            type: 'string',
            description: 'Краткое изложение последнего намерения клиента от 1-го лица. Но без начальной фразы типа "я хочу", "мне надо". Только суть вопроса или желания',
          },
        },
        additionalProperties: false,
      },
    } as any;

    const intentPrompt = INTENT_DETECTOR_PROMPT.replace('{{messageHistory}}', messageHistory);

    const intentResp = await chatCompletionRequest<{ shortIntent: string }>({
      model: config.modelForQuestions,
      messages: [
        { role: 'system', content: intentPrompt },
      ],
      response_format: { type: 'json_schema', json_schema: intentSchema },
      temperature: 0,
    });
    // TODO вынеси код детекции намерения в отдельную функцию
    const detected = (intentResp as any).resultJson as { shortIntent?: string } | undefined;
    const lastUserMsg = [...recent].reverse().find((m: any) => m.role === 'user');
    const query = detected?.shortIntent || lastUserMsg?.content || '';

    // RAG search using detected intent or last user message
    const rag = await ragSearch({ query, threshold, chunksLimit });

    // Prepare chunks text for prompt
    const chunksText = rag.results
      .map((r, idx) => `============\n${r.chunk}\n\n`)
      .join('\n\n');

    const dialogPlain = recent.map((m: any) => `${m.role}: ${m.content.replace(/\n{2,}/g, '\n')}`).join('\n\n');

    const systemPrompt = getChatRagPrompt()
      .replace('{{chunks}}', chunksText || '[нет релевантных фрагментов]');

    // Compose final chat messages (system + original history to preserve roles)
    const finalMessages = [
      { role: 'system', content: systemPrompt },
      ...recent,
    ];

    const answerResp = await chatCompletionRequest({
      model: config.modelForQuestions,
      messages: finalMessages,
      temperature: 0.3,
      max_tokens: 10000,
    });

    const reply = answerResp?.choices?.[0]?.message?.content || '';

    res.json({
      ok: true,
      shortIntent: query,
      reply,
      sources: rag.results.map(r => ({ chunk_id: r.chunk_id, wiki_id: r.wiki_id, similarity: r.similarity })),
    });
  } catch (error) {
    console.error('Error in chat handler:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
}
