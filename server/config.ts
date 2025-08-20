import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export interface Config {
  // Server Configuration
  port: number;
  
  // Confluence Configuration
  confluenceBaseUrl: string;
  
  // OpenAI Configuration
  openaiApiKey: string;
  openaiChatModel: string;
  openaiEmbeddingModel: string;
  
  // PostgreSQL Configuration
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgDatabase: string;
  
  // Prompts
  promptChunking: string;
  promptQuestions: string;
}

// Default configuration with environment variable fallbacks
export const config: Config = {
  // Server Configuration
  port: parseInt(process.env.PORT || '3000', 10),
  
  // Confluence Configuration
  confluenceBaseUrl: process.env.CONFLUENCE_BASE_URL || 'https://wiki.example.com',
  
  // OpenAI Configuration
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large',
  
  // PostgreSQL Configuration
  pgHost: process.env.PGHOST || 'localhost',
  pgPort: parseInt(process.env.PGPORT || '5432', 10),
  pgUser: process.env.PGUSER || 'postgres',
  pgPassword: process.env.PGPASSWORD || '',
  pgDatabase: process.env.PGDATABASE || 'wiki_rag',
  
  // Prompts
  promptChunking: `You are a text chunking assistant. Your task is to split the provided HTML content into logical, coherent chunks that would be useful for a RAG (Retrieval-Augmented Generation) system.

Guidelines:
- Each chunk should be self-contained and meaningful
- Chunks should be 200-800 words when possible
- Preserve semantic coherence - don't break related content
- Include relevant context in each chunk
- Remove redundant formatting but preserve essential structure
- Return ONLY a valid JSON object with the exact format: {"chunks": ["chunk1", "chunk2", ...]}

The input will be cleaned HTML content. Split it into chunks and return as JSON.`,
  
  promptQuestions: `You are a question generation assistant. Your task is to generate 3-20 questions based on the provided text chunk that would help users find this content through semantic search.

Guidelines:
- Generate questions that this chunk can answer
- Include different question types: factual, conceptual, procedural
- Use natural language that users might actually search for
- Make questions specific enough to match this content
- Vary question length and complexity
- Return ONLY a valid JSON object with the exact format: {"questions": ["question1", "question2", ...]}

Generate questions for the following text chunk:`
};

// Validation function to ensure required environment variables are set
export function validateConfig(): void {
  const requiredVars = [
    { key: 'OPENAI_API_KEY', value: config.openaiApiKey },
    { key: 'PGPASSWORD', value: config.pgPassword }
  ];
  
  const missing = requiredVars.filter(({ value }) => !value);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach(({ key }) => console.error(`  - ${key}`));
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }
}