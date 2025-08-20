-- Master DDL script for wiki_rag schema
-- This script creates the complete database schema for the RAG (Retrieval-Augmented Generation) system
-- Execute this script to set up both tables: wiki_rag.texts and wiki_rag.questions

-- Create schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS wiki_rag;

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;
