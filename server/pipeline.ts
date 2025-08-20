import pLimit from 'p-limit';
import { fetchPageHtml, ConfluencePageContent } from './confluence.js';
import { cleanHtml } from './cleanHtml.js';
import { splitIntoChunks, addSourceMetadata } from './chunker/splitIntoChunks.js';
import { generateQuestionsForChunk } from './chunker/questions.js';
import { getEmbeddingForText } from './embeddings.js';
import { insertChunk, insertQuestion, deleteByWikiId } from './db.js';

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

/**
 * Process a single wiki page through the complete RAG pipeline
 * @param pageId Wiki page ID to process
 * @param token Confluence authentication token
 * @param options Processing options
 * @param progressCallback Optional progress callback function
 * @returns Pipeline processing result
 */
export async function processPage(
  pageId: string,
  token: string,
  options: {
    keepImages?: boolean;
    maxChunks?: number;
    minChunkLength?: number;
    maxChunkLength?: number;
    minQuestions?: number;
    maxQuestions?: number;
  } = {},
  progressCallback?: (progress: PipelineProgress) => void
): Promise<PipelineResult> {
  const startTime = Date.now();
  let totalTokens = 0;
  let totalCost = 0;

  const reportProgress = (stage: PipelineProgress['stage'], progress: number, message?: string) => {
    if (progressCallback) {
      progressCallback({
        pageId,
        stage,
        progress: Math.max(0, Math.min(100, progress)),
        message
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
      linkTarget: '_blank'
    });
    console.log(`[Pipeline] Cleaned HTML: ${cleanedHtml.length} chars (${Math.round((1 - cleanedHtml.length / pageContent.html.length) * 100)}% reduction)`);

    reportProgress('chunking', 30, 'Splitting content into chunks...');

    // Step 3: Split into chunks
    const chunkResult = await splitIntoChunks(cleanedHtml, {
      maxChunks: options.maxChunks || 50,
      minChunkLength: options.minChunkLength || 200,
      maxChunkLength: options.maxChunkLength || 800
    });

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
        processingTime: Date.now() - startTime
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
      pageContent.url.replace('/pages/viewpage.action?pageId=' + pageId, '')
    );

    reportProgress('questions', 50, 'Generating questions for chunks...');

    // Step 5: Generate questions for each chunk (with rate limiting)
    const limit = pLimit(3); // Process 3 chunks concurrently
    let questionsGenerated = 0;
    const chunkData: Array<{
      chunkText: string;
      embeddingText: string;
      questions: string[];
      chunkTokens: number;
      chunkCost: number;
    }> = [];

    const questionPromises = chunkResult.chunks.map((chunk, index) =>
      limit(async () => {
        try {
          console.log(`[Pipeline] Processing chunk ${index + 1}/${chunkResult.chunks.length} for questions...`);
          
          // Generate questions for this chunk
          const questionsResult = await generateQuestionsForChunk(chunk, {
            minQuestions: options.minQuestions || 3,
            maxQuestions: options.maxQuestions || 20,
            context: `Page: ${pageContent.title}`
          });

          totalTokens += questionsResult.totalTokens || 0;
          totalCost += questionsResult.totalCost || 0;
          questionsGenerated += questionsResult.questions.length;

          chunkData[index] = {
            chunkText: chunksWithMetadata[index],
            embeddingText: chunk, // Use original chunk without metadata for embedding
            questions: questionsResult.questions,
            chunkTokens: questionsResult.totalTokens || 0,
            chunkCost: questionsResult.totalCost || 0
          };

          reportProgress('questions', 50 + (index / chunkResult.chunks.length) * 30);
        } catch (error) {
          console.error(`[Pipeline] Failed to generate questions for chunk ${index}:`, error);
          // Continue with empty questions for this chunk
          chunkData[index] = {
            chunkText: chunksWithMetadata[index],
            embeddingText: chunk,
            questions: [],
            chunkTokens: 0,
            chunkCost: 0
          };
        }
      })
    );

    await Promise.all(questionPromises);

    reportProgress('embeddings', 80, 'Generating embeddings...');

    // Step 6: Clean up any existing data for this page
    console.log(`[Pipeline] Cleaning up existing data for page ${pageId}`);
    await deleteByWikiId(pageId);

    // Step 7: Generate embeddings and save to database (with rate limiting)
    let savedChunks = 0;
    let savedQuestions = 0;

    const embeddingPromises = chunkData.map((data, index) =>
      limit(async () => {
        try {
          console.log(`[Pipeline] Processing embeddings for chunk ${index + 1}/${chunkData.length}...`);
          
          // Generate embedding for chunk
          const chunkEmbeddingResult = await getEmbeddingForText(data.embeddingText);
          totalTokens += chunkEmbeddingResult.totalTokens || 0;
          totalCost += chunkEmbeddingResult.totalCost || 0;

          // Insert chunk into database
          const chunkId = await insertChunk(
            pageId,
            data.chunkText,
            data.embeddingText,
            chunkEmbeddingResult.embedding
          );
          savedChunks++;

          console.log(`[Pipeline] Saved chunk ${chunkId} with ${data.questions.length} questions`);

          // Generate embeddings for questions and save them
          for (const question of data.questions) {
            try {
              const questionEmbeddingResult = await getEmbeddingForText(question);
              totalTokens += questionEmbeddingResult.totalTokens || 0;
              totalCost += questionEmbeddingResult.totalCost || 0;

              await insertQuestion(
                chunkId,
                pageId,
                question,
                questionEmbeddingResult.embedding
              );
              savedQuestions++;

              // Small delay between question embeddings
              await new Promise(resolve => setTimeout(resolve, 50));
            } catch (questionError) {
              console.error(`[Pipeline] Failed to process question "${question}":`, questionError);
            }
          }

          reportProgress('saving', 80 + (index / chunkData.length) * 15);
        } catch (error) {
          console.error(`[Pipeline] Failed to process chunk ${index} embeddings:`, error);
          throw error;
        }
      })
    );

    await Promise.all(embeddingPromises);

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
      processingTime
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
      error: errorMessage
    };
  }
}

