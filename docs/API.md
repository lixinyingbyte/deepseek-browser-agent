# API Reference

> HTTP API exposed by the local web UI server (`src/ui/server.js`).

Base URL: `http://127.0.0.1:4765` (override with `DSA_UI_HOST` / `DSA_UI_PORT`).

All responses are JSON unless noted. Errors use standard HTTP status codes plus `{ "error": "message" }`.

---

## Status & Config

### GET /api/status
Returns the current agent/session state.

```json
{
  "status": "ready",
  "currentTask": null,
  "startedAt": 1729000000000,
  "language": "en",
  "workingDir": "D:\\projects\\app",
  "sessionDir": "C:\\Users\\me\\.deepseek-agent\\session",
  "headless": false,
  "debug": false,
  "maxIterations": 40,
  "platform": "win32",
  "nodeVersion": "v24.20.0",
  "uiPort": 4765,
  "tools": ["read_file", "write_file", "..."]
}
```

### GET /api/config
Returns a subset of the live config:

```json
{ "workingDir": "...", "headless": false, "debug": false, "maxIterations": 40, "stableDelay": 1200 }
```

### POST /api/config
Updates the in-memory config. All fields optional.

Request:
```json
{ "workingDir": "D:\\projects\\new", "headless": true, "debug": false, "maxIterations": 60 }
```

Response:
```json
{ "ok": true, "applied": { ... }, "config": { ... } }
```
`workingDir` must exist (400 otherwise). `maxIterations` is clamped to 1..200.

---

## Tasks

### POST /api/task
Start a task. Returns `202 Accepted` immediately; progress streams over SSE (`/api/events`).

Request:
```json
{ "task": "add tests to utils.js", "keepSession": false, "headless": false, "newChat": true }
```

| Field | Type | Description |
|-------|------|-------------|
| `task` | string | **Required.** The task prompt. |
| `keepSession` | bool | Reuse the current DeepSeek conversation. |
| `headless` | bool | Override headless for this run. |
| `newChat` | bool | Reset the DeepSeek chat before running. |

Response (202):
```json
{ "ok": true, "accepted": true, "task": "add tests to utils.js" }
```

Errors: `409` if a task is already running; `400` if `task` is missing.

### POST /api/new-chat
Resets the DeepSeek conversation.

Response: `{ "ok": true }`

### GET /api/history
Returns the in-memory conversation history for this UI session.

```json
{ "history": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ] }
```

---

## Server-Sent Events

### GET /api/events
Opens an SSE stream. Each event is a JSON object with a `type` and a `ts` (epoch ms) plus type-specific fields.

Event types:

| type | Fields | Meaning |
|------|--------|---------|
| status | status, task? | Agent state changed (ready / running). |
| user_message | content | Task echoed back. |
| header | message | Section header. |
| info / success / warn / error / dim | message | Log lines. |
| tool_call | name, args | The model invoked a tool. |
| tool_result | result, isError | Tool execution output. |
| iteration | n, max | Loop step marker. |
| finalOutput | content | Final answer text. |
| task_done | finalText | Task completed. |
| task_error | message | Task failed. |
| account_switched / account_added / account_removed | account | Account registry changes. |

Each frame follows the SSE wire format: a line beginning with `data: ` followed by the JSON payload and a blank line.

---

## Accounts

### GET /api/accounts
Lists all configured accounts. Response shape: `accounts` (array of {name, label, active, hasProfile}), `active` (string), `rotation` (string).

### POST /api/accounts/switch
Switch the active account. If a live agent exists its browser profile is swapped on the fly. Request body: `{ name }`. Response: `{ ok, account }`.

### POST /api/accounts/add
Register a new account and create its profile directory. Request body: `{ name, label? }`. Response: `{ ok, account }`.

### POST /api/accounts/remove
Remove an account. Pass `deleteProfile: true` to also delete its profile directory. The default account cannot be removed. Request body: `{ name, deleteProfile? }`. Response: `{ ok, account }`.

### POST /api/accounts/rotate
Advance to the next account per the rotation policy (forced). Response: `{ ok, account }`.

---

## Conversations

### GET /api/conversations
Lists past DeepSeek conversations from the sidebar. Response shape: `conversations` (array of {index, title, href}).

### POST /api/conversations/open
Open a past conversation to continue it. Request body: `{ ref }` where ref is a 1-based index or a title/href fragment. Response: `{ ok, conversation }`.

### GET /api/conversations/read
Returns the turns of the currently open conversation. Response shape: `turns` (array of {role, content}).

---

## Tools, Tokens and Workspace

### GET /api/tools
Lists tool names available to the agent. Response: `{ tools: [...] }`.

### GET /api/tokens
Returns estimated token usage. Response shape: `today` (number), `history` (array of {date, input, output}).

### GET /api/workspace/tree
Returns the working-directory file tree (ignores node_modules, .git, dist, etc.). Response shape: `root`, `name`, `tree` (nested nodes with name/path/type/children/size), `truncated`.

### GET /api/workspace/file?path=RELATIVE
Returns a single file preview. Paths are sandboxed to the working directory; traversal attempts return 403. Files over 512 KB return 413. Response shape: `path`, `name`, `size`, `binary`, `content`.

---

## Lifecycle

### POST /api/shutdown
Gracefully shuts down the server and any live agent, then exits the process. Response: `{ ok: true }`.
