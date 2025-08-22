# Wiki-RAG: Enhanced Confluence Search with Question-Augmented Retrieval

A powerful standalone application for indexing Confluence wiki pages and performing intelligent semantic search using an advanced RAG (Retrieval-Augmented Generation) implementation with automatic question generation for superior search accuracy.

## 🚀 Key Features

### Enhanced RAG Technology
- **Question-Augmented Indexing**: Our extended RAG implementation automatically generates multiple relevant questions for each content chunk, creating a richer search index that significantly improves search result accuracy and relevance
- **Dual-Vector Search**: Searches both original content and generated questions simultaneously, capturing user intent more effectively than traditional text-only approaches
- **Intelligent Question Generation**: Uses advanced LLM prompting to create diverse question types (factual, conceptual, procedural) that users might ask about the content

### Core Capabilities
- **Confluence Integration**: Seamless connection to any Confluence instance using personal access tokens
- **Smart Content Processing**: Automatically cleans HTML, chunks content optimally, and generates contextual questions
- **Semantic Vector Search**: Advanced similarity-based search with configurable thresholds and result limits
- **Real-time Processing**: Background indexing with live progress tracking and comprehensive status monitoring
- **Modern Web Interface**: Responsive UI with intuitive tree navigation and live content preview
- **Enterprise-Grade Storage**: PostgreSQL with pgvector extension for high-performance vector operations

## 🏗️ System Architecture

### Backend Components
- **Express API Server** (`server/server.ts`) - RESTful API and static content serving
- **Confluence Client** (`server/api/`) - Robust wiki API integration with error handling
- **HTML Content Processor** (`server/lib/`) - Intelligent content cleaning and preprocessing
- **Enhanced Chunking System** (`server/chunker/`) - Smart text segmentation with question generation
- **Question Generation Engine** (`server/chunker/questions.ts`) - LLM-powered question creation for improved searchability
- **Vector Embeddings Engine** (`server/lib/`) - OpenAI-powered vector generation and management
- **Database Layer** (`server/lib/`) - Optimized PostgreSQL operations with pgvector support
- **Processing Pipeline** (`server/controllers/`) - Coordinated workflow execution with monitoring

### Frontend Components
- **Responsive Web UI** (`public/index.html`) - Modern interface built with CSS Grid and Flexbox
- **Interactive Application** (`public/app.js`) - Full-featured JavaScript client with real-time updates

## 📋 Prerequisites

- **Node.js** >= 22.17
- **PostgreSQL** >= 12 with pgvector extension
- **Confluence** personal access token with appropriate permissions
- **OpenAI** API key with sufficient credits

## 🚀 Installation (Linux)

### 1. Clone Repository and Install Dependencies

```bash
git clone <repository-url>
cd wiki-rag
npm install
```

### 2. Database Setup

Install PostgreSQL and pgvector extension on Ubuntu/Debian:

```bash
# Update package list
sudo apt update

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Install pgvector extension
sudo apt install postgresql-17-pgvector

# Start and enable PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

For other Linux distributions:

```bash
# Fedora/CentOS/RHEL
sudo dnf install postgresql postgresql-server postgresql-contrib
sudo dnf install pgvector

# Arch Linux
sudo pacman -S postgresql postgresql-contrib
yay -S pgvector
```

Create the database and user:

```bash
# Switch to postgres user
sudo -u postgres psql

# In PostgreSQL shell:
CREATE DATABASE wiki_rag;
CREATE USER wiki_rag_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE wiki_rag TO wiki_rag_user;
\q
```

Enable pgvector extension:

```bash
sudo -u postgres psql -d wiki_rag -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 3. Environment Configuration

Copy and configure environment variables:

```bash
cp .env.example .env
nano .env  # or use your preferred editor
```

Configure `.env` file:

```env
# Server Configuration
PORT=3000

# Confluence Configuration
CONFLUENCE_BASE_URL=https://your-company.atlassian.net/wiki

# OpenAI Configuration (for enhanced RAG with questions)
OPENAI_API_KEY=sk-your-openai-api-key-here
MODEL_FOR_CHUNKS=gpt-4o-mini
MODEL_FOR_QUESTIONS=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# PostgreSQL Configuration
PGHOST=localhost
PGPORT=5432
PGUSER=wiki_rag_user
PGPASSWORD=your_secure_password
PGDATABASE=wiki_rag
```

