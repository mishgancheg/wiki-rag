import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import pgvector from 'pgvector/pg';

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

    pool.on('connect', async (client: PoolClient) => {
      try {
        const registerTypesFunctions = [pgvector.registerType];
        if (Array.isArray(registerTypesFunctions)) {
          await Promise.all(registerTypesFunctions.map((fn) => fn(client)));
        }
        console.log('Connected to PostgreSQL database (types registered)');
      } catch (err) {
        console.error('Failed to register PostgreSQL custom types for client', err);
      }
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

// Database initialization has been moved to server/init-db/init-db.ts
// This file now only contains connection pool and query helper functions.

// Database query helpers
export interface ChunkRecord {
  chunk_id: number;
  wiki_id: string;
  text: string;
  embedding_text: string;
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
  const embeddingLiteral = JSON.stringify(embedding);
  const result = await pool.query(
    `INSERT INTO wiki_rag.chunk (wiki_id, text, embedding_text, embedding)
     VALUES ($1, $2, $3, '${embeddingLiteral}')
     RETURNING chunk_id`,
    [wikiId, text, embeddingText]
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
  const embeddingLiteralQ = JSON.stringify(embedding);
  const result = await pool.query(
    `INSERT INTO wiki_rag.question (chunk_id, wiki_id, text, embedding)
     VALUES ($1, $2, $3, '${embeddingLiteralQ}')
     RETURNING question_id`,
    [chunkId, wikiId, text]
  );

  return result.rows[0].question_id;
}

// Delete chunks and questions by wiki_id
export async function deleteByWikiId(wikiId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM wiki_rag.chunk WHERE wiki_id = $1', [wikiId]);
  await pool.query('DELETE FROM wiki_rag.question WHERE wiki_id = $1', [wikiId]);
  console.log(`Deleted chunks and questions for wiki_id: ${wikiId}`);
}

// Search similar chunks and questions
export async function searchSimilar(
  queryEmbedding: number[],
  threshold: number = 0.65,
  chunksLimit: number = 10
): Promise<Array<{ chunk_id: number; wiki_id: string; question: string | null; chunk: string; cs: number }>> {
  const pool = getPool();

  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // 1) Execute search on wiki_rag.question table
  const questionResult = await pool.query(`
    SELECT
      Q.chunk_id,
      Q.wiki_id,
      Q.text AS "question",
      C.text AS "chunk",
      (Q.embedding <=> $1)::real as "cs"
    FROM wiki_rag.question AS Q
    JOIN wiki_rag.chunk AS C ON Q.chunk_id = C.chunk_id
    WHERE (Q.embedding <=> $1) <= $2
    ORDER BY "cs"
  `, [embeddingStr, threshold]);

  // 2) Execute search on wiki_rag.chunk table
  const chunkResult = await pool.query(`
    SELECT 
      chunk_id,
      wiki_id,
      null as "question",
      text as chunk,
      ("embedding" <=> $1)::real AS "cs"
    FROM wiki_rag.chunk
    WHERE (embedding <=> $1) <= $2
    ORDER BY "cs"
  `, [embeddingStr, threshold]);

  // 3) Process the results: combine and get unique chunk_ids
  const allResults = [...questionResult.rows, ...chunkResult.rows];

  // Create a map to store the best similarity for each unique chunk_id
  const chunkMap = new Map<number, { chunk_id: number; wiki_id: string; question: string | null; chunk: string; cs: number }>();

  for (const row of allResults) {
    const existing = chunkMap.get(row.chunk_id);
    if (!existing || row.cs < existing.cs) {
      chunkMap.set(row.chunk_id, {
        chunk_id: row.chunk_id,
        wiki_id: row.wiki_id,
        question: row.question,
        chunk: row.chunk,
        cs: row.cs
      });
    }
  }

  // Sort by similarity (ascending, since lower cosine distance means higher similarity)
  // and return top-N records
  return Array.from(chunkMap.values())
    .sort((a, b) => a.cs - b.cs)
    .slice(0, chunksLimit);
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

