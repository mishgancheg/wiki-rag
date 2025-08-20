import { Pool, Client } from 'pg';
import { config } from './config.js';

// PostgreSQL connection pool
let pool: Pool | null = null;

// Database connection configuration
const dbConfig = {
  host: config.pgHost,
  port: config.pgPort,
  user: config.pgUser,
  password: config.pgPassword,
  database: config.pgDatabase,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Initialize database connection pool
export function initializePool(): Pool {
  if (!pool) {
    pool = new Pool(dbConfig);
    
    pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err);
    });
    
    pool.on('connect', () => {
      console.log('Connected to PostgreSQL database');
    });
  }
  
  return pool;
}

// Get database pool instance
export function getPool(): Pool {
  if (!pool) {
    return initializePool();
  }
  return pool;
}

// Close database connection pool
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection pool closed');
  }
}

// Database initialization and migration
export async function initializeDatabase(): Promise<void> {
  console.log('Initializing database...');
  
  try {
    // Connect directly to PostgreSQL to create database if it doesn't exist
    const adminClient = new Client({
      host: config.pgHost,
      port: config.pgPort,
      user: config.pgUser,
      password: config.pgPassword,
      database: 'postgres', // Connect to default postgres database first
    });
    
    await adminClient.connect();
    
    // Check if database exists, create if it doesn't
    const dbCheckResult = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [config.pgDatabase]
    );
    
    if (dbCheckResult.rows.length === 0) {
      console.log(`Creating database ${config.pgDatabase}...`);
      await adminClient.query(`CREATE DATABASE "${config.pgDatabase}"`);
    }
    
    await adminClient.end();
    
    // Now connect to the target database
    const client = new Client(dbConfig);
    await client.connect();
    
    // Enable pgvector extension
    console.log('Enabling pgvector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    
    // Create schema
    console.log('Creating wiki_rag schema...');
    await client.query('CREATE SCHEMA IF NOT EXISTS wiki_rag');
    
    // Create chunk table
    console.log('Creating wiki_rag.chunk table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS wiki_rag.chunk (
        chunk_id       SERIAL PRIMARY KEY,
        wiki_id        TEXT                                               NOT NULL,
        text           TEXT                                               NOT NULL,
        embedding_text TEXT                                               NOT NULL,
        embedding      public.vector(1024)                                       NOT NULL,
        updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    
    // Create question table
    console.log('Creating wiki_rag.question table...');
    await client.query(`
        CREATE TABLE IF NOT EXISTS wiki_rag.question
        (
            question_id SERIAL PRIMARY KEY,
            chunk_id    INTEGER                                            NOT NULL,
            wiki_id     TEXT                                               NOT NULL,
            text        TEXT                                               NOT NULL,
            embedding   public.vector(1024)                                NOT NULL,
            updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
            FOREIGN KEY (chunk_id) REFERENCES wiki_rag.chunk (chunk_id) ON DELETE CASCADE
        )
    `);
    
    // Create indexes
    console.log('Creating vector indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chunk_embedding_vector 
      ON wiki_rag.chunk USING ivfflat (embedding vector_cosine_ops)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_question_embedding_vector 
      ON wiki_rag.question USING ivfflat (embedding vector_cosine_ops)
    `);
    
    // Create additional helpful indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chunk_wiki_id ON wiki_rag.chunk(wiki_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_question_wiki_id ON wiki_rag.question(wiki_id)
    `);
    
    await client.end();
    
    console.log('Database initialization completed successfully!');
    
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

// Database query helpers
export interface ChunkRecord {
  chunk_id: number;
  wiki_id: string;
  text: string;
  embedding_text: string;
  embedding: number[];
  updated_at: Date;
}

export interface QuestionRecord {
  question_id: number;
  chunk_id: number;
  wiki_id: string;
  text: string;
  embedding: number[];
  updated_at: Date;
}

// Insert chunk with embedding
export async function insertChunk(
  wikiId: string,
  text: string,
  embeddingText: string,
  embedding: number[]
): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO wiki_rag.chunk (wiki_id, text, embedding_text, embedding)
     VALUES ($1, $2, $3, $4)
     RETURNING chunk_id`,
    [wikiId, text, embeddingText, `[${embedding.join(',')}]`]
  );
  
  return result.rows[0].chunk_id;
}

// Insert question with embedding
export async function insertQuestion(
  chunkId: number,
  wikiId: string,
  text: string,
  embedding: number[]
): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO wiki_rag.question (chunk_id, wiki_id, text, embedding)
     VALUES ($1, $2, $3, $4)
     RETURNING question_id`,
    [chunkId, wikiId, text, `[${embedding.join(',')}]`]
  );
  
  return result.rows[0].question_id;
}

// Delete chunks and questions by wiki_id
export async function deleteByWikiId(wikiId: string): Promise<void> {
  const pool = getPool();
  
  // Questions will be deleted automatically due to CASCADE foreign key
  await pool.query('DELETE FROM wiki_rag.chunk WHERE wiki_id = $1', [wikiId]);
}

// Search similar chunks and questions
export async function searchSimilar(
  queryEmbedding: number[],
  threshold: number = 0.65,
  limit: number = 10
): Promise<Array<{ chunk_id: number; wiki_id: string; text: string; similarity: number; source: 'chunk' | 'question' }>> {
  const pool = getPool();
  
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  
  // Search in both chunks and questions
  const result = await pool.query(`
    (
      SELECT 
        chunk_id,
        wiki_id,
        embedding_text as text,
        1 - (embedding <=> $1::vector) as similarity,
        'chunk' as source
      FROM wiki_rag.chunk
      WHERE 1 - (embedding <=> $1::vector) >= $2
    )
    UNION ALL
    (
      SELECT 
        chunk_id,
        wiki_id,
        text,
        1 - (embedding <=> $1::vector) as similarity,
        'question' as source
      FROM wiki_rag.question
      WHERE 1 - (embedding <=> $1::vector) >= $2
    )
    ORDER BY similarity DESC
    LIMIT $3
  `, [embeddingStr, threshold, limit]);
  
  return result.rows;
}

// Get chunks by IDs (for retrieving full content)
export async function getChunksByIds(chunkIds: number[]): Promise<ChunkRecord[]> {
  if (chunkIds.length === 0) return [];
  
  const pool = getPool();
  const result = await pool.query(
    `SELECT chunk_id, wiki_id, text, embedding_text, embedding, updated_at
     FROM wiki_rag.chunk
     WHERE chunk_id = ANY($1::int[])
     ORDER BY chunk_id`,
    [chunkIds]
  );
  
  return result.rows;
}

// Check which wiki IDs are already indexed
export async function getIndexedWikiIds(wikiIds: string[]): Promise<string[]> {
  if (wikiIds.length === 0) return [];
  
  const pool = getPool();
  const result = await pool.query(
    `SELECT DISTINCT wiki_id FROM wiki_rag.chunk WHERE wiki_id = ANY($1::text[])`,
    [wikiIds]
  );
  
  return result.rows.map(row => row.wiki_id);
}

// Run this script directly to initialize database
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('Database setup completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database setup failed:', error);
      process.exit(1);
    });
}