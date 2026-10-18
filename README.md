<div align="center">

<img src="https://img.shields.io/badge/status-in%20development-orange?style=for-the-badge" alt="Status: In Development"/>
<img src="https://img.shields.io/npm/v/deepseek-browser-agent?style=for-the-badge&color=blue" alt="npm version"/>
<img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=for-the-badge" alt="Node.js"/>
<img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License"/>
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs Welcome"/>

# 🤖 DeepSeek Browser Agent

**An autonomous AI coding agent that runs entirely for free — no API key required.**

It drives a real browser to talk to [DeepSeek](https://chat.deepseek.com), giving you a Claude Code / Cursor-style coding agent powered by DeepSeek's models at zero cost.

> 🍴 **This is a modified fork.** It is based on
> [`Omar-Azam/forge-agent`](https://github.com/Omar-Azam/forge-agent) (via
> `Windows-Feilulu/deepseek-browser-agent`) with substantial additions: a local
> **web UI**, **multi-account rotation**, a **checkpoint/undo** system, git tools,
> token tracking, i18n and full developer docs.
> See [What's Different From Upstream](#-whats-different-from-upstream) and
> [Install This Fork](#-install-this-fork).

[Install This Fork](#-install-this-fork) · [What's Different](#-whats-different-from-upstream) · [Quick Start](#-quick-start) · [Usage](#-usage) · [Configuration](#-configuration) · [Tools](#-available-tools) · [Developer Docs](./docs/README.md) · [Contributing](#-contributing)

---

> ⚠️ **This project is currently in active development.**
> Core functionality works, but you may encounter rough edges. Bug reports and contributions are very welcome — see [Contributing](#-contributing).

</div>

---

## 🧠 How It Works

Most AI coding agents talk to a paid API. This one doesn't.

Instead, it uses **Playwright** to control a real Chromium browser, navigates to `chat.deepseek.com`, sends your task, waits for the response, and parses it to extract tool calls — all automatically. Your local files and terminal are wired up as tools the AI can use, so it can read code, write files, run commands, and build complete projects step by step.

```
Your Terminal
     │
     ▼
 Agent Core          ← orchestrates the loop
     │
     ├──► Browser (Playwright)  ← talks to chat.deepseek.com
     │         │
     │    DeepSeek AI  ← thinks, decides what tool to use
     │         │
     └──► Tool Executor  ← reads/writes files, runs commands
              │
         Your Project
```

---

## 📦 Install This Fork

This fork is **not published to npm** under its own name. Install it by
cloning this repository. Do **not** run `npm install -g deepseek-browser-agent`
— that pulls the upstream package, not this fork.

**Requirements:** Node.js ≥ 18 (tested on v24), a free DeepSeek account, and
~150 MB of disk for Chromium.

### Option A — Clone & run locally (recommended)

```bash
git clone https://github.com/lixinyingbyte/deepseek-browser-agent.git
cd deepseek-browser-agent
git checkout local-workbench        # this fork's work lives on this branch
npm install                         # also downloads Chromium via postinstall
node src/index.js --interactive     # first run: log in to DeepSeek once
```

If the automatic Chromium download fails, run it manually:

```bash
npx playwright install chromium
```

### Option B — Install globally from the clone

So you can call `deepseek-agent` / `dsa` from any folder:

```bash
git clone https://github.com/lixinyingbyte/deepseek-browser-agent.git
cd deepseek-browser-agent
git checkout local-workbench
npm install
npm install -g .
```

Then from anywhere:

```bash
dsa "build a REST API in Express with user authentication"
```

### Option C — Use a release archive

Download the ZIP of the `local-workbench` branch from GitHub, extract it, then:

```bash
npm install
node src/index.js --interactive
```

### Windows convenience launchers

This fork ships two Windows batch files:

| File | Purpose |
|------|---------|
| `start-agent.bat` | Checks a local proxy (default `127.0.0.1:2080`), optionally routes the agent through it, then starts the CLI. |
| `launch-ui.bat` | Starts the web UI (Chinese UI) at `http://127.0.0.1:4765`. |

### Verify the install

```bash
node src/index.js --help        # CLI is wired up
node src/index.js --calibrate   # browser + DeepSeek selectors work
node src/ui/server.js           # web UI at http://127.0.0.1:4765
```

---

## 🔀 What's Different From Upstream

This repository is a fork of
[`Omar-Azam/forge-agent`](https://github.com/Omar-Azam/forge-agent) (the project
originally published as `deepseek-browser-agent`), by way of
[`Windows-Feilulu/deepseek-browser-agent`](https://github.com/Windows-Feilulu/deepseek-browser-agent).
It keeps the original browser-automation core and adds a large set of features.

### At a glance

| Area | Upstream (forge-agent) | This fork |
|------|------------------------|-----------|
| **Local web UI** | ✗ | ✅ Zero-dependency HTTP + SSE UI (`src/ui/`) with chat, live activity stream, tool inspector, settings panel |
| **Multi-account** | ✗ | ✅ Per-account browser profiles, registry, `manual` / `round-robin` / `on-error` rotation |
| **Undo / checkpoints** | ✗ | ✅ Every file write is snapshotted; `checkpoint_restore` undoes any change |
| **Git tools** | ✗ | ✅ `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_branch`, `git_blame` |
| **Partial edits** | ✗ | ✅ `apply_patch` (atomic search/replace hunks) |
| **Completion guard** | basic | ✅ `(complete)` marker verification + unclosed-fence detection |
| **Auto-resume** | ✗ | ✅ Detects network cut-offs / truncation and resumes; Regenerate fallback |
| **Token tracking** | ✗ | ✅ Heuristic per-task & daily token usage |
| **i18n** | ✗ | ✅ CLI + Web UI in English and Simplified Chinese |
| **Danger confirmation** | ✗ | ✅ Human-in-the-loop prompt for destructive ops |
| **Developer docs** | minimal | ✅ Full `docs/` (architecture, API, tools, config, development) |
| **Session reuse** | ✗ | ✅ `--keep-session`, history browsing, conversation open/view |

### Tool set

**Added in this fork:** `apply_patch`, `git_status`, `git_diff`, `git_log`,
`git_add`, `git_commit`, `git_branch`, `git_blame`, `checkpoint_list`,
`checkpoint_restore`, `checkpoint_clear`.

**Removed from this fork:** `ask_user` (replaced by non-blocking error recovery
and the completion hand-shake).

**Changed:** file writes are **checkpointed** before they happen, so every
mutation is undoable — upstream wrote directly with no undo.

### New modules not present upstream

`src/accounts.js`, `src/checkpoint.js`, `src/completion.js`, `src/confirm.js`,
`src/i18n.js`, `src/token-usage.js`, and the whole `src/ui/` tree.

> ⚠️ Because this fork diverged, its `main` history is unrelated to the
> upstream history. This fork's work is published on the **`local-workbench`**
> branch. Upstream's `src/backup.js` (a simple prompt-backup helper) is not used
> here; checkpoints supersede it.

---

## 🚀 Quick Start

> The examples below assume a global install (`deepseek-agent` / `dsa`).
> If you installed by cloning only, replace `deepseek-agent` with
> `node src/index.js` (run from the repo root).

**1. First run — log in to DeepSeek:**
```bash
deepseek-agent --interactive
```
A browser window opens. Log in to your DeepSeek account, then come back to the terminal and press **Enter**. Your session is saved — you only do this once.

**2. Give it a task:**
```bash
deepseek-agent "build a REST API in Express with user authentication"
```

**3. Use the short alias `dsa` from any project folder:**
```bash
cd ~/my-project
dsa "add input validation to all my API routes"
```

---

## 🖥️ Web UI

Prefer a graphical interface? The agent ships with a beautiful, local web UI — no extra dependencies, no build step.

```bash
# Launch the UI (opens a server at http://127.0.0.1:4765)
deepseek-agent --ui

# or via npm script
npm run ui

# or via the dedicated binary
dsa-ui
```

Then open **http://127.0.0.1:4765** in your browser.

### Features

- **Chat interface** — send tasks, see the agent's final answer rendered with markdown & syntax-highlighted code blocks
- **Live activity stream** — every tool call, file write, and command is streamed in real time via Server-Sent Events
- **Tool inspector** — browse all available tools and their parameters
- **Settings panel** — change the working directory, max iterations, headless mode and debug logging on the fly
- **Session control** — start a new DeepSeek chat or reuse the previous conversation with a single toggle
- **Status indicator** — always know whether the browser is idle, launching, ready or working
- **Material 3 design** — a hand-written Material 3 skin (`beer-skin.css`) with a neutral `Slate` theme (default), 6 alternate color schemes, and a Plain background by default. Motion uses Material's emphasized easing curves, respects `prefers-reduced-motion`, and the interface deliberately avoids the usual "AI product" look (no glowing blobs, no emoji chrome). Icons are inline SVG, so nothing depends on an icon font or a CDN at runtime.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DSA_UI_PORT` | `4765` | Port the UI server listens on |
| `DSA_UI_HOST` | `127.0.0.1` | Host/interface to bind to |

> The UI is served by a zero-dependency Node HTTP server (`src/ui/server.js`). It uses the same agent core and tool executor as the CLI — your session, config and logs are shared between both.

---

## 💻 Usage

```
deepseek-agent [OPTIONS] [TASK]

  -t, --task <task>    Task to run (or just type it as the last argument)
  -i, --interactive    Keep browser open, run multiple tasks in a session
  --ui                 Launch the local web UI (default: http://127.0.0.1:4765)
  -d, --dir <path>     Set working directory (default: current directory)
  --debug              Print raw AI responses to the terminal
  --headless           Run browser invisibly (requires prior login)
  --save-log           Save full session log to ~/.deepseek-agent/logs/
  --keep-session       Reuse the previous DeepSeek conversation on startup
  --history            List your past DeepSeek conversations, then exit
  --open <n|title>     Open a past conversation by number or title to continue it
  --view               Print the contents of the currently open conversation
  --account <name>     Start with a specific account (adds it if new)
  --accounts           List all configured accounts and exit
  --account-add <name> Add a new account profile and exit
  --account-use <name> Set the active account and exit
  --account-remove <n> Remove an account (and its profile) and exit
  --account-next       Rotate to the next account and exit
  --rotation <policy>  Account rotation: manual | round-robin | on-error
  --calibrate          Auto-detect DOM selectors (run if agent breaks)
  --lang <en|zh>       Set interface language
  -h, --help           Show help

Aliases:
  dsa                  Short form of deepseek-agent
```

### Examples

```bash
# Single task — runs and exits
deepseek-agent "create a Python script that scrapes Hacker News"

# Interactive mode — keeps browser open between tasks
deepseek-agent --interactive

# Run on a specific project
dsa --dir ~/projects/my-app "refactor all callbacks to async/await"

# Debug mode (shows what DeepSeek is actually outputting)
dsa --debug "build a calculator"

# Headless mode (faster — browser runs in background)
dsa --headless "write unit tests for utils.js"

# In interactive mode, type 'new' to start a fresh chat:
❯ Task: new
```

---

## 🕘 Conversation History

You can browse and reopen any of your previous DeepSeek chats — and continue them right where you left off.

```bash
# List your past conversations (numbered, newest first)
deepseek-agent --history

# Continue the 2nd conversation in the list
deepseek-agent --open 2 "keep working on the auth refactor"

# Just read a past conversation's contents
deepseek-agent --open 2 --view
```

In **interactive mode** you get the same power through REPL commands:

```
history              # list past conversations
open 2               # open conversation #2 and continue it
open my-project      # open by (partial) title
view                 # print the currently-open conversation
```

Opened conversations are re-read from the live page, and the next task you send continues that thread — DeepSeek keeps the historical context automatically.

---

## 👥 Multi-Account Rotation

Run the agent across several DeepSeek accounts and rotate between them — handy for sharing free-tier quota across accounts or separating work and personal usage.

Each account gets its **own persistent browser profile**, so every account stays logged in independently. You only log in to each one once.

```bash
# Add two accounts
deepseek-agent --account-add work
deepseek-agent --account-add personal

# See them all (the ● marks the active account)
deepseek-agent --accounts

# Switch the active account
deepseek-agent --account-use work

# Start the agent with a specific account
deepseek-agent --account work --interactive

# Rotate to the next account
deepseek-agent --account-next
```

### Automatic rotation policies

Set the rotation policy to have the agent switch accounts by itself:

| Policy | Behaviour |
|---|---|
| `manual` *(default)* | Never switches on its own — you control it |
| `round-robin` | Cycles to the next account whenever `--account-next` is used |
| `on-error` | If a task fails (e.g. quota exhausted), automatically retries on the next account |

```bash
# Rotate automatically when an account hits an error
deepseek-agent --rotation on-error "build the whole app"
```

> **Interactive mode:** `accounts`, `account use <name>`, `account add <name>`, `account remove <name>` and `account next` all work as REPL commands.
>
> **Web UI:** click **Accounts** in the top bar to add, switch, remove or rotate accounts visually.

Account profiles live under `~/.deepseek-agent/accounts/<name>/` (configurable via `ACCOUNTS_DIR`); the registry is `accounts.json`. The classic single-session directory remains as the implicit `default` account, so existing setups keep working unchanged.

---

## ⚙️ Configuration

### Global config — applies everywhere

Create `~/.deepseek-agent/config.json`:

```json
{
  "HEADLESS": true,
  "MAX_ITERATIONS": 50,
  "STABLE_DELAY": 3000,
  "DEBUG": false
}
```

### Per-project config — overrides global

Drop `deepseek-agent.config.json` in your project root:

```json
{
  "MAX_ITERATIONS": 60,
  "MAX_OUTPUT_LENGTH": 12000
}
```

### All settings

| Setting | Default | Description |
|---|---|---|
| `HEADLESS` | `false` | Hide the browser window |
| `MAX_ITERATIONS` | `40` | Max agent steps per task before stopping |
| `RESPONSE_TIMEOUT` | `180000` | Max ms to wait for a response (3 min) |
| `STABLE_DELAY` | `2500` | Ms of silence that means DeepSeek is done |
| `SEND_DELAY` | `400` | Ms between typing and pressing Enter |
| `MAX_OUTPUT_LENGTH` | `8000` | Truncate long command outputs sent to AI |
| `DEBUG` | `false` | Print raw AI responses to terminal |
| `SESSION_DIR` | `~/.deepseek-agent/session` | Where browser cookies are saved (the `default` account) |
| `ACCOUNTS_DIR` | `~/.deepseek-agent/accounts` | Root directory for per-account browser profiles |
| `ACCOUNT_FILE` | `<ACCOUNTS_DIR>/accounts.json` | Account registry file |
| `ACCOUNT_ROTATION` | `manual` | Rotation policy: `manual` / `round-robin` / `on-error` |
| `ACTIVE_ACCOUNT` | `null` | Force a specific account on startup |

---

## 🛠️ Available Tools

The agent can use these tools autonomously to complete your task:

| Tool | Description |
|---|---|
| `read_file` | Read a file's contents, optionally by line range |
| `write_file` | Create or overwrite a file (auto-creates directories) |
| `append_to_file` | Append text to an existing file |
| `replace_in_file` | Find and replace text in a file (regex supported) |
| `delete_file` | Permanently delete a file |
| `list_directory` | List directory contents, optionally recursive |
| `create_directory` | Create a directory and all parents |
| `move_file` | Move or rename a file or directory |
| `copy_file` | Copy a file to a new location |
| `get_file_info` | Get file metadata (size, line count, dates) |
| `run_command` | Execute any shell command |
| `find_files` | Find files by name pattern (e.g. `*.ts`) |
| `search_in_files` | Search text inside files (like `grep -r`) |
| `read_url` | Fetch and read the content of a URL |
| `write_files` | Write multiple files at once (batch scaffold) |

---

## 📂 Where Data is Stored

Everything lives in `~/.deepseek-agent/` in your home directory:

```
~/.deepseek-agent/
├── session/        ← Browser cookies (login once, runs forever)
├── logs/           ← Session logs (only saved with --save-log)
└── config.json     ← Your global settings
```

---

## 🔧 Troubleshooting

### Agent responds but creates no files
The browser DOM rendered the AI's response in a way the parser didn't catch. Run with `--debug` to see exactly what's being received:
```bash
deepseek-agent --debug "build a calculator"
```

### Agent stops responding / loops
DeepSeek's UI may have changed. Run the calibration tool — it inspects the live DOM and prints updated selectors:
```bash
deepseek-agent --calibrate
```

### Login session expired
Just run without `--headless` — the browser opens and you log in again:
```bash
deepseek-agent --interactive
```

### Chromium didn't download automatically
```bash
npx playwright install chromium
```

### Response times out on long tasks
Increase the timeout in your config:
```json
{ "RESPONSE_TIMEOUT": 300000, "STABLE_DELAY": 4000 }
```

---

## 🗂️ Project Structure

```
deepseek-browser-agent/
├── src/
│   ├── index.js          ← CLI entry point and argument parsing
│   ├── agent.js          ← Core agent loop (send → wait → parse → execute)
│   ├── browser.js        ← Playwright controller for chat.deepseek.com
│   ├── accounts.js       ← Multi-account registry, profiles & rotation
│   ├── tools.js          ← All agent tools (filesystem, shell, git, checkpoints)
│   ├── parser.js         ← Extracts tool calls from AI responses (7 strategies)
│   ├── prompt.js         ← System prompt and conversation history manager
│   ├── completion.js     ← Final-answer verification ((complete) marker)
│   ├── checkpoint.js     ← Content-addressed snapshot / restore
│   ├── token-usage.js    ← Heuristic token estimation + daily persistence
│   ├── confirm.js        ← Human-in-the-loop confirmation for risky ops
│   ├── i18n.js           ← CLI translations (English + Simplified Chinese)
│   ├── config.js         ← Configuration loader (global + per-project)
│   ├── logger.js         ← ANSI output + event bus for the web UI
│   ├── calibrate.js      ← DOM selector inspector / auto-fix tool
│   ├── postinstall.js    ← Auto-downloads Chromium after npm install
│   └── ui/
│       ├── server.js     ← Zero-dependency HTTP + SSE server for the web UI
│       ├── workspace.js  ← Sandboxed file-tree / preview helpers
│       └── public/       ← Single-page frontend (HTML/CSS/JS)
│           ├── beer-skin.css  ← Material 3 visual layer (pure CSS)
│           └── vendor/        ← unused Beer CSS bundle (safe to delete)
├── docs/                 ← Developer documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── TOOLS.md
│   ├── CONFIGURATION.md
│   └── DEVELOPMENT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
└── package.json
```

> 📚 **Developer documentation lives in [`docs/`](./docs/README.md).** Start with
> [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for how the agent works, and
> [DEVELOPMENT.md](./docs/DEVELOPMENT.md) to build and extend it.

---

## 🤝 Contributing

Contributions are very welcome — this project is in active development and there's plenty of room to grow.

### Setting up locally

```bash
git clone https://github.com/lixinyingbyte/deepseek-browser-agent.git
cd deepseek-browser-agent
git checkout local-workbench
npm install
npx playwright install chromium
node src/index.js --interactive
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for conventions.

### Areas that need work

- 🧪 **Tests** — there are currently no automated tests; a test suite would be a great contribution
- 🎨 **UI selector resilience** — DeepSeek updates their UI occasionally; better selector strategies are welcome
- 🔌 **More tools** — image generation, browser control, database tools, etc.
- 🌐 **Other AI frontends** — adapting the browser layer to work with other free AI chats
- 📦 **Windows support** — currently tested on Linux; Windows path handling may need fixes
- 📝 **Better error messages** — making failures easier to diagnose

### How to contribute

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-improvement`
3. Make your changes
4. Open a Pull Request with a clear description

Please keep PRs focused — one feature or fix per PR makes review much faster.

### Reporting bugs

Open an issue on GitHub with:
- What you ran
- What you expected
- What actually happened
- Output of `deepseek-agent --debug "your task"` if relevant

---

## ⚠️ Disclaimer

This project automates a web browser to interact with chat.deepseek.com. Automating web UIs may violate the terms of service of the website being automated. Use this tool for **personal and development purposes only**. The authors take no responsibility for account suspensions or other consequences of use.

---

## 📄 License

MIT — see [LICENSE](./LICENSE) for details.

---

<div align="center">

**Built with Playwright · Powered by DeepSeek · Free forever**

If this project helped you, consider giving it a ⭐ on GitHub!

</div>
