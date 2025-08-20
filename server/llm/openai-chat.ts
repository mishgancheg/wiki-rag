import { RateLimiterMemory, RateLimiterQueue } from 'rate-limiter-flexible';
import OpenAI from 'openai';
import { config } from '../config.js';
import { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions/completions';

const limiterFlexible = new RateLimiterMemory({
  // Use quarter of total maximum "speed"
  // Max requests per 1 second
  points: Math.floor(((config as any).rateLimits?.requestsPerMinute || 10000) / 60 / 4), // Default to high limit if not configured
  // interval in seconds
  duration: 1,
});

const limiterQueue = new RateLimiterQueue(limiterFlexible, { maxQueueSize: 10000 });

// Single OpenAI client
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export type IChatCompletionAnswer<T = any> = OpenAI.ChatCompletion & { resultJson: T | undefined, priceUSD?: number };

export interface IChatCompletionRequestOptions {
  rateLimited?: boolean,
  jobId?: string, // Not used yet. Intended for queuing case
  rateLimiterQueue?: RateLimiterQueue,
}

/**
 * Centralized wrapper for OpenAI chat completion requests.
 * It normalizes parameters for certain model families and performs the API call.
 * Also parses JSON when response_format requests structured output and attaches it to resultJson.
 */
export async function chatCompletionRequest<R = any> (
  llmReq: ChatCompletionCreateParamsBase,
  options?: IChatCompletionRequestOptions,
): Promise<IChatCompletionAnswer<R>> {
  const {
    rateLimited,
    rateLimiterQueue = limiterQueue,
  } = options || {};

  if (rateLimited) {
    await rateLimiterQueue.removeTokens(1);
  }

  // Default temperature if not specified
  if (llmReq.temperature == null) {
    llmReq.temperature = 0;
  }

  // For gpt-5 models do not send temperature and set minimal reasoning effort
  if (llmReq.model.startsWith('gpt-5')) {
    delete llmReq.temperature;
    // @ts-ignore
    (llmReq as any).reasoning_effort = 'low';
  }

  // For o* models (o1, o3, o3-mini, o4-mini) map max_tokens -> max_completion_tokens and drop temperature
  if (llmReq.model.startsWith('o')) {
    delete llmReq.temperature;
    if (typeof (llmReq as any).max_tokens === 'number') {
      (llmReq as any).max_completion_tokens = (llmReq as any).max_tokens;
      delete (llmReq as any).max_tokens;
    }
  }

  // Make a single request using the OpenAI client
  const response = await openai.chat.completions.create(llmReq) as OpenAI.ChatCompletion;

  // Parse JSON if requested via response_format
  try {
    const type = (llmReq as any)?.response_format?.type as string | undefined;
    if (type && (type === 'json_schema' || type === 'json_object')) {
      const content = response?.choices?.[0]?.message?.content ?? '';
      if (content) {
        const cleaned = content.replace(/```(json)?/gi, '').trim();
        (response as any).resultJson = cleaned ? JSON.parse(cleaned) : undefined;
      }
    }
  } catch (e) {
    // If parsing fails, leave resultJson undefined and let callers handle fallback
    (response as any).resultJson = undefined;
  }

  return response as IChatCompletionAnswer<R>;
}
