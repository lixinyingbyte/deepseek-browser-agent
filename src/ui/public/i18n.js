// i18n.js — Lightweight internationalization for the DeepSeek Agent UI
// Supports English (en) and Simplified Chinese (zh).
//
// Wrapped in an IIFE so internal helpers (notably `t`) do NOT leak into the
// global scope — app.js declares its own `const t`, and a top-level function
// declaration here would collide with it (`Identifier 't' has already been
// declared`), breaking the whole UI.
'use strict';

(function () {

const TRANSLATIONS = {
  en: {
    // ── Meta ─────────────────────────────────────────
    'html.lang'                : 'en',
    'app.title'                : 'DeepSeek Agent — Console',
    'brand.subtitle'           : 'AI Coding Agent · Browser Automation',

    // ── Topbar ───────────────────────────────────────
    'topbar.tools'             : 'Tools',
    'topbar.settings'          : 'Settings',
    'topbar.theme'             : 'Theme',
    'topbar.history'           : 'History',
    'topbar.accounts'          : 'Accounts',
    'topbar.lang.toggle'       : 'Switch to Chinese',

    // ── Accounts modal ───────────────────────────────
    'accounts.title'           : 'Accounts',
    'accounts.loading'         : 'Loading accounts…',
    'accounts.active'          : 'Active',
    'accounts.use'             : 'Use',
    'accounts.remove'          : 'Remove',
    'accounts.removeConfirm'   : 'Remove this account and its login profile?',
    'accounts.addPlaceholder'  : 'New account name',
    'accounts.add'             : 'Add',
    'accounts.rotate'          : 'Rotate to next',
    'accounts.rotation'        : 'Rotation',
    'accounts.empty'           : 'No accounts configured.',
    'accounts.loadFailed'      : 'Failed to load accounts',
    'accounts.switched'        : 'Switched account',
    'accounts.added'           : 'Account added',
    'accounts.removed'         : 'Account removed',
    'accounts.rotated'         : 'Rotated account',
    'accounts.opFailed'        : 'Account operation failed',

    // ── History modal ────────────────────────────────
    'history.title'            : 'Conversation History',
    'history.loading'          : 'Loading conversations…',
    'history.empty'            : 'No conversation history found.',
    'history.continue'         : 'Continue',
    'history.view'             : 'View',
    'history.openFailed'       : 'Could not open conversation',
    'history.loadFailed'       : 'Failed to load history',
    'history.noTurns'          : 'This conversation has no readable content.',
    'history.preview'          : 'Conversation preview',

    // ── Theme picker ─────────────────────────────────
    'theme.title'              : 'Theme & Background',
    'theme.scheme'             : 'Color scheme',
    'theme.background'         : 'Background',
    'theme.close'              : 'Close',

    // ── Status ───────────────────────────────────────
    'status.idle'              : 'Idle',
    'status.launching'         : 'Launching browser…',
    'status.ready'             : 'Ready',
    'status.running'           : 'Working…',
    'status.error'             : 'Error',

    // ── Welcome ──────────────────────────────────────
    'welcome.title'            : 'Welcome to your AI coding agent',
    'welcome.desc'             : 'Describe what you want to build. The agent will use DeepSeek through browser automation to plan, edit files, and run commands — all without an API key.',

    // ── Suggestions ──────────────────────────────────
    'sugg.restapi.title'       : 'Build a REST API',
    'sugg.restapi.sub'         : 'Express + CRUD for users',
    'sugg.restapi.task'        : 'Create a REST API in Express with CRUD endpoints for users',
    'sugg.darkmode.title'      : 'Add a dark mode toggle',
    'sugg.darkmode.sub'        : 'CSS variables + localStorage',
    'sugg.darkmode.task'       : 'Add a dark mode toggle to the frontend using CSS variables and localStorage',
    'sugg.tests.title'         : 'Write unit tests',
    'sugg.tests.sub'           : 'Jest, all passing',
    'sugg.tests.task'          : 'Write unit tests for the existing modules using Jest and make them pass',
    'sugg.typescript.title'    : 'Migrate to TypeScript',
    'sugg.typescript.sub'      : 'Strict mode refactor',
    'sugg.typescript.task'     : 'Refactor the project to use TypeScript with strict mode enabled',

    // ── Composer ─────────────────────────────────────
    'composer.placeholder'     : 'Describe a task…  (Enter to send, Shift+Enter for newline)',
    'composer.keepSession'     : 'Continue conversation',
    'composer.keepSession.tip' : 'Continue the current conversation (no tool prompt re-sent). Off = start a new chat.',
    'composer.send'            : 'Send',
    'composer.working'         : 'Working…',

    // ── Activity ─────────────────────────────────────
    'activity.title'           : 'Activity',
    'activity.clear'           : 'Clear activity',
    'activity.empty'           : 'Activity will stream here',

    // ── Workspace panel ──────────────────────────────
    'workspace.title'          : 'Workspace',
    'workspace.refresh'        : 'Refresh files',
    'workspace.loading'        : 'Loading files…',
    'workspace.empty'          : 'No files in the working directory.',
    'workspace.loadFailed'     : 'Failed to load workspace',
    'workspace.fileFailed'     : 'Failed to open file',
    'workspace.binary'         : 'Binary file — no preview available.',
    'workspace.truncated'      : 'Showing the first 4,000 entries only.',

    // ── Settings modal ───────────────────────────────
    'settings.title'           : 'Settings',
    'settings.workingDir'      : 'Working directory',
    'settings.workingDir.hint' : 'The folder the agent reads and writes.',
    'settings.maxIter'         : 'Max iterations',
    'settings.maxIter.hint'    : 'Upper bound on agent steps per task.',
    'settings.headless'        : 'Headless browser',
    'settings.debug'           : 'Debug logging',
    'settings.cancel'          : 'Cancel',
    'settings.save'            : 'Save',
    'settings.tokens.title'    : "Today's token usage",
    'settings.tokens.total'    : 'Total',
    'settings.tokens.input'    : 'Input',
    'settings.tokens.output'   : 'Output',
    'settings.tokens.tasks'    : 'Tasks',
    'settings.tokens.hint'     : "Estimated from conversation text — DeepSeek's web UI does not expose exact counts.",

    // ── Tools modal ──────────────────────────────────
    'tools.title'              : 'Available Tools',
    'tools.loading'            : 'Loading tools…',
    'tools.none'               : 'No tools registered.',
    'tools.noParams'           : 'No parameters',
    'tools.required'           : 'required',
    'tools.loadFailed'         : 'Failed to load tools',

    // ── Toasts ───────────────────────────────────────
    'toast.taskComplete'       : 'Task complete',
    'toast.taskFailed'         : 'Task failed',
    'toast.settingsSaved'      : 'Settings saved',
    'toast.settingsLoadFailed': 'Could not load settings',
    'toast.langChanged'        : 'Language changed',

    // ── Messages ─────────────────────────────────────
    'msg.you'                  : 'You',
    'msg.agent'                : 'Agent',
    'msg.error'                : 'Error',

    // ── Activity entries ─────────────────────────────
    'act.banner'               : 'Agent banner',
    'act.step'                 : 'Step {n} / {max}',
    'act.toolCall'             : 'Tool → {name}',
    'act.toolResult'           : 'Tool result',
    'act.toolError'            : 'Tool error',
    'act.newChat'              : 'New chat started',

    // ── Agent-forwarded (server) messages ────────────
    'agent.workingDir'         : 'Working directory',
  },

  zh: {
    // ── Meta ─────────────────────────────────────────
    'html.lang'                : 'zh-CN',
    'app.title'                : 'DeepSeek Agent — 控制台',
    'brand.subtitle'           : 'AI 编程助手 · 浏览器自动化',

    // ── Topbar ───────────────────────────────────────
    'topbar.tools'             : '工具',
    'topbar.settings'          : '设置',
    'topbar.theme'             : '主题',
    'topbar.history'           : '历史对话',
    'topbar.accounts'          : '账号',
    'topbar.lang.toggle'       : '切换为英文',

    // ── Accounts modal ───────────────────────────────
    'accounts.title'           : '账号管理',
    'accounts.loading'         : '正在加载账号…',
    'accounts.active'          : '当前',
    'accounts.use'             : '使用',
    'accounts.remove'          : '移除',
    'accounts.removeConfirm'   : '确定移除该账号及其登录配置吗？',
    'accounts.addPlaceholder'  : '新账号名称',
    'accounts.add'             : '添加',
    'accounts.rotate'          : '轮换到下一个',
    'accounts.rotation'        : '轮换策略',
    'accounts.empty'           : '尚未配置任何账号。',
    'accounts.loadFailed'      : '加载账号失败',
    'accounts.switched'        : '已切换账号',
    'accounts.added'           : '已添加账号',
    'accounts.removed'         : '已移除账号',
    'accounts.rotated'         : '已轮换账号',
    'accounts.opFailed'        : '账号操作失败',

    // ── History modal ────────────────────────────────
    'history.title'            : '历史对话',
    'history.loading'          : '正在加载对话…',
    'history.empty'            : '未找到历史对话。',
    'history.continue'         : '继续',
    'history.view'             : '查看',
    'history.openFailed'       : '无法打开对话',
    'history.loadFailed'       : '加载历史失败',
    'history.noTurns'          : '此对话没有可读内容。',
    'history.preview'          : '对话预览',

    // ── Theme picker ─────────────────────────────────
    'theme.title'              : '主题与背景',
    'theme.scheme'             : '配色方案',
    'theme.background'         : '背景',
    'theme.close'              : '关闭',

    // ── Status ───────────────────────────────────────
    'status.idle'              : '空闲',
    'status.launching'         : '正在启动浏览器…',
    'status.ready'             : '就绪',
    'status.running'           : '处理中…',
    'status.error'             : '出错',

    // ── Welcome ──────────────────────────────────────
    'welcome.title'            : '欢迎使用你的 AI 编程助手',
    'welcome.desc'             : '描述你想构建的内容。助手会通过浏览器自动化调用 DeepSeek 来制定计划、编辑文件并执行命令 —— 全程无需 API 密钥。',

    // ── Suggestions ──────────────────────────────────
    'sugg.restapi.title'       : '构建 REST API',
    'sugg.restapi.sub'         : 'Express + 用户增删改查',
    'sugg.restapi.task'        : '用 Express 创建一个 REST API，为用户提供增删改查（CRUD）接口',
    'sugg.darkmode.title'      : '添加深色模式切换',
    'sugg.darkmode.sub'        : 'CSS 变量 + localStorage',
    'sugg.darkmode.task'       : '使用 CSS 变量和 localStorage 为前端添加深色模式切换功能',
    'sugg.tests.title'         : '编写单元测试',
    'sugg.tests.sub'           : 'Jest，全部通过',
    'sugg.tests.task'          : '使用 Jest 为现有模块编写单元测试并使其全部通过',
    'sugg.typescript.title'    : '迁移到 TypeScript',
    'sugg.typescript.sub'      : '严格模式重构',
    'sugg.typescript.task'     : '将项目重构为使用 TypeScript 并开启严格模式',

    // ── Composer ─────────────────────────────────────
    'composer.placeholder'     : '描述一个任务…（回车发送，Shift+回车换行）',
    'composer.keepSession'     : '继续对话',
    'composer.keepSession.tip' : '继续当前对话（不重复注入工具提示词）。关闭 = 开启新对话。',
    'composer.send'            : '发送',
    'composer.working'         : '处理中…',

    // ── Activity ─────────────────────────────────────
    'activity.title'           : '活动日志',
    'activity.clear'           : '清空活动日志',
    'activity.empty'           : '活动日志会显示在这里',

    // ── Workspace panel ──────────────────────────────
    'workspace.title'          : '工作台',
    'workspace.refresh'        : '刷新文件列表',
    'workspace.loading'        : '正在加载文件…',
    'workspace.empty'          : '工作目录中没有文件。',
    'workspace.loadFailed'     : '加载工作台失败',
    'workspace.fileFailed'     : '无法打开文件',
    'workspace.binary'         : '二进制文件，无法预览。',
    'workspace.truncated'      : '仅显示前 4,000 个条目。',

    // ── Settings modal ───────────────────────────────
    'settings.title'           : '设置',
    'settings.workingDir'      : '工作目录',
    'settings.workingDir.hint' : '助手读取和写入文件的文件夹。',
    'settings.maxIter'         : '最大迭代次数',
    'settings.maxIter.hint'    : '每个任务中助手执行步骤的上限。',
    'settings.headless'        : '无头浏览器',
    'settings.debug'           : '调试日志',
    'settings.cancel'          : '取消',
    'settings.save'            : '保存',
    'settings.tokens.title'    : '今日 Token 用量',
    'settings.tokens.total'    : '总计',
    'settings.tokens.input'    : '输入',
    'settings.tokens.output'   : '输出',
    'settings.tokens.tasks'    : '任务数',
    'settings.tokens.hint'     : '根据对话文本估算 —— DeepSeek 网页版不提供精确计数。',

    // ── Tools modal ──────────────────────────────────
    'tools.title'              : '可用工具',
    'tools.loading'            : '正在加载工具…',
    'tools.none'               : '未注册任何工具。',
    'tools.noParams'           : '无参数',
    'tools.required'           : '必填',
    'tools.loadFailed'         : '加载工具失败',

    // ── Toasts ───────────────────────────────────────
    'toast.taskComplete'       : '任务完成',
    'toast.taskFailed'         : '任务失败',
    'toast.settingsSaved'      : '设置已保存',
    'toast.settingsLoadFailed': '无法加载设置',
    'toast.langChanged'        : '语言已切换',

    // ── Messages ─────────────────────────────────────
    'msg.you'                  : '你',
    'msg.agent'                : '助手',
    'msg.error'                : '错误',

    // ── Activity entries ─────────────────────────────
    'act.banner'               : '助手启动',
    'act.step'                 : '步骤 {n} / {max}',
    'act.toolCall'             : '调用工具 → {name}',
    'act.toolResult'           : '工具结果',
    'act.toolError'            : '工具错误',
    'act.newChat'              : '已开始新对话',

    // ── Agent-forwarded (server) messages ────────────
    'agent.workingDir'         : '工作目录',
  },
};

// ─────────────────────────────────────────────
//  Current language
// ─────────────────────────────────────────────
const STORAGE_KEY = 'dsa-ui-lang';

function detectInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && TRANSLATIONS[saved]) return saved;
  } catch { /* localStorage may be disabled */ }

  // Fall back to browser locale
  const nav = (navigator.language || 'en').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  return 'en';
}

