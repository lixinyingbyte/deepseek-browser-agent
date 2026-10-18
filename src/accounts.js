// src/accounts.js — Multi-account registry & rotation for DeepSeek Agent
//
// DeepSeek's web UI keeps the login inside a browser profile. To support
// rotating between several accounts we give each account its own Playwright
// persistent-context directory and keep a small JSON registry describing them.
//
// This module owns three concerns:
//   1. The registry (list / add / remove / active account) persisted to disk.
//   2. Resolving an account name to a concrete session directory.
//   3. Rotation policy (manual / round-robin / on-error).
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const config = require('./config');
const logger = require('./logger');
const i18n   = require('./i18n');

const REGISTRY_VERSION = 1;

// ─────────────────────────────────────────────
//  Validation helpers
// ─────────────────────────────────────────────

/** Account names become directory names, so keep them filesystem-safe. */
const NAME_RE = /^[A-Za-z0-9._\-]{1,64}$/;

function isValidName(name) {
  return typeof name === 'string' && NAME_RE.test(name) && name !== '.' && name !== '..';
}

function nowIso() {
  return new Date().toISOString();
}

// ─────────────────────────────────────────────
//  AccountManager
// ─────────────────────────────────────────────

class AccountManager {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseDir]      Directory that holds all account profiles.
   * @param {string} [opts.registryFile] Path to the JSON registry.
   * @param {string} [opts.defaultDir]   Session dir used for the implicit
   *                                     "default" account (config.SESSION_DIR).
   * @param {string} [opts.rotation]     'manual' | 'round-robin' | 'on-error'.
   */
  constructor(opts = {}) {
    this.baseDir = opts.baseDir
      || config.ACCOUNTS_DIR
      || path.join(os.homedir(), '.deepseek-agent', 'accounts');

    this.registryFile = opts.registryFile
      || config.ACCOUNT_FILE
      || path.join(this.baseDir, 'accounts.json');

    this.defaultDir = opts.defaultDir || config.SESSION_DIR;
    this.rotation   = opts.rotation  || config.ACCOUNT_ROTATION || 'manual';

    this._registry = null;
  }

  // ── Registry persistence ───────────────────────────────────────────────────

  /** Load the registry from disk (or build a fresh one). Never throws. */
  load() {
    if (this._registry) return this._registry;

    let data = null;
    try {
      if (fs.existsSync(this.registryFile)) {
        data = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      }
    } catch (err) {
      logger.warn(`${i18n.t('accounts.registryParseFailed')} ${err.message}`);
      data = null;
    }

    if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) {
      data = { version: REGISTRY_VERSION, active: null, accounts: [] };
    }

    // Ensure the implicit "default" account always exists and points at the
    // classic single-session directory so existing users keep working.
    if (!data.accounts.some(a => a.name === 'default')) {
      data.accounts.unshift({
        name       : 'default',
        label      : 'Default',
        sessionDir : this.defaultDir,
        createdAt  : nowIso(),
        lastUsedAt : null,
      });
    }

    if (!data.active || !data.accounts.some(a => a.name === data.active)) {
      data.active = data.accounts[0].name;
    }

    this._registry = data;
    return this._registry;
  }

  /** Persist the registry to disk. Creates the base directory if needed. */
  save() {
    const data = this.load();
    try {
      fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
      fs.writeFileSync(this.registryFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      logger.warn(`${i18n.t('accounts.registrySaveFailed')} ${err.message}`);
    }
    return data;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** All accounts as a shallow copy, with a boolean `hasProfile` flag. */
  list() {
    const data = this.load();
    return data.accounts.map(a => ({
      ...a,
      hasProfile : this._profileExists(a.sessionDir),
      active     : a.name === data.active,
    }));
  }

  /** Look up a single account by name, or null. */
  get(name) {
    const data = this.load();
    const acct = data.accounts.find(a => a.name === name);
    if (!acct) return null;
    return { ...acct, active: acct.name === data.active, hasProfile: this._profileExists(acct.sessionDir) };
  }

  has(name) {
    return !!this.load().accounts.find(a => a.name === name);
  }

  /** The currently active account descriptor. */
  active() {
    const data = this.load();
    return this.get(data.active);
  }

  activeName() {
    return this.load().active;
  }

  /** Resolve an account name (or the active one) to its session directory. */
  resolveSessionDir(name) {
    const acct = name ? this.get(name) : this.active();
    if (!acct) throw new Error(i18n.t('accounts.notFound', { name: String(name) }));
    return path.resolve(acct.sessionDir);
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Add a new account. Creates its profile directory eagerly so the user can
   * log in to it right away.
   */
  add(name, { label } = {}) {
    if (!isValidName(name)) {
      throw new Error(i18n.t('accounts.invalidName', { name: String(name) }));
    }
    const data = this.load();
    if (data.accounts.some(a => a.name === name)) {
      throw new Error(i18n.t('accounts.alreadyExists', { name }));
    }

    const sessionDir = path.join(this.baseDir, name);
    fs.mkdirSync(sessionDir, { recursive: true });

    const acct = {
      name,
      label      : label || name,
      sessionDir,
      createdAt  : nowIso(),
      lastUsedAt : null,
    };
    data.accounts.push(acct);
    this.save();
    return this.get(name);
  }

  /**
   * Remove an account. The implicit "default" account cannot be removed.
   * When `deleteProfile` is true its profile directory is deleted too.
   */
  remove(name, { deleteProfile = false } = {}) {
    if (name === 'default') {
      throw new Error(i18n.t('accounts.cannotRemoveDefault'));
    }
    const data = this.load();
    const idx  = data.accounts.findIndex(a => a.name === name);
    if (idx === -1) throw new Error(i18n.t('accounts.notFound', { name }));

    const [removed] = data.accounts.splice(idx, 1);

    if (deleteProfile) {
      try { fs.rmSync(removed.sessionDir, { recursive: true, force: true }); }
      catch (err) { logger.warn(`${i18n.t('accounts.removeProfileFailed')} ${err.message}`); }
    }

    if (data.active === name) data.active = data.accounts[0] ? data.accounts[0].name : 'default';
    this.save();
    return removed;
  }

  /** Mark an account as active. */
  setActive(name) {
    const data = this.load();
    const acct = data.accounts.find(a => a.name === name);
    if (!acct) throw new Error(i18n.t('accounts.notFound', { name }));
    acct.lastUsedAt = nowIso();
    data.active = name;
    this.save();
    return this.get(name);
  }

  /**
   * Advance the active pointer according to the rotation policy and return the
   * newly-active account.
   *
   *   • manual      → stays on the current account (returns it unchanged)
   *   • round-robin → next account in the list, wrapping around
   *   • on-error    → same as round-robin; callers invoke this after a failure
   */
  next({ force = false } = {}) {
    const data = this.load();
    if (data.accounts.length <= 1) return this.active();

    if (this.rotation === 'manual' && !force) {
      return this.active();
    }

    const idx  = data.accounts.findIndex(a => a.name === data.active);
    const next = data.accounts[(idx + 1) % data.accounts.length];
    return this.setActive(next.name);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _profileExists(dir) {
    try { return fs.existsSync(dir) && fs.readdirSync(dir).length > 0; }
    catch { return false; }
  }
}

module.exports = { AccountManager, isValidName, REGISTRY_VERSION };
