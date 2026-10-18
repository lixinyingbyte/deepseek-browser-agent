# Tools Reference

> Every tool the agent can invoke, defined in `src/tools.js`.

The model calls tools by emitting a fenced `tool_call` block. The framework parses it, runs the matching tool, and feeds the result back. File-mutating tools automatically take a **checkpoint** so any change can be undone with `checkpoint_restore`.

---

## File reading

### read_file
Read a file's contents, optionally a line range.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | File path |
| `start_line` | number | no | First line (1-indexed) |
| `end_line` | number | no | Last line (inclusive) |

### list_directory
List files/folders, optionally recursive.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | no | Directory (default: working dir) |
| `recursive` | bool | no | Recurse into subdirs |
| `show_hidden` | bool | no | Include dotfiles |

### get_file_info
Metadata: size, modified date, line count.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | File or directory |

---

## File writing

### write_file
Create or overwrite a file (creates parent dirs). **Checkpoints before writing.**

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | Destination |
| `content` | string | yes | Full content |

### apply_patch
Edit part of a file via search/replace hunks. Fails atomically if any hunk is missing or ambiguous. **Preferred over write_file for partial edits.**

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | File to edit |
| `patches` | array | yes | `{search, replace, all?}` objects |
| `use_regex` | bool | no | Treat search as regex |

### append_to_file
Append text (creates file if missing). **Checkpoints.**

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | File path |
| `content` | string | yes | Text to append |

### replace_in_file
Find and replace, with optional regex. **Checkpoints.**

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | File path |
| `find` | string | yes | Text/regex to find |
| `replace` | string | yes | Replacement |
| `use_regex` | bool | no | Treat find as regex |
| `all_occurrences` | bool | no | Replace all (default true) |

### write_files
Batch-write multiple files. **Checkpoints each.**

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `files` | array | yes | `{path, content}` objects |

### delete_file
**Destructive - requires confirmation.** Checkpoint taken so it can be restored.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | File to delete |

---

## Directory & file management

### create_directory
Create a directory (and parents).

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `path` | string | yes | Directory to create |

### move_file
Move or rename a file/directory. **Checkpoints source and destination.**

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `source` | string | yes | Source path |
| `destination` | string | yes | Destination path |

### copy_file
Copy a file to a new location.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `source` | string | yes | Source file |
| `destination` | string | yes | Destination file |

---

## Search & shell

### find_files
Find files by glob-style name pattern.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `pattern` | string | yes | e.g. `*.js`, `test_*` |
| `directory` | string | no | Search root |
| `exclude` | string | no | Pattern to exclude |

### search_in_files
Grep-style search inside files. Returns matching lines with filenames.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `pattern` | string | yes | Text or regex |
| `directory` | string | no | Search root |
| `file_pattern` | string | no | Restrict to `*.ext` |
| `case_sensitive` | bool | no | Default false |
| `context_lines` | number | no | Lines of context |

### run_command
Execute a shell command. **Destructive commands (rm -rf, git push --force, npm publish) require confirmation.**

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `command` | string | yes | Shell command |
| `cwd` | string | no | Working directory |
| `timeout` | number | no | ms, default 60000 |
| `env` | object | no | Extra env vars |

### read_url
Fetch text content of a URL (HTML is stripped to text). 15 s timeout.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `url` | string | yes | http/https URL |

---

## Git tools

Prefer these over raw `git` shell commands - output is structured and safer.

### git_status
Show working-tree status (short format). Param: `cwd` (optional).

### git_diff
Show unstaged (or staged) changes.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `cwd` | string | no | Repository dir |
| `staged` | bool | no | Show `--cached` changes |
| `path` | string | no | Limit to a path |

### git_log
Recent commit history. Params: `cwd`, `limit` (default 15).

### git_add
Stage files. Params: `cwd`, `paths` (array; use `["."]` for everything).

### git_commit
Create a commit. **Requires confirmation.** Params: `cwd`, `message` (required), `all` (bool, `-a`).

### git_branch
List branches, or create/switch when `name` is given. Params: `cwd`, `name`.

### git_blame
Show per-line last-modifier info. Params: `cwd`, `path` (required).

---

## Checkpoints

### checkpoint_list
List saved snapshots for this session (newest first). Param: `limit` (default 50).

### checkpoint_restore
Restore a file to a previous checkpoint. Omit `id` to undo the most recent change.

| Param | Type | Req | Description |
|-------|------|-----|-------------|
| `id` | string | no | Checkpoint id (default: most recent) |

### checkpoint_clear
Delete all checkpoints for this session.

---

## Adding a new tool

1. Add a definition to the `TOOLS` object in `src/tools.js` with `description`, `parameters`, and an `async execute(args)` method.
2. If it mutates files, call `checkpointFile(abs, label)` before writing.
3. If it is destructive, `await confirm(question, { defaultAllow: false })` and honour a decline.
4. Tool docs are generated automatically into the system prompt via `getToolDescriptions()` - no extra wiring needed.
