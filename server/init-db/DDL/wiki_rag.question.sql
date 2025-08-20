DROP TABLE IF EXISTS wiki_rag.question CASCADE;

CREATE TABLE wiki_rag.question
(
  question_id SERIAL PRIMARY KEY,
  chunk_id    integer                                            NOT NULL,
  wiki_id     TEXT                                               NOT NULL,
  text        TEXT                                               NOT NULL,
  embedding   public.vector(1024)                                NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_question_chunk
    FOREIGN KEY (chunk_id)
    REFERENCES wiki_rag.chunk(chunk_id)
    ON DELETE CASCADE
);


COMMENT ON TABLE wiki_rag.question IS 'Stores user questions and their vector embeddings for RAG query processing';
COMMENT ON COLUMN wiki_rag.question.question_id IS 'Primary key, auto-incrementing identifier for each question record';
COMMENT ON COLUMN wiki_rag.question.chunk_id IS 'chunk_id из таблицы wiki_rag.chunk';
COMMENT ON COLUMN wiki_rag.question.wiki_id IS 'Id страницы в WIKI, к которой относятся воппросы';
COMMENT ON COLUMN wiki_rag.question.text IS 'Text content of the user question or query';
COMMENT ON COLUMN wiki_rag.question.embedding IS 'Vector embedding representation of the question_text with dimension 1024';
COMMENT ON COLUMN wiki_rag.question.updated_at IS 'Timestamp indicating when the record was created or last updated';

CREATE INDEX idx_questions_embedding_vector ON wiki_rag.question USING ivfflat (embedding vector_cosine_ops);

ALTER TABLE wiki_rag.question OWNER TO csbot;
