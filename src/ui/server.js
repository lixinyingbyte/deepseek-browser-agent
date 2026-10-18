#!/usr/bin/env node
// src/ui/server.js — Local web UI for DeepSeek Browser Agent
//
// Zero-dependency HTTP server (uses only Node core modules) that wraps the
// agent's core classes and streams live events to a single-page frontend.
'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const os     = require('os');

const config        = require('../config');
const logger        = require('../logger');
const DeepSeekAgent = require('../agent');
const { TOOLS }     = require('../tools');
const i18n          = require('../i18n');
const tokenUsage    = require('../token-usage');
const workspace     = require('./workspace');

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const PUBLIC_DIR  = path.join(__dirname, 'public');
const PORT        = Number(process.env.DSA_UI_PORT || process.env.PORT || 4765);
const HOST        = process.env.DSA_UI_HOST || '127.0.0.1';

// ─────────────────────────────────────────────
//  Session manager — one agent per UI process
// ─────────────────────────────────────────────
const session = {
  agent: null,
  status: 'idle',          // idle | launching | ready | running | error
  currentTask: null,
  history: [],             // { role, content, ts }
  abortController: null,
  startedAt: Date.now(),
};

function pushHistory(role, content) {
  session.history.push({ role, content, ts: Date.now() });
  if (session.history.length > 500) session.history.shift();
}

// ─────────────────────────────────────────────
//  Static file serving
// ─────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.ico' : 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  let rel      = decodeURIComponent(parsed.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = path.join(PUBLIC_DIR, rel);

  // Block path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type'  : MIME[ext] || 'application/octet-stream',
      'Cache-Control' : 'no-cache',
    });
    res.end(data);
  });
}

// ─────────────────────────────────────────────
//  JSON helpers
// ─────────────────────────────────────────────
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────
//  Server-Sent Events
// ─────────────────────────────────────────────
const sseClients = new Set();

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type'  : 'text/event-stream',
    'Cache-Control' : 'no-cache, no-transform',
    'Connection'    : 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const client = { res };
  sseClients.add(client);

  // Send a snapshot of the current status so a fresh client is in sync
  res.write(`event: snapshot\n`);
  res.write(`data: ${JSON.stringify({
    status       : session.status,
    currentTask  : session.currentTask,
    workingDir   : config.WORKING_DIR,
    headless     : config.HEADLESS,
    maxIterations: config.MAX_ITERATIONS,
  })}\n\n`);

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* ignore */ }
  }, 15_000);

  const cleanup = () => {
    clearInterval(keepAlive);
    sseClients.delete(client);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
}

