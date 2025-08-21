import { Request, Response } from 'express';
import { processPages } from './pipeline';

// Local copy of IndexingTask to avoid circular deps (exported for reuse)
export interface IndexingTask {
  id: string;
  pageId: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  progress?: number;
}

// Shared in-memory stores for indexing state
export const indexingTasks = new Map<string, IndexingTask>();
export const taskQueue: IndexingTask[] = [];

interface HandlerDeps {
  getAuthToken: (req: Request) => string | null;
}

// Get indexing status handler
export function statusHandler (req: Request, res: Response) {
  const tasks = Array.from(indexingTasks.values());
  const status = {
    queued: tasks.filter(t => t.status === 'queued').length,
    processing: tasks.filter(t => t.status === 'processing').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    errors: tasks.filter(t => t.status === 'error').length,
    tasks: tasks.slice(-20),
  };
  res.json(status);
}

// Factory to create the base indexing handler with injected dependencies
export function createIndexHandler (deps: HandlerDeps) {
  const { getAuthToken } = deps;

  return async function indexHandler (req: Request, res: Response) {
    try {
      const token = getAuthToken(req);
      if (!token) {
        return res.status(401).json({ error: 'Authorization token required' });
      }

      const { pages } = req.body || {};
      if (!pages || !Array.isArray(pages)) {
        return res.status(400).json({ error: 'pages array required' });
      }

      // Create indexing tasks
      const taskIds: string[] = [];
      for (const page of pages) {
        if (!page?.id || !page?.spaceKey || !page?.title) {
          continue;
        }
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2)}`;
        const task: IndexingTask = { id: taskId, pageId: page.id, status: 'queued', progress: 0 };
        indexingTasks.set(taskId, task);
        taskQueue.push(task);
        taskIds.push(taskId);
      }

      // Start processing in background
      processPages(pages, token, { concurrency: 3, startDelay: 100 }, (pageId, progress) => {
        const task = Array.from(indexingTasks.values()).find(t => t.pageId === pageId);
        if (task) {
          task.status = progress.stage === 'completed' ? 'completed' : progress.stage === 'error' ? 'error' : 'processing';
          task.progress = progress.progress;
          if (progress.error) task.error = progress.error;
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
  };
}
