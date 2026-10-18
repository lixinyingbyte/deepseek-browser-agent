// src/logger.js — ANSI-colored terminal output + structured event bus
'use strict';

const { EventEmitter } = require('events');
const i18n = require('./i18n');

// ─────────────────────────────────────────────
//  Event bus (used by the web UI to stream logs)
// ─────────────────────────────────────────────
const bus = new EventEmitter();
bus.setMaxListeners(0);

function emit(type, data = {}) {
  try {
    bus.emit('event', { type, ...data, ts: Date.now() });
  } catch (_) {
    /* never let logging crash the agent */
  }
}

// ─────────────────────────────────────────────
//  ANSI helpers
// ─────────────────────────────────────────────
const A = {
  reset   : '\x1b[0m',
  bold    : '\x1b[1m',
  dim     : '\x1b[2m',
  red     : '\x1b[31m',
  green   : '\x1b[32m',
  yellow  : '\x1b[33m',
  blue    : '\x1b[34m',
  magenta : '\x1b[35m',
  cyan    : '\x1b[36m',
  white   : '\x1b[37m',
  gray    : '\x1b[90m',
  lred    : '\x1b[91m',
  lgreen  : '\x1b[92m',
  lyellow : '\x1b[93m',
  lblue   : '\x1b[94m',
  lmagenta: '\x1b[95m',
  lcyan   : '\x1b[96m',
};

const c  = (code, text) => `${A[code]}${text}${A.reset}`;
const cb = (code, text) => `${A.bold}${A[code]}${text}${A.reset}`;

// Strip ANSI escape codes — used before sending text to the web UI
function stripAnsi(str) {
  if (!str) return '';
  // eslint-disable-next-line no-control-regex
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function truncDisplay(str, max = 400) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max) + c('gray', `… (+${s.length - max} chars)`);
}

function jsonPreview(obj, max = 350) {
  let s;
  try {
    s = JSON.stringify(obj, null, 2);
  } catch {
    s = String(obj);
  }
  return truncDisplay(s, max);
}

// ── Public logger API ─────────────────────────────────────────────────────────
const logger = {
  /** The event bus — the web UI subscribes here. */
  bus,

  banner() {
    const t = i18n.t;
    console.log(`
${c('cyan','╔══════════════════════════════════════════════════╗')}
${c('cyan','║')}   ${cb('lcyan','🤖  ' + t('log.bannerTitle'))}                     ${c('cyan','║')}
${c('cyan','║')}   ${c('gray', t('log.bannerSub1'))}         ${c('cyan','║')}
${c('cyan','║')}   ${c('gray', t('log.bannerSub2'))}     ${c('cyan','║')}
${c('cyan','╚══════════════════════════════════════════════════╝')}
`);
    emit('banner');
  },

  header(msg) {
    const line = '─'.repeat(50);
    console.log(`\n${c('blue', line)}`);
    console.log(`${c('bold','📋 ')}${cb('white', msg)}`);
    console.log(`${c('blue', line)}\n`);
    emit('header', { message: stripAnsi(msg) });
  },

  info(msg) {
    console.log(`${c('lblue','  ℹ ')} ${msg}`);
    emit('info', { message: stripAnsi(msg) });
  },

  success(msg) {
    console.log(`${c('lgreen','  ✓ ')} ${c('lgreen', msg)}`);
    emit('success', { message: stripAnsi(msg) });
  },

  warn(msg) {
    console.log(`${c('lyellow','  ⚠ ')} ${c('lyellow', msg)}`);
    emit('warn', { message: stripAnsi(msg) });
  },

  error(msg) {
    console.log(`${c('lred','  ✗ ')} ${c('lred', msg)}`);
    emit('error', { message: stripAnsi(msg) });
  },

  dim(msg) {
    console.log(`${A.dim}    ${msg}${A.reset}`);
    emit('dim', { message: stripAnsi(msg) });
  },

  /** Spinner-style line (overwrites itself with \r) */
  thinking(msg) {
    process.stdout.write(`  ${c('cyan','⟳')} ${c('gray', msg)}\r`);
    emit('thinking', { message: stripAnsi(msg) });
  },

  /** Clear the current line */
  clearLine() {
    process.stdout.write(`\r${' '.repeat(80)}\r`);
    emit('clearLine');
  },

  // ── Tool call display ───────────────────────────────────────────────────────
  toolCall(name, args) {
    console.log(`\n  ${cb('magenta','⚡ ' + i18n.t('log.toolCall'))} ${c('cyan', `→ ${name}`)}`);
    const preview = jsonPreview(args);
    if (preview.trim()) {
      preview.split('\n').forEach(l => console.log(`  ${c('gray', l)}`));
    }
    let cleanArgs = args;
    try { cleanArgs = JSON.parse(JSON.stringify(args)); } catch { cleanArgs = String(args); }
    emit('tool_call', { name, args: cleanArgs });
  },

  toolResult(result, isError = false) {
    const icon   = isError ? c('lred','  ✗ ' + i18n.t('log.result')) : c('lgreen','  ✓ ' + i18n.t('log.result'));
    const text   = truncDisplay(String(result), 300);
    const color  = isError ? 'lred' : 'gray';
    console.log(`${icon}`);
    text.split('\n').slice(0, 12).forEach(l => console.log(`  ${c(color, l)}`));
    if (String(result).split('\n').length > 12) {
      console.log(`  ${c('gray', i18n.t('log.truncated'))}`);
    }
    console.log('');
    emit('tool_result', {
      result: stripAnsi(String(result)),
      isError: !!isError,
    });
  },

  // ── Final agent output ──────────────────────────────────────────────────────
  finalOutput(msg) {
    const line = '━'.repeat(50);
    console.log(`\n${c('lgreen', line)}`);
    console.log(`${cb('lgreen','✅  ' + i18n.t('log.taskComplete'))}`);
    console.log(`${c('lgreen', line)}\n`);
    console.log(msg);
    console.log('');
    emit('finalOutput', { content: stripAnsi(String(msg)) });
  },

  // ── Section separator ───────────────────────────────────────────────────────
  separator(label = '') {
    const pad = label ? ` ${label} ` : '';
    console.log(`\n${c('gray', '·'.repeat(20) + pad + '·'.repeat(20))}\n`);
    emit('separator', { label });
  },

  // ── Iteration marker ────────────────────────────────────────────────────────
  iteration(n, max) {
    console.log(`\n${c('gray','  ┄')} ${c('dim', i18n.t('log.step', { n, max }))} ${c('gray','┄')}`);
    emit('iteration', { n, max });
  },
};

// Expose helpers for other modules if needed
logger.stripAnsi = stripAnsi;

module.exports = logger;
