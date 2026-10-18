// src/ui/workspace.js — Workspace file-tree helpers for the local web UI
//
// Scans the agent's working directory and reads individual files for preview.
// All paths are validated to stay inside the configured working directory.
'use strict';

const fs   = require('fs');
const path = require('path');

// Directories that are never shown in the workspace tree.
const IGNORED_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.nuxt',
  '.cache', '.parcel-cache', '.turbo', 'coverage', '.nyc_output', '.idea',
  '.vscode', '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache',
  '.DS_Store', 'Thumbs.db',
]);

const MAX_DEPTH        = 12;
const MAX_ENTRIES      = 4000;
const MAX_PREVIEW_BYTES = 512 * 1024; // 512 KB

/**
 * Resolve a client-supplied relative path against the workspace root.
 * Throws if the result escapes the root (path traversal).
 */
function resolveInside(root, relPath) {
  const absRoot = path.resolve(root);
  const abs     = path.resolve(absRoot, relPath ? String(relPath) : '.');
  if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
    const err = new Error('Path is outside of the working directory');
    err.statusCode = 403;
    throw err;
  }
  return abs;
}

function scanDir(absDir, relDir, depth, budget, out) {
  if (depth > MAX_DEPTH || budget.count >= MAX_ENTRIES) return;

  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip silently
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  for (const entry of entries) {
    if (budget.count >= MAX_ENTRIES) break;
    if (IGNORED_NAMES.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue; // hide dotfiles (but keep .env.example?)

    const rel = relDir ? relDir + '/' + entry.name : entry.name;
    const abs = path.join(absDir, entry.name);
    budget.count += 1;

    if (entry.isDirectory()) {
      const node = { name: entry.name, path: rel, type: 'dir', children: [] };
      out.push(node);
      scanDir(abs, rel, depth + 1, budget, node.children);
    } else if (entry.isFile()) {
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { /* ignore */ }
      out.push({ name: entry.name, path: rel, type: 'file', size });
    }
  }
}

/** Build the full workspace tree for the given root directory. */
function buildTree(root) {
  const absRoot = path.resolve(root);
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
    const err = new Error('Working directory not found: ' + absRoot);
    err.statusCode = 404;
    throw err;
  }
  const tree = [];
  const budget = { count: 0 };
  scanDir(absRoot, '', 0, budget, tree);
  return {
    root: absRoot,
    name: path.basename(absRoot) || absRoot,
    tree,
    truncated: budget.count >= MAX_ENTRIES,
  };
}

/** Read a single file for preview. */
function readFile(root, relPath) {
  if (!relPath) {
    const err = new Error('Missing file path');
    err.statusCode = 400;
    throw err;
  }
  const abs  = resolveInside(root, relPath);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    const err = new Error('Not a file: ' + relPath);
    err.statusCode = 400;
    throw err;
  }
  if (stat.size > MAX_PREVIEW_BYTES) {
    const err = new Error('File is too large to preview (' + stat.size + ' bytes)');
    err.statusCode = 413;
    throw err;
  }
  const buf    = fs.readFileSync(abs);
  const sample = buf.subarray(0, 8192);
  const binary = sample.includes(0);
  return {
    path  : relPath,
    name  : path.basename(abs),
    size  : stat.size,
    binary,
    content: binary ? null : buf.toString('utf8'),
  };
}

module.exports = {
  buildTree,
  readFile,
  resolveInside,
  IGNORED_NAMES,
  MAX_PREVIEW_BYTES,
};
