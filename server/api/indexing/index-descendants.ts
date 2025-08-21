import { Request, Response } from 'express';
import { fetchDescendants } from '../../lib/confluence';
import { processPages } from './pipeline';
import { IndexingTask, indexingTasks, taskQueue } from './index';

interface HandlerDeps {
  getAuthToken: (req: Request) => string | null;
}

// Factory to create the descendants indexing handler with injected dependencies
export function createIndexDescendantsHandler (deps: HandlerDeps) {
  const { getAuthToken } = deps;

  return async function indexDescendantsHandler (req: Request, res: Response) {
    try {
      const token = getAuthToken(req);
      if (!token) {
        return res.status(401).json({ error: 'Authorization token required' });
      }

      const { roots, maxDepth = 10 } = req.body || {};
      if (!roots || !Array.isArray(roots) || roots.length === 0) {
        return res.status(400).json({ error: 'roots array required' });
      }

      // Collect descendant pages for each root
      const pagesToIndex: { id: string; title: string; spaceKey: string }[] = [];
      const seen = new Set<string>();

      for (const root of roots) {
        if (!root?.id || !root?.spaceKey || !root?.title) continue;
        // Include the root itself as well
        if (!seen.has(root.id)) {
          seen.add(root.id);
          pagesToIndex.push({ id: root.id, title: root.title, spaceKey: root.spaceKey });
        }

        try {
          const descendants = await fetchDescendants(token, root.id, maxDepth);
          for (const d of descendants) {
            if (!seen.has(d.id)) {
              seen.add(d.id);
              pagesToIndex.push({ id: d.id, title: d.title, spaceKey: root.spaceKey });
            }
          }
        } catch (e) {
          console.warn(`Failed to fetch descendants for ${root.id}:`, e);
        }
      }

      if (pagesToIndex.length === 0) {
        return res.status(400).json({ error: 'No pages to index' });
      }

      // Prepare tasks similarly to /api/index
      const taskIds: string[] = [];
      for (const page of pagesToIndex) {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2)}`;
        const task: IndexingTask = { id: taskId, pageId: page.id, status: 'queued', progress: 0 };
        indexingTasks.set(taskId, task);
        taskQueue.push(task);
        taskIds.push(taskId);
      }

      // Start processing in background
      processPages(pagesToIndex, token, { startDelay: 5 }, (pageId, progress) => {
        const task = Array.from(indexingTasks.values()).find(t => t.pageId === pageId);
        if (task) {
          task.status = progress.stage === 'completed' ? 'completed' : progress.stage === 'error' ? 'error' : 'processing';
          task.progress = progress.progress;
          if (progress.error) task.error = progress.error;
        }
      }).catch(error => {
        console.error('Background processing error (descendants):', error);
      });

      res.json({
        message: 'Indexing descendants started',
        taskIds,
        queuedCount: taskIds.length,
        pagesCount: pagesToIndex.length,
      });
    } catch (error) {
      console.error('Error starting indexing descendants:', error);
      res.status(500).json({ error: 'Failed to start indexing descendants' });
    }
  };
}
