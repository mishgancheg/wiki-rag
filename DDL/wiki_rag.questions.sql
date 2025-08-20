DROP TABLE IF EXISTS wiki_rag.questions CASCADE;

CREATE TABLE wiki_rag.questions
(
    question_id   SERIAL PRIMARY KEY,
    question_text TEXT                                               NOT NULL,
    embedding     public.vector(1024)                                NOT NULL,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);


COMMENT ON TABLE wiki_rag.questions IS 'Stores user questions and their vector embeddings for RAG query processing';
COMMENT ON COLUMN wiki_rag.questions.question_id IS 'Primary key, auto-incrementing identifier for each question record';
COMMENT ON COLUMN wiki_rag.questions.question_text IS 'Text content of the user question or query';
COMMENT ON COLUMN wiki_rag.questions.embedding IS 'Vector embedding representation of the question_text with dimension 1024';
COMMENT ON COLUMN wiki_rag.questions.updated_at IS 'Timestamp indicating when the record was created or last updated';


CREATE INDEX idx_questions_embedding_vector ON wiki_rag.questions USING ivfflat (embedding vector_cosine_ops);