# Wiki-RAG: Confluence Indexing & Semantic Search

A standalone application for indexing Confluence wiki pages and performing intelligent semantic search using RAG (Retrieval-Augmented Generation) technology.

## 🌟 Features

- **Confluence Integration**: Connect to any Confluence instance using personal access tokens
- **Intelligent Indexing**: Automatically clean HTML, chunk content, and generate questions using LLM
- **Semantic Search**: Vector-based search with configurable similarity thresholds
- **Real-time Processing**: Background indexing with progress tracking and status monitoring
- **Modern UI**: Responsive web interface with tree navigation and live preview
- **Scalable Storage**: PostgreSQL with pgvector for efficient vector operations

## 🏗️ Architecture

### Backend Components
- **Express Server** (`server/server.ts`) - REST API and static file serving
- **Confluence Client** (`server/confluence.ts`) - Wiki API integration
- **HTML Cleaner** (`server/cleanHtml.ts`) - Content preprocessing
- **LLM Chunker** (`server/chunker/`) - Text splitting and question generation
- **Embeddings Engine** (`server/embeddings.ts`) - OpenAI vector generation
- **Database Layer** (`server/db.ts`) - PostgreSQL with pgvector operations
- **Processing Pipeline** (`server/pipeline.ts`) - Coordinated workflow execution

### Frontend Components
- **Modern UI** (`public/index.html`) - Responsive interface with CSS Grid
- **Interactive Logic** (`public/app.js`) - Full-featured JavaScript application

## 📋 Prerequisites

- **Node.js** >= 22.17
- **PostgreSQL** >= 12 with pgvector extension
- **Confluence** personal access token
- **OpenAI** API key

## 🚀 Installation

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd wiki-rag
npm install
```

### 2. Database Setup

Install PostgreSQL and the pgvector extension:

```bash
# On Ubuntu/Debian
sudo apt install postgresql postgresql-contrib
sudo apt install postgresql-14-pgvector

# On macOS with Homebrew
brew install postgresql pgvector

# On Windows
# Download PostgreSQL from https://www.postgresql.org/download/
# Install pgvector from https://github.com/pgvector/pgvector
```

Create the database:

```sql
CREATE DATABASE wiki_rag;
CREATE USER wiki_rag_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE wiki_rag TO wiki_rag_user;
```

### 3. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=3000

# Confluence Configuration
CONFLUENCE_BASE_URL=https://your-company.atlassian.net/wiki

# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# PostgreSQL Configuration
PGHOST=localhost
PGPORT=5432
PGUSER=wiki_rag_user
PGPASSWORD=your_password
PGDATABASE=wiki_rag
```

### 4. Build and Initialize

```bash
# Build the TypeScript code
npm run build

# Initialize the database (creates tables and indexes)
npm run db:migrate
```

## 🎯 Usage

### 1. Start the Server

```bash
npm start
```

The application will be available at `http://localhost:3000`

### 2. Configure Confluence Access

1. Generate a Confluence personal access token:
   - Go to your Confluence profile settings
   - Navigate to "Personal Access Tokens"
   - Create a new token with appropriate permissions

2. Enter the token in the web interface

### 3. Index Wiki Pages

1. **Load Spaces**: Click "Load Spaces" to fetch available spaces
2. **Select Space**: Choose a space from the dropdown
3. **Browse Pages**: Navigate the page tree, expand folders as needed
4. **Select Pages**: Check the pages you want to index
5. **Start Indexing**: Click "Index Selected" to begin processing

### 4. Perform Semantic Search

1. Enter your search query in the search box
2. Adjust similarity threshold (0.65 recommended)
3. Set maximum results limit
4. Click "Search" to find relevant content

## 🔧 API Endpoints

### Wiki Management
- `GET /api/wiki/spaces` - List available spaces
- `GET /api/wiki/pages?spaceKey=<key>` - Get root pages for a space
- `GET /api/wiki/children?parentId=<id>` - Get child pages
- `GET /api/wiki/page?id=<id>` - Get page content

### Indexing
- `POST /api/indexed-ids` - Check which pages are indexed
- `POST /api/index` - Start indexing selected pages
- `DELETE /api/index/:id` - Remove page from index
- `GET /api/status` - Get processing status

### Search
- `POST /api/rag/search` - Perform semantic search

Example search request:
```json
{
  "query": "How to configure authentication",
  "threshold": 0.65,
  "chunksLimit": 10
}
```

## 📊 Monitoring and Status

The application provides real-time monitoring:

- **Processing Status**: Queued, processing, completed, and error counts
- **Progress Tracking**: Visual progress bars during indexing
- **Cost Tracking**: OpenAI token usage and estimated costs
- **Error Handling**: Detailed error messages and fallback mechanisms

## ⚙️ Configuration Options

### HTML Cleaning
- Remove scripts, styles, and decorative elements
- Preserve semantic structure and links
- Configurable image handling
- Adjustable nesting levels

### Chunking Parameters
- Chunk size: 200-800 words (configurable)
- Maximum chunks per page: 50
- Semantic boundary preservation

### Question Generation
- 3-20 questions per chunk
- Multiple question types (factual, conceptual, procedural)
- Context-aware generation

### Search Settings
- Similarity threshold: 0.0-1.0
- Result limits: 1-100
- Combined chunk and question search

## 🐛 Troubleshooting

### Common Issues

**Database Connection Errors**
```bash
# Check PostgreSQL service
sudo systemctl status postgresql

# Verify pgvector installation
psql -d wiki_rag -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

**OpenAI API Errors**
- Verify API key is valid and has sufficient credits
- Check rate limits and model availability
- Monitor token usage in application logs

**Confluence Connection Issues**
- Ensure personal access token has proper permissions
- Check Confluence base URL format
- Verify network connectivity to Confluence instance

### Logs and Debugging

The application provides detailed logging:
- Server logs: All API requests and processing steps
- Database operations: Query execution and errors
- OpenAI interactions: Token usage and costs
- Processing pipeline: Step-by-step execution tracking

## 🔒 Security Considerations

- **Token Storage**: Confluence tokens stored in browser localStorage only
- **API Security**: No sensitive data logged to server
- **Database Access**: Use dedicated database user with minimal privileges
- **Environment Variables**: Keep `.env` file out of version control

## 📈 Performance Optimization

### Recommended Settings
- **Concurrency**: 3-5 parallel processing tasks
- **Rate Limiting**: 100ms delay between API calls
- **Batch Size**: 100 items per embedding request
- **Database**: Create indexes on frequently queried columns

### Scaling Considerations
- Use connection pooling for database access
- Implement caching for frequently accessed pages
- Consider horizontal scaling for large deployments
- Monitor OpenAI API costs and usage patterns

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review server logs for detailed error messages
3. Ensure all prerequisites are properly installed
4. Verify environment configuration

## 🔮 Roadmap

Future enhancements:
- [ ] Support for additional wiki platforms (MediaWiki, Notion)
- [ ] Advanced search filters and faceting
- [ ] Content summarization and insights
- [ ] Integration with other LLM providers
- [ ] Enhanced UI with dark mode and themes
- [ ] API rate limiting and quotas
- [ ] Automated content updates and synchronization
