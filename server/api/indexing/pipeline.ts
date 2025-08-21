import pLimit from 'p-limit';
import { fetchPageHtml, ConfluencePageContent } from '../../lib/confluence';
import { cleanHtml } from '../../lib/cleanHtml';
import { splitIntoChunks, addSourceMetadata } from '../../chunker/splitIntoChunks';
import { generateQuestionsForChunk } from '../../chunker/questions';
import { getEmbeddingsForTexts } from '../../lib/embeddings';
import { insertChunk, insertQuestion, deleteByWikiId } from '../../lib/db';
import * as cheerio from 'cheerio';
import { MAX_QUESTIONS, MIN_QUESTIONS } from "../../constants";

// Interface for pipeline result
export interface PipelineResult {
  success: boolean;
  pageId: string;
  title: string;
  chunksProcessed: number;
  questionsGenerated: number;
  totalTokens: number;
  totalCost: number;
  processingTime: number;
  error?: string;
}

// Interface for pipeline progress callback
export interface PipelineProgress {
  pageId: string;
  stage: 'fetching' | 'cleaning' | 'chunking' | 'questions' | 'embeddings' | 'saving' | 'completed' | 'error';
  progress: number; // 0-100
  message?: string;
  error?: string;
}

// Helper: convert cleaned HTML chunk to plain text for embeddings
const stripHtmlToText = (html: string): string => {
  try {
    const $ = cheerio.load(html, { xmlMode: false });
    const text = $.root().text();
    return text.replace(/\s+/g, ' ').trim();
  } catch {
    // Fallback: naive tag removal
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
};

/**
 * Process a single wiki page through the complete RAG pipeline
 * @param pageId Wiki page ID to process
 * @param token Confluence authentication token
 * @param options Processing options
 * @param progressCallback Optional progress callback function
 * @returns Pipeline processing result
 */
export async function processPage (
  pageId: string,
  token: string,
  options: {
    keepImages?: boolean;
    minQuestions?: number;
    maxQuestions?: number;
  } = {},
  progressCallback?: (progress: PipelineProgress) => void,
): Promise<PipelineResult> {
  if (typeof options.minQuestions !== 'number') {
    options.minQuestions = MIN_QUESTIONS;
  }
  if (!options.maxQuestions) {
    options.maxQuestions = MAX_QUESTIONS;
  }

  const startTime = Date.now();
  let totalTokens = 0;
  let totalCost = 0;

  const reportProgress = (stage: PipelineProgress['stage'], progress: number, message?: string) => {
    if (progressCallback) {
      progressCallback({
        pageId,
        stage,
        progress: Math.max(0, Math.min(100, progress)),
        message,
      });
    }
  };

  try {
    console.log(`[Pipeline] Starting processing for page ${pageId}`);
    reportProgress('fetching', 10, 'Fetching page content from Confluence...');

    // Step 1: Fetch page content from Confluence
    const pageContent: ConfluencePageContent = await fetchPageHtml(token, pageId);
    console.log(`[Pipeline] Fetched page: "${pageContent.title}" (${pageContent.html.length} chars)`);

    reportProgress('cleaning', 20, 'Cleaning HTML content...');

    // Step 2: Clean HTML
    const cleanedHtml = await cleanHtml(pageContent.html, {
      keepImages: options.keepImages || false,
      maxNestingLevel: 10,
      linkTarget: '_blank',
    });
    console.log(`[Pipeline] Cleaned HTML: ${cleanedHtml.length} chars (${Math.round((1 - cleanedHtml.length / pageContent.html.length) * 100)}% reduction)`);

    reportProgress('chunking', 30, 'Splitting content into chunks...');

    // Step 3: Split into chunks
    const chunkResult = await splitIntoChunks(cleanedHtml);

    if (chunkResult.chunks.length === 0) {
      console.log(`[Pipeline] No chunks generated for page ${pageId}`);
      return {
        success: true,
        pageId,
        title: pageContent.title,
        chunksProcessed: 0,
        questionsGenerated: 0,
        totalTokens: chunkResult.totalTokens || 0,
        totalCost: chunkResult.totalCost || 0,
        processingTime: Date.now() - startTime,
      };
    }

    totalTokens += chunkResult.totalTokens || 0;
    totalCost += chunkResult.totalCost || 0;

    console.log(`[Pipeline] Generated ${chunkResult.chunks.length} chunks`);

    // Step 4: Add source metadata to chunks
    const chunksWithMetadata = addSourceMetadata(
      chunkResult.chunks,
      pageContent.title,
      pageId,
      pageContent.url.replace('/pages/viewpage.action?pageId=' + pageId, ''),
    );

    reportProgress('questions', 50, 'Generating questions for chunks...');

    // Step 5: Generate questions for each chunk (with rate limiting)
    let questionsGenerated = 0;
    const chunkData: Array<{
      chunkText: string;
      embeddingText: string;
      questions: string[];
      chunkTokens: number;
      chunkCost: number;
    }> = [];


    const getQuestions = async (chunk: string, index: number) => {
      try {
        console.log(`[Pipeline] Processing chunk ${index + 1}/${chunkResult.chunks.length} for questions...`);

        // Generate questions for this chunk
        const questionsResult = await generateQuestionsForChunk(chunk, {
          minQuestions: options.minQuestions,
          maxQuestions: options.maxQuestions,
          context: `Page: ${pageContent.title}`,
        });

        totalTokens += questionsResult.totalTokens || 0;
        totalCost += questionsResult.totalCost || 0;
        questionsGenerated += questionsResult.questions.length;

        chunkData[index] = {
          chunkText: chunksWithMetadata[index],
          embeddingText: stripHtmlToText(chunk), // Plain text for embedding (HTML stripped)
          questions: questionsResult.questions,
          chunkTokens: questionsResult.totalTokens || 0,
          chunkCost: questionsResult.totalCost || 0,
        };

        reportProgress('questions', 50 + (index / chunkResult.chunks.length) * 30);
      } catch (error) {
        console.error(`[Pipeline] Failed to generate questions for chunk ${index}:`, error);
        // Continue with empty questions for this chunk
        chunkData[index] = {
          chunkText: chunksWithMetadata[index],
          embeddingText: stripHtmlToText(chunk),
          questions: [],
          chunkTokens: 0,
          chunkCost: 0,
        };
      }
    };
    const questionPromises = chunkResult.chunks.map(getQuestions);
    await Promise.all(questionPromises);

    reportProgress('embeddings', 80, 'Generating embeddings...');

    // Step 6: Clean up any existing data for this page
    console.log(`[Pipeline] Cleaning up existing data for page ${pageId}`);
    await deleteByWikiId(pageId);

    // Step 7: Generate embeddings in batches (all chunks, then all questions)
    let savedChunks = 0;
    let savedQuestions = 0;

    // Prepare inputs
    const chunkEmbeddingInputs = chunkData.map((d) => d.embeddingText);
    const questionEmbeddingInputs: string[] = [];
    const questionCountsPerChunk: number[] = [];
    for (const d of chunkData) {
      questionCountsPerChunk.push(d.questions.length);
      for (const q of d.questions) questionEmbeddingInputs.push(q);
    }

    // Compute embeddings for all chunks
    const chunkBatch = await getEmbeddingsForTexts(chunkEmbeddingInputs);
    totalTokens += chunkBatch.totalTokens || 0;
    totalCost += chunkBatch.totalCost || 0;

    // Save chunks and collect chunk IDs in order
    const chunkIds: number[] = [];
    for (let ci = 0; ci < chunkData.length; ci++) {
      try {
        const chunkId = await insertChunk(
          pageId,
          chunkData[ci].chunkText,
          chunkData[ci].embeddingText,
          chunkBatch.embeddings[ci] || [],
        );
        chunkIds.push(chunkId);
        savedChunks++;
      } catch (err) {
        console.error(`[Pipeline] Failed to save chunk ${ci}:`, err);
        // maintain alignment
        chunkIds.push(-1);
      }
    }

    // Compute embeddings for all questions (flat list)
    const questionsBatch = await getEmbeddingsForTexts(questionEmbeddingInputs);
    totalTokens += questionsBatch.totalTokens || 0;
    totalCost += questionsBatch.totalCost || 0;

    // Save questions mapped back to chunks
    let qOffset = 0;
    for (let ci = 0; ci < chunkData.length; ci++) {
      const count = questionCountsPerChunk[ci];
      const cid = chunkIds[ci];
      if (cid === -1) {
        qOffset += count;
        continue;
      }
      for (let k = 0; k < count; k++) {
        const qText = chunkData[ci].questions[k];
        const qEmbedding = questionsBatch.embeddings[qOffset + k] || [];
        try {
          await insertQuestion(cid, pageId, qText, qEmbedding);
          savedQuestions++;
        } catch (err) {
          console.error(`[Pipeline] Failed to save question for chunk ${ci}:`, err);
        }
        // small delay to avoid hammering DB
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      qOffset += count;
    }

    reportProgress('saving', 95);

    const processingTime = Date.now() - startTime;

    console.log(`[Pipeline] Completed processing page ${pageId}:`);
    console.log(`  - Title: ${pageContent.title}`);
    console.log(`  - Chunks saved: ${savedChunks}`);
    console.log(`  - Questions saved: ${savedQuestions}`);
    console.log(`  - Total tokens: ${totalTokens}`);
    console.log(`  - Total cost: $${totalCost.toFixed(4)}`);
    console.log(`  - Processing time: ${processingTime}ms`);

    reportProgress('completed', 100, `Processed ${savedChunks} chunks with ${savedQuestions} questions`);

    return {
      success: true,
      pageId,
      title: pageContent.title,
      chunksProcessed: savedChunks,
      questionsGenerated: savedQuestions,
      totalTokens,
      totalCost,
      processingTime,
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Pipeline] Failed to process page ${pageId}:`, error);

    reportProgress('error', 0, errorMessage);

    return {
      success: false,
      pageId,
      title: 'Unknown',
      chunksProcessed: 0,
      questionsGenerated: 0,
      totalTokens,
      totalCost,
      processingTime,
      error: errorMessage,
    };
  }
}

/**
 * Process multiple pages
 * @param pages Array of page information
 * @param token Confluence authentication token
 * @param options Processing options
 * @param progressCallback Optional progress callback function
 * @returns Array of pipeline results
 */
export async function processPages (
  pages: Array<{ id: string; spaceKey: string; title: string }>,
  token: string,
  options: {
    startDelay?: number;
    keepImages?: boolean;
    minQuestions?: number;
    maxQuestions?: number;
    batchSize?: number;
  } = {},
  progressCallback?: (pageId: string, progress: PipelineProgress) => void,
): Promise<PipelineResult[]> {
  const {
    startDelay = 5, // 100ms delay between starting tasks
    batchSize = 100, // Max 50 pages per batch
  } = options;

  console.log(`[Pipeline] Starting batch processing of ${pages.length} pages`);

  // Split pages into batches of maximum 50 pages
  const batches: Array<Array<{ id: string; spaceKey: string; title: string }>> = [];
  for (let i = 0; i < pages.length; i += batchSize) {
    batches.push(pages.slice(i, i + batchSize));
  }

  console.log(`[Pipeline] Processing ${batches.length} batches of pages`);

  const allResults: PipelineResult[] = [];

  // Process batches sequentially, but pages within each batch in parallel
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`[Pipeline] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} pages`);

    const processingPromises = batch.map(async (page, index) => {
      // Stagger the start of each task
      await new Promise(resolve => setTimeout(resolve, index * startDelay));

      const globalIndex = batchIndex * batchSize + index + 1;
      console.log(`[Pipeline] Starting page ${globalIndex}/${pages.length}: ${page.title}`);

      const result = await processPage(
        page.id,
        token,
        options,
        progressCallback ? (progress) => progressCallback(page.id, progress) : undefined,
      );

      console.log(`[Pipeline] Completed page ${globalIndex}/${pages.length}: ${result.success ? 'SUCCESS' : 'FAILED'}`);

      return result;
    });

    const batchResults = await Promise.all(processingPromises);
    allResults.push(...batchResults);

    console.log(`[Pipeline] Completed batch ${batchIndex + 1}/${batches.length}`);
  }

  // Calculate summary statistics
  const successful = allResults.filter(r => r.success).length;
  const failed = allResults.length - successful;
  const totalChunks = allResults.reduce((sum, r) => sum + r.chunksProcessed, 0);
  const totalQuestions = allResults.reduce((sum, r) => sum + r.questionsGenerated, 0);
  const totalCost = allResults.reduce((sum, r) => sum + r.totalCost, 0);
  const totalTime = Math.max(...allResults.map(r => r.processingTime));

  console.log(`[Pipeline] Batch processing completed:`);
  console.log(`  - Successful: ${successful}/${pages.length}`);
  console.log(`  - Failed: ${failed}`);
  console.log(`  - Total chunks: ${totalChunks}`);
  console.log(`  - Total questions: ${totalQuestions}`);
  console.log(`  - Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  - Total time: ${totalTime}ms`);

  return allResults;
}

/**
 * Test function for development
 */
export async function testPipeline (): Promise<void> {
  // This would require actual Confluence credentials and page IDs
  console.log('Pipeline test would require real Confluence credentials and page IDs');
  console.log('Use the processPage function with actual data for testing');
}

// Export types for use in other modules
// PipelineProgress is already exported as interface above

// Run test if this file is executed directly
if (require.main === module) {
  testPipeline().catch(console.error);
}
