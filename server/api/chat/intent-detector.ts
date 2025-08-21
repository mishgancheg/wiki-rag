import { config } from '../../config';
import { INTENT_DETECTOR_PROMPT } from '../../prompts';
import { chatCompletionRequest } from '../../llm/openai-chat';

export type ChatMessage = { role: string; content: string };

export type DetectedIntent = { shortIntent?: string };

/**
 * Detect user's short intent from recent chat messages.
 * - Builds a plain text history
 * - Uses LLM with JSON schema to extract shortIntent
 * - Falls back to last user message content if extraction fails
 */
export async function detectIntentQuery(recent: ChatMessage[]): Promise<{ query: string; detected?: DetectedIntent }>
{
  // Create plain text history for intent detection
  const messageHistory = (recent || [])
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
          description:
            'Краткое изложение последнего намерения клиента от 1-го лица. Но без начальной фразы типа "я хочу", "мне надо". Только суть вопроса или желания',
        },
      },
      additionalProperties: false,
    },
  } as any;

  const intentPrompt = INTENT_DETECTOR_PROMPT.replace('{{messageHistory}}', messageHistory);

  const intentResp = await chatCompletionRequest<{ shortIntent: string }>({
    model: config.modelForQuestions,
    messages: [{ role: 'system', content: intentPrompt }],
    response_format: { type: 'json_schema', json_schema: intentSchema },
    temperature: 0,
  });

  const detected = (intentResp as any).resultJson as DetectedIntent | undefined;
  const lastUserMsg = [...(recent || [])].reverse().find((m: any) => m.role === 'user');
  const query = (detected?.shortIntent?.trim?.() || lastUserMsg?.content || '').toString();

  return { query, detected };
}
