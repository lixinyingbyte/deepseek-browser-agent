// src/tools.js — All tools available to the AI agent
'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');
const http          = require('http');
const https         = require('https');
const config        = require('./config');
const { CheckpointManager } = require('./checkpoint');
const { confirm }   = require('./confirm');

// ─────────────────────────────────────────────
//  Session-wide checkpoint manager
// ─────────────────────────────────────────────
let checkpoints = null;
function getCheckpoints() {
  if (!checkpoints) checkpoints = new CheckpointManager();
  return checkpoints;
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

/** Truncate long strings so they don't blow up the context window */
function truncate(str, max = config.MAX_OUTPUT_LENGTH) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return (
    s.slice(0, half) +
    `\n\n⚠ [OUTPUT TRUNCATED — ${s.length.toLocaleString()} chars total, showing first & last ${half} chars]\n\n` +
    s.slice(-half)
  );
}

/** Resolve a path relative to the working directory */
function resolve(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(config.WORKING_DIR, filePath);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Snapshot a file (or its absence) before we mutate it. */
function checkpointFile(absPath, label) {
  try {
    return getCheckpoints().snapshot(absPath, label);
  } catch {
    return null; // checkpointing must never break the actual operation
  }
}

/**
 * Patterns that mark a shell command as destructive. When one matches we
 * pause for user confirmation before executing.
 */
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-[a-z]*r/i,
  /\brm\s+-[a-z]*f/i,
  /\bdel\s+\/f/i,
  /\brd\s+\/s/i,
  /\brmdir\s+\/s/i,
  /\bformat\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bnpm\s+publish\b/i,
  /\byarn\s+publish\b/i,
  /\bpip\s+uninstall\b/i,
  /\b(shutdown|reboot|mkfs|dd\s+if=)/i,
];

function isDangerousCommand(cmd) {
  return DANGEROUS_COMMAND_PATTERNS.some(re => re.test(cmd));
}

// ─────────────────────────────────────────────
//  Tool definitions
// ─────────────────────────────────────────────

