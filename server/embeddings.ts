import OpenAI from 'openai';
import { config } from './config.js';

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
 * @param text The text to generate embedding for
 * @param options Optional parameters
 * @returns Embedding vector
 */
export async function getEmbeddingForText(
  text: string,
  options: {
    model?: string;
    maxRetries?: number;
  } = {}
): Promise<EmbeddingResult> {
  const startTime = Date.now();
  
  const {
    model = config.openaiEmbeddingModel,
    maxRetries = 3
  } = options;

  // Validate input
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  // Truncate text if too long (embedding models have token limits)
  const maxLength = 8000; // Conservative limit for text-embedding-3-large
  const truncatedText = text.length > maxLength ? text.substring(0, maxLength) : text;
  
  if (text.length > maxLength) {
    console.warn(`[Embeddings] Text truncated from ${text.length} to ${maxLength} characters`);
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Embeddings] Generating embedding (attempt ${attempt}/${maxRetries})...`);

      const response = await openai.embeddings.create({
        model: model,
        input: truncatedText,
        encoding_format: 'float'
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding data received from OpenAI');
      }

      const embedding = response.data[0].embedding;
      const totalTokens = response.usage?.total_tokens || 0;
      const processingTime = Date.now() - startTime;

      console.log(`[Embeddings] Generated embedding with ${embedding.length} dimensions in ${processingTime}ms`);
      console.log(`[Embeddings] Total tokens used: ${totalTokens}`);

      // Calculate rough cost (text-embedding-3-large pricing)
      const estimatedCost = (totalTokens / 1000000) * 0.13; // $0.13 per 1M tokens

      return {
        embedding,
        totalTokens,
        totalCost: estimatedCost,
        processingTime
      };

    } catch (error) {
      lastError = error as Error;
      console.error(`[Embeddings] Attempt ${attempt} failed:`, error);
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
        console.log(`[Embeddings] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed to generate embedding after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Generate embeddings for multiple texts in batch
 * @param texts Array of texts to generate embeddings for
 * @param options Optional parameters
 * @returns Array of embedding vectors
 */
export async function getEmbeddingsForTexts(
  texts: string[],
  options: {
    model?: string;
    batchSize?: number;
    concurrency?: number;
    maxRetries?: number;
  } = {}
): Promise<BatchEmbeddingResult> {
  const startTime = Date.now();
  
  const {
    model = config.openaiEmbeddingModel,
    batchSize = 100, // OpenAI allows up to 2048 inputs per request for embeddings
    concurrency = 3,
    maxRetries = 3
  } = options;

  // Validate input
  if (!texts || texts.length === 0) {
    return { embeddings: [] };
  }

  console.log(`[Embeddings] Processing ${texts.length} texts in batches of ${batchSize}...`);

  const embeddings: number[][] = [];
  const failedIndices: number[] = [];
  let totalTokens = 0;
  let totalCost = 0;

  // Process texts in batches to avoid API limits
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchStartIndex = i;
    
    console.log(`[Embeddings] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}...`);

    try {
      // Truncate texts if too long
      const truncatedBatch = batch.map(text => {
        const maxLength = 8000;
        return text.length > maxLength ? text.substring(0, maxLength) : text;
      });

      const response = await openai.embeddings.create({
        model: model,
        input: truncatedBatch,
        encoding_format: 'float'
      });

      if (!response.data || response.data.length !== batch.length) {
        throw new Error(`Expected ${batch.length} embeddings, got ${response.data?.length || 0}`);
      }

      // Add embeddings to results
      response.data.forEach(item => {
        embeddings.push(item.embedding);
      });

      // Update statistics
      totalTokens += response.usage?.total_tokens || 0;
      totalCost += ((response.usage?.total_tokens || 0) / 1000000) * 0.13;

    } catch (error) {
      console.error(`[Embeddings] Batch failed:`, error);
      
      // Try individual texts in the failed batch
      console.log(`[Embeddings] Trying individual texts in failed batch...`);
      
      for (let j = 0; j < batch.length; j++) {
        try {
          const result = await getEmbeddingForText(batch[j], { model, maxRetries });
          embeddings.push(result.embedding);
          totalTokens += result.totalTokens || 0;
          totalCost += result.totalCost || 0;
        } catch (individualError) {
          console.error(`[Embeddings] Failed to process text at index ${batchStartIndex + j}:`, individualError);
          failedIndices.push(batchStartIndex + j);
          embeddings.push([]); // Placeholder for failed embedding
        }
      }
    }

    // Add delay between batches to avoid rate limiting
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const processingTime = Date.now() - startTime;
  
  console.log(`[Embeddings] Completed batch processing:`);
  console.log(`  - Successful: ${embeddings.length - failedIndices.length}/${texts.length}`);
  console.log(`  - Failed: ${failedIndices.length}`);
  console.log(`  - Total tokens: ${totalTokens}`);
  console.log(`  - Processing time: ${processingTime}ms`);
  console.log(`  - Estimated cost: $${totalCost.toFixed(4)}`);

  return {
    embeddings,
    totalTokens,
    totalCost,
    processingTime,
    failedIndices: failedIndices.length > 0 ? failedIndices : undefined
  };
}

/**
 * Generate embeddings for chunks and their questions
 * @param chunks Array of text chunks
 * @param chunkQuestions Array of questions for each chunk
 * @returns Object with chunk and question embeddings
 */
export async function generateEmbeddingsForChunksAndQuestions(
  chunks: string[],
  chunkQuestions: string[][]
): Promise<{
  chunkEmbeddings: number[][];
  questionEmbeddings: number[][];
  totalTokens: number;
  totalCost: number;
  processingTime: number;
}> {
  const startTime = Date.now();
  
  console.log(`[Embeddings] Generating embeddings for ${chunks.length} chunks and their questions...`);
  
  // Generate chunk embeddings
  console.log('[Embeddings] Processing chunk embeddings...');
  const chunkResults = await getEmbeddingsForTexts(chunks, {
    concurrency: 2 // Lower concurrency for larger batches
  });
  
  // Flatten all questions for batch processing
  const allQuestions: string[] = [];
  const questionIndexMap: { chunkIndex: number; questionIndex: number }[] = [];
  
  chunkQuestions.forEach((questions, chunkIndex) => {
    questions.forEach((question, questionIndex) => {
      allQuestions.push(question);
      questionIndexMap.push({ chunkIndex, questionIndex });
    });
  });
  
  // Generate question embeddings
  console.log(`[Embeddings] Processing ${allQuestions.length} question embeddings...`);
  const questionResults = await getEmbeddingsForTexts(allQuestions, {
    concurrency: 2
  });
  
  const totalTokens = (chunkResults.totalTokens || 0) + (questionResults.totalTokens || 0);
  const totalCost = (chunkResults.totalCost || 0) + (questionResults.totalCost || 0);
  const processingTime = Date.now() - startTime;
  
  console.log(`[Embeddings] Completed all embeddings in ${processingTime}ms`);
  console.log(`[Embeddings] Total cost: $${totalCost.toFixed(4)}`);
  
  return {
    chunkEmbeddings: chunkResults.embeddings,
    questionEmbeddings: questionResults.embeddings,
    totalTokens,
    totalCost,
    processingTime
  };
}

/**
 * Calculate cosine similarity between two embeddings
 * @param a First embedding vector
 * @param b Second embedding vector
 * @returns Cosine similarity (0-1, where 1 is most similar)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embedding vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find most similar embeddings using cosine similarity
 * @param queryEmbedding The query embedding vector
 * @param candidateEmbeddings Array of candidate embedding vectors
 * @param topK Number of top results to return
 * @returns Array of {index, similarity} sorted by similarity
 */
export function findSimilarEmbeddings(
  queryEmbedding: number[],
  candidateEmbeddings: number[][],
  topK: number = 10
): Array<{ index: number; similarity: number }> {
  const similarities = candidateEmbeddings.map((embedding, index) => ({
    index,
    similarity: cosineSimilarity(queryEmbedding, embedding)
  }));
  
  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Test function for development and debugging
 */
export async function testEmbeddings(): Promise<void> {
  const testTexts = [
    'Machine learning is a subset of artificial intelligence.',
    'Deep learning uses neural networks with multiple layers.',
    'Natural language processing helps computers understand human language.',
    'Computer vision enables machines to interpret visual information.'
  ];

  console.log('Testing embedding generation...\n');
  
  try {
    // Test single embedding
    console.log('Testing single embedding:');
    const singleResult = await getEmbeddingForText(testTexts[0]);
    console.log(`Generated embedding with ${singleResult.embedding.length} dimensions`);
    console.log(`Processing time: ${singleResult.processingTime}ms`);
    console.log(`Tokens used: ${singleResult.totalTokens}`);
    console.log(`Estimated cost: $${singleResult.totalCost?.toFixed(6)}`);
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test batch embeddings
    console.log('Testing batch embeddings:');
    const batchResult = await getEmbeddingsForTexts(testTexts);
    console.log(`Generated ${batchResult.embeddings.length} embeddings`);
    console.log(`Processing time: ${batchResult.processingTime}ms`);
    console.log(`Total tokens: ${batchResult.totalTokens}`);
    console.log(`Total cost: $${batchResult.totalCost?.toFixed(6)}`);
    
    if (batchResult.failedIndices && batchResult.failedIndices.length > 0) {
      console.log(`Failed indices: ${batchResult.failedIndices}`);
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test similarity
    console.log('Testing similarity calculation:');
    const queryEmbedding = batchResult.embeddings[0];
    const similarResults = findSimilarEmbeddings(queryEmbedding, batchResult.embeddings, 3);
    
    console.log('Most similar texts to first text:');
    similarResults.forEach(({ index, similarity }) => {
      console.log(`  ${index}: "${testTexts[index]}" (similarity: ${similarity.toFixed(4)})`);
    });
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testEmbeddings().catch(console.error);
}