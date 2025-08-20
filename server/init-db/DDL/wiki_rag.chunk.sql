-- DROP TABLE IF EXISTS wiki_rag.chunk CASCADE;

CREATE TABLE wiki_rag.chunk
(
    chunk_id       SERIAL PRIMARY KEY,
    wiki_id        TEXT                                               NOT NULL,
    text           TEXT                                               NOT NULL,
    embedding_text TEXT                                               NOT NULL,
    embedding      public.vector(1024)                                NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);


COMMENT ON TABLE wiki_rag.chunk IS 'Stores text chunks and their vector embeddings for RAG retrieval system';
COMMENT ON COLUMN wiki_rag.chunk.chunk_id IS 'Primary key, auto-incrementing identifier for each text chunk record';
COMMENT ON COLUMN wiki_rag.chunk.wiki_id IS 'Id страницы в WIKI, с которой получен чанк';
COMMENT ON COLUMN wiki_rag.chunk.text IS 'Original text chunk content (may contain HTML tags or other formatting)';
COMMENT ON COLUMN wiki_rag.chunk.embedding_text IS 'Processed text used for embedding generation (e.g., HTML stripped version of chunk_text)';
COMMENT ON COLUMN wiki_rag.chunk.embedding IS 'Vector embedding representation of the embedding_text with dimension 1024';
COMMENT ON COLUMN wiki_rag.chunk.updated_at IS 'Timestamp indicating when the record was created or last updated';

CREATE INDEX idx_texts_embedding_vector ON wiki_rag.chunk USING ivfflat (embedding vector_cosine_ops);

ALTER TABLE wiki_rag.chunk OWNER TO csbot;