let currentLang = detectInitialLang();

const listeners = new Set();

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────
function t(key, vars) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  let str = dict[key];
  if (str == null) str = TRANSLATIONS.en[key];
  if (str == null) return key;

  if (vars && typeof vars === 'object') {
    str = str.replace(/\{(\w+)\}/g, (_, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
    );
  }
  return str;
}

function getLang() { return currentLang; }

function setLang(lang) {
  if (!TRANSLATIONS[lang] || lang === currentLang) return;
  currentLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  applyTranslations();
  for (const fn of listeners) {
    try { fn(currentLang); } catch (err) { console.warn('i18n listener failed', err); }
  }
}

function toggleLang() {
  setLang(currentLang === 'zh' ? 'en' : 'zh');
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Walk the DOM and translate every element carrying a data-i18n* attribute.
 *  - data-i18n           → textContent
 *  - data-i18n-html      → innerHTML (only for trusted, developer-authored keys)
 *  - data-i18n-placeholder → placeholder
 *  - data-i18n-title     → title
 *  - data-i18n-aria      → aria-label
 */
function applyTranslations(root = document) {
  // <html lang>
  try {
    document.documentElement.setAttribute('lang', t('html.lang'));
  } catch { /* ignore */ }

  // Document title
  try { document.title = t('app.title'); } catch { /* ignore */ }

  const attrMap = [
    ['data-i18n',           (el, v) => { el.textContent = v; }],
    ['data-i18n-html',      (el, v) => { el.innerHTML   = v; }],
    ['data-i18n-placeholder',(el, v) => { el.setAttribute('placeholder', v); }],
    ['data-i18n-title',     (el, v) => { el.setAttribute('title', v); }],
    ['data-i18n-aria',      (el, v) => { el.setAttribute('aria-label', v); }],
  ];

  for (const [attr, apply] of attrMap) {
    const nodes = root.querySelectorAll(`[${attr}]`);
    for (const el of nodes) {
      const key = el.getAttribute(attr);
      if (!key) continue;
      try { apply(el, t(key)); } catch { /* ignore per-element errors */ }
    }
  }

  // Update the lang toggle button's label & title
  const btn = document.getElementById('langBtn');
  if (btn) {
    btn.setAttribute('title', t('topbar.lang.toggle'));
    const label = btn.querySelector('.lang-label');
    if (label) label.textContent = currentLang === 'zh' ? '中' : 'EN';
  }
}

// Expose globally for the non-module frontend
window.i18n = { t, getLang, setLang, toggleLang, onChange, applyTranslations };

})();
