# Configuration Reference

> All settings, their defaults, and how config files are resolved.

Config lives in `src/config.js`. Values come from (highest priority wins):

1. `./deepseek-agent.config.json` - per-project (in the working directory)
2. `~/.deepseek-agent/config.json` - global user config
3. Built-in defaults

Example `deepseek-agent.config.json`:

```json
{
  "HEADLESS": true,
  "MAX_ITERATIONS": 60,
  "STABLE_DELAY": 1500,
  "WORKING_DIR": "D:\\projects\\my-app"
}
```

---

## Browser

| Key | Default | Description |
|-----|---------|-------------|
| `DEEPSEEK_URL` | `https://chat.deepseek.com` | Site to drive. |
| `SESSION_DIR` | `~/.deepseek-agent/session` | Playwright persistent profile for the implicit default account. |
| `HEADLESS` | `false` | Run Chromium headless. Requires a prior login. |

## Timing

| Key | Default | Description |
|-----|---------|-------------|
| `RESPONSE_TIMEOUT` | `180000` | Max ms to wait for a full response. |
| `STABLE_DELAY` | `1200` | ms of unchanged text to consider a response stable. |
| `SEND_DELAY` | `200` | ms pause after clicking send. |
| `STALL_TIMEOUT` | `25000` | Hard cap ms before accepting a stalled stream. |

## Agent

| Key | Default | Description |
|-----|---------|-------------|
| `MAX_ITERATIONS` | `40` | Max real work steps per task. |
| `MAX_OUTPUT_LENGTH` | `8000` | Truncation length for tool output. |
| `WORKING_DIR` | `process.cwd()` | Directory the agent reads/writes. |
| `DEBUG` | `false` | Verbose debug output. |

## Reliability

| Key | Default | Description |
|-----|---------|-------------|
| `AUTO_RESUME` | `true` | Auto-continue after a network interruption. |
| `MAX_AUTO_RESUMES` | `6` | Max auto-resume attempts per task. |
| `MAX_FINAL_VALIDATIONS` | `10000` | Completion hand-shakes. `0` = unlimited. |
| `REQUIRE_COMPLETION_MARKER` | `true` | Treat a missing `(complete)` as unfinished. |
| `REGENERATE_ON_EXHAUST` | `true` | Click DeepSeek's Regenerate button as a last resort. |

## Accounts

| Key | Default | Description |
|-----|---------|-------------|
| `ACCOUNTS_DIR` | `~/.deepseek-agent/accounts` | Base dir for per-account profiles. |
| `ACCOUNT_FILE` | `<ACCOUNTS_DIR>/accounts.json` | Registry path. |
| `ACTIVE_ACCOUNT` | `null` | Force this account on startup. |
| `ACCOUNT_ROTATION` | `manual` | `manual` / `round-robin` / `on-error`. |

## Logging

| Key | Default | Description |
|-----|---------|-------------|
| `LOG_DIR` | `D:\deepseek-agent\logs` (Windows w/ D:) else `~/.deepseek-agent/logs` | Where session logs are written. |

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `DSA_LANG` | Force UI language (`en` / `zh`). |
| `DSA_UI_PORT` | Web UI port (default 4765). |
| `DSA_UI_HOST` | Web UI host (default 127.0.0.1). |
| `CI` / `SKIP_PLAYWRIGHT_INSTALL` | Skip the postinstall Chromium download. |
