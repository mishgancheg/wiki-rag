import express, { Request, Response } from 'express';
import path from 'path';
import { config, validateConfig } from './config.js';
import { initializePool, closePool, getIndexedWikiIds, deleteByWikiId } from './db.js';
import { fetchSpaces, fetchPagesBySpace, fetchChildren, fetchPageHtml } from './confluence.js';
import { processPages } from './pipeline.js';
import { ragSearch } from './rag.js';
import { INTENT_DETECTOR_PROMPT, getChatRagPrompt } from './prompts.js';
import { chatCompletionRequest } from './llm/openai-chat.js';

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

// Store for tracking indexing progress
interface IndexingTask {
  id: string;
  pageId: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  progress?: number;
}

const indexingTasks = new Map<string, IndexingTask>();
const taskQueue: IndexingTask[] = [];

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

// Serve chat UI
app.get('/chat', (req: Request, res: Response) => {
  res.sendFile(path.join(publicPath, 'chat.html'));
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
app.post('/api/index', async (req: Request, res: Response) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const { pages } = req.body;

    if (!pages || !Array.isArray(pages)) {
      return res.status(400).json({ error: 'pages array required' });
    }

    // Create indexing tasks
    const taskIds: string[] = [];

    for (const page of pages) {
      if (!page.id || !page.spaceKey || !page.title) {
        continue;
      }

      const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      const task: IndexingTask = {
        id: taskId,
        pageId: page.id,
        status: 'queued',
        progress: 0,
      };

      indexingTasks.set(taskId, task);
      taskQueue.push(task);
      taskIds.push(taskId);
    }

    // Process tasks with pipeline

    // Start processing in background
    processPages(pages, token, {
      concurrency: 3,
      startDelay: 100,
    }, (pageId, progress) => {
      // Update task status
      const task = Array.from(indexingTasks.values()).find(t => t.pageId === pageId);
      if (task) {
        task.status = progress.stage === 'completed' ? 'completed' :
          progress.stage === 'error' ? 'error' : 'processing';
        task.progress = progress.progress;
        if (progress.error) {
          task.error = progress.error;
        }
      }
    }).catch(error => {
      console.error('Background processing error:', error);
    });

    res.json({
      message: 'Indexing started',
      taskIds,
      queuedCount: taskIds.length,
    });
  } catch (error) {
    console.error('Error starting indexing:', error);
    res.status(500).json({ error: 'Failed to start indexing' });
  }
});

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
app.get('/api/status', (req: Request, res: Response) => {
  const tasks = Array.from(indexingTasks.values());

  const status = {
    queued: tasks.filter(t => t.status === 'queued').length,
    processing: tasks.filter(t => t.status === 'processing').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    errors: tasks.filter(t => t.status === 'error').length,
    tasks: tasks.slice(-20), // Return last 20 tasks for monitoring
  };

  res.json(status);
});

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
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const MAX_USED_MESSAGES_FROM_HISTORY = 10;

    const { messages = [], threshold = 0.65, chunksLimit = 6 } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    // Keep only last 10 messages for safety
    const recent = messages.slice(-MAX_USED_MESSAGES_FROM_HISTORY);

    // Create plain text history for intent detection
    const messageHistory = recent
      .map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content.replace(/\n{2,}/g, '\n') : ''}`)
      .join('\n\n');

    // Intent detection with structured output
    const intentSchema = {
      name: 'intent_schema',
      schema: {
        type: 'object',
        required: ['shortIntent'],
        properties: {
          shortIntent: {
            type: 'string',
            description: 'Краткое изложение последнего намерения клиента от 1-го лица. Но без начальной фразы типа "я хочу", "мне надо". Только суть вопроса или желания',
          },
        },
        additionalProperties: false,
      },
    } as any;

    const intentPrompt = INTENT_DETECTOR_PROMPT.replace('{{messageHistory}}', messageHistory);

    const intentResp = await chatCompletionRequest<{ shortIntent: string }>({
      model: config.modelForQuestions,
      messages: [
        { role: 'system', content: intentPrompt },
      ],
      response_format: { type: 'json_schema', json_schema: intentSchema },
      temperature: 0,
    });
    // TODO вынеси код детекции намерения в отдельную функцию
    const detected = (intentResp as any).resultJson as { shortIntent?: string } | undefined;
    const lastUserMsg = [...recent].reverse().find((m: any) => m.role === 'user');
    const query = detected?.shortIntent || lastUserMsg?.content || '';

    // RAG search using detected intent or last user message
    const rag = await ragSearch({ query, threshold, chunksLimit });

    // Prepare chunks text for prompt
    const chunksText = rag.results
      .map((r, idx) => `============\n${r.chunk}\n\n`)
      .join('\n\n');

    const dialogPlain = recent.map((m: any) => `${m.role}: ${m.content.replace(/\n{2,}/g, '\n')}`).join('\n\n');

    const systemPrompt = getChatRagPrompt()
      .replace('{{chunks}}', chunksText || '[нет релевантных фрагментов]');

    // Compose final chat messages (system + original history to preserve roles)
    const finalMessages = [
      { role: 'system', content: systemPrompt },
      ...recent,
    ];

    const answerResp = await chatCompletionRequest({
      model: config.modelForQuestions,
      messages: finalMessages,
      temperature: 0.3,
      max_tokens: 10000,
    });

    const reply = answerResp?.choices?.[0]?.message?.content || '';

    res.json({
      ok: true,
      shortIntent: query,
      reply,
      sources: rag.results.map(r => ({ chunk_id: r.chunk_id, wiki_id: r.wiki_id, similarity: r.similarity })),
    });
  } catch (error) {
    console.error('Error in chat handler:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

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
Health: http://localhost:${config.port}/api/health

Environment:
- Confluence: ${config.confluenceBaseUrl}
- Model for Chunks: ${config.modelForChunks}
- Model for Questions: ${config.modelForQuestions}
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

export { app, indexingTasks, taskQueue };