const TOOLS = {

  // ── File Reading ────────────────────────────────────────────────────────────
  read_file: {
    description: 'Read the full contents of a file. Optionally read specific line ranges.',
    parameters: {
      path        : { type: 'string',  required: true,  description: 'Path to the file' },
      start_line  : { type: 'number',  required: false, description: 'First line to read (1-indexed)' },
      end_line    : { type: 'number',  required: false, description: 'Last line to read (inclusive)' },
    },
    async execute({ path: filePath, start_line, end_line }) {
      const abs = resolve(filePath);
      if (!fs.existsSync(abs))       throw new Error(`File not found: ${filePath}`);
      if (fs.statSync(abs).isDirectory()) throw new Error(`${filePath} is a directory`);

      let content = fs.readFileSync(abs, 'utf8');

      if (start_line != null || end_line != null) {
        const lines = content.split('\n');
        const s = Math.max(0, (start_line || 1) - 1);
        const e = end_line != null ? end_line : lines.length;
        content = lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join('\n');
        return `[${filePath} | lines ${s + 1}–${e}]\n${truncate(content)}`;
      }

      const lineCount = content.split('\n').length;
      if (lineCount <= 300) {
        const numbered = content.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
        return `[${filePath} | ${lineCount} lines]\n${numbered}`;
      }
      return `[${filePath} | ${lineCount} lines — use start_line/end_line to read sections]\n${truncate(content)}`;
    },
  },

  // ── File Writing ────────────────────────────────────────────────────────────
  write_file: {
    description: 'Write (create or overwrite) a file with given content. Creates parent directories automatically. A checkpoint is taken automatically so the change can be undone.',
    parameters: {
      path    : { type: 'string', required: true, description: 'Destination file path' },
      content : { type: 'string', required: true, description: 'Full file content to write' },
    },
    async execute({ path: filePath, content }) {
      const abs = resolve(filePath);
      checkpointFile(abs, `write_file: ${filePath}`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      const lineCount = content.split('\n').length;
      return `✓ Wrote ${formatBytes(Buffer.byteLength(content, 'utf8'))} (${lineCount} lines) → ${filePath}`;
    },
  },

  // ── Partial Edit (apply_patch) ───────────────────────────────────────────────
  apply_patch: {
    description:
      'Edit part of a file without rewriting the whole thing. Provide one or more ' +
      'search/replace hunks. Each hunk finds `search` (exact text, or regex when ' +
      'use_regex is true) and replaces it with `replace`. Fails atomically if any ' +
      'search text is not found or is ambiguous, so no partial edits are left behind.',
    parameters: {
      path      : { type: 'string',  required: true,  description: 'File to edit' },
      patches   : { type: 'array',   required: true,  description: 'Array of {search, replace, all?} hunk objects' },
      use_regex : { type: 'boolean', required: false, description: 'Treat each search string as a regex (default false)' },
    },
    async execute({ path: filePath, patches, use_regex = false }) {
      const abs = resolve(filePath);
      if (!fs.existsSync(abs)) throw new Error(`File not found: ${filePath}`);
      if (!Array.isArray(patches) || patches.length === 0) {
        throw new Error('"patches" must be a non-empty array of {search, replace} objects');
      }

      let content = fs.readFileSync(abs, 'utf8');
      const applied = [];
      const failures = [];

      // Validate every hunk first so the edit is atomic.
      for (let i = 0; i < patches.length; i++) {
        const { search, replace = '', all = false } = patches[i];
        if (typeof search !== 'string' || search.length === 0) {
          failures.push(`hunk #${i + 1}: missing non-empty "search"`);
          continue;
        }

        let count;
        if (use_regex) {
          const re = new RegExp(search, all ? 'g' : '');
          count = (content.match(new RegExp(search, 'g')) || []).length;
        } else {
          count = content.split(search).length - 1;
        }

        if (count === 0) {
          failures.push(`hunk #${i + 1}: search text not found`);
        } else if (count > 1 && !all) {
          failures.push(`hunk #${i + 1}: search text matches ${count} places — add "all": true or make it unique`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`Patch aborted (no changes written):\n  - ${failures.join('\n  - ')}`);
      }

      // Apply.
      for (let i = 0; i < patches.length; i++) {
        const { search, replace = '', all = false } = patches[i];
        if (use_regex) {
          const re = new RegExp(search, all ? 'g' : '');
          content = content.replace(re, replace);
        } else if (all) {
          content = content.split(search).join(replace);
        } else {
          content = content.replace(search, replace);
        }
        applied.push(`hunk #${i + 1}: ✓`);
      }

      checkpointFile(abs, `apply_patch: ${filePath}`);
      fs.writeFileSync(abs, content, 'utf8');
      return `✓ Patched ${filePath} (${patches.length} hunk(s)):\n${applied.join('\n')}`;
    },
  },

  // ── Append to File ──────────────────────────────────────────────────────────
  append_to_file: {
    description: 'Append text to the end of an existing file (or create it if missing).',
    parameters: {
      path    : { type: 'string', required: true, description: 'File path' },
      content : { type: 'string', required: true, description: 'Text to append' },
    },
    async execute({ path: filePath, content }) {
      const abs = resolve(filePath);
      checkpointFile(abs, `append_to_file: ${filePath}`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.appendFileSync(abs, content, 'utf8');
      return `✓ Appended ${formatBytes(Buffer.byteLength(content, 'utf8'))} to ${filePath}`;
    },
  },

  // ── Find & Replace in File ──────────────────────────────────────────────────
  replace_in_file: {
    description: 'Find and replace text in a file. Supports regex patterns.',
    parameters: {
      path           : { type: 'string',  required: true,  description: 'File path' },
      find           : { type: 'string',  required: true,  description: 'Text to find' },
      replace        : { type: 'string',  required: true,  description: 'Replacement text' },
      use_regex      : { type: 'boolean', required: false, description: 'Treat "find" as a regex pattern (default: false)' },
      all_occurrences: { type: 'boolean', required: false, description: 'Replace all occurrences (default: true)' },
    },
    async execute({ path: filePath, find, replace, use_regex = false, all_occurrences = true }) {
      const abs     = resolve(filePath);
      let   content = fs.readFileSync(abs, 'utf8');
      const original = content;

      if (use_regex) {
        const re = new RegExp(find, all_occurrences ? 'g' : '');
        content = content.replace(re, replace);
      } else if (all_occurrences) {
        content = content.split(find).join(replace);
      } else {
        content = content.replace(find, replace);
      }

      if (content === original) {
        return `⚠ No matches found for "${find}" in ${filePath}`;
      }

      const count = (original.match(
        new RegExp(use_regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      ) || []).length;

      checkpointFile(abs, `replace_in_file: ${filePath}`);
      fs.writeFileSync(abs, content, 'utf8');
      return `✓ Replaced ${count} occurrence(s) of "${find}" in ${filePath}`;
    },
  },

  // ── Delete File ─────────────────────────────────────────────────────────────
  delete_file: {
    description: 'Permanently delete a file. Requires user confirmation. A checkpoint is taken so it can be restored.',
    parameters: {
      path: { type: 'string', required: true, description: 'File to delete' },
    },
    async execute({ path: filePath }) {
      const abs = resolve(filePath);
      if (!fs.existsSync(abs)) throw new Error(`File not found: ${filePath}`);

      const ok = await confirm(`Delete file "${filePath}"?`, { defaultAllow: false });
      if (!ok) return `✗ Deletion of ${filePath} was declined by the user.`;

      checkpointFile(abs, `delete_file: ${filePath}`);
      fs.unlinkSync(abs);
      return `✓ Deleted ${filePath} (checkpoint saved — use checkpoint_restore to undo)`;
    },
  },

  // ── List Directory ──────────────────────────────────────────────────────────
  list_directory: {
    description: 'List files and folders in a directory, optionally recursive.',
    parameters: {
      path        : { type: 'string',  required: false, description: 'Directory to list (default: working dir)' },
      recursive   : { type: 'boolean', required: false, description: 'Recurse into sub-directories (default: false)' },
      show_hidden : { type: 'boolean', required: false, description: 'Include hidden files starting with . (default: false)' },
    },
    async execute({ path: dirPath = '.', recursive = false, show_hidden = false }) {
      const abs = resolve(dirPath);
      if (!fs.existsSync(abs)) throw new Error(`Directory not found: ${dirPath}`);
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      const lines = [];
      for (const e of entries) {
        if (!show_hidden && e.name.startsWith('.')) continue;
        if (e.isDirectory()) {
          lines.push(`${e.name}/`);
          if (recursive) {
            const walk = (dir, prefix) => {
              for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
                if (!show_hidden && child.name.startsWith('.')) continue;
                lines.push(`${prefix}${child.name}${child.isDirectory() ? '/' : ''}`);
                if (child.isDirectory()) walk(path.join(dir, child.name), `${prefix}${child.name}/`);
              }
            };
            walk(path.join(abs, e.name), `${e.name}/`);
          }
        } else {
          lines.push(e.name);
        }
      }
      return truncate(lines.join('\n')) || '(empty directory)';
    },
  },

  // ── Create Directory ────────────────────────────────────────────────────────
  create_directory: {
    description: 'Create a directory (and all necessary parent directories).',
    parameters: {
      path: { type: 'string', required: true, description: 'Directory path to create' },
    },
    async execute({ path: dirPath }) {
      const abs = resolve(dirPath);
      fs.mkdirSync(abs, { recursive: true });
      return `✓ Created directory: ${dirPath}`;
    },
  },

  // ── Move / Rename ───────────────────────────────────────────────────────────
  move_file: {
    description: 'Move or rename a file or directory.',
    parameters: {
      source      : { type: 'string', required: true, description: 'Source path' },
      destination : { type: 'string', required: true, description: 'Destination path' },
    },
    async execute({ source, destination }) {
      const src  = resolve(source);
      const dest = resolve(destination);
      if (!fs.existsSync(src)) throw new Error(`Source not found: ${source}`);
      checkpointFile(src, `move_file(source): ${source}`);
      checkpointFile(dest, `move_file(dest): ${destination}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
      return `✓ Moved: ${source} → ${destination}`;
    },
  },

  // ── Copy File ───────────────────────────────────────────────────────────────
  copy_file: {
    description: 'Copy a file to a new location.',
    parameters: {
      source      : { type: 'string', required: true, description: 'Source file path' },
      destination : { type: 'string', required: true, description: 'Destination file path' },
    },
    async execute({ source, destination }) {
      const src  = resolve(source);
      const dest = resolve(destination);
      if (!fs.existsSync(src)) throw new Error(`Source not found: ${source}`);
      checkpointFile(dest, `copy_file(dest): ${destination}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      return `✓ Copied: ${source} → ${destination}`;
    },
  },

  // ── File Info ───────────────────────────────────────────────────────────────
  get_file_info: {
    description: 'Get metadata about a file or directory (size, modified date, line count, etc.).',
    parameters: {
      path: { type: 'string', required: true, description: 'File or directory path' },
    },
    async execute({ path: filePath }) {
      const abs = resolve(filePath);
      if (!fs.existsSync(abs)) throw new Error(`Not found: ${filePath}`);
      const stat = fs.statSync(abs);
      const info = {
        path        : abs,
        type        : stat.isDirectory() ? 'directory' : 'file',
        size        : stat.size,
        size_human  : formatBytes(stat.size),
        modified    : stat.mtime.toISOString(),
        created     : stat.birthtime.toISOString(),
        permissions : `0${(stat.mode & 0o777).toString(8)}`,
      };
      if (stat.isFile()) {
        const content = fs.readFileSync(abs, 'utf8');
        info.lines = content.split('\n').length;
        info.encoding = 'utf-8';
      }
      return JSON.stringify(info, null, 2);
    },
  },

  // ── Run Command ─────────────────────────────────────────────────────────────
  run_command: {
    description:
      'Execute a shell command and return its output. Runs in the working directory by default. ' +
      'Destructive commands (rm -rf, git push --force, npm publish, …) require user confirmation.',
    parameters: {
      command : { type: 'string',  required: true,  description: 'Shell command to run' },
      cwd     : { type: 'string',  required: false, description: 'Working directory for the command' },
      timeout : { type: 'number',  required: false, description: 'Timeout in milliseconds (default 60000)' },
      env     : { type: 'object',  required: false, description: 'Extra environment variables as key-value pairs' },
    },
    async execute({ command, cwd, timeout = 60_000, env = {} }) {
      const workDir = cwd ? resolve(cwd) : config.WORKING_DIR;

      if (isDangerousCommand(command)) {
        const ok = await confirm(`Run potentially destructive command?\n    ${command}`, { defaultAllow: false });
        if (!ok) return `✗ Command declined by the user: ${command}`;
      }

      try {
        const output = execSync(command, {
          cwd         : workDir,
          encoding    : 'utf8',
          timeout,
          maxBuffer   : 20 * 1024 * 1024,
          env         : { ...process.env, ...env },
          stdio       : ['pipe', 'pipe', 'pipe'],
        });
        const result = (output || '').trim();
        return truncate(result || '(command completed with no output)');
      } catch (err) {
        const stdout = (err.stdout || '').trim();
        const stderr = (err.stderr || '').trim();
        const combined = [
          stdout && `STDOUT:\n${stdout}`,
          stderr && `STDERR:\n${stderr}`,
        ].filter(Boolean).join('\n\n');
        throw new Error(`Command failed (exit code ${err.status}):\n${truncate(combined || err.message)}`);
      }
    },
  },

  // ── Find Files ──────────────────────────────────────────────────────────────
  find_files: {
    description: 'Search for files by name pattern (glob-style, e.g. "*.js", "test_*").',
    parameters: {
      pattern   : { type: 'string', required: true,  description: 'Filename pattern (e.g. "*.ts")' },
      directory : { type: 'string', required: false, description: 'Directory to search (default: working dir)' },
      exclude   : { type: 'string', required: false, description: 'Pattern to exclude from results' },
    },
    async execute({ pattern, directory = '.', exclude }) {
      const dir = resolve(directory);
      let cmd = `find "${dir}" -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*"`;
      if (exclude) cmd += ` -not -path "*${exclude}*"`;
      cmd += ' | sort | head -100';

      const result = execSync(cmd, { encoding: 'utf8', cwd: config.WORKING_DIR }).trim();
      return result || `No files matching "${pattern}" in ${directory}`;
    },
  },

  // ── Search in Files (grep) ───────────────────────────────────────────────────
  search_in_files: {
    description: 'Search for text patterns inside files (like grep -r). Returns matching lines with filenames.',
    parameters: {
      pattern       : { type: 'string',  required: true,  description: 'Text or regex to search for' },
      directory     : { type: 'string',  required: false, description: 'Directory to search (default: working dir)' },
      file_pattern  : { type: 'string',  required: false, description: 'Only search files matching this (e.g. "*.js")' },
      case_sensitive: { type: 'boolean', required: false, description: 'Case-sensitive search (default: false)' },
      context_lines : { type: 'number',  required: false, description: 'Lines of context around each match (default: 2)' },
    },
    async execute({ pattern, directory = '.', file_pattern, case_sensitive = false, context_lines = 2 }) {
      const dir     = resolve(directory);
      const flags   = case_sensitive ? '' : '-i';
      const include = file_pattern ? `--include="${file_pattern}"` : '';
      const ctx     = context_lines > 0 ? `-C ${context_lines}` : '';
      const cmd     = `grep -rn ${flags} ${ctx} ${include} "${pattern}" "${dir}" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null | head -150`;

      try {
        const result = execSync(cmd, { encoding: 'utf8' }).trim();
        return truncate(result) || `No matches found for: ${pattern}`;
      } catch (err) {
        if (err.status === 1) return `No matches found for: ${pattern}`;
        throw err;
      }
    },
  },

  // ── Fetch URL ───────────────────────────────────────────────────────────────
  read_url: {
    description: 'Fetch the text content of a URL (useful for reading documentation, APIs, etc.).',
    parameters: {
      url: { type: 'string', required: true, description: 'Full URL to fetch (http or https)' },
    },
    async execute({ url }) {
      return new Promise((resolve_p, reject) => {
        const client  = url.startsWith('https') ? https : http;
        const options = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DeepSeekAgent/1.0)',
            'Accept'    : 'text/html,text/plain,application/json',
          },
        };

        const req = client.get(url, options, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return TOOLS.read_url.execute({ url: res.headers.location }).then(resolve_p).catch(reject);
          }

          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            const text = data
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s{3,}/g, '\n\n')
              .trim();
            resolve_p(truncate(text));
          });
        });

        req.on('error', reject);
        req.setTimeout(15_000, () => { req.destroy(); reject(new Error('URL fetch timed out')); });
      });
    },
  },

  // ── Write Multiple Files (batch) ────────────────────────────────────────────
  write_files: {
    description: 'Write multiple files at once — useful for scaffolding projects.',
    parameters: {
      files: {
        type       : 'array',
        required   : true,
        description: 'Array of {path, content} objects',
      },
    },
    async execute({ files }) {
      if (!Array.isArray(files)) throw new Error('"files" must be an array of {path, content}');
      const results = [];
      for (const { path: filePath, content } of files) {
        const abs = resolve(filePath);
        checkpointFile(abs, `write_files: ${filePath}`);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        results.push(`✓ ${filePath}`);
      }
      return `Wrote ${results.length} files:\n${results.join('\n')}`;
    },
  },

  // ─────────────────────────────────────────────
  //  Git tools
  // ─────────────────────────────────────────────
  git_status: {
    description: 'Show the Git working-tree status (short format).',
    parameters: {
      cwd: { type: 'string', required: false, description: 'Repository directory (default: working dir)' },
    },
    async execute({ cwd }) {
      return runGit(cwd, 'status --short --branch');
    },
  },

  git_diff: {
    description: 'Show unstaged (or staged) changes as a diff.',
    parameters: {
      cwd    : { type: 'string',  required: false, description: 'Repository directory (default: working dir)' },
      staged : { type: 'boolean', required: false, description: 'Show staged (--cached) changes instead (default: false)' },
      path   : { type: 'string',  required: false, description: 'Limit the diff to a specific file or path' },
    },
    async execute({ cwd, staged = false, path: p }) {
      const parts = ['diff'];
      if (staged) parts.push('--cached');
      if (p) parts.push('--', `"${p}"`);
      return runGit(cwd, parts.join(' '));
    },
  },

  git_log: {
    description: 'Show recent commit history.',
    parameters: {
      cwd   : { type: 'string', required: false, description: 'Repository directory (default: working dir)' },
      limit : { type: 'number', required: false, description: 'Number of commits to show (default 15)' },
    },
    async execute({ cwd, limit = 15 }) {
      return runGit(cwd, `log --oneline --decorate -n ${Math.max(1, Math.floor(limit))}`);
    },
  },

  git_add: {
    description: 'Stage files for commit.',
    parameters: {
      cwd   : { type: 'string', required: false, description: 'Repository directory (default: working dir)' },
      paths : { type: 'array',  required: true,  description: 'Array of file paths to stage (use ["."] to stage everything)' },
    },
    async execute({ cwd, paths }) {
      if (!Array.isArray(paths) || paths.length === 0) throw new Error('"paths" must be a non-empty array');
      const quoted = paths.map(p => `"${p}"`).join(' ');
      return runGit(cwd, `add ${quoted}`);
    },
  },

  git_commit: {
    description: 'Create a commit with the given message. Requires confirmation.',
    parameters: {
      cwd     : { type: 'string',  required: false, description: 'Repository directory (default: working dir)' },
      message : { type: 'string',  required: true,  description: 'Commit message' },
      all     : { type: 'boolean', required: false, description: 'Stage all tracked changes first (-a) (default: false)' },
    },
    async execute({ cwd, message, all = false }) {
      const ok = await confirm(`Create git commit?\n    message: ${message}`, { defaultAllow: false });
      if (!ok) return '✗ Commit declined by the user.';
      const esc = message.replace(/"/g, '\\"');
      return runGit(cwd, `commit ${all ? '-a ' : ''}-m "${esc}"`);
    },
  },

  git_branch: {
    description: 'List branches, or create/switch to one when a name is given.',
    parameters: {
      cwd  : { type: 'string', required: false, description: 'Repository directory (default: working dir)' },
      name : { type: 'string', required: false, description: 'Branch to create & switch to (omit to just list branches)' },
    },
    async execute({ cwd, name }) {
      if (!name) return runGit(cwd, 'branch -a');
      const ok = await confirm(`Create and switch to branch "${name}"?`, { defaultAllow: true });
      if (!ok) return '✗ Branch creation declined by the user.';
      return runGit(cwd, `checkout -b "${name}"`);
    },
  },

  git_blame: {
    description: 'Show what revision and author last modified each line of a file.',
    parameters: {
      cwd  : { type: 'string', required: false, description: 'Repository directory (default: working dir)' },
      path : { type: 'string', required: true,  description: 'File to blame' },
    },
    async execute({ cwd, path: p }) {
      return runGit(cwd, `blame -- "${p}"`);
    },
  },

  // ─────────────────────────────────────────────
  //  Checkpoint tools
  // ─────────────────────────────────────────────
  checkpoint_list: {
    description: 'List saved checkpoints for this session (newest first). Each entry can be restored.',
    parameters: {
      limit: { type: 'number', required: false, description: 'Max entries to return (default 50)' },
    },
    async execute({ limit = 50 }) {
      const entries = getCheckpoints().list(limit);
      if (entries.length === 0) return 'No checkpoints recorded yet.';
      return entries.map(e =>
        `${e.id}  ${e.ts}  ${e.mode === 'absent' ? '(did not exist)' : '(file)'}  ${e.path}${e.label ? '  — ' + e.label : ''}`
      ).join('\n');
    },
  },

  checkpoint_restore: {
    description: 'Restore a file to a previous checkpoint. Omit "id" to undo the most recent change.',
    parameters: {
      id: { type: 'string', required: false, description: 'Checkpoint id from checkpoint_list (default: most recent)' },
    },
    async execute({ id }) {
      const entry = getCheckpoints().restore(id);
      return `✓ Restored ${entry.path} to checkpoint ${entry.id} (${entry.ts})`;
    },
  },

  checkpoint_clear: {
    description: 'Delete all checkpoints for this session.',
    parameters: {},
    async execute() {
      const ok = await confirm('Clear all checkpoints for this session?', { defaultAllow: false });
      if (!ok) return '✗ Clear declined by the user.';
      getCheckpoints().clear();
      return '✓ Checkpoints cleared.';
    },
  },

};

