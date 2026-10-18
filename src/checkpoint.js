// src/checkpoint.js — Snapshot & restore support so every write is undoable
'use strict';

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const CHECKPOINT_ROOT = path.join(os.homedir(), '.deepseek-agent', 'checkpoints');

/**
 * Keeps a per-session directory of file snapshots.
 * Snapshots are content-addressed (identical content stored once) and an
 * append-only journal records what changed so we can undo step by step.
 */
class CheckpointManager {
  constructor(sessionId) {
    this.sessionId = sessionId || 'session-' + Date.now();
    this.dir       = path.join(CHECKPOINT_ROOT, this.sessionId);
    this.blobsDir  = path.join(this.dir, 'blobs');
    this.journal   = path.join(this.dir, 'journal.jsonl');
    this._seq      = 0;
    fs.mkdirSync(this.blobsDir, { recursive: true });
    if (!fs.existsSync(this.journal)) fs.writeFileSync(this.journal, '', 'utf8');
  }

  _hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  _blobPath(hash) {
    return path.join(this.blobsDir, hash);
  }

  _storeBlob(content) {
    const hash = this._hash(content);
    const p    = this._blobPath(hash);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, 'utf8');
    return hash;
  }

  _append(entry) {
    fs.appendFileSync(this.journal, JSON.stringify(entry) + '\n', 'utf8');
  }

  _readJournal() {
    if (!fs.existsSync(this.journal)) return [];
    return fs
      .readFileSync(this.journal, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  }

  /**
   * Record the state of a path BEFORE a mutating operation.
   * mode "file" stores contents; mode "absent" marks that it did not exist,
   * so a restore can recreate or remove it exactly.
   */
  snapshot(absPath, label) {
    const id = Date.now() + '-' + this._seq++;
    let mode, blob;
    if (fs.existsSync(absPath)) {
      mode = 'file';
      blob = this._storeBlob(fs.readFileSync(absPath, 'utf8'));
    } else {
      mode = 'absent';
      blob = null;
    }
    this._append({
      id,
      ts   : new Date().toISOString(),
      path : absPath,
      mode,
      blob,
      label: label || null,
    });
    return id;
  }

  /** List recorded checkpoints, most recent first. */
  list(limit) {
    const n = limit || 50;
    return this._readJournal().slice(-n).reverse();
  }

  /** Restore the most recent checkpoint, or a specific one by id. */
  restore(id) {
    const entries = this._readJournal();
    let entry;
    if (id) {
      entry = entries.find(e => e.id === id);
      if (!entry) throw new Error('Checkpoint not found: ' + id);
    } else {
      entry = entries[entries.length - 1];
      if (!entry) throw new Error('No checkpoints recorded for this session');
    }

    if (entry.mode === 'absent') {
      if (fs.existsSync(entry.path)) fs.unlinkSync(entry.path);
    } else {
      const src = this._blobPath(entry.blob);
      if (!fs.existsSync(src)) throw new Error('Checkpoint blob missing: ' + entry.blob);
      fs.mkdirSync(path.dirname(entry.path), { recursive: true });
      fs.copyFileSync(src, entry.path);
    }
    return entry;
  }

  /** Remove all checkpoints for this session. */
  clear() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.blobsDir, { recursive: true });
    fs.writeFileSync(this.journal, '', 'utf8');
  }
}

module.exports = { CheckpointManager, CHECKPOINT_ROOT };
