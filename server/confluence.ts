import https from 'https';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config } from './config.js';

// Confluence API client
export class ConfluenceClient {
  private axiosInstance: AxiosInstance;

  constructor (token: string) {
    const axiosConfig: any = {
      baseURL: config.confluenceBaseUrl,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };

    // Если включено игнорирование SSL ошибок
    if (process.env.IGNORE_SSL_ERRORS === 'true') {
      axiosConfig.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }

    this.axiosInstance = axios.create(axiosConfig);


    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        console.log(`[Confluence API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error),
    );

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('[Confluence API Error]:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          data: error.response?.data,
        });
        return Promise.reject(error);
      },
    );
  }

  // Get all spaces
  async getSpaces (): Promise<ConfluenceSpace[]> {
    try {
      const response = await this.axiosInstance.get('/rest/api/space', {
        params: {
          start: 0,
          limit: 1000,
        },
      });

      return response.data.results
        .filter((space: any) => space.type === 'global')
        .map((space: any) => ({
          key: space.key,
          name: space.name,
          type: space.type,
          description: space.description?.plain?.value || '',
        }));
    } catch (error) {
      console.error('Error fetching spaces:', error);
      throw new Error('Failed to fetch Confluence spaces');
    }
  }

  // Get root pages for a space
  async getSpacePages (spaceKey: string): Promise<ConfluencePage[]> {
    try {
      const response = await this.axiosInstance.get('/rest/api/content', {
        params: {
          spaceKey,
          type: 'page',
          expand: 'ancestors,children.page',
          start: 0,
          limit: 1000,
        },
      });

      // Filter for root pages (no ancestors)
      const rootPages = response.data.results.filter((page: any) =>
        !page.ancestors || page.ancestors.length === 0,
      );

      return rootPages.map((page: any) => ({
        id: page.id,
        title: page.title,
        type: page.type,
        status: page.status,
        hasChildren: page.children?.page?.size > 0,
        spaceKey: spaceKey,
      }));
    } catch (error) {
      console.error('Error fetching space pages:', error);
      throw new Error(`Failed to fetch pages for space ${spaceKey}`);
    }
  }

  // Get child pages for a parent page
  async getChildPages (parentId: string): Promise<ConfluencePage[]> {
    try {
      const response = await this.axiosInstance.get(`/rest/api/content/${parentId}/child/page`, {
        params: {
          start: 0,
          limit: 1000,
          expand: 'children.page',
        },
      });

      return response.data.results.map((page: any) => ({
        id: page.id,
        title: page.title,
        type: page.type,
        status: page.status,
        hasChildren: page.children?.page?.size > 0,
        parentId: parentId,
      }));
    } catch (error) {
      console.error('Error fetching child pages:', error);
      throw new Error(`Failed to fetch child pages for ${parentId}`);
    }
  }

  // Get page content with HTML
  async getPageContent (pageId: string): Promise<ConfluencePageContent> {
    try {
      const response = await this.axiosInstance.get(`/rest/api/content/${pageId}`, {
        params: {
          expand: 'body.view,space,ancestors',
        },
      });

      const page = response.data;
      let html = page.body?.view?.value || '';

      // Normalize relative URLs to absolute URLs
      html = this.normalizeUrls(html);

      // Try to embed base64 images (optional, may be heavy)
      // html = await this.embedImages(html);

      return {
        id: page.id,
        title: page.title,
        html: html,
        spaceKey: page.space?.key || '',
        spaceName: page.space?.name || '',
        url: `${config.confluenceBaseUrl}/pages/viewpage.action?pageId=${page.id}`,
        lastModified: page.version?.when || '',
        version: page.version?.number || 1,
      };
    } catch (error) {
      console.error('Error fetching page content:', error);
      throw new Error(`Failed to fetch content for page ${pageId}`);
    }
  }

  // Normalize relative URLs to absolute URLs
  private normalizeUrls (html: string): string {
    const baseUrl = config.confluenceBaseUrl;

    // Replace relative src attributes
    html = html.replace(/src="\/([^"]*)/g, `src="${baseUrl}/$1`);

    // Replace relative href attributes
    html = html.replace(/href="\/([^"]*)/g, `href="${baseUrl}/$1`);

