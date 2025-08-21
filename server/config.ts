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
}

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
