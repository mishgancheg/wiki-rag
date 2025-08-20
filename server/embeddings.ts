import OpenAI from 'openai';
import { config } from './config.js';
import { stringTokens } from 'openai-chat-tokens';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// Interface for embedding result
export interface EmbeddingResult {
  embedding: number[];
  totalTokens?: number;
  totalCost?: number;
  processingTime?: number;
}

// Interface for batch embedding result
export interface BatchEmbeddingResult {
  embeddings: number[][];
  totalTokens?: number;
  totalCost?: number;
  processingTime?: number;
  failedIndices?: number[];
}

/**
 * Generate embedding for a single text using OpenAI Embeddings API
 * This is a wrapper around getEmbeddingsForTexts for single text input
 * @param text The text to generate embedding for
 * @returns Embedding vector
 */
export async function getEmbeddingForText (text: string): Promise<EmbeddingResult> {
  // Validate input
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  // Use getEmbeddingsForTexts with single text array
  const result = await getEmbeddingsForTexts([text]);

  if (!result.embeddings || result.embeddings.length === 0) {
    throw new Error('No embedding generated for text');
  }

  return {
    embedding: result.embeddings[0],
    totalTokens: result.totalTokens,
    totalCost: result.totalCost,
    processingTime: result.processingTime,
  };
}

/**
 * Generate embeddings for multiple texts in batch
 * @param texts Array of texts to generate embeddings for
 * @returns Array of embedding vectors
 */
export async function getEmbeddingsForTexts (texts: string[]): Promise<BatchEmbeddingResult> {
  const startTime = Date.now();

  const model = config.openaiEmbeddingModel;

  // Validate input
  if (!texts || texts.length === 0) {
    return { embeddings: [] };
  }

  console.log(`[Embeddings] Processing ${texts.length} texts with token-based batching (<=8000 tokens per request)...`);

  const embeddings: number[][] = [];
  const failedIndices: number[] = [];
  let totalTokensUsed = 0;
  let totalCostUsed = 0;

  // Precompute token counts
  const tokenCounts = texts.map(t => {
    try {
      return stringTokens(t) || 0;
    } catch {
      return 0;
    }
  });

  const MAX_TOKENS_PER_BATCH = 8000;

  let i = 0;
  let batchNumber = 0;
  while (i < texts.length) {
    let currentBatch: string[] = [];
    let currentBatchIndices: number[] = [];
    let currentTokens = 0;

    // Build a batch without exceeding the token limit
    while (i < texts.length) {
      const tks = tokenCounts[i] || 0;

      // If single text exceeds limit and we have no other texts in batch
      if (tks > MAX_TOKENS_PER_BATCH && currentBatch.length === 0) {
        console.warn(`[Embeddings] Single text at index ${i} exceeds ${MAX_TOKENS_PER_BATCH} tokens (${tks}). Adding to batch anyway.`);
        currentBatch.push(texts[i]);
        currentBatchIndices.push(i);
        i++;
        break; // Process this oversized text alone
      }

      // If adding this text would exceed the limit, stop building current batch
      if (tks + currentTokens > MAX_TOKENS_PER_BATCH) {
        break;
      }

      currentBatch.push(texts[i]);
      currentBatchIndices.push(i);
      currentTokens += tks;
      i++;
    }

    // Process the batch
    if (currentBatch.length > 0) {
      batchNumber++;
      console.log(`[Embeddings] Processing batch #${batchNumber} with ${currentBatch.length} items (~${currentTokens} tokens)...`);

      try {
        const response = await openai.embeddings.create({
          model,
          input: currentBatch,
          dimensions: 1024,
          encoding_format: 'float',
        });

        if (response.data && response.data.length === currentBatch.length) {
          // Success: add embeddings in order
          response.data.forEach(item => embeddings.push(item.embedding));

          // Update token stats and cost
          const usedTokens = response.usage?.total_tokens || 0;
          totalTokensUsed += usedTokens;
          totalCostUsed += (usedTokens / 1_000_000) * 0.13;
        } else {
          // Failed: mark all texts in this batch as failed
          console.error(`[Embeddings] Batch #${batchNumber} returned unexpected response`);
          for (const idx of currentBatchIndices) {
            failedIndices.push(idx);
            embeddings.push([]);
          }
        }
      } catch (error) {
        // Failed: mark all texts in this batch as failed
        console.error(`[Embeddings] Batch #${batchNumber} failed:`, error);
        for (const idx of currentBatchIndices) {
          failedIndices.push(idx);
          embeddings.push([]);
        }
      }

      // Add delay between batches to avoid rate limiting
      if (i < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }

  const processingTime = Date.now() - startTime;

  return {
    embeddings,
    totalTokens: totalTokensUsed,
    totalCost: totalCostUsed,
    processingTime,
    failedIndices: failedIndices.length > 0 ? failedIndices : undefined,
  };
}
