import { config } from '../config.js';
import { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions/completions";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import { chatCompletionRequest, IChatCompletionAnswer } from "../llm/openai-chat.js";
import { getPromptForQuestions } from "../prompts";

// Interface for questions result
export interface QuestionsResult {
  questions: string[];
  totalTokens?: number;
  totalCost?: number;
  processingTime?: number;
}


/**
 * Generate questions for a text chunk using OpenAI LLM
 * @param chunkText The text chunk to generate questions for
 * @param options Optional parameters for question generation
 * @returns Array of generated questions
 */
export async function generateQuestionsForChunk (
  chunkText: string,
  options: {
    minQuestions?: number;
    maxQuestions?: number;
    context?: string;
  } = {},
): Promise<QuestionsResult> {
  const startTime = Date.now();

  const {
    minQuestions = 3,
    maxQuestions = 20,
    context = '',
  } = options;

  // Validate input
  if (!chunkText || chunkText.trim().length === 0) {
    return { questions: [] };
  }

  // If chunk is very short, generate fewer questions
  const chunkLength = chunkText.length;
  const targetQuestions = Math.min(
    maxQuestions,
    Math.max(minQuestions, Math.floor(chunkLength / 100)),
  );

  try {
    console.log(`[Questions] Generating questions for chunk (${chunkLength} characters)...`);

    const messages: ChatCompletionMessageParam[] = [];
    if (context) {
      messages.push({ role: 'system', content: `--- CONTEXT ---\n${context}\n--- END OF CONTEXT ---` });
    }
    messages.push({ role: 'user', content: `--- TEXT ---\n${chunkText}\n--- END OF TEXT ---` });
    messages.push({ role: 'system', content: getPromptForQuestions(minQuestions, targetQuestions, !!context) });

    const model = config.modelForQuestions;

    const llmReq: ChatCompletionCreateParamsBase = {
      model,
      messages,
      temperature: 0.3, // Slightly higher temperature for more diverse questions
      max_tokens: 1500,  // Reasonable limit for questions response
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "questions",
          schema: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                description: "Potential user questions",
                items: {
                  type: "string",
                  description: "One potential user question",
                },
              },
            },
            required: ["questions"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    }

    // Call OpenAI Chat Completions API with JSON mode via centralized helper
    const response = (await chatCompletionRequest(llmReq)) as IChatCompletionAnswer;

    // Prefer structured result parsed by chatCompletionRequest
    const parsedResponse: any = (response as any).resultJson;
    if (!parsedResponse) {
      throw new Error('No structured JSON result parsed from OpenAI response');
    }

    // Validate response structure
    if (!parsedResponse.questions || !Array.isArray(parsedResponse.questions)) {
      console.error('[Questions] Invalid response structure:', parsedResponse);
      throw new Error('Response does not contain valid questions array');
    }

    // Filter and validate questions
    const questions = parsedResponse.questions
      .filter((q: any) => typeof q === 'string' && q.trim().length > 0)
      .map((q: string) => q.trim())
      .filter((q: string) => q.length >= 10) // Minimum question length
      .slice(0, maxQuestions); // Limit to maximum questions

    // Log statistics
    const totalTokens = response.usage?.total_tokens || 0;
    const processingTime = Date.now() - startTime;

    console.log(`[Questions] Generated ${questions.length} questions in ${processingTime}ms`);
    console.log(`[Questions] Total tokens used: ${totalTokens}`);

    // Calculate rough cost (GPT-4o-mini pricing)
    const estimatedCost = (totalTokens / 1000000) * 0.15; // $0.15 per 1M tokens

    return {
      questions,
      totalTokens,
      totalCost: estimatedCost,
      processingTime,
    } as QuestionsResult;
  } catch (error) {
    console.error('[Questions] Error generating questions:', error);
    console.log('[Questions] Falling back to simple question generation...');
    return {
      questions: [chunkText],
      processingTime: Date.now() - startTime,
    };
  }
}
