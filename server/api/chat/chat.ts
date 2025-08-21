import { Request, Response } from 'express';
import { config } from '../../config';
import { ragSearch } from '../rag';
import { getChatRagPrompt } from '../../prompts';
import { chatCompletionRequest } from '../../llm/openai-chat';
import { detectIntentQuery } from './intent-detector';

/**
 * Chat endpoint handler: intent -> rag -> answer
 */
export async function handleChatRequest(req: Request, res: Response) {
  try {
    const MAX_USED_MESSAGES_FROM_HISTORY = 10;

    const { messages = [], threshold = 0.65, chunksLimit = 20 } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    // Keep only last 10 messages for safety
    const recent = messages.slice(-MAX_USED_MESSAGES_FROM_HISTORY);
    const lastUserMessage = recent.find((m: any) => m.role === 'user')?.content || '';
    if (!lastUserMessage) {
      return res.status(400).json({ error: 'No user message found in recent messages' });
    }
    let query = lastUserMessage;
    if (recent.length > 2) {
      ({ query } = await detectIntentQuery(recent as any));
    }

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
