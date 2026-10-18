# Developer Guide

> How to set up, run, debug, and extend DeepSeek Browser Agent.

## Prerequisites

- Node.js >= 18 (tested on v24)
- A DeepSeek account (free)
- ~150 MB disk for Chromium

## Setup

```bash
git clone https://github.com/Omar-Azam/deepseek-browser-agent.git
cd deepseek-browser-agent
npm install
```

`npm install` triggers `src/postinstall.js`, which runs `playwright install chromium`.
Skip it with `CI=1` or `SKIP_PLAYWRIGHT_INSTALL=1` if needed.

## Running from source

| Command | Purpose |
|---------|---------|
| `node src/index.js --interactive` | REPL mode (log in on first run) |
| `node src/index.js "<task>"` | One-shot task |
| `node src/index.js --ui` | Start the web UI |
| `node src/ui/server.js` | Start the web UI directly |
| `node src/index.js --debug` | Verbose raw-response output |
| `node src/index.js --calibrate` | Dump DOM to fix selectors |

There are no build steps - it is plain CommonJS, run directly by Node.

## Project layout

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module map.

Key files to know:

- `src/agent.js` - the loop you will touch most.
- `src/browser.js` - selector banks live in `SEL` at the top.
- `src/tools.js` - add tools here.
- `src/parser.js` - extend parsing strategies here.
- `src/ui/server.js` + `src/ui/public/` - the web UI.

## Debugging the browser layer

When DeepSeek's UI changes and the agent cannot find an element:

```bash
node src/index.js --calibrate
```

This opens the browser, navigates to DeepSeek, and prints DOM candidates
(see `browser.dumpDebugInfo()`). Use the output to update the `SEL` banks in
`src/browser.js`. You can also take a screenshot with `browser.screenshot()`.

## Adding a tool

1. Open `src/tools.js` and add a key to the `TOOLS` object:

```js
my_tool: {
  description: 'What it does.',
  parameters: {
    arg: { type: 'string', required: true, description: 'An argument' },
  },
  async execute({ arg }) {
    // ... do work, return a string result
    return 'done';
  },
},
```

2. If it mutates files, call `checkpointFile(abs, label)` before writing.
3. If it is destructive, `await confirm(...)` and honour a decline.
4. Tool docs are injected into the system prompt automatically - no other wiring.

## Adding a parser strategy

`src/parser.js` tries strategies in order. Add a new block before the
final-answer return. Each strategy must return a normalised object:

```js
{ type: 'tool_call', name, args, raw }
{ type: 'final', content, raw }
{ type: 'error', message, raw }
```

## Code conventions

- Plain CommonJS (`require` / `module.exports`), no TypeScript, no build step.
- `'use strict';` at the top of every module.
- Section banners: `// ─────` dividers with a title.
- Prefer small focused modules; `agent.js` is the only large orchestrator.
- Never let logging or telemetry throw into the agent loop.
- All user-facing strings go through `i18n.t()` and must exist in both `en` and `zh`.

## Testing

The project currently ships no unit-test suite (browser automation is hard to
mock). Manual verification is the norm:

1. `node src/index.js --calibrate` to confirm selectors still resolve.
2. Run a small task against a scratch directory.
3. Exercise a file mutation, then `checkpoint_restore` to confirm undo works.
4. Open the web UI and confirm SSE events stream correctly.

Contributions that add tests (especially for `parser.js`, `tools.js` path
handling, and `accounts.js`) are very welcome.