/**
 * Process multiple pages with controlled concurrency
 * @param pages Array of page information
 * @param token Confluence authentication token
 * @param options Processing options
 * @param progressCallback Optional progress callback function
 * @returns Array of pipeline results
 */
export async function processPages(
  pages: Array<{ id: string; spaceKey: string; title: string }>,
  token: string,
  options: {
    concurrency?: number;
    startDelay?: number;
    keepImages?: boolean;
    maxChunks?: number;
    minChunkLength?: number;
    maxChunkLength?: number;
    minQuestions?: number;
    maxQuestions?: number;
  } = {},
  progressCallback?: (pageId: string, progress: PipelineProgress) => void
): Promise<PipelineResult[]> {
  const {
    concurrency = 3,
    startDelay = 100, // 100ms delay between starting tasks
  } = options;

  console.log(`[Pipeline] Starting batch processing of ${pages.length} pages with concurrency ${concurrency}`);
  
  const limit = pLimit(concurrency);
  const results: PipelineResult[] = [];

  const processingPromises = pages.map((page, index) =>
    limit(async () => {
      // Stagger the start of each task
      await new Promise(resolve => setTimeout(resolve, index * startDelay));
      
      console.log(`[Pipeline] Starting page ${index + 1}/${pages.length}: ${page.title}`);
      
      const result = await processPage(
        page.id,
        token,
        options,
        progressCallback ? (progress) => progressCallback(page.id, progress) : undefined
      );
      
      results.push(result);
      
      console.log(`[Pipeline] Completed page ${index + 1}/${pages.length}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      
      return result;
    })
  );

  const allResults = await Promise.all(processingPromises);
  
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
export async function testPipeline(): Promise<void> {
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