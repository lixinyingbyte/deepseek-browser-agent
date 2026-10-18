# Contributing

Thanks for helping improve DeepSeek Browser Agent! This project is in active
development and contributions are very welcome.

## Getting started

```bash
git clone https://github.com/lixinyingbyte/deepseek-browser-agent.git
cd deepseek-browser-agent
git checkout local-workbench     # this fork's work
npm install
node src/index.js --interactive   # log in to DeepSeek once
```

> This is a modified fork of [`Omar-Azam/forge-agent`](https://github.com/Omar-Azam/forge-agent).
> See [What's Different From Upstream](./README.md#-whats-different-from-upstream).

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for the full developer guide.

## How to contribute

1. Open an issue describing the bug or feature first for anything non-trivial.
2. Fork, create a topic branch (`fix/parser-fence`, `feat/new-tool`).
3. Keep changes focused and match the existing code style (CommonJS, `'use strict'`, section banners).
4. If you touch user-facing strings, add them to **both** `en` and `zh` in `src/i18n.js`.
5. Verify manually: `node src/index.js --calibrate` and run a small task.
6. Open a PR with a clear description and, for UI/selector changes, before/after notes.

## Areas that need work

- **Tests** - `parser.js`, `tools.js` path handling, `accounts.js` registry.
- **Selector robustness** - DeepSeek UI changes break `browser.js`; more fallbacks help.
- **Parser strategies** - new model output shapes.
- **Docs** - keep `docs/` in sync with behaviour.

## Reporting bugs

Include: OS + Node version, the exact command, `--debug` output if possible,
and whether `--calibrate` finds the elements. Screenshots help for UI issues.

## Code of conduct

Be respectful and constructive. We are all here to build something useful.
