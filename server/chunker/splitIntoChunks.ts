// noinspection UnnecessaryLocalVariableJS

import { config } from '../config.js';
import { chatCompletionRequest } from "../llm/openai-chat.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";
import { CHUNK_CHARS_LIMIT } from "../constants";

// Interface for chunk result
export interface ChunkResult {
  chunks: string[];
  totalTokens?: number;
  totalCost?: number;
  processingTime?: number;
}

/**
 * Split cleaned HTML content into logical chunks using OpenAI LLM
 * @param cleanedHtml The cleaned HTML content to chunk
 * @returns Array of text chunks
 */
export async function splitIntoChunks (cleanedHtml: string): Promise<ChunkResult> {
  const startTime = Date.now();

  // Validate input
  if (!cleanedHtml || cleanedHtml.trim().length === 0) {
    return { chunks: [] };
  }

  // If content is very short, return as single chunk
  if (cleanedHtml.length < CHUNK_CHARS_LIMIT) {
    return {
      chunks: [cleanedHtml],
      processingTime: Date.now() - startTime,
    };
  }

  try {
    console.log(`[Chunker] Processing ${cleanedHtml.length} characters...`);
    // Create messages for chat completion
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: config.promptChunking },
      { role: 'user', content: cleanedHtml },
    ];

    // Call OpenAI Chat Completions API with JSON mode via centralized helper
    const response = await chatCompletionRequest({
      model: config.modelForChunks,
      messages: messages,
      temperature: 0.1, // Low temperature for consistent chunking
      max_tokens: 16000,  // Reasonable limit for chunk responses
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "chunk_response",
          schema: {
            type: "object",
            properties: {
              chunks: {
                type: "array",
                description: `Array of chunks. Each of items contains significant, consistent chunk of the text, convenient for placement in RAG.`,
                items: {
                  type: 'string',
                  description: `Text chunk.
Significant, consistent chunk of the text, convenient for placement in RAG.
If it is necessary for a more complete understanding of the chink, headlines and preamble are added to it`,
                },
              },
            },
            required: ["chunks"],
            additionalProperties: false,
          },
          strict: true,
        },
      },

    });

    // Prefer structured result parsed by chatCompletionRequest
    const parsedResponse: any = (response as any).resultJson;
    if (!parsedResponse) {
      throw new Error('No structured JSON result parsed from OpenAI response');
    }

    // Validate response structure
    if (!parsedResponse.chunks || !Array.isArray(parsedResponse.chunks)) {
      console.error('[Chunker] Invalid response structure:', parsedResponse);
      throw new Error('Response does not contain valid chunks array');
    }

    // Filter and validate chunks
    const chunks = parsedResponse.chunks
      .filter((chunk: any) => typeof chunk === 'string' && chunk.trim().length > 0)
      .map((chunk: string) => chunk.trim()); // Limit to maximum chunks

    // Log statistics
    const totalTokens = response.usage?.total_tokens || 0;
    const processingTime = Date.now() - startTime;

    console.log(`[Chunker] Generated ${chunks.length} chunks in ${processingTime}ms`);
    console.log(`[Chunker] Total tokens used: ${totalTokens}`);

    // Calculate rough cost (GPT-4o-mini pricing as example)
    const estimatedCost = (totalTokens / 1000000) * 0.15; // $0.15 per 1M tokens (approximate)

    const result: ChunkResult = {
      chunks,
      totalTokens,
      totalCost: estimatedCost,
      processingTime,
    };

    return result;

  } catch (error) {
    console.error('[Chunker] Error splitting content:', error);

    // Fallback: Simple text-based chunking if LLM fails
    console.log('[Chunker] Falling back to simple text splitting...');
    const fallbackChunks = fallbackTextSplitting(cleanedHtml, CHUNK_CHARS_LIMIT);

    return {
      chunks: fallbackChunks,
      processingTime: Date.now() - startTime,
    };
  }
}

/**
 * Fallback text splitting when LLM fails
 */
