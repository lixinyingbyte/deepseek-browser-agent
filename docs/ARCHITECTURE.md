# Architecture

> Deep dive into how DeepSeek Browser Agent is structured.

## High-level Overview

DeepSeek Browser Agent is a **browser-automation-driven AI coding agent**. Instead of calling a paid LLM API, it drives a real Chromium browser via Playwright to chat with DeepSeek for free.

The agent runs an **autonomous loop**:

1. Build a message (system prompt + task).
2. Send it to DeepSeek through the browser.
3. Wait for the response to finish streaming.
4. Parse the response to detect a tool call or a final answer.
5. If a tool call: execute the tool locally, feed the result back, repeat.
6. If a final answer: verify it carries the `(complete)` marker, then stop.

---

## The Agent Loop

The core lives in `src/agent.js` -> `DeepSeekAgent._runOnce()`. It is driven by a bounded `for` loop capped by `config.MAX_ITERATIONS` (default 40).

Each iteration:

| Step | What happens | Code |
|------|--------------|------|
| 1 | Send message to DeepSeek | `browser.sendMessage()` |
| 2 | Wait for stable streamed response | `browser.waitForResponse()` |
| 3 | Detect network interruption / truncation | checks `lastWaitMeta` |
| 4 | Auto-resume if interrupted | sends a "please continue" message |
| 5 | Parse response | `parser.parseResponse()` |
| 6 | Dispatch tool / handle error / finalize | `tools.executeTool()` |

Two budgets run in parallel:

- **Iterations** (`MAX_ITERATIONS`) - real work steps (tool calls, resume attempts).
- **Final validations** (`MAX_FINAL_VALIDATIONS`) - completion hand-shakes. These do *not* consume the iteration budget (`iter--` on success), so a model that forgets the `(complete)` marker can be nudged indefinitely without starving real work.

### Interruption detection

A response is considered **interrupted** when *any* of the following hold:

- Nothing came back at all.
- DeepSeek rendered an inline network-error banner (`waitMeta.netError`).
- The stream ended while still generating (`waitMeta.stillGenerating`).
- The text was structurally truncated (`waitMeta.truncated`).

When interrupted and the resume budget is not exhausted, the agent sends a continuation prompt with backoff `min(1000 * n, 5000)` ms.

---

## Module Map

```
src/
  index.js         CLI entry point - argument parsing, mode dispatch
  config.js        Central config: defaults + global + per-project overrides
  agent.js         DeepSeekAgent class - the autonomous loop
  browser.js       DeepSeekBrowser class - Playwright controller
  tools.js         All tool definitions + executor + checkpoint integration
  parser.js        Response parser - 7 strategies to extract tool calls
  prompt.js        System prompt builder + ConversationManager
  completion.js    Final-answer verification ((complete) marker checks)
  accounts.js      Multi-account registry + rotation policies
  checkpoint.js    Content-addressed snapshot/restore manager
  token-usage.js   Heuristic token estimation + daily persistence
  i18n.js          CLI translations (English + Simplified Chinese)
  logger.js        ANSI terminal output + EventEmitter bus for the UI
  confirm.js       Human-in-the-loop confirmation for destructive ops
  postinstall.js   Downloads Playwright Chromium after npm install
  calibrate.js     Debug helper - dumps DOM selectors
  ui/
    server.js      Zero-dependency HTTP + SSE server for the web UI
    workspace.js   Sandboxed file-tree / file-preview helpers
    public/        index.html, app.js, i18n.js, styles.css, themes.css
```

### Dependency graph (simplified)

```
index.js --> agent.js --> browser.js (Playwright)
                  |
                  +--> tools.js --> checkpoint.js, confirm.js
                  +--> prompt.js --> tools.js (tool docs)
                  +--> parser.js
                  +--> accounts.js
                  +--> completion.js
                  +--> token-usage.js

ui/server.js --> agent.js, workspace.js, logger.js (event bus)
```

---

## Data Flow

### Sending a task

```
User task string
   |
   v
ConversationManager.buildFirstMessage(task, dirListing)
   |   -> system prompt + tool docs + cwd snapshot + task
   v
browser.sendMessage(text)
   |   -> finds input element, types, clicks send
   v
browser.waitForResponse()
   |   -> polls DOM until text stabilizes or structurally finishes
   v
raw text
```

### Feeding a tool result back

```
parseResponse -> { type: 'tool_call', name, args }
   |
   v
executeTool(name, args)   <- runs the actual fs / exec / git operation
   |
   v
ConversationManager.addToolResult(name, result, isError)
   |   -> wraps in [TOOL RESULT: ...] ... [END TOOL RESULT]
   v
browser.sendMessage(feedback)
```

The model sees the tool result as the next **user turn** - that is how browser-based LLM UIs are typically driven, since the web interface has no native "function calling" channel.

---

## Response Parsing Pipeline

`src/parser.js` tries multiple strategies in order, because the browser's markdown renderer may reshape code fences unpredictably:

| # | Strategy | Example input |
|---|----------|---------------|
| 0 | Bare `tool_call` + JSON (DOM fallback) | fence stripped by renderer |
| 1 | Fenced `tool_call` block (primary) | normal model output |
| 2 | JSON block containing `name` | model used wrong fence |
| 3 | XML `<tool_call><name>...` | some models emit this |
| 4 | XML with angle brackets stripped by DOM | renderer ate the tags |
| 5 | Largest JSON object containing `name` | loose JSON in prose |
| 6 | Python-style `func(k="v")` in a code block | rare fallback |

