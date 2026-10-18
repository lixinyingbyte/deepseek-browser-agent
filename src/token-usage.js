// src/token-usage.js — Estimate and persist daily token usage
//
// DeepSeek's web UI does not expose exact token counts, so we estimate from
// the text that flows through the agent and accumulate a per-day total in
// ~/.deepseek-agent/token-usage.json.
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const FILE = path.join(os.homedir(), '.deepseek-agent', 'token-usage.json');

// ─────────────────────────────────────────────
//  Estimation
// ─────────────────────────────────────────────
// Heuristic tuned for DeepSeek's tokenizer (mixed Chinese + English):
//   • CJK / Hangul / Kana chars  ≈ 0.6 tokens each (~1.7 chars/token)
//   • everything else            ≈ 0.25 tokens each (~4 chars/token)
const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  let cjk = 0;
  for (const ch of s) {
    if (CJK_RE.test(ch)) cjk++;
  }
  const other = s.length - cjk;
  return Math.ceil(cjk * 0.6 + other / 4);
}

// ─────────────────────────────────────────────
//  Local-date key (YYYY-MM-DD)
// ─────────────────────────────────────────────
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─────────────────────────────────────────────
//  Persistence
// ─────────────────────────────────────────────
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    /* never let token accounting crash the agent */
  }
}

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────

/**
 * Record an exchange. Either argument may be empty.
 * Returns the updated entry for today.
 */
function record(inputText, outputText) {
  const data = load();
  const key  = todayKey();
  if (!data[key]) data[key] = { input: 0, output: 0, tasks: 0 };
  data[key].input  += estimateTokens(inputText);
  data[key].output += estimateTokens(outputText);
  save();
  return data[key];
}

/** Increment today's completed-task counter. */
function incrementTask() {
  const data = load();
  const key  = todayKey();
  if (!data[key]) data[key] = { input: 0, output: 0, tasks: 0 };
  data[key].tasks += 1;
  save();
  return data[key];
}

/** Today's totals: { date, input, output, total, tasks }. */
function todayTotal() {
  const data = load();
  const key  = todayKey();
  const e = data[key] || { input: 0, output: 0, tasks: 0 };
  return {
    date   : key,
    input  : e.input,
    output : e.output,
    total  : e.input + e.output,
    tasks  : e.tasks || 0,
  };
}

/** All recorded days, newest first. */
function history() {
  const data = load();
  return Object.keys(data)
    .sort()
    .reverse()
    .map(date => ({
      date,
      input  : data[date].input  || 0,
      output : data[date].output || 0,
      total  : (data[date].input || 0) + (data[date].output || 0),
      tasks  : data[date].tasks || 0,
    }));
}

module.exports = { estimateTokens, record, incrementTask, todayTotal, history, todayKey, FILE };
