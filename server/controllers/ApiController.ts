import 'reflect-metadata';
import { Controller, Route, Tags, Get, Post, Delete, Query, Body, SuccessResponse, Security } from 'tsoa';

// Shared models to document request/response shapes
export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

export interface WikiSpace {
  id: string;
  key: string;
  name: string;
}

export interface WikiPageItem {
  id: string;
  spaceKey: string;
  title: string;
  url?: string;
}

export interface PageHtmlResponse {
  title: string;
  html: string;
}

export interface IndexedIdsRequest {
  ids: string[];
}

export interface IndexPagesRequestPage {
  id: string;
  spaceKey: string;
  title: string;
}

export interface IndexPagesRequest {
  pages: IndexPagesRequestPage[];
}

export interface IndexStartResponse {
  message: string;
  taskIds: string[];
  queuedCount: number;
}

export interface DeleteIndexResponse {
  message: string;
  pageId: string;
}

export interface StatusTaskItem {
  id: string;
  pageId: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  progress?: number;
}

export interface QueueStatus {
  queued: number;
  processing: number;
  completed: number;
  errors: number;
  tasks: StatusTaskItem[];
}

export interface RagSearchRequest {
  query: string;
  threshold?: number;
  chunksLimit?: number;
}

export interface RagSearchChunk {
  wiki_id: string;
  content: string;
  similarity: number;
}

export interface RagSearchResponse {
  matches: RagSearchChunk[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  threshold?: number;
  chunksLimit?: number;
}

export interface ChatResponse {
  reply: string;
  sources?: RagSearchChunk[];
}

@Route('api')
export class ApiController extends Controller {
  /** Health check */
  @Get('health')
  @Tags('Health')
  public async health(): Promise<HealthResponse> {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Get spaces (requires Authorization: Bearer token) */
  @Get('wiki/spaces')
  @Tags('Wiki')
  @Security('bearerAuth')
  public async getSpaces(): Promise<WikiSpace[]> {
    return [];
  }

  /** Get pages list by space key */
  @Get('wiki/pages')
  @Tags('Wiki')
  @Security('bearerAuth')
  public async getPages(@Query() spaceKey: string): Promise<WikiPageItem[]> {
    return [];
  }

  /** Get children by parentId */
  @Get('wiki/children')
  @Tags('Wiki')
  @Security('bearerAuth')
  public async getChildren(@Query() parentId: string): Promise<WikiPageItem[]> {
    return [];
  }

  /** Get page HTML by id */
  @Get('wiki/page')
  @Tags('Wiki')
  @Security('bearerAuth')
  public async getPage(@Query() id: string): Promise<PageHtmlResponse> {
    return { title: '', html: '' };
  }

  /** Check which IDs are already indexed */
  @Post('indexed-ids')
  @Tags('Indexing')
  public async getIndexedIds(@Body() body: IndexedIdsRequest): Promise<string[]> {
    return [];
  }

  /** Start indexing of provided pages */
  @Post('index')
  @Tags('Indexing')
  @Security('bearerAuth')
  @SuccessResponse('200', 'Indexing started')
  public async startIndexing(@Body() body: IndexPagesRequest): Promise<IndexStartResponse> {
    return { message: 'Indexing started', taskIds: [], queuedCount: 0 };
  }

  /** Remove page from index */
  @Delete('index/{id}')
  @Tags('Indexing')
  public async deleteIndex(id: string): Promise<DeleteIndexResponse> {
    return { message: 'Page deindexed successfully', pageId: id };
  }

  /** Get queue/status */
  @Get('status')
  @Tags('Indexing')
  public async status(): Promise<QueueStatus> {
    return { queued: 0, processing: 0, completed: 0, errors: 0, tasks: [] };
  }

  /** Vector search */
  @Post('rag/search')
  @Tags('RAG')
  public async ragSearch(@Body() body: RagSearchRequest): Promise<RagSearchResponse> {
    return { matches: [] };
  }

  /** Chat: intent -> rag -> answer */
  @Post('chat')
  @Tags('Chat')
  public async chat(@Body() body: ChatRequest): Promise<ChatResponse> {
    return { reply: '' };
  }
}