// ─────────────────────────────────────────────
//  Git helper
// ─────────────────────────────────────────────
function runGit(cwd, args) {
  const workDir = cwd ? resolve(cwd) : config.WORKING_DIR;
  try {
    const out = execSync(`git ${args}`, {
      cwd       : workDir,
      encoding  : 'utf8',
      timeout   : 30_000,
      maxBuffer : 20 * 1024 * 1024,
    }).trim();
    return truncate(out || '(no output)');
  } catch (err) {
    const stderr = (err.stderr || '').trim();
    const stdout = (err.stdout || '').trim();
    throw new Error(`git ${args} failed:\n${truncate(stderr || stdout || err.message)}`);
  }
}

// ─────────────────────────────────────────────
//  Generate tool docs for the system prompt
// ─────────────────────────────────────────────
function getToolDescriptions() {
  return Object.entries(TOOLS).map(([name, tool]) => {
    const paramLines = Object.entries(tool.parameters || {}).map(([pName, p]) =>
      `    - ${pName} (${p.type}${p.required ? ', REQUIRED' : ''}): ${p.description || ''}`
    ).join('\n');

    return `### ${name}\n  ${tool.description}\n  Parameters:\n${paramLines}`;
  }).join('\n\n');
}

// ─────────────────────────────────────────────
//  Execute a tool by name
// ─────────────────────────────────────────────
async function executeTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) {
    const available = Object.keys(TOOLS).join(', ');
    throw new Error(`Unknown tool: "${name}". Available tools: ${available}`);
  }
  return await tool.execute(args || {});
}

module.exports = { TOOLS, executeTool, getToolDescriptions };
