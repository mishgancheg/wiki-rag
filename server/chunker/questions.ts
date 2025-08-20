import OpenAI from 'openai';
import { config } from '../config.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

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
export async function generateQuestionsForChunk(
  chunkText: string,
  options: {
    minQuestions?: number;
    maxQuestions?: number;
    context?: string;
  } = {}
): Promise<QuestionsResult> {
  const startTime = Date.now();
  
  const {
    minQuestions = 3,
    maxQuestions = 20,
    context = ''
  } = options;

  // Validate input
  if (!chunkText || chunkText.trim().length === 0) {
    return { questions: [] };
  }

  // If chunk is very short, generate fewer questions
  const chunkLength = chunkText.length;
  const targetQuestions = Math.min(
    maxQuestions,
    Math.max(minQuestions, Math.floor(chunkLength / 100))
  );

  try {
    console.log(`[Questions] Generating questions for chunk (${chunkLength} characters)...`);

    // Create enhanced prompt with specific instructions
    const enhancedPrompt = `${config.promptQuestions}

Additional guidelines:
- Generate ${minQuestions}-${targetQuestions} questions
- Make questions diverse: factual, conceptual, procedural, comparative
- Questions should be specific enough to match this exact content
- Use natural language that users would actually search for
- Include questions about key concepts, processes, and details
- Avoid overly generic questions that could apply to many documents
- Questions should help users find this specific information

${context ? `\nContext: ${context}` : ''}`;

    // Create messages for chat completion
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: enhancedPrompt
      },
      {
        role: 'user',
        content: chunkText
      },
      {
        role: 'system',
        content: `Generate ${minQuestions}-${targetQuestions} high-quality questions and return as JSON with the exact format: {"questions": ["question1", "question2", ...]}`
      }
    ];

    // Call OpenAI Chat Completions API with JSON mode
    const response = await openai.chat.completions.create({
      model: config.openaiChatModel,
      messages: messages,
      temperature: 0.3, // Slightly higher temperature for more diverse questions
      max_tokens: 1500,  // Reasonable limit for questions response
      response_format: { type: "json_object" }, // Ensure JSON response
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No content received from OpenAI');
    }

    // Parse JSON response
    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(choice.message.content);
    } catch (parseError) {
      console.error('[Questions] JSON parse error:', parseError);
      console.error('[Questions] Raw response:', choice.message.content);
      throw new Error(`Failed to parse JSON response: ${parseError}`);
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
    
    const result: QuestionsResult = {
      questions,
      totalTokens,
      totalCost: estimatedCost,
      processingTime
    };

    // Validate question quality
    validateQuestions(questions, chunkText);

    return result;

  } catch (error) {
    console.error('[Questions] Error generating questions:', error);
    
    // Fallback: Generate simple questions based on text analysis
    console.log('[Questions] Falling back to simple question generation...');
    const fallbackQuestions = generateFallbackQuestions(chunkText, targetQuestions);
    
    return {
      questions: fallbackQuestions,
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Validate questions for quality and relevance
 */
function validateQuestions(questions: string[], chunkText: string): void {
  const chunkLower = chunkText.toLowerCase();
  
  questions.forEach((question, index) => {
    // Check if question is too short
    if (question.length < 10) {
      console.warn(`[Questions] Question ${index} is too short: "${question}"`);
    }
    
    // Check if question is too long
    if (question.length > 200) {
      console.warn(`[Questions] Question ${index} is too long: ${question.length} characters`);
    }
    
    // Check if question doesn't end with proper punctuation
    if (!/[?!.]$/.test(question)) {
      console.warn(`[Questions] Question ${index} missing punctuation: "${question}"`);
    }
    
    // Check if question seems too generic (contains very common words only)
    const questionWords = question.toLowerCase().split(/\s+/);
    const commonWords = ['what', 'how', 'when', 'where', 'why', 'who', 'is', 'are', 'can', 'does', 'do'];
    const specificWords = questionWords.filter(word => 
      word.length > 3 && !commonWords.includes(word)
    );
    
    if (specificWords.length < 2) {
      console.warn(`[Questions] Question ${index} may be too generic: "${question}"`);
    }
  });
}

/**
 * Fallback question generation when LLM fails
 */
function generateFallbackQuestions(text: string, targetCount: number): string[] {
  const questions: string[] = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  // Extract key phrases and concepts
  const keyPhrases = extractKeyPhrases(text);
  
  // Generate different types of questions
  const questionTemplates = [
    'What is {}?',
    'How does {} work?',
    'What are the benefits of {}?',
    'What is the purpose of {}?',
    'How can {} be used?',
    'What are the key features of {}?'
  ];
  
  // Generate questions from key phrases
  keyPhrases.slice(0, Math.ceil(targetCount * 0.7)).forEach(phrase => {
    const template = questionTemplates[Math.floor(Math.random() * questionTemplates.length)];
    questions.push(template.replace('{}', phrase));
  });
  
  // Generate questions from sentences (transform statements to questions)
  sentences.slice(0, Math.ceil(targetCount * 0.3)).forEach(sentence => {
    const trimmed = sentence.trim();
    if (trimmed.length > 20) {
      // Simple transformation: add "What is the significance of" to the beginning
      questions.push(`What is mentioned about ${trimmed.split(' ').slice(0, 5).join(' ')}?`);
    }
  });
  
  // Ensure we have at least some questions
  if (questions.length === 0) {
    questions.push(
      'What information is provided in this content?',
      'What are the main points discussed here?',
      'What concepts are explained in this text?'
    );
  }
  
  console.log(`[Questions] Fallback generated ${questions.length} questions`);
  return questions.slice(0, targetCount);
}

/**
 * Extract key phrases from text for fallback question generation
 */
function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];
  
  // Extract phrases in quotes
  const quotedPhrases = text.match(/"([^"]+)"/g);
  if (quotedPhrases) {
    phrases.push(...quotedPhrases.map(p => p.replace(/"/g, '')));
  }
  
  // Extract capitalized phrases (likely proper nouns or important terms)
  const capitalizedPhrases = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g);
  if (capitalizedPhrases) {
    phrases.push(...capitalizedPhrases.filter(p => p.length > 3));
  }
  
  // Extract phrases with common technical indicators
  const technicalPhrases = text.match(/\b(?:API|SDK|HTTP|URL|JSON|XML|REST|GraphQL|OAuth|JWT)[a-zA-Z\s]*/gi);
  if (technicalPhrases) {
    phrases.push(...technicalPhrases);
  }
  
  // Remove duplicates and filter out very short phrases
  return [...new Set(phrases)]
    .filter(p => p.length > 3 && p.length < 50)
    .slice(0, 10);
}

/**
 * Generate questions for multiple chunks in batch
 */
export async function generateQuestionsForChunks(
  chunks: string[],
  options: {
    concurrency?: number;
    minQuestions?: number;
    maxQuestions?: number;
    context?: string;
  } = {}
): Promise<{ chunkIndex: number; questions: string[]; stats: QuestionsResult }[]> {
  const { concurrency = 3 } = options;
  const results: { chunkIndex: number; questions: string[]; stats: QuestionsResult }[] = [];
  
  // Process chunks in batches to avoid hitting rate limits
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchPromises = batch.map(async (chunk, batchIndex) => {
      const chunkIndex = i + batchIndex;
      console.log(`[Questions] Processing chunk ${chunkIndex + 1}/${chunks.length}...`);
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, batchIndex * 100));
      
      const result = await generateQuestionsForChunk(chunk, options);
      return { chunkIndex, questions: result.questions, stats: result };
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Add delay between batches
    if (i + concurrency < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`[Questions] Generated questions for ${results.length} chunks`);
  return results;
}

/**
 * Test function for development and debugging
 */
export async function testQuestionGeneration(): Promise<void> {
  const testChunk = `
    <h2>Machine Learning Model Training</h2>
    <p>Training a machine learning model involves several key steps. First, you need to prepare your dataset by cleaning the data, handling missing values, and splitting it into training and validation sets. The training set is used to teach the model patterns in the data, while the validation set helps evaluate how well the model generalizes to unseen data.</p>
    
    <p>During training, the model learns by adjusting its internal parameters to minimize prediction errors. This process is called optimization, and it typically uses algorithms like gradient descent. The training process continues until the model reaches satisfactory performance or meets stopping criteria such as convergence or maximum iterations.</p>
    
    <p>It's important to monitor for overfitting, which occurs when the model performs well on training data but poorly on new data. Techniques like regularization, dropout, and early stopping can help prevent overfitting and improve model generalization.</p>
  `;

  console.log('Testing question generation with sample chunk...\n');
  console.log('Chunk content:');
  console.log(testChunk);
  console.log('\n' + '='.repeat(50) + '\n');
  
  try {
    const result = await generateQuestionsForChunk(testChunk, {
      minQuestions: 5,
      maxQuestions: 15,
      context: 'This content is from a machine learning tutorial'
    });
    
    console.log(`Generated ${result.questions.length} questions:`);
    console.log(`Processing time: ${result.processingTime}ms`);
    console.log(`Total tokens: ${result.totalTokens}`);
    console.log(`Estimated cost: $${result.totalCost?.toFixed(4)}`);
    console.log('=' .repeat(50));
    
    result.questions.forEach((question, index) => {
      console.log(`${index + 1}. ${question}`);
    });
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testQuestionGeneration().catch(console.error);
}