    // Handle protocol-relative URLs
    html = html.replace(/src="\/\/([^"]*)/g, 'src="https://$1');
    html = html.replace(/href="\/\/([^"]*)/g, 'href="https://$1');

    return html;
  }

  // Optional: Embed images as base64 (can be heavy, use with caution)
  private async embedImages (html: string): Promise<string> {
    const imgRegex = /<img[^>]+src="([^"]*)"[^>]*>/g;
    const images = [...html.matchAll(imgRegex)];

    for (const imgMatch of images) {
      try {
        const imgUrl = imgMatch[1];

        // Skip if already base64 or external
        if (imgUrl.startsWith('data:') || !imgUrl.includes(config.confluenceBaseUrl)) {
          continue;
        }

        // Fetch image
        const response = await this.axiosInstance.get(imgUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
        });

        const contentType = response.headers['content-type'] || 'image/png';
        const buffer = Buffer.from(response.data);
        const base64 = buffer.toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;

        // Replace in HTML
        html = html.replace(imgUrl, dataUrl);
      } catch (error) {
        console.warn(`Failed to embed image ${imgMatch[1]}:`, error);
        // Continue with original URL
      }
    }

    return html;
  }

  // Test connection and token validity
  async testConnection (): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/rest/api/user/current');
      console.log(`[Confluence] Connected as: ${response.data.displayName} (${response.data.email})`);
      return true;
    } catch (error) {
      console.error('[Confluence] Connection test failed:', error);
      return false;
    }
  }

  // Get descendants (all child pages recursively)
  async getDescendants (pageId: string, maxDepth: number = 10): Promise<ConfluencePage[]> {
    const descendants: ConfluencePage[] = [];
    const visited = new Set<string>();

    const fetchRecursive = async (parentId: string, depth: number): Promise<void> => {
      if (depth >= maxDepth || visited.has(parentId)) {
        return;
      }

      visited.add(parentId);

      try {
        const children = await this.getChildPages(parentId);
        descendants.push(...children);

        // Recursively fetch children of children
        for (const child of children) {
          await fetchRecursive(child.id, depth + 1);
        }
      } catch (error) {
        console.warn(`Failed to fetch descendants of ${parentId}:`, error);
      }
    };

    await fetchRecursive(pageId, 0);
    return descendants;
  }
}

// Type definitions
export interface ConfluenceSpace {
  key: string;
  name: string;
  type?: string;
  description?: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  type?: string;
  status?: string;
  hasChildren: boolean;
  spaceKey?: string;
  parentId?: string;
}

export interface ConfluencePageContent {
  id: string;
  title: string;
  html: string;
  spaceKey: string;
  spaceName: string;
  url: string;
  lastModified: string;
  version: number;
}

// Helper functions for server.ts integration
export async function fetchSpaces (token: string): Promise<ConfluenceSpace[]> {
  const client = new ConfluenceClient(token);
  return client.getSpaces();
}

export async function fetchPagesBySpace (token: string, spaceKey: string): Promise<ConfluencePage[]> {
  const client = new ConfluenceClient(token);
  return client.getSpacePages(spaceKey);
}

export async function fetchChildren (token: string, parentId: string): Promise<ConfluencePage[]> {
  const client = new ConfluenceClient(token);
  return client.getChildPages(parentId);
}

export async function fetchPageHtml (token: string, pageId: string): Promise<ConfluencePageContent> {
  const client = new ConfluenceClient(token);
  return client.getPageContent(pageId);
}

export async function validateToken (token: string): Promise<boolean> {
  const client = new ConfluenceClient(token);
  return client.testConnection();
}
