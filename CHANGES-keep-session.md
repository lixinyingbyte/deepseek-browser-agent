# 变更说明：交互模式跨任务保留上下文（keep-session）

## 背景（已定位根因，无需再查）

DeepSeek Browser Agent 的记忆分两层：

1. **服务端上下文** —— 存在于 chat.deepseek.com 网页当前的对话窗口里；
2. **本地上下文** —— `ConversationManager.messages` 数组。

关键事实：`browser.sendMessage` 只发送当前这一条消息，不会把本地 `messages` 数组里的历史重新拼接发送。
因此 AI 能记住上文**完全依赖网页对话未被切换**。一旦调用 `browser.newChat()`，两层记忆同时丢失，
且无法从本地恢复。

原 `runInteractive` 每处理一个新任务都无条件执行 `new ConversationManager()` + `browser.newChat()`，
导致每个新任务都丢弃上一次任务的记忆；`init()` 启动时也强制 `newChat()`，导致程序一启动就丢弃上次退出前的会话。

## 改动文件（共 2 个）

### 1. `src/agent.js`

- **`init()`（原第 30–33 行）**：
  - 由「启动即无条件 `browser.newChat()`」改为可选行为。
  - 当 `this.options.keepSession` 为真时，跳过 `newChat()`，尝试沿用上次会话，并输出一条 `logger.info`；
    否则保持原有默认：启动时开新会话。

- **`runInteractive()`（原第 198–214 行附近）**：
  - 新增 `let freshSession = true;`（进入交互模式后第一个任务需要一次干净的初始会话）。
  - 新增 `new` 命令分支行为：执行 `browser.newChat()` + `new ConversationManager()`，并将 `freshSession = true`，`continue`。
  - 新增 `if (freshSession)` 分支：仅在此刻执行 `browser.newChat()` + `new ConversationManager()`，随后 `freshSession = false`。
  - `try` 块内**只保留** `await this.run(task);`，不再每次任务都 newChat / reset。
  - `catch` 块保持原样：`logger.error(...)` + `if (config.DEBUG) console.error(err);`。

  效果：交互模式下多个任务默认复用同一个 DeepSeek 对话以保留上下文；仅在「输入 `new` 命令」和「进入交互模式后的第一个任务」两种情况下开新对话。

### 2. `src/index.js`

- **`parseArgs()`**：
  - `opts` 新增 `keepSession: false`。
  - 新增命令行分支 `case '--keep-session': opts.keepSession = true; break;`。
- **`printHelp()`**：
  - 在 OPTIONS 段新增一行 `--keep-session` 说明（带该开关时启动不调用 `newChat`，尝试沿用上次会话；不带时保持现有默认，即启动时开新会话）。
- **`main()`**：
  - 创建 agent 时透传该选项：`new DeepSeekAgent({ saveLog: opts.saveLog, keepSession: opts.keepSession })`。

## 兼容性

- 单任务模式 `agent.run(task)` 的行为未做任何修改。
- 交互模式下不带 `--keep-session` 时，启动仍为开新会话（保持现有默认）；仅 `init()` 的 `newChat` 变为可选，交互循环本身按 `freshSession` 逻辑运行。
- 未执行任何需要真实登录 DeepSeek 的联网测试。

## 语法校验

```
node --check src/agent.js && node --check src/index.js
# => SYNTAX_OK
```
