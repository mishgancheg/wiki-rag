#!/usr/bin/env node
/**
 * Fetch page structure for Confluence space with key "AI" and save to
 * wiki-mock-server/data/AI/structure.json
 *
 * Vanilla JS (Node) script using axios. Reads configuration from environment:
 * - CONFLUENCE_BASE_URL (required)
 * - One of:
 *     - WIKI_TOKEN or CONFLUENCE_TOKEN or CONFLUENCE_API_TOKEN (Bearer token)
 *     - CONFLUENCE_EMAIL + CONFLUENCE_API_TOKEN (Basic auth)
 * - IGNORE_SSL_ERRORS=true to skip TLS verification (useful for self-signed certs)
 *
 * Endpoints used:
 * - Root pages:   GET /rest/api/content?spaceKey={spaceKey}&type=page&expand=ancestors&start=0&limit=1000
 * - Children:     GET /rest/api/content/{parentId}/child/page?start=0&limit=1000
 *
 * Output schema designed to support a mock emulator of Confluence endpoints:
 * {
 *   spaceKey: "AI",
 *   generatedAt: "2025-08-20T...Z",
 *   roots: [{ id: "123", title: "Root", hasChildren: true }, ...],
 *   children: {
 *     "123": [{ id: "456", title: "Child", hasChildren: false }, ...],
 *     "456": [...],
 *     ...
 *   }
 * }
 *
 * Usage:
 *   node wiki-mock-server/fetch-ai-structure.js [SPACE_KEY]
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
const BASIC_EMAIL = process.env.CONFLUENCE_EMAIL;
const BASIC_TOKEN = process.env.CONFLUENCE_API_TOKEN;

let authHeader = undefined;
if (BEARER_TOKEN) {
  authHeader = { Authorization: `Bearer ${BEARER_TOKEN}` };
} else if (BASIC_EMAIL && BASIC_TOKEN) {
  const basic = Buffer.from(`${BASIC_EMAIL}:${BASIC_TOKEN}`).toString('base64');
  authHeader = { Authorization: `Basic ${basic}` };
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

function log(msg) { console.log(`[fetch-ai-structure] ${msg}`); }
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
    await delay(50); // be polite
  }
  return all;
}

async function getRootPages(spaceKey) {
  const results = await pagedGet('/rest/api/content', { spaceKey, type: 'page', expand: 'ancestors' });
  const roots = results.filter(p => !p.ancestors || p.ancestors.length === 0);
  return roots.map(p => ({ id: String(p.id), title: p.title }));
}

async function getChildren(parentId) {
  const results = await pagedGet(`/rest/api/content/${parentId}/child/page`);
  // hasChildren is unknown from this call unless it expands children.page; we can infer later when fetching each child's children.
  return results.map(p => ({ id: String(p.id), title: p.title }));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function buildStructure(spaceKey) {
  const structure = {
    spaceKey,
    generatedAt: new Date().toISOString(),
    roots: [],
    children: {},
  };

  const visited = new Set();
  const queue = [];

  // Initialize with roots
  const roots = await getRootPages(spaceKey);
  structure.roots = roots.map(r => ({ id: r.id, title: r.title, hasChildren: false }));
  roots.forEach(r => queue.push(r.id));

  // BFS to populate children mapping
  while (queue.length) {
    const parentId = queue.shift();
    if (visited.has(parentId)) continue;
    visited.add(parentId);

    try {
      const ch = await getChildren(parentId);
      const childEntries = [];

      for (const c of ch) {
        childEntries.push({ id: c.id, title: c.title, hasChildren: false });
        // enqueue to discover its children
        if (!visited.has(c.id)) queue.push(c.id);
      }

      structure.children[parentId] = childEntries;

      // Mark hasChildren on parent in roots if applicable
      const r = structure.roots.find(x => x.id === parentId);
      if (r) r.hasChildren = childEntries.length > 0;

      // small delay between requests
      await delay(20);
    } catch (err) {
      console.warn(`Failed to get children for ${parentId}:`, err?.response?.status || err.message);
    }
  }

  // Second pass to compute hasChildren flags for all nodes using children map
  const hasChildrenSet = new Set(Object.keys(structure.children).filter(k => (structure.children[k] || []).length > 0));

  // Update roots (already partially set)
  structure.roots = structure.roots.map(n => ({ ...n, hasChildren: hasChildrenSet.has(n.id) }));

  // Update children entries
  for (const pid of Object.keys(structure.children)) {
    structure.children[pid] = structure.children[pid].map(n => ({ ...n, hasChildren: hasChildrenSet.has(n.id) }));
  }

  return structure;
}

async function main() {
  log(`Base URL: ${BASE_URL}`);
  log(`Space: ${SPACE_KEY}`);

  const structure = await buildStructure(SPACE_KEY);
  const outDir = path.join(__dirname, 'data', SPACE_KEY);
  ensureDir(outDir);
  const outFile = path.join(outDir, 'structure.json');

  fs.writeFileSync(outFile, JSON.stringify(structure, null, 2), 'utf8');
  log(`Saved structure to ${outFile}`);
}

main().catch(err => {
  console.error('Fatal error:', err?.response?.data || err.message || err);
  process.exit(1);
});
