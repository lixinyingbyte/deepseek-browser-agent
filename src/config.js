// src/config.js — Central configuration for DeepSeek Agent
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const i18n = require('./i18n');

// ─────────────────────────────────────────────
//  Default configuration
// ─────────────────────────────────────────────
const defaults = {
  // Browser
  DEEPSEEK_URL   : 'https://chat.deepseek.com',
  SESSION_DIR    : path.join(os.homedir(), '.deepseek-agent', 'session'),
  HEADLESS       : false,

  // Multi-account support ────────────────────────────────────────────────
  // Each account gets its own browser profile directory under ACCOUNTS_DIR;
  // a JSON registry tracks the accounts and which one is active.
  ACCOUNTS_DIR     : path.join(os.homedir(), '.deepseek-agent', 'accounts'),
  ACCOUNT_FILE     : null,          // defaults to <ACCOUNTS_DIR>/accounts.json
  ACTIVE_ACCOUNT   : null,          // name to force on startup (null = registry)
  ACCOUNT_ROTATION : 'manual',      // 'manual' | 'round-robin' | 'on-error'

  // Timing
  RESPONSE_TIMEOUT : 180_000,
  STABLE_DELAY     : 1_200,
  SEND_DELAY       : 200,

  // Agent
  MAX_ITERATIONS   : 40,
  WORKING_DIR      : process.cwd(),

  // Auto-resume after a network interruption.  When DeepSeek stops
  // generating mid-answer (network fluctuation) we automatically ask it to
  // continue instead of treating the truncated text as the final answer.
  AUTO_RESUME      : true,
  MAX_AUTO_RESUMES : 6,

  // Stall detection.  A response whose text has not changed for STABLE_DELAY
  // may just be a momentary server pause, not a finished answer.  We only
  // accept it as final once the text has been unchanged for STALL_TIMEOUT
  // (or once the page structurally looks finished).  This is the key guard
  // against accepting a mid-thought fragment as a completed task.
  STALL_TIMEOUT    : 25_000,

  // How many times we may ask the model to finish / add the completion
  // marker before giving up.  Set to 0 for UNLIMITED retries — a missing
  // (complete) marker will keep sending the model back until it produces one
  // (the MAX_ITERATIONS cap still applies as an overall safety net).
  MAX_FINAL_VALIDATIONS : 10000,

  // When true, a final answer that does not carry the explicit completion
  // marker is treated as possibly unfinished and sent back for confirmation.
  REQUIRE_COMPLETION_MARKER : true,

  // When an answer keeps getting cut off, fall back to clicking DeepSeek's
  // "regenerate" button (or re-sending the original task) instead of looping
  // on "please continue" forever.
  REGENERATE_ON_EXHAUST : true,

  // Logging — resolved below.  On Windows we prefer the D: drive.
  LOG_DIR          : null,

  // Output
  MAX_OUTPUT_LENGTH : 8_000,
  DEBUG             : false,
};

// ─────────────────────────────────────────────
//  Config loading priority (highest wins):
//
//  1. ~/.deepseek-agent/config.json  — global user config
//  2. ./deepseek-agent.config.json   — per-project config
// ─────────────────────────────────────────────

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    console.warn(i18n.t('config.parseFailed') + ' ' + filePath);
  }
  return {};
}

const globalConfigPath  = path.join(os.homedir(), '.deepseek-agent', 'config.json');
const projectConfigPath = path.join(process.cwd(), 'deepseek-agent.config.json');

const config = {
  ...defaults,
  ...loadJson(globalConfigPath),   // global overrides defaults
  ...loadJson(projectConfigPath),  // project overrides global
};

// Remove comment keys from JSON files
delete config._comment;

// Resolve session dir to absolute path
if (!path.isAbsolute(config.SESSION_DIR)) {
  config.SESSION_DIR = path.resolve(process.cwd(), config.SESSION_DIR);
}

// Resolve the multi-account directories to absolute paths
if (!path.isAbsolute(config.ACCOUNTS_DIR)) {
  config.ACCOUNTS_DIR = path.resolve(process.cwd(), config.ACCOUNTS_DIR);
}
if (config.ACCOUNT_FILE && !path.isAbsolute(config.ACCOUNT_FILE)) {
  config.ACCOUNT_FILE = path.resolve(process.cwd(), config.ACCOUNT_FILE);
}

// ── Resolve the log directory ────────────────────────────────────────────────
//  Logs should NOT be written to the C: drive (system drive) — instead we
//  prefer the D: drive on Windows so that user data is kept off the system
//  partition.  Resolution order:
//    1. Explicit LOG_DIR from a config file
//    2. D:\deepseek-agent\logs   (Windows, when the D: drive exists)
//    3. <home>/.deepseek-agent/logs  (fallback, any platform)
function resolveLogDir() {
  if (config.LOG_DIR && typeof config.LOG_DIR === 'string') {
    return path.isAbsolute(config.LOG_DIR)
      ? config.LOG_DIR
      : path.resolve(process.cwd(), config.LOG_DIR);
  }

  if (process.platform === 'win32') {
    const dDrive = 'D:\\deepseek-agent\\logs';
    try {
      // Confirm the D: drive root is reachable before committing to it.
      fs.accessSync('D:\\', fs.constants.F_OK);
      return dDrive;
    } catch {
      // D: not available — fall through to the home directory.
    }
  }

  return path.join(os.homedir(), '.deepseek-agent', 'logs');
}

config.LOG_DIR = resolveLogDir();

// Ensure required directories exist.  Directory creation is best-effort for
// the log dir so a missing/unwritable drive can never crash the agent.
fs.mkdirSync(config.SESSION_DIR, { recursive: true });
try {
  fs.mkdirSync(config.LOG_DIR, { recursive: true });
} catch (err) {
  // Fall back to the home directory if the preferred log location fails.
  config.LOG_DIR = path.join(os.homedir(), '.deepseek-agent', 'logs');
  try { fs.mkdirSync(config.LOG_DIR, { recursive: true }); } catch { /* ignore */ }
}

module.exports = config;
