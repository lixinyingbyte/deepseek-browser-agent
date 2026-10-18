# CHANGES — Partial editing, Git tools, checkpoints & confirmations

This release adds four capability groups to the tool layer.

## 1. Partial editing — `apply_patch`

`src/tools.js` gains an `apply_patch` tool so the agent can change part of a
file instead of rewriting it with `write_file`.

- Takes `path` and an array of `{search, replace, all?}` hunks.
- Validates **every** hunk before writing: a hunk whose search text is missing,
  or ambiguous (matches more than once without `all: true`), aborts the whole
  edit. No half-applied changes are ever left on disk.
- `use_regex: true` treats each search string as a regular expression.

## 2. Git tools

Seven structured Git tools replace ad-hoc `run_command("git ...")` calls:
`git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_branch`,
`git_blame`. They run in the configured working directory, cap their output, and
surface stderr cleanly on failure.

## 3. Checkpoints & undo

New module `src/checkpoint.js` (`CheckpointManager`) records a snapshot of a
file's contents (or its absence) before every mutating operation.

- Snapshots are content-addressed — identical content is stored once.
- An append-only JSONL journal records each change with a timestamp and label.
- `checkpoint_list` shows saved snapshots; `checkpoint_restore` undoes the most
  recent change, or a specific one by id; `checkpoint_clear` wipes the session.
- Every write path in `tools.js` (`write_file`, `apply_patch`, `append_to_file`,
  `replace_in_file`, `delete_file`, `move_file`, `copy_file`, `write_files`)
  takes a checkpoint first.
- Checkpoints live under `~/.deepseek-agent/checkpoints/<session>/`.

## 4. Dangerous-operation confirmation

New module `src/confirm.js` provides a `confirm(question, opts)` gate plus a
`setConfirmHandler(fn)` hook so a UI can answer prompts.

- `delete_file`, `git_commit`, `git_branch`, and `checkpoint_clear` ask first.
- `run_command` scans the command against a pattern list (`rm -rf`, `git push
  --force`, `git reset --hard`, `git clean -f`, `npm publish`, `format`,
  `mkfs`, `dd if=`, …) and asks before running anything destructive.
- In non-interactive contexts, the caller-supplied default decides — so
  dangerous actions are declined by default in CI/automation.

## Wiring

- `src/prompt.js` documents the new editing/safety rules and the `git_*`
  convention in the system prompt; tool docs are generated automatically.
- `src/agent.js` parse-recovery heuristic now also recognises `apply_patch`,
  `git_status` and `checkpoint_restore`.
