#!/usr/bin/env node
/**
 * Simple Vanilla Node.js mock server for Confluence-like API
 *
 * Port: 3001
 * Endpoints implemented:
 * - GET /rest/api/space?start=0&limit=1000
 *   Response: { results: [{ key, name, type?, description? }, ...] }
 *   Data source: wiki-mock-server/mock-data/spaces.json
 *
 * - GET /rest/api/content?spaceKey={spaceKey}&type=page&expand=ancestors&start=0&limit=1000
 *   Response: { results: [ { id, title, type: 'page', status: 'current', ancestors: [], children: { page: { size } } }, ... ] }
 *   Roots only (ancestors.length === 0)
 *   Data source: wiki-mock-server/mock-data/{spaceKey}/structure.json (supports AI)
 *
 * - GET /rest/api/content/{parentId}/child/page?start=0&limit=1000
 *   Response: { results: [ { id, title, type: 'page', status: 'current', children: { page: { size } } }, ... ] }
 *   Data source: structure.json children map
 *
 * - GET /rest/api/content/{id}?expand=body.view
 *   Response: { id, title, body: { view: { value: HTML } }, space: { key, name } }
 *   Data source: HTML file wiki-mock-server/mock-data/{spaceKey}/pages/{id}.html and title from structure.json
 *
 * Notes:
 * - This is a lightweight emulator intended to satisfy the consuming code in server/confluence.ts.
 * - Unknown spaceKeys are served with empty results.
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const BASE_DIR = __dirname;
const MOCK_DIR = path.join(BASE_DIR, 'mock-data');

// Utility helpers
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(text);
}

function parseQuery(reqUrl) {
  const parsed = url.parse(reqUrl, true);
  return parsed.query || {};
}

function loadJsonSafe(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

// Load spaces at startup
const SPACES_FILE = path.join(MOCK_DIR, 'spaces.json');
const SPACES = loadJsonSafe(SPACES_FILE, []);

// Preload supported space structures (currently AI)
const SUPPORTED_SPACES = ['AI'];
const STRUCTURES = {}; // spaceKey -> structure JSON
const TITLE_INDEX = {}; // spaceKey -> { [id]: title }

for (const spaceKey of SUPPORTED_SPACES) {
  const file = path.join(MOCK_DIR, spaceKey, 'structure.json');
  const structure = loadJsonSafe(file, null);
  if (structure) {
    STRUCTURES[spaceKey] = structure;

    // Build title index for quick lookups
    const index = {};
    (structure.roots || []).forEach(n => { index[String(n.id)] = n.title; });
    const children = structure.children || {};
    for (const pid of Object.keys(children)) {
      for (const ch of children[pid]) {
        index[String(ch.id)] = ch.title;
      }
    }
    TITLE_INDEX[spaceKey] = index;
  }
}

function asConfluencePage(node) {
  // node: { id, title, hasChildren }
  return {
    id: String(node.id),
    title: node.title,
    type: 'page',
    status: 'current',
    children: { page: { size: node.hasChildren ? 1 : 0 } },
  };
}

function handleGetSpaces(req, res) {
  // Emulate paging but always return all in results
  return sendJson(res, 200, { results: SPACES });
}

function handleGetRootPages(req, res, spaceKey) {
  const structure = STRUCTURES[spaceKey];
  if (!structure) {
    return sendJson(res, 200, { results: [] });
  }
  const roots = (structure.roots || []).map(asConfluencePage).map(p => ({ ...p, ancestors: [] }));
  return sendJson(res, 200, { results: roots });
}

function handleGetChildren(req, res, parentId) {
  // Find which space contains this parentId; currently only AI
  const spaceKey = SUPPORTED_SPACES.find(sk => TITLE_INDEX[sk] && (TITLE_INDEX[sk][String(parentId)] || (STRUCTURES[sk]?.children?.[String(parentId)])));
  const structure = spaceKey ? STRUCTURES[spaceKey] : null;
  if (!structure) {
    return sendJson(res, 200, { results: [] });
  }
  const children = (structure.children?.[String(parentId)] || []).map(asConfluencePage);
  return sendJson(res, 200, { results: children });
}

function handleGetPage(req, res, id) {
  // Determine space by presence in title index
  const spaceKey = SUPPORTED_SPACES.find(sk => TITLE_INDEX[sk] && TITLE_INDEX[sk][String(id)]);
  const title = spaceKey ? TITLE_INDEX[spaceKey][String(id)] : `Page ${id}`;
  const htmlPath = spaceKey
    ? path.join(MOCK_DIR, spaceKey, 'pages', `${id}.html`)
    : path.join(MOCK_DIR, 'AI', 'pages', `${id}.html`); // fallback

  let html = '';
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    // If HTML missing, return simple placeholder
    html = `<div><h1>${title}</h1><p>Mock content for page ${id}</p></div>`;
  }

  const spaceName = (SPACES.find(s => s.key === spaceKey) || {}).name || spaceKey || '';

  return sendJson(res, 200, {
    id: String(id),
    title,
    body: { view: { value: html } },
    space: spaceKey ? { key: spaceKey, name: spaceName } : undefined,
    version: { number: 1, when: new Date().toISOString() },
  });
}

function notFound(res) {
  sendJson(res, 404, { message: 'Not found' });
}

const wikiMockServer = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '';

  // Basic CORS for convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { message: 'Method Not Allowed' });
  }

  // Routing
  // 1) /rest/api/space
  if (pathname === '/rest/api/space') {
    return handleGetSpaces(req, res);
  }

  // 2) /rest/api/content with query params for spaceKey
  if (pathname === '/rest/api/content') {
    const { spaceKey } = parsed.query || {};
    return handleGetRootPages(req, res, String(spaceKey || ''));
  }

  // 3) /rest/api/content/{id}
  const contentIdMatch = pathname.match(/^\/rest\/api\/content\/(\d+)(?:\/child\/page)?$/);
  if (contentIdMatch) {
    const id = contentIdMatch[1];

    // If ends with /child/page -> children endpoint
    if (/\/child\/page$/.test(pathname)) {
      return handleGetChildren(req, res, id);
    }

    // Else -> page endpoint
    return handleGetPage(req, res, id);
  }

  return notFound(res);
});

wikiMockServer.listen(PORT, () => {
  console.log(`[wiki-mock-server] Listening on http://localhost:${PORT}`);
});