### 4. Build and Initialize

```bash
# Build TypeScript code
npm run build

# Initialize database schema and indexes
npm run db:migrate
```

## 🎯 Usage

### 1. Start the Application

```bash
npm start
```

The application will be available at `http://localhost:3000`

### 2. Configure Confluence Access

1. **Generate Personal Access Token**:
   - Navigate to your Confluence profile settings
   - Go to "Personal Access Tokens" section
   - Create a new token with read permissions for spaces and pages

2. **Enter Token**: Provide the token in the web interface when prompted

### 3. Index Wiki Content

1. **Load Available Spaces**: Click "Load Spaces" to fetch your accessible spaces
2. **Select Target Space**: Choose a space from the dropdown menu
3. **Browse Content Tree**: Navigate through the hierarchical page structure
4. **Select Pages for Indexing**: Check the pages you want to include in your search index
5. **Start Enhanced Indexing**: Click "Index Selected" to begin the advanced RAG processing

The system will:
- Clean and chunk your content optimally
- Generate relevant questions for each content chunk using LLM
- Create vector embeddings for both content and questions
- Store everything in the optimized database structure

### 4. Perform Advanced Semantic Search

1. **Enter Search Query**: Type your question or keywords in the search box
2. **Configure Search Parameters**:
   - **Similarity Threshold**: 0.65 recommended for balanced precision/recall
   - **Result Limit**: Set maximum number of results to return
3. **Execute Search**: Click "Search" to find relevant content

The enhanced RAG system searches both original content and generated questions, providing more accurate and comprehensive results than traditional keyword-based search.

## 🔧 API Reference

### Wiki Management Endpoints
- `GET /api/wiki/spaces` - Retrieve available Confluence spaces
- `GET /api/wiki/pages?spaceKey=<key>` - Get root pages for specified space
- `GET /api/wiki/children?parentId=<id>` - Fetch child pages for given parent
- `GET /api/wiki/page?id=<id>` - Retrieve complete page content

### Enhanced Indexing Endpoints
- `POST /api/indexed-ids` - Check indexing status of specified pages
- `POST /api/index` - Start enhanced RAG indexing for selected pages
- `DELETE /api/index/:id` - Remove page from search index
- `GET /api/status` - Get real-time processing status and statistics

### Advanced Search Endpoint
- `POST /api/rag/search` - Perform semantic search with question-augmented retrieval

Example search request:
```json
{
  "query": "How to configure user authentication and permissions?",
  "threshold": 0.65,
  "chunksLimit": 15
}
```

## 📊 Monitoring and Analytics

The application provides comprehensive monitoring:

- **Real-time Processing Status**: Queue depth, active processing, completion rates, error tracking
- **Progress Visualization**: Dynamic progress bars during indexing operations
- **Cost Analytics**: OpenAI token usage tracking and cost estimation
- **Performance Metrics**: Processing times, throughput statistics
- **Error Management**: Detailed error logging with automatic fallback mechanisms

## ⚙️ Advanced Configuration

### Enhanced RAG Settings

**Question Generation Parameters**:
- Questions per chunk: 3-20 (automatically adjusted based on content length)
- Question types: Factual, conceptual, procedural, and contextual
- Generation temperature: 0.3 for consistent, relevant questions
- Minimum question length: 10 characters

**Search Configuration**:
- Similarity threshold range: 0.0-1.0 (0.65 recommended)
- Result limits: 1-100 results
- Combined content + question vector search
- Configurable result ranking algorithms

### HTML Processing Options
- Script and style element removal
- Semantic structure preservation
- Link and reference handling
- Configurable nesting depth limits
- Image and media content processing

## 🛠️ Development

### Development Mode

```bash
# Start in development mode with auto-reload
npm run dev

# Run mock wiki server for testing
npm run mock:wiki
```


## 🐛 Troubleshooting

### Database Issues

