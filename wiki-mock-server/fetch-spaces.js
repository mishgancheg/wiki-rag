#!/usr/bin/env node
/**
 * Fetch list of Confluence spaces (projects) and save to
 * wiki-mock-server/data/spaces.json
 *
 * Vanilla Node.js script using axios. Reads configuration from environment:
 * - CONFLUENCE_BASE_URL (required)
 * - One of:
 *     - WIKI_TOKEN or CONFLUENCE_TOKEN (Bearer token)
 *     - CONFLUENCE_EMAIL + CONFLUENCE_API_TOKEN (Basic auth)
 * - IGNORE_SSL_ERRORS=true to skip TLS verification (useful for self-signed certs)
 *
 * Usage:
 *   node wiki-mock-server/fetch-spaces.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const dotenv = require('dotenv');

// Load .env if present
dotenv.config();

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

function log(msg) { console.log(`[fetch-spaces] ${msg}`); }
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

async function fetchSpaces() {
  const spaces = await pagedGet('/rest/api/space', { expand: 'description.plain' });
  return spaces.map(space => ({
    key: space.key,
    name: space.name,
    type: space.type,
    description: (space.description && space.description.plain && space.description.plain.value) || ''
  }));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function main() {
  log(`Base URL: ${BASE_URL}`);
  log('Fetching spaces...');

  const spaces = await fetchSpaces();
  log(`Fetched ${spaces.length} spaces.`);

  const outDir = path.join(__dirname, 'mock-data');
  ensureDir(outDir);
  const outFile = path.join(outDir, 'spaces.json');

  fs.writeFileSync(outFile, JSON.stringify(spaces, null, 2), 'utf8');
  log(`Saved spaces to ${outFile}`);
}

main().catch(err => {
  console.error('Fatal error:', err?.response?.data || err.message || err);
  process.exit(1);
});
