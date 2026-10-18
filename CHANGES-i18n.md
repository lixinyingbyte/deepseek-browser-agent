# 变更说明：完整中文（i18n）适配

## 目标

为 DeepSeek Browser Agent 提供完整的中英文双语支持，覆盖 CLI、终端日志、Web UI 与校准/安装脚本。

## 架构

- **后端字典** `src/i18n.js`：CLI/终端/日志所有文案，`t(key, vars)` 支持 `{name}` 占位符插值。
  语言探测优先级：`DSA_LANG` / `LANG` / `LC_ALL` 环境变量 → 系统区域 → 回退英文。
  可用 `--lang en|zh` 或 `i18n.setLanguage()` 强制切换。
- **前端字典** `src/ui/public/i18n.js`：浏览器端 UI，`window.i18n`，支持 `localStorage` 记忆、
  `navigator.language` 自动探测、`data-i18n*` 属性批量翻译、`toggleLang()`、`onChange()` 订阅。

## 适配文件（后端）

| 文件 | 说明 |
|------|------|
| `src/i18n.js` | 新增全部文案键，中英各 127 键，完全对称 |
| `src/index.js` | 帮助文本、运行信息、错误提示全部走 `t()`；新增 `--lang` 选项 |
| `src/logger.js` | banner、工具调用/结果、任务完成、步骤、截断提示本地化 |
| `src/agent.js` | 调试信息、会话日志（标题/日期/任务/最终响应）、失败提示本地化 |
| `src/browser.js` | 启动/就绪、导航警告、新对话、登录提示框、DOM 调试、截图提示本地化 |
| `src/calibrate.js` | 校准工具全部输出本地化 |
| `src/postinstall.js` | 安装脚本提示本地化 |
| `src/config.js` | 配置解析失败警告本地化 |
| `src/ui/server.js` | 启动横幅、任务失败、关闭提示本地化 |

## 适配文件（前端）

| 文件 | 说明 |
|------|------|
| `src/ui/public/i18n.js` | 中英各 63 键；`applyTranslations()` 支持 5 种 `data-i18n*` 属性 |
| `src/ui/public/index.html` | 所有静态文本加 `data-i18n*` 属性；引入 `i18n.js`；语言切换按钮 |
| `src/ui/public/app.js` | 状态标签、消息角色、活动日志、弹窗、Toast、建议任务全部走 `window.i18n.t()` |

## 设计要点

1. **登录提示框**：原为固定宽度 ASCII 艺术框，中文双宽字符会导致边框错位；
   改为上下横线 + 逐行文本的无边框设计，中英文均对齐良好。
2. **建议任务本地化**：`data-i18n-task` 存放键名，切换语言时 `refreshSuggestionTasks()`
   同步更新 `dataset.task`，保证点击后发送对应语言的提示词。
3. **服务端消息本地化**：`localizeServerMessage()` 将后端英文事件（如 `Working directory`）
   映射为前端 i18n 键。
4. **系统提示词**：`src/prompt.js` 保持不变（面向模型而非用户）。

## 校验

```
node --check src/*.js src/ui/server.js     # SYNTAX_OK
node _i18n_check.js                        # 11 passed, 0 failed
后端字典 en/zh 键数一致（127/127），无缺失
前端字典 en/zh 键数一致（63/63），无缺失
node src/index.js --lang zh --help         # 中文帮助正常
node src/index.js --lang en --help         # 英文帮助正常
```

---

# 新增功能：设置面板显示今日 Token 用量

## 背景

DeepSeek 网页版不提供精确的 token 计数接口，因此采用**基于对话文本的估算**方式统计用量。

## 新增文件

### `src/token-usage.js`

- `estimateTokens(text)` —— 估算 token 数：
  - CJK 字符（中日韩）≈ 0.6 token/字
  - 其他字符 ≈ 0.25 token/字（约 4 字符/token）
- `record(input, output)` —— 累加一次输入/输出，写入今日条目
- `incrementTask()` —— 今日完成任务数 +1
- `todayTotal()` —— 返回 `{ date, input, output, total, tasks }`
- `history()` —— 返回所有历史日期（最新在前）
- 持久化路径：`~/.deepseek-agent/token-usage.json`，按本地日期（YYYY-MM-DD）分桶

## 接入点

| 文件 | 改动 |
|------|------|
| `src/agent.js` | 首次消息、工具反馈、空响应续写、解析纠错、格式重试均调用 `tokenUsage.record()`；任务完成时 `incrementTask()` 并打印 `agent.tokenSummary` 摘要行 |
| `src/ui/server.js` | 新增 `GET /api/tokens` 返回 `{ today, history }` |
| `src/ui/public/index.html` | 设置弹窗新增 Token 用量四宫格（总计/输入/输出/任务数）+ 说明文字 |
| `src/ui/public/app.js` | `loadTokenUsage()` 拉取并渲染；打开设置时加载；`task_done` 事件后自动刷新 |
| `src/ui/public/styles.css` | `.token-grid` / `.token-cell` / `.token-num` / `.token-cap` 样式 |
| `src/i18n.js` | 新增 `agent.tokenSummary` 键（中英） |
| `src/ui/public/i18n.js` | 新增 `settings.tokens.*` 共 6 个键（中英） |

## 展示位置

点击右上角 **设置** 按钮 → 弹窗底部「今日 Token 用量」区域，显示：

| 总计 | 输入 | 输出 | 任务数 |
|------|------|------|--------|
| 12   | 6    | 6    | 1      |

## 校验

```
node --check src/token-usage.js src/agent.js src/ui/server.js   # OK
后端字典 en/zh = 128/128，前端字典 en/zh = 69/69，均无缺失
Playwright 实测：设置弹窗正确显示 Token 四宫格，JS 错误 0
```
