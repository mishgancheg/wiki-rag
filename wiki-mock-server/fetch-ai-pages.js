#!/usr/bin/env node
/**
 * Fetch all pages from Confluence space with key "AI" and save to
 * wiki-mock-server/AI/pages/<pageId>.html
 *
 * Vanilla JS (Node) script using axios. Reads configuration from environment:
 * - CONFLUENCE_BASE_URL (required)
 * - One of:
 *     - WIKI_TOKEN or CONFLUENCE_TOKEN (Bearer token)
 *     - CONFLUENCE_EMAIL + CONFLUENCE_API_TOKEN (Basic auth)
 * - IGNORE_SSL_ERRORS=true to skip TLS verification (useful for self-signed certs)
 *
 * Usage:
 *   node wiki-mock-server/fetch-ai-pages.js [SPACE_KEY]
 *   SPACE_KEY defaults to "AI".
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const dotenv = require('dotenv');

// Load .env if present
dotenv.config();

const SPACE_KEY = process.argv[2] || 'AI';
const BASE_URL = process.env.CONFLUENCE_BASE_URL;

if (!BASE_URL) {
  console.error('ERROR: CONFLUENCE_BASE_URL is not set in environment (.env)');
  process.exit(1);
}

// Auth: prefer Bearer token, else Basic with email + api token
const BEARER_TOKEN = process.env.WIKI_TOKEN || process.env.CONFLUENCE_TOKEN || process.env.CONFLUENCE_API_TOKEN;

let authHeader = undefined;
if (BEARER_TOKEN) {
  authHeader = { Authorization: `Bearer ${BEARER_TOKEN}` };
} else {
  console.warn('WARNING: No authentication provided. Requests will be sent without Authorization header.');
}

const httpsAgent = process.env.IGNORE_SSL_ERRORS === 'true'
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(authHeader || {}),
  },
  httpsAgent,
});

// Simple logger
function log(msg) { console.log(`[fetch-ai-pages] ${msg}`); }
function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

async function pagedGet(url, params = {}, itemsPath = 'results') {
  const all = [];
  let start = 0;
  const limit = 1000;
  while (true) {
    const resp = await api.get(url, { params: { ...params, start, limit } });
    const data = resp.data || {};
    const items = Array.isArray(data[itemsPath]) ? data[itemsPath] : (data.results || []);
    all.push(...items);
    const size = items.length;
    if (size < limit) break;
    start += limit;
    // be polite
    await delay(50);
  }
  return all;
}

async function getSpaces() {
  const spaces = await pagedGet('/rest/api/space');
  return spaces.map(s => ({ key: s.key, name: s.name }));
}

async function getRootPages(spaceKey) {
  const results = await pagedGet('/rest/api/content', { spaceKey, type: 'page', expand: 'ancestors' });
  const roots = results.filter(p => !p.ancestors || p.ancestors.length === 0);
  return roots.map(p => ({ id: String(p.id), title: p.title }));
}

async function getChildren(parentId) {
  const results = await pagedGet(`/rest/api/content/${parentId}/child/page`);
  return results.map(p => ({ id: String(p.id), title: p.title }));
}

async function getPageHtml(pageId) {
  const resp = await api.get(`/rest/api/content/${pageId}`, { params: { expand: 'body.view' } });
  return resp.data?.body?.view?.value || '';
}

async function collectAllPageIds(spaceKey) {
  const visited = new Set();
  const queue = [];

  const roots = await getRootPages(spaceKey);
  roots.forEach(p => queue.push(p.id));

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    try {
      const children = await getChildren(id);
      for (const ch of children) {
        if (!visited.has(ch.id)) queue.push(ch.id);
      }
    } catch (err) {
      console.warn(`Failed to get children for ${id}:`, err?.response?.status || err.message);
    }
    // short delay to avoid flooding
    await delay(25);
  }
  return Array.from(visited);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function main() {
  log(`Base URL: ${BASE_URL}`);
  log(`Space: ${SPACE_KEY}`);

  // Check that space exists (optional but useful)
  try {
    const spaces = await getSpaces();
    const space = spaces.find(s => s.key === SPACE_KEY);
    if (!space) {
      log(`WARNING: Space ${SPACE_KEY} not found in API. Continuing anyway...`);
    } else {
      log(`Space found: ${space.key} - ${space.name}`);
    }
  } catch (e) {
    log('Could not verify spaces list, proceeding. Error: ' + (e?.message || e));
  }

  const outDir = path.join(__dirname, 'mock-data/AI/pages');
  ensureDir(outDir);

  log('Collecting page tree...');
  const pageIds = await collectAllPageIds(SPACE_KEY);
  log(`Found ${pageIds.length} pages in space ${SPACE_KEY}.`);

  let ok = 0, fail = 0;
  for (const id of pageIds) {
    try {
      const html = await getPageHtml(id);
      const filePath = path.join(outDir, `${id}.html`);
      fs.writeFileSync(filePath, html ?? '', 'utf8');
      ok++;
      if (ok % 20 === 0) log(`Saved ${ok} pages...`);
      // small delay to be friendly
      await delay(10);
    } catch (err) {
      fail++;
      console.warn(`Failed to fetch/save page ${id}:`, err?.response?.status || err.message);
    }
  }

  log(`Done. Saved ${ok} pages, failed ${fail}. Output: ${outDir}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
