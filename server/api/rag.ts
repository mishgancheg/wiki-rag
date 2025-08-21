import { getEmbeddingForText } from '../embeddings';
import { searchSimilar } from '../db';

export interface RagSearchParams {
  query: string;
  threshold?: number; // 0..1
  chunksLimit?: number; // 1..100
}

export interface RagSearchResultItem {
  chunk_id: number;
  wiki_id: string;
  question: string | null;
  chunk: string;
  similarity: number;
  source: 'chunk';
}

export interface RagSearchResponse {
  query: string;
  results: RagSearchResultItem[];
  total_results: number;
  threshold: number;
  processing_time_ms?: number;
  tokens_used?: number;
  estimated_cost?: number;
}

export async function ragSearch(params: RagSearchParams): Promise<RagSearchResponse> {
  const { query, threshold = 0.65, chunksLimit = 10 } = params || {} as RagSearchParams;

  // Validate inputs (mirrors previous endpoint checks)
  if (!query || typeof query !== 'string') {
    throw new Error('query string required');
  }
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    throw new Error('threshold must be a number between 0 and 1');
  }
  if (typeof chunksLimit !== 'number' || chunksLimit < 1 || chunksLimit > 100) {
    throw new Error('chunksLimit must be a number between 1 and 100');
  }

  // Generate embedding for the search query
  const queryEmbeddingResult = await getEmbeddingForText(query);

  // Search for similar chunks
  const searchResults = await searchSimilar(
    queryEmbeddingResult.embedding,
    threshold,
    chunksLimit,
  );

  // Map to API response format
  const results: RagSearchResultItem[] = searchResults.map(result => ({
    chunk_id: result.chunk_id,
    wiki_id: result.wiki_id,
    question: result.question,
    chunk: result.chunk,
    similarity: result.cs,
    source: 'chunk',
  }));

  return {
    query,
    results,
    total_results: results.length,
    threshold,
    processing_time_ms: queryEmbeddingResult.processingTime,
    tokens_used: queryEmbeddingResult.totalTokens,
    estimated_cost: queryEmbeddingResult.totalCost,
  };
}