If none match, the response is treated as a **final prose answer**.

`attemptJsonFix()` repairs common LLM JSON mistakes: trailing commas and unquoted keys. `stripThinkingBlocks()` removes DeepSeek R1 reasoning so tool calls embedded in reasoning do not leak.

---

## Reliability Mechanisms

Real browser automation is flaky. The agent defends on several fronts:

### 1. Selector banks
`browser.js` never relies on a single CSS selector. Every element has an ordered fallback list (e.g. `chatInput` has 5 candidates). When DeepSeek's UI changes, you only update the bank.

### 2. Response stability detection
`waitForResponse()` uses two thresholds:
- `STABLE_DELAY` (1.2 s) - text unchanged -> candidate for completion.
- `STALL_TIMEOUT` (25 s) - hard cap before accepting a stalled stream.

### 3. Auto-resume
Network glitches and mid-stream cut-offs are detected and recovered by re-prompting the model to continue, with a bounded retry count (`MAX_AUTO_RESUMES`).

### 4. Regenerate fallback
If continuation prompts keep failing, the agent clicks DeepSeek's own "Regenerate" button (`REGENERATE_ON_EXHAUST`) - a server-side replay.

### 5. Completion marker
Every finished task must end with the literal token `(complete)`. This is the primary structural signal the answer is truly done, checked by `completion.js`: empty answer, truncation metadata, unbalanced code fences, or a missing `(complete)` marker all mark the answer incomplete and trigger a re-prompt.

### 6. Parse-error recovery
If the model emits a malformed tool call, the parser's `type: 'error'` result is fed back with a corrective prompt rather than crashing the loop.

---

## Account Isolation

DeepSeek ties a login session to a browser profile. To support multiple accounts, each account gets its **own Playwright persistent-context directory**:

```
~/.deepseek-agent/
  session/                 <- the implicit "default" account
  accounts/
    accounts.json          <- registry (version, active, accounts[])
    work/
      (Chromium profile)
    personal/
      (Chromium profile)
```

`AccountManager` (`accounts.js`) owns the registry. Rotation policies:

| Policy | Behaviour |
|--------|-----------|
| `manual` | Never switch unless the user asks. |
| `round-robin` | Cycle accounts on each `next()`. |
| `on-error` | Switch automatically when `run()` throws (quota, expiry). |

Switching tears down the current browser context and launches a new one against the target account's profile directory, so cookies/session are fully isolated.

---

## Checkpoint System

Every file-mutating tool snapshots the target *before* writing, so any change is undoable:

- Storage: `~/.deepseek-agent/checkpoints/<sessionId>/`
- Blobs are content-addressed (`sha256`) - identical content stored once.
- A JSONL journal records `{id, ts, path, mode, blob, label}` per operation.
- `mode: "absent"` means the file did not exist, so restore deletes it.

`checkpoint_restore` with no id undoes the most recent operation.

---

## Web UI Server

`src/ui/server.js` is a **zero-dependency** HTTP server (Node core only):

- Static assets served from `public/`.
- JSON API under `/api/*`.
- **Server-Sent Events** at `/api/events` stream live agent logs.
- One `DeepSeekAgent` instance per process (`session` singleton).
- Listens on `DSA_UI_HOST`:`DSA_UI_PORT` (default `127.0.0.1:4765`).

### Event flow

```
logger.emit(type, data)
   |  (EventEmitter bus)
   v
server forwards every event -> SSE clients
   |
   v
public/app.js updates the UI (tool calls, results, final output)
```

### API surface (summary)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Current agent/session status |
| GET/POST | `/api/config` | Read / update in-memory config |
| POST | `/api/task` | Start a task (streams via SSE) |
| POST | `/api/new-chat` | Reset the conversation |
| GET | `/api/events` | SSE stream |
| GET | `/api/history` | In-memory history |
| GET/POST | `/api/accounts*` | List / switch / add / remove / rotate |
| GET/POST | `/api/conversations*` | List / open / read past chats |
| GET | `/api/tools` | List available tools |
| GET | `/api/tokens` | Token usage stats |
| GET | `/api/workspace/tree` | Working-dir file tree |
| GET | `/api/workspace/file` | File preview (sandboxed) |

See [API.md](./API.md) for full request/response schemas.

---

## Design Trade-offs

**Why browser automation instead of an API?**
Zero cost and no API key. The trade-off is fragility: UI changes can break selectors, and there is no structured function-calling channel, so tool calls are parsed from rendered text with a multi-strategy parser.

**Why a text protocol ((complete) marker, fenced tool calls)?**
Because the web UI has no native tool-calling API. A strict, explicit text protocol is the most reliable way to get structured behaviour out of a chat-only model.

**Why per-account profile directories?**
Playwright persistent contexts cannot be shared between accounts. Separate directories are the clean way to isolate logins.

**Why content-addressed checkpoints?**
Edits are frequent and often repeated; deduplicating blobs keeps the checkpoint store small even for long sessions.

**Why zero-dependency UI server?**
The project's only runtime dependency is Playwright. Keeping the UI on Node core avoids a framework install and keeps npm install fast.
