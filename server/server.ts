import express, { Request, Response } from 'express';
import path from 'path';
import { config, validateConfig } from './config.js';
import { initializePool, closePool, getIndexedWikiIds, deleteByWikiId } from './db.js';
import { fetchSpaces, fetchPagesBySpace, fetchChildren, fetchPageHtml } from './confluence.js';
import { ragSearch } from './api/rag';
import { handleChatRequest } from './api/chat';
import swaggerUi from 'swagger-ui-express';
import { createIndexDescendantsHandler } from './api/indexing/index-descendants';
import { createIndexHandler, statusHandler } from './api/indexing';

// Validate configuration on startup
validateConfig();

// Initialize Express app
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));

// Swagger UI served at /docs using generated spec at /public/swagger.json
app.use('/docs', swaggerUi.serve, swaggerUi.setup(undefined, {
  swaggerUrl: '/swagger.json',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    filter: true,
    showExtensions: true,
  },
}));

// Helper to get Authorization header (Confluence token)
function getAuthToken (req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.substring(7);
}

// Routes

// Serve main UI
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});


// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Wiki API endpoints
app.get('/api/wiki/spaces', async (req: Request, res: Response) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const spaces = await fetchSpaces(token);
    res.json(spaces);
  } catch (error) {
    console.error('Error fetching spaces:', error);
    res.status(500).json({ error: 'Failed to fetch spaces' });
  }
});

app.get('/api/wiki/pages', async (req: Request, res: Response) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const { spaceKey } = req.query;
    if (!spaceKey) {
      return res.status(400).json({ error: 'spaceKey parameter required' });
    }

    const pages = await fetchPagesBySpace(token, spaceKey as string);
    res.json(pages);
  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

app.get('/api/wiki/children', async (req: Request, res: Response) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const { parentId } = req.query;
    if (!parentId) {
      return res.status(400).json({ error: 'parentId parameter required' });
    }

    const children = await fetchChildren(token, parentId as string);
    res.json(children);
  } catch (error) {
    console.error('Error fetching children:', error);
    res.status(500).json({ error: 'Failed to fetch children' });
  }
});

app.get('/api/wiki/page', async (req: Request, res: Response) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'id parameter required' });
    }

    const pageContent = await fetchPageHtml(token, id as string);
    res.json({ title: pageContent.title, html: pageContent.html });
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

// Check indexed pages
app.post('/api/indexed-ids', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids array required' });
    }

    const indexedIds = await getIndexedWikiIds(ids);
    res.json(indexedIds);
  } catch (error) {
    console.error('Error checking indexed IDs:', error);
    res.status(500).json({ error: 'Failed to check indexed IDs' });
  }
});

// Indexing endpoints
app.post('/api/index', createIndexHandler({ getAuthToken }));

app.post('/api/index/descendants', createIndexDescendantsHandler({ getAuthToken }));

app.delete('/api/index/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Page ID required' });
    }

    await deleteByWikiId(id);

    res.json({
      message: 'Page deindexed successfully',
      pageId: id,
    });
  } catch (error) {
    console.error('Error removing index:', error);
    res.status(500).json({ error: 'Failed to remove index' });
  }
});

// Get indexing status
app.get('/api/status', statusHandler);

// RAG search endpoint
app.post('/api/rag/search', async (req: Request, res: Response) => {
  try {
    const { query, threshold = 0.65, chunksLimit = 10 } = req.body;
    const result = await ragSearch({ query, threshold, chunksLimit });
    res.json(result);
  } catch (error) {
    console.error('Error in RAG search:', error);
    res.status(400).json({ error: (error as Error).message || 'Failed to perform search' });
  }
});

// Chat endpoint: intent -> rag -> answer
app.post('/api/chat', handleChatRequest);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
async function startServer () {
  try {
    // Initialize database connection
    initializePool();
    console.log('Database connection initialized');

    // Start HTTP server
    const server = app.listen(config.port, () => {
      console.log(`
🚀 Wiki-RAG Server is running!

Server: http://localhost:${config.port}

Environment:
- Confluence: ${config.confluenceBaseUrl}
- Model for Chunks: ${config.modelForChunks}
- Model for Questions: ${config.modelForQuestions}
- Model for Chat: ${config.modelForChat}
- Database: ${config.pgHost}:${config.pgPort}/${config.pgDatabase}
      `);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('Received SIGTERM, shutting down gracefully');
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.log('Received SIGINT, shutting down gracefully');
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export { app };