function broadcast(event) {
  if (sseClients.size === 0) return;
  const payload = `event: agent\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of [...sseClients]) {
    try {
      client.res.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Forward every logger event to all connected SSE clients
logger.bus.on('event', (evt) => {
  broadcast(evt);
});

// ─────────────────────────────────────────────
//  Agent lifecycle
// ─────────────────────────────────────────────
async function ensureAgent({ keepSession = false, headless } = {}) {
  if (session.agent) return session.agent;

  session.status = 'launching';
  broadcast({ type: 'status', status: 'launching' });

  if (headless != null) config.HEADLESS = !!headless;

  const agent = new DeepSeekAgent({ keepSession, saveLog: true });
  await agent.init();

  session.agent  = agent;
  session.status = 'ready';
  broadcast({ type: 'status', status: 'ready' });
  return agent;
}

async function shutdownAgent() {
  if (!session.agent) return;
  try { await session.agent.shutdown(); } catch { /* ignore */ }
  session.agent = null;
  session.status = 'idle';
  broadcast({ type: 'status', status: 'idle' });
}

// ─────────────────────────────────────────────
//  API routes
// ─────────────────────────────────────────────

async function handleStatus(req, res) {
  sendJson(res, 200, {
    status       : session.status,
    currentTask  : session.currentTask,
    startedAt    : session.startedAt,
    language     : i18n.getLanguage(),
    workingDir   : config.WORKING_DIR,
    sessionDir   : config.SESSION_DIR,
    headless     : config.HEADLESS,
    debug        : config.DEBUG,
    maxIterations: config.MAX_ITERATIONS,
    platform     : process.platform,
    nodeVersion  : process.version,
    uiPort       : PORT,
    tools        : Object.keys(TOOLS),
  });
}

async function handleConfig(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      workingDir   : config.WORKING_DIR,
      headless     : config.HEADLESS,
      debug        : config.DEBUG,
      maxIterations: config.MAX_ITERATIONS,
      stableDelay  : config.STABLE_DELAY,
    });
  }

  // POST → update in-memory config
  const body = await readBody(req);
  const applied = {};

  if (typeof body.workingDir === 'string' && body.workingDir.trim()) {
    const resolved = path.resolve(body.workingDir.trim());
    if (!fs.existsSync(resolved)) {
      return sendJson(res, 400, { error: `Working directory not found: ${resolved}` });
    }
    config.WORKING_DIR = resolved;
    applied.workingDir = resolved;
  }
  if (typeof body.headless === 'boolean') {
    config.HEADLESS = body.headless;
    applied.headless = body.headless;
  }
  if (typeof body.debug === 'boolean') {
    config.DEBUG = body.debug;
    applied.debug = body.debug;
  }
  if (Number.isFinite(body.maxIterations)) {
    config.MAX_ITERATIONS = Math.max(1, Math.min(200, Math.floor(body.maxIterations)));
    applied.maxIterations = config.MAX_ITERATIONS;
  }

  sendJson(res, 200, { ok: true, applied, config });
}

async function handleTask(req, res) {
  if (session.status === 'running') {
    return sendJson(res, 409, { error: 'A task is already running' });
  }

  const body = await readBody(req);
  const task = (body.task || '').trim();
  if (!task) return sendJson(res, 400, { error: 'Missing "task" in request body' });

  // Respond immediately; the run streams over SSE
  sendJson(res, 202, { ok: true, accepted: true, task });

  session.status      = 'running';
  session.currentTask = task;
  pushHistory('user', task);
  broadcast({ type: 'status', status: 'running', task });
  broadcast({ type: 'user_message', content: task });

  // Run in the background so we don't block the HTTP response
  (async () => {
    try {
      const opts = {
        keepSession : !!body.keepSession,
        headless    : typeof body.headless === 'boolean' ? body.headless : undefined,
      };

      const agent = await ensureAgent(opts);

      if (body.newChat) {
        await agent.browser.newChat();
        agent.conversation = new (require('../prompt').ConversationManager)();
      }

      const finalText = await agent.run(task);
      pushHistory('assistant', finalText);
      broadcast({ type: 'task_done', finalText });
    } catch (err) {
      logger.error(`${i18n.t('ui.taskFailed')} ${err.message}`);
      pushHistory('assistant', `${i18n.t('ui.error')} ${err.message}`);
      broadcast({ type: 'task_error', message: err.message });
    } finally {
      session.status      = 'ready';
      session.currentTask = null;
      broadcast({ type: 'status', status: 'ready' });
    }
  })();
}

async function handleNewChat(req, res) {
  try {
    const agent = await ensureAgent({});
    await agent.browser.newChat();
    agent.conversation = new (require('../prompt').ConversationManager)();
    broadcast({ type: 'new_chat' });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleShutdown(req, res) {
  sendJson(res, 200, { ok: true });
  await shutdownAgent();
}

async function handleHistory(req, res) {
  sendJson(res, 200, { history: session.history });
}

async function handleListAccounts(req, res) {
  try {
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    sendJson(res, 200, {
      accounts : am.list(),
      active   : session.agent ? session.agent.currentAccount : am.activeName(),
      rotation : config.ACCOUNT_ROTATION,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleSwitchAccount(req, res) {
  try {
    const body = await readBody(req);
    if (!body.name) return sendJson(res, 400, { error: 'Missing "name" in request body' });

    if (session.agent) {
      // A live agent exists — swap its browser profile on the fly.
      const acct = await session.agent.switchAccount(body.name);
      broadcast({ type: 'account_switched', account: acct });
      return sendJson(res, 200, { ok: true, account: acct });
    }

    // No agent yet — just set the active pointer in the registry.
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const acct = am.setActive(body.name);
    broadcast({ type: 'account_switched', account: acct });
    sendJson(res, 200, { ok: true, account: acct });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleAddAccount(req, res) {
  try {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Missing "name" in request body' });
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const acct = am.add(name, { label: body.label });
    broadcast({ type: 'account_added', account: acct });
    sendJson(res, 200, { ok: true, account: acct });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleRemoveAccount(req, res) {
  try {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Missing "name" in request body' });
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const removed = am.remove(name, { deleteProfile: !!body.deleteProfile });
    broadcast({ type: 'account_removed', account: removed });
    sendJson(res, 200, { ok: true, account: removed });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleRotateAccount(req, res) {
  try {
    if (session.agent) {
      const acct = await session.agent.rotateAccount({ force: true });
      broadcast({ type: 'account_switched', account: acct });
      return sendJson(res, 200, { ok: true, account: acct });
    }
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const acct = am.next({ force: true });
    broadcast({ type: 'account_switched', account: acct });
    sendJson(res, 200, { ok: true, account: acct });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleListAccounts(req, res) {
  try {
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    sendJson(res, 200, {
      accounts : am.list(),
      active   : session.agent ? session.agent.currentAccount : am.activeName(),
      rotation : config.ACCOUNT_ROTATION,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleSwitchAccount(req, res) {
  try {
    const body = await readBody(req);
    if (!body.name) return sendJson(res, 400, { error: 'Missing "name" in request body' });

    if (session.agent) {
      // A live agent exists — swap its browser profile on the fly.
      const acct = await session.agent.switchAccount(body.name);
      broadcast({ type: 'account_switched', account: acct });
      return sendJson(res, 200, { ok: true, account: acct });
    }

    // No agent yet — just set the active pointer in the registry.
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const acct = am.setActive(body.name);
    broadcast({ type: 'account_switched', account: acct });
    sendJson(res, 200, { ok: true, account: acct });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleAddAccount(req, res) {
  try {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Missing "name" in request body' });
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const acct = am.add(name, { label: body.label });
    broadcast({ type: 'account_added', account: acct });
    sendJson(res, 200, { ok: true, account: acct });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleRemoveAccount(req, res) {
  try {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Missing "name" in request body' });
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const removed = am.remove(name, { deleteProfile: !!body.deleteProfile });
    broadcast({ type: 'account_removed', account: removed });
    sendJson(res, 200, { ok: true, account: removed });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleRotateAccount(req, res) {
  try {
    if (session.agent) {
      const acct = await session.agent.rotateAccount({ force: true });
      broadcast({ type: 'account_switched', account: acct });
      return sendJson(res, 200, { ok: true, account: acct });
    }
    const { AccountManager } = require('../accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });
    const acct = am.next({ force: true });
    broadcast({ type: 'account_switched', account: acct });
    sendJson(res, 200, { ok: true, account: acct });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleListConversations(req, res) {
  try {
    const agent = await ensureAgent({});
    const list  = await agent.listConversations();
    sendJson(res, 200, { conversations: list });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleOpenConversation(req, res) {
  try {
    const body = await readBody(req);
    if (body.ref == null || body.ref === '') {
      return sendJson(res, 400, { error: 'Missing "ref" (index or title) in request body' });
    }
    const agent = await ensureAgent({});
    const ref   = typeof body.ref === 'number' || /^\d+$/.test(String(body.ref))
      ? Number(body.ref)
      : String(body.ref);
    const match = await agent.openConversation(ref);
    broadcast({ type: 'conversation_opened', conversation: match });

    // Return the conversation contents so the UI can render them immediately.
    const turns = await agent.readCurrentConversation().catch(() => []);
    sendJson(res, 200, { ok: true, conversation: match, turns });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleReadConversation(req, res) {
  try {
    const agent = await ensureAgent({});
    const turns = await agent.readCurrentConversation();
    sendJson(res, 200, { turns });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleTokens(req, res) {
  sendJson(res, 200, {
    today  : tokenUsage.todayTotal(),
    history: tokenUsage.history(),
  });
}

async function handleWorkspaceTree(req, res) {
  try {
    sendJson(res, 200, workspace.buildTree(config.WORKING_DIR));
  } catch (err) {
    sendJson(res, err.statusCode || 500, { error: err.message });
  }
}

async function handleWorkspaceFile(req, res) {
  try {
    const { query } = url.parse(req.url, true);
    sendJson(res, 200, workspace.readFile(config.WORKING_DIR, query.path));
  } catch (err) {
    sendJson(res, err.statusCode || 500, { error: err.message });
  }
}

async function handleTools(req, res) {
  const out = Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description : tool.description,
    parameters  : Object.entries(tool.parameters || {}).map(([pName, p]) => ({
      name: pName,
      type: p.type,
      required: !!p.required,
      description: p.description || '',
    })),
  }));
  sendJson(res, 200, { tools: out });
}

// ─────────────────────────────────────────────
//  Router
// ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  // CORS for convenience when hitting the API directly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (pathname === '/api/events' && req.method === 'GET')  return handleEvents(req, res);
    if (pathname === '/api/status'  && req.method === 'GET')  return handleStatus(req, res);
    if (pathname === '/api/config')                           return handleConfig(req, res);
    if (pathname === '/api/task'    && req.method === 'POST') return handleTask(req, res);
    if (pathname === '/api/new-chat'&& req.method === 'POST') return handleNewChat(req, res);
    if (pathname === '/api/shutdown'&& req.method === 'POST') return handleShutdown(req, res);
    if (pathname === '/api/history' && req.method === 'GET')  return handleHistory(req, res);
    if (pathname === '/api/accounts'          && req.method === 'GET')  return handleListAccounts(req, res);
    if (pathname === '/api/accounts/switch'    && req.method === 'POST') return handleSwitchAccount(req, res);
    if (pathname === '/api/accounts/add'       && req.method === 'POST') return handleAddAccount(req, res);
    if (pathname === '/api/accounts/remove'    && req.method === 'POST') return handleRemoveAccount(req, res);
    if (pathname === '/api/accounts/rotate'    && req.method === 'POST') return handleRotateAccount(req, res);
    if (pathname === '/api/accounts'          && req.method === 'GET')  return handleListAccounts(req, res);
    if (pathname === '/api/accounts/switch'    && req.method === 'POST') return handleSwitchAccount(req, res);
    if (pathname === '/api/accounts/add'       && req.method === 'POST') return handleAddAccount(req, res);
    if (pathname === '/api/accounts/remove'    && req.method === 'POST') return handleRemoveAccount(req, res);
    if (pathname === '/api/accounts/rotate'    && req.method === 'POST') return handleRotateAccount(req, res);
    if (pathname === '/api/conversations'     && req.method === 'GET')  return handleListConversations(req, res);
    if (pathname === '/api/conversations/open'&& req.method === 'POST') return handleOpenConversation(req, res);
    if (pathname === '/api/conversations/read'&& req.method === 'GET')  return handleReadConversation(req, res);
    if (pathname === '/api/tools'   && req.method === 'GET')  return handleTools(req, res);
    if (pathname === '/api/tokens'  && req.method === 'GET')  return handleTokens(req, res);
    if (pathname === '/api/workspace/tree' && req.method === 'GET') return handleWorkspaceTree(req, res);
    if (pathname === '/api/workspace/file' && req.method === 'GET') return handleWorkspaceFile(req, res);

    // Static assets
    if (req.method === 'GET') return serveStatic(req, res);

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    logger.error(`HTTP error: ${err.message}`);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else try { res.end(); } catch { /* ignore */ }
  }
});

// ─────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────
function start() {
  const t = i18n.t;
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log('');
    console.log(`  \x1b[1m\x1b[96m🤖  ${t('ui.title')}\x1b[0m`);
    console.log('  \x1b[90m' + '─'.repeat(46) + '\x1b[0m');
    console.log(`  \x1b[92m✓\x1b[0m  ${t('ui.serving')}  \x1b[96m${url}\x1b[0m`);
    console.log(`  \x1b[90mℹ\x1b[0m  ${t('runtime.workingDir')} \x1b[36m${config.WORKING_DIR}\x1b[0m`);
    console.log(`  \x1b[90mℹ\x1b[0m  ${t('runtime.sessionDir')} \x1b[36m${config.SESSION_DIR}\x1b[0m`);
    console.log('');
    console.log(`  \x1b[90m${t('ui.openHint')}\x1b[0m`);
    console.log(`  \x1b[90m${t('ui.stopHint')}\x1b[0m`);
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ✗ ${t('ui.portInUse', { port: PORT })}`);
      console.error(`    ${t('ui.portHint')}\n`);
    } else {
      console.error(`\n  ✗ Server error: ${err.message}\n`);
    }
    process.exit(1);
  });
}

const shutdown = async (code = 0) => {
  console.log('\n  ' + i18n.t('ui.shuttingDown'));
  for (const client of sseClients) {
    try { client.res.end(); } catch { /* ignore */ }
  }
  sseClients.clear();
  await shutdownAgent();
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 2000).unref();
};

process.on('SIGINT',  () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (err) => {
  console.error(`Uncaught: ${err.message}`);
  if (config.DEBUG) console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
});

if (require.main === module) start();

module.exports = { server, start, session };
