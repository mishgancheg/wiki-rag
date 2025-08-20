import dotenv from 'dotenv';
import { CHUNK_CHARS_LIMIT } from "./constants";

// Load environment variables from .env file
dotenv.config();

export interface Config {
  // Server Configuration
  port: number;

  // Confluence Configuration
  confluenceBaseUrl: string;

  // OpenAI Configuration
  openaiApiKey: string;
  modelForChunks: string;
  modelForQuestions: string;
  openaiEmbeddingModel: string;

  // Network / TLS
  ignoreSslErrors: boolean;

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

export const LNG = `Весь текст переводи на РУССКИЙ язык`;

// Default configuration with environment variable fallbacks
export const config: Config = {
  // Server Configuration
  port: parseInt(process.env.PORT || '3000', 10),

  // Confluence Configuration
  confluenceBaseUrl: process.env.CONFLUENCE_BASE_URL || 'https://wiki.example.com',

  // OpenAI Configuration
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  modelForChunks: process.env.MODEL_FOR_CHUNKS || 'gpt-4.1',
  modelForQuestions: process.env.MODEL_FOR_QUESTIONS || 'gpt-4.1',
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large',

  // Network / TLS
  ignoreSslErrors: (process.env.IGNORE_SSL_ERRORS || '').toLowerCase() === 'true',

  // PostgreSQL Configuration
  pgHost: process.env.PGHOST || 'localhost',
  pgPort: parseInt(process.env.PGPORT || '5432', 10),
  pgUser: process.env.PGUSER || 'postgres',
  pgPassword: process.env.PGPASSWORD || '',
  pgDatabase: process.env.PGDATABASE || 'wiki_rag',

  // Prompts
  promptChunking: `
You are an expert assistant specializing in high-quality text chunking for use in Retrieval-Augmented Generation (RAG) systems.

Your task is to analyze the provided content and split it into **meaningful and logically connected chunks**, suitable for indexing and retrieval in RAG pipelines.

**Chunk requirements:**
- Break content into chunks that do not exceed ${CHUNK_CHARS_LIMIT} characters.
- Each chunk must preserve the **original text exactly**, with no omissions, reductions, or paraphrasing.
- Preserve all formatting.
- Each chunk should be **cohesive** and **self-contained**, meaning it should make sense and be interpretable on its own.
- Chunk boundaries should follow the **logical flow** of the original content.

IMPORTANT: DO NOT LOSE ANYTHING FROM CONTENT. All content should enter the chunks. Without exception.
Therefore do the following:
- Break content into chunks.
- Check if the entire text of the content is in chopped chunks. If something is missing, add.
- place the chunks in an ARRAY OF RESULTS

**Output the result in the JSON structure pointed in \`response_format\`**

${LNG}
`,

  promptQuestions: `
You are an expert specializing in inventing questions for the text.

Your task is to generate questions that users might ask to retrieve the information from given ---TEXT---.

**Questions requirements:**
- Generate **3–20 natural language questions** that users might ask to retrieve the information from given ---TEXT---.
- If you can come up with more than 20 questions - come up with more!
- Look at the text in the ---CONTEXT---. Think about what else can refer to the context.
- You can form questions of a more general plan than the ---TEXT---.
- If you understand that this text can be interesting in the ---CONTEXT--- of another requested information, then add questions to that context.

**Output the result in the JSON structure pointed in \`response_format\`**

${LNG}
`,
};

// Apply TLS relaxation if explicitly requested (use with caution)
if ((process.env.IGNORE_SSL_ERRORS || '').toLowerCase() === 'true') {
  // Disables certificate verification for all HTTPS requests in this process
  // This is unsafe and should only be used in controlled corporate proxy environments.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[Config] IGNORE_SSL_ERRORS=true: TLS certificate verification is disabled. Use only in trusted networks.');
}

// Validation function to ensure required environment variables are set
export function validateConfig (): void {
  const requiredVars = [
    { key: 'OPENAI_API_KEY', value: config.openaiApiKey },
    { key: 'PGPASSWORD', value: config.pgPassword },
  ];

  const missing = requiredVars.filter(({ value }) => !value);

  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach(({ key }) => console.error(`  - ${key}`));
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }
}
