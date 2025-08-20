DROP TABLE IF EXISTS wiki_rag.texts CASCADE;

CREATE TABLE wiki_rag.texts
(
    text_id        SERIAL PRIMARY KEY,
    chunk_text     TEXT                                               NOT NULL,
    embedding_text TEXT                                               NOT NULL,
    embedding      public.vector(1024)                                NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);


COMMENT ON TABLE wiki_rag.texts IS 'Stores text chunks and their vector embeddings for RAG retrieval system';
COMMENT ON COLUMN wiki_rag.texts.text_id IS 'Primary key, auto-incrementing identifier for each text chunk record';
COMMENT ON COLUMN wiki_rag.texts.chunk_text IS 'Original text chunk content (may contain HTML tags or other formatting)';
COMMENT ON COLUMN wiki_rag.texts.embedding_text IS 'Processed text used for embedding generation (e.g., HTML stripped version of chunk_text)';
COMMENT ON COLUMN wiki_rag.texts.embedding IS 'Vector embedding representation of the embedding_text with dimension 1024';
COMMENT ON COLUMN wiki_rag.texts.updated_at IS 'Timestamp indicating when the record was created or last updated';

CREATE INDEX idx_texts_embedding_vector ON wiki_rag.texts USING ivfflat (embedding vector_cosine_ops);