function fallbackTextSplitting (text: string, maxChunkLength: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed max length
    if (currentChunk.length + paragraph.length > maxChunkLength) {
      // Save current chunk if it has content
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // If single paragraph is too long, split it by sentences
      if (paragraph.length > maxChunkLength) {
        const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim().length > 0);
        let sentenceChunk = '';

        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length > maxChunkLength) {
            if (sentenceChunk.trim().length > 0) {
              chunks.push(sentenceChunk.trim());
              sentenceChunk = '';
            }
          }
          sentenceChunk += sentence + '. ';
        }

        if (sentenceChunk.trim().length > 0) {
          currentChunk = sentenceChunk.trim();
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      if (currentChunk.length > 0) {
        currentChunk += '\n\n' + paragraph;
      } else {
        currentChunk = paragraph;
      }
    }
  }

  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  console.log(`[Chunker] Fallback splitting created ${chunks.length} chunks`);
  return chunks;
}

/**
 * Add source metadata to chunks
 */
export function addSourceMetadata (
  chunks: string[],
  pageTitle: string,
  pageId: string,
  baseUrl: string,
): string[] {
  const sourcePrefix = `<source title="${pageTitle}" url="${baseUrl}/pages/viewpage.action?pageId=${pageId}" />`;

  return chunks.map(chunk => `${sourcePrefix}\n\n${chunk}`);
}

/**
 * Test function for development and debugging
 */
export async function testChunking (): Promise<void> {
  const testHtml = `
    <h1>Introduction to Machine Learning</h1>
    <p>Machine learning is a subset of artificial intelligence that focuses on developing algorithms and models that can learn and make predictions or decisions from data without being explicitly programmed.</p>
    
    <h2>Types of Machine Learning</h2>
    <p>There are several types of machine learning approaches:</p>
    
    <h3>Supervised Learning</h3>
    <p>Supervised learning involves training a model using labeled data, where both input features and expected outputs are provided. Common algorithms include linear regression, decision trees, and neural networks.</p>
    
    <h3>Unsupervised Learning</h3>
    <p>Unsupervised learning works with unlabeled data to discover hidden patterns or structures. Clustering and dimensionality reduction are common unsupervised learning tasks.</p>
    
    <h3>Reinforcement Learning</h3>
    <p>Reinforcement learning involves an agent learning to make decisions through interaction with an environment, receiving rewards or penalties for different actions.</p>
    
    <h2>Applications</h2>
    <p>Machine learning has numerous applications across various industries:</p>
    <ul>
      <li>Healthcare: Medical diagnosis and drug discovery</li>
      <li>Finance: Fraud detection and algorithmic trading</li>
      <li>Technology: Recommendation systems and natural language processing</li>
      <li>Transportation: Autonomous vehicles and route optimization</li>
    </ul>
    
    <h2>Getting Started</h2>
    <p>To begin with machine learning, you should have a solid foundation in mathematics, statistics, and programming. Popular programming languages for ML include Python and R, with libraries like scikit-learn, TensorFlow, and PyTorch.</p>
  `;

  console.log('Testing chunking with sample content...\n');

  try {
    const result = await splitIntoChunks(testHtml);

    console.log(`Generated ${result.chunks.length} chunks:`);
    console.log(`Processing time: ${result.processingTime}ms`);
    console.log(`Total tokens: ${result.totalTokens}`);
    console.log(`Estimated cost: $${result.totalCost?.toFixed(4)}`);
    console.log('='.repeat(50));

    result.chunks.forEach((chunk, index) => {
      console.log(`\nChunk ${index + 1} (${chunk.length} chars):`);
      console.log(chunk);
      console.log('-'.repeat(30));
    });

    // Test with source metadata
    const chunksWithSource = addSourceMetadata(
      result.chunks,
      'Machine Learning Guide',
      '12345',
      'https://wiki.example.com',
    );

    console.log('\nFirst chunk with source metadata:');
    console.log(chunksWithSource[0]);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testChunking().catch(console.error);
}