**PostgreSQL Connection Problems**:
```bash
# Check PostgreSQL service status
sudo systemctl status postgresql

# Restart if needed
sudo systemctl restart postgresql

# Verify pgvector installation
sudo -u postgres psql -d wiki_rag -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

**Database Performance Optimization**:
```bash
# Create additional indexes for better performance
sudo -u postgres psql -d wiki_rag -c "CREATE INDEX CONCURRENTLY idx_embeddings_similarity ON chunks USING ivfflat (embedding vector_cosine_ops);"
```

### OpenAI API Issues

**Authentication and Rate Limiting**:
- Verify API key validity and credit availability
- Monitor rate limits in application logs
- Check model availability and pricing
- Configure appropriate retry mechanisms

**Network Connectivity (Corporate Environments)**:
```bash
# If behind corporate proxy, configure certificates
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem

# Set proxy if required
export HTTPS_PROXY=http://proxy.company.com:8080
export HTTP_PROXY=http://proxy.company.com:8080

# For testing only - disable SSL verification (not recommended for production)
# echo "IGNORE_SSL_ERRORS=true" >> .env
```

### Confluence Connection Issues

**Authentication Problems**:
- Ensure personal access token has appropriate read permissions
- Verify Confluence base URL format (include `/wiki` if needed)
- Test network connectivity to Confluence instance
- Check for IP restrictions or security policies

### Performance Optimization

**System Resource Management**:
```bash
# Monitor system resources
htop
iostat 1
df -h

# Optimize PostgreSQL settings
sudo nano /etc/postgresql/14/main/postgresql.conf
# Increase shared_buffers, work_mem, maintenance_work_mem
```

**Application Tuning**:
- Adjust concurrency settings (recommended: 3-5 parallel tasks)
- Configure rate limiting (100ms delay between API calls)
- Optimize batch sizes (100 items per embedding request)
- Enable connection pooling for database access

## 🔒 Security Best Practices

### Access Control
- **Token Management**: Confluence tokens stored securely in browser localStorage only
- **API Security**: Sensitive data never logged to server console
- **Database Security**: Use dedicated database user with minimal required privileges
- **Environment Security**: Keep `.env` file out of version control, use secure passwords

### Network Security
```bash
# Configure firewall (UFW on Ubuntu)
sudo ufw allow 3000/tcp  # Application port
sudo ufw allow 5432/tcp  # PostgreSQL (if needed for remote access)
sudo ufw enable

# Use reverse proxy for production (Nginx example)
sudo apt install nginx
# Configure SSL/TLS certificates with Let's Encrypt
sudo apt install certbot python3-certbot-nginx
```

## 🚀 Production Deployment

### System Service Setup

Create systemd service:

```bash
sudo nano /etc/systemd/system/wiki-rag.service
```

```ini
[Unit]
Description=Wiki-RAG Enhanced Search Service
After=network.target postgresql.service

[Service]
Type=simple
User=wiki-rag
WorkingDirectory=/opt/wiki-rag
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable wiki-rag
sudo systemctl start wiki-rag
```

### Performance Monitoring

```bash
# Install monitoring tools
sudo apt install htop iotop nethogs

# Monitor application logs
sudo journalctl -u wiki-rag -f

# Database performance monitoring
sudo -u postgres psql -d wiki_rag -c "SELECT * FROM pg_stat_activity;"
```

## 🤝 Contributing

1. Fork the repository on GitHub
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request with detailed description

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for complete details.

## 🆘 Support

For technical support and questions:

1. **Check Documentation**: Review this README and inline code documentation
2. **Examine Logs**: Check application logs for detailed error messages
3. **Verify Setup**: Ensure all prerequisites are correctly installed and configured
4. **Community Support**: Create GitHub issues for bugs and feature requests

## 🔮 Roadmap

Planned enhancements:

- [ ] **Multi-Platform Support**: MediaWiki, Notion, and other wiki platform integrations
- [ ] **Advanced Search Features**: Filters, faceting, and search result clustering
- [ ] **Content Intelligence**: Automated summarization and insight generation
- [ ] **LLM Provider Flexibility**: Support for Anthropic Claude, local models, and other providers
- [ ] **Enhanced UI/UX**: Dark mode, themes, and accessibility improvements
- [ ] **Enterprise Features**: API rate limiting, user quotas, and admin dashboard
- [ ] **Real-time Sync**: Automated content updates and change detection
- [ ] **Advanced Analytics**: Search analytics, content popularity, and usage insights

---

*This enhanced Wiki-RAG implementation leverages cutting-edge question-augmented retrieval technology to provide superior search accuracy and user experience compared to traditional text-only search systems.*