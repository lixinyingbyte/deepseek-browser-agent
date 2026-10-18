// app.js — DeepSeek Agent Web UI logic (i18n-aware)
'use strict';

// i18n is loaded before this script via <script src="i18n.js">
const t = (key, vars) => window.i18n.t(key, vars);

// ─────────────────────────────────────────────
//  DOM shortcuts
// ─────────────────────────────────────────────
const $  = (sel) => document.querySelector(sel);

const els = {
  statusPill    : $('#statusPill'),
  statusLabel   : $('#statusLabel'),
  chatScroll    : $('#chatScroll'),
  chatMessages  : $('#chatMessages'),
  welcome       : $('#welcome'),
  suggestions   : $('#suggestions'),
  taskInput     : $('#taskInput'),
  sendBtn       : $('#sendBtn'),
  keepSession   : $('#keepSession'),
  hintWorkingDir: $('#hintWorkingDir'),
  activityList  : $('#activityList'),
  activityEmpty : $('#activityEmpty'),
  activityCount : $('#activityCount'),
  clearActivity : $('#clearActivity'),
  settingsBtn   : $('#settingsBtn'),
  toolsBtn      : $('#toolsBtn'),
  historyBtn    : $('#historyBtn'),
  historyModal  : $('#historyModal'),
  historyBody   : $('#historyBody'),
  accountsBtn   : $('#accountsBtn'),
  accountsModal : $('#accountsModal'),
  accountsBody  : $('#accountsBody'),
  newAccountName: $('#newAccountName'),
  addAccountBtn : $('#addAccountBtn'),
  rotateAccountBtn: $('#rotateAccountBtn'),
  langBtn       : $('#langBtn'),
  settingsModal : $('#settingsModal'),
  toolsModal    : $('#toolsModal'),
  toolsBody     : $('#toolsBody'),
  cfgWorkingDir : $('#cfgWorkingDir'),
  cfgMaxIter    : $('#cfgMaxIter'),
  cfgHeadless   : $('#cfgHeadless'),
  cfgDebug      : $('#cfgDebug'),
  tokTodayTotal : $('#tokTodayTotal'),
  tokTodayInput : $('#tokTodayInput'),
  tokTodayOutput: $('#tokTodayOutput'),
  tokTodayTasks : $('#tokTodayTasks'),
  saveSettings  : $('#saveSettingsBtn'),
  toastWrap     : $('#toastWrap'),
  themeBtn      : $('#themeBtn'),
  themePanel    : $('#themePanel'),
  themeClose    : $('#themeClose'),
  themeGrid     : $('#themeGrid'),
  bgRow         : $('#bgRow'),
  workspaceCol  : $('#workspaceCol'),
  workspaceTree : $('#workspaceTree'),
  workspaceEmpty: $('#workspaceEmpty'),
  workspaceRoot : $('#workspaceRoot'),
  workspaceRefresh: $('#workspaceRefresh'),
  fileModal     : $('#fileModal'),
  fileModalTitle: $('#fileModalTitle'),
  filePreview   : $('#filePreview'),
};

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
const state = {
  status      : 'idle',
  taskRunning : false,
  activityN   : 0,
  currentAssistantEl : null,
  toolsCache  : null,       // cached tool list so we can re-render on lang change
  lastAssistantContent : null,
  workspaceData : null,     // { root, name, tree, truncated }
  workspaceOpenDirs : null, // Set of expanded directory paths
  workspaceActiveFile : null,
};

// ─────────────────────────────────────────────
//  Theme & background
// ─────────────────────────────────────────────
// Registry of selectable color schemes. `swatch` is a CSS gradient used for
// the little preview tile in the picker.
const THEMES = [
  { id: 'slate',     name: 'Slate',     swatch: 'linear-gradient(135deg,#171a1d,#9dc3e6)' },
  { id: 'light',     name: 'Light',     swatch: 'linear-gradient(135deg,#ffffff,#e9ecf7)' },
  { id: 'nord',      name: 'Nord',      swatch: 'linear-gradient(135deg,#2e3440,#88c0d0)' },
  { id: 'dracula',   name: 'Dracula',   swatch: 'linear-gradient(135deg,#282a36,#bd93f9)' },
  { id: 'solarized', name: 'Solarized', swatch: 'linear-gradient(135deg,#002b36,#268bd2)' },
  { id: 'forest',    name: 'Forest',    swatch: 'linear-gradient(135deg,#0c1410,#10b981)' },
  { id: 'sunset',    name: 'Sunset',    swatch: 'linear-gradient(135deg,#1a1013,#fb923c)' },
  { id: 'sakura',    name: 'Sakura',    swatch: 'linear-gradient(135deg,#ffe3ef,#ff5fa2 55%,#c86bff)' },
];

const BACKGROUNDS = [
  { id: 'aurora', name: 'Aurora' },
  { id: 'grid',   name: 'Grid'   },
  { id: 'dots',   name: 'Dots'   },
  { id: 'plain',  name: 'Plain'  },
];

const THEME_STORAGE   = 'dsa-ui-theme';
const BG_STORAGE      = 'dsa-ui-bg';
const DEFAULT_THEME   = 'slate';
const DEFAULT_BG      = 'plain';

const themeState = {
  theme: DEFAULT_THEME,
  bg   : DEFAULT_BG,
};

function isValidTheme(id) { return THEMES.some(t => t.id === id); }
function isValidBg(id)    { return BACKGROUNDS.some(b => b.id === id); }

function loadThemePrefs() {
  let theme = DEFAULT_THEME;
  let bg    = DEFAULT_BG;
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE);
    const savedBg    = localStorage.getItem(BG_STORAGE);
    if (savedTheme && isValidTheme(savedTheme)) theme = savedTheme;
    if (savedBg && isValidBg(savedBg)) bg = savedBg;
  } catch { /* localStorage may be disabled */ }
  themeState.theme = theme;
  themeState.bg    = bg;
}

function applyTheme(themeId, bgId) {
  if (themeId && isValidTheme(themeId)) themeState.theme = themeId;
  if (bgId && isValidBg(bgId)) themeState.bg = bgId;

  const root = document.documentElement;
  root.setAttribute('data-theme', themeState.theme);
  root.setAttribute('data-bg', themeState.bg);

  try {
    localStorage.setItem(THEME_STORAGE, themeState.theme);
    localStorage.setItem(BG_STORAGE, themeState.bg);
  } catch { /* ignore */ }

  renderThemePicker();
}

function renderThemePicker() {
  if (els.themeGrid) {
    els.themeGrid.innerHTML = THEMES.map(t => {
      const active = t.id === themeState.theme ? ' active' : '';
      return `<button class="theme-swatch${active}" data-theme-id="${t.id}" title="${escapeHtml(t.name)}" aria-label="${escapeHtml(t.name)}" aria-pressed="${t.id === themeState.theme}">` +
             `<span class="swatch-dot" style="background:${t.swatch}"></span>` +
             `<span class="swatch-name">${escapeHtml(t.name)}</span>` +
             `</button>`;
    }).join('');
  }

  if (els.bgRow) {
    els.bgRow.innerHTML = BACKGROUNDS.map(b => {
      const active = b.id === themeState.bg ? ' active' : '';
      return `<button class="bg-btn${active}" data-bg-id="${b.id}" aria-pressed="${b.id === themeState.bg}">${escapeHtml(b.name)}</button>`;
    }).join('');
  }
}

function toggleThemePanel(force) {
  if (!els.themePanel) return;
  const willOpen = typeof force === 'boolean' ? force : !els.themePanel.classList.contains('open');
  els.themePanel.classList.toggle('open', willOpen);
  els.themePanel.setAttribute('aria-hidden', String(!willOpen));
  if (els.themeBtn) els.themeBtn.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) renderThemePicker();
}

function initTheme() {
  loadThemePrefs();
  applyTheme(themeState.theme, themeState.bg);
}

// ─────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Very small markdown renderer — safe because we escape first. */
function renderMarkdown(raw) {
  if (!raw) return '';
  let text = escapeHtml(raw);

  // Fenced code blocks
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code class="lang-${lang || 'text'}">${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000CODEBLOCK${idx}\u0000`;
  });

  // Inline code
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headers
  text = text.replace(/^######\s+(.+)$/gm, '<h4>$1</h4>');
  text = text.replace(/^#####\s+(.+)$/gm,  '<h4>$1</h4>');
  text = text.replace(/^####\s+(.+)$/gm,   '<h4>$1</h4>');
  text = text.replace(/^###\s+(.+)$/gm,    '<h3>$1</h3>');
  text = text.replace(/^##\s+(.+)$/gm,     '<h2>$1</h2>');
  text = text.replace(/^#\s+(.+)$/gm,      '<h1>$1</h1>');

  // Bold / italic
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // Links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Blockquote
  text = text.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

  // Lists
  const lines = text.split('\n');
  const out = [];
  let inUl = false, inOl = false;
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  for (const line of lines) {
    const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ulMatch) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${olMatch[1]}</li>`);
    } else {
      closeLists();
      out.push(line);
    }
  }
  closeLists();
  text = out.join('\n');

  // Paragraphs
  text = text
    .split(/\n{2,}/)
    .map(chunk => {
      if (/^<(h[1-4]|ul|ol|pre|blockquote)/.test(chunk.trim())) return chunk;
      if (chunk.includes('\u0000CODEBLOCK')) return chunk;
      const trimmed = chunk.trim();
      if (!trimmed) return '';
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  // Restore code blocks
  text = text.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)]);

  return text;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
  });
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────
//  Toast notifications
// ─────────────────────────────────────────────
function toast(msg, type = 'info', ttl = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'ok' ? '✓' : type === 'err' ? '✗' : 'ℹ';
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
  els.toastWrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  }, ttl);
}

// ─────────────────────────────────────────────
//  Status
// ─────────────────────────────────────────────
function setStatus(status) {
  state.status = status;
  els.statusPill.dataset.status = status;
  const key = `status.${status}`;
  const label = t(key);
  els.statusLabel.textContent = label === key ? status : label;
  updateComposerState();
}

function updateComposerState() {
  const running = state.status === 'running';
  state.taskRunning = running;
  const hasText = els.taskInput.value.trim().length > 0;
  els.sendBtn.disabled = running || !hasText;
  els.taskInput.disabled = running;
  els.sendBtn.querySelector('span').textContent = running ? t('composer.working') : t('composer.send');
}

// ─────────────────────────────────────────────
//  Chat rendering
// ─────────────────────────────────────────────
function hideWelcome() {
  if (els.welcome && els.welcome.parentNode) {
    els.welcome.remove();
    els.welcome = null;
  }
}

function addMessage(role, content, { html = false } = {}) {
  hideWelcome();
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const avatarText = role === 'user' ? '🧑' : role === 'error' ? '⚠' : '🤖';
  const roleLabel  = role === 'user' ? t('msg.you') : role === 'error' ? t('msg.error') : t('msg.agent');
  wrap.innerHTML = `
    <div class="msg-avatar">${avatarText}</div>
    <div class="msg-body">
      <div class="msg-meta">${escapeHtml(roleLabel)} · ${nowTime()}</div>
      <div class="msg-content"></div>
    </div>`;
  const contentEl = wrap.querySelector('.msg-content');
  if (html) contentEl.innerHTML = content;
  else contentEl.innerHTML = renderMarkdown(content);

  els.chatMessages.appendChild(wrap);
  scrollChatToBottom();
  return wrap;
}

function addAssistantPlaceholder() {
  const wrap = addMessage('assistant', '<div class="typing"><i></i><i></i><i></i></div>', { html: true });
  state.currentAssistantEl = wrap.querySelector('.msg-content');
  return wrap;
}

function clearAssistantPlaceholder() {
  state.currentAssistantEl = null;
}

// ─────────────────────────────────────────────
//  Activity panel
// ─────────────────────────────────────────────
const ACTIVITY_ICONS = {
  info         : 'i',
  success      : '✓',
  warn         : '!',
  error        : '✗',
  tool_call    : '⚡',
  tool_result  : '↩',
  dim          : '·',
};

// Mapping from agent event content → i18n keys for common server messages.
// These come from the Node backend which is English-only, so we translate
// known patterns here to keep the Chinese experience consistent.
const SERVER_MESSAGE_PATTERNS = [
  { re: /^Working directory\s*:\s*(.+)$/i, key: 'agent.workingDir', capture: true },
];

function localizeServerMessage(msg) {
  if (!msg) return msg;
  const trimmed = String(msg).trim();
  for (const p of SERVER_MESSAGE_PATTERNS) {
    const m = trimmed.match(p.re);
    if (m) {
      const val = p.capture && m[1] ? `: ${m[1].trim()}` : '';
      return `${t(p.key)}${val}`;
    }
  }
  return msg;
}

function addActivity(type, title, detail) {
  if (els.activityEmpty && els.activityEmpty.parentNode) {
    els.activityEmpty.remove();
  }

  const el = document.createElement('div');
  el.className = `act t-${type}`;

  const icon = ACTIVITY_ICONS[type] || '·';
  el.innerHTML = `
    <div class="act-icon">${icon}</div>
    <div class="act-content">
      <div class="act-title"></div>
      ${detail ? '<div class="act-detail"></div>' : ''}
    </div>`;
  el.querySelector('.act-title').textContent = title;
  if (detail) {
    const d = el.querySelector('.act-detail');
    d.textContent = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
  }

  els.activityList.appendChild(el);
  els.activityList.scrollTop = els.activityList.scrollHeight;

  state.activityN++;
  els.activityCount.textContent = state.activityN;

  while (els.activityList.children.length > 250) {
    els.activityList.removeChild(els.activityList.firstChild);
  }
}

function buildActivityEmpty() {
  const d = document.createElement('div');
  d.className = 'activity-empty';
  d.id = 'activityEmpty';
  d.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                `<p>${escapeHtml(t('activity.empty'))}</p>`;
  return d;
}

function clearActivity() {
  els.activityList.innerHTML = '';
  els.activityEmpty = buildActivityEmpty();
  els.activityList.appendChild(els.activityEmpty);
  state.activityN = 0;
  els.activityCount.textContent = '0';
}

// ─────────────────────────────────────────────
//  SSE stream
// ─────────────────────────────────────────────
function connectEventStream() {
  const es = new EventSource('/api/events');

  es.addEventListener('snapshot', (e) => {
    try {
      const data = JSON.parse(e.data);
      setStatus(data.status);
      if (data.workingDir) els.hintWorkingDir.textContent = data.workingDir;
    } catch { /* ignore */ }
  });

  es.addEventListener('agent', (e) => {
    try {
      const evt = JSON.parse(e.data);
      handleAgentEvent(evt);
    } catch (err) {
      console.warn('Bad event', err);
    }
  });

  es.onerror = () => { /* EventSource auto-reconnects */ };
}

const MUTATING_TOOLS = new Set([
  'write_file', 'apply_patch', 'append_to_file', 'replace_in_file',
  'delete_file', 'move_file', 'copy_file', 'create_directory', 'write_files',
]);

function isMutatingTool(name) {
  return MUTATING_TOOLS.has(name);
}

function handleAgentEvent(evt) {
  switch (evt.type) {
    case 'banner':
      addActivity('dim', t('act.banner'));
      break;
    case 'header':
      addActivity('info', localizeServerMessage(evt.message));
      break;
    case 'info':
      addActivity('info', localizeServerMessage(evt.message));
      break;
    case 'success':
      addActivity('success', localizeServerMessage(evt.message));
      break;
    case 'warn':
      addActivity('warn', localizeServerMessage(evt.message));
      break;
    case 'error':
      addActivity('error', localizeServerMessage(evt.message));
      break;
    case 'dim':
      addActivity('dim', localizeServerMessage(evt.message));
      break;
    case 'thinking':
      break;
    case 'iteration':
      addActivity('info', t('act.step', { n: evt.n, max: evt.max }));
      break;
    case 'tool_call':
      addActivity('tool_call', t('act.toolCall', { name: evt.name }), evt.args);
      break;
    case 'tool_result':
      addActivity(
        evt.isError ? 'error' : 'tool_result',
        evt.isError ? t('act.toolError') : t('act.toolResult'),
        evt.result
      );
      // Refresh the workspace after a file-mutating tool so the tree stays live.
      if (!evt.isError && isMutatingTool(evt.name)) loadWorkspace();
      break;
    case 'finalOutput':
      clearAssistantPlaceholder();
      state.lastAssistantContent = evt.content;
      addMessage('assistant', evt.content);
      break;
    case 'status':
      setStatus(evt.status);
      break;
    case 'user_message':
      break;
    case 'task_done':
      clearAssistantPlaceholder();
      setStatus('ready');
      toast(t('toast.taskComplete'), 'ok');
      loadTokenUsage();
      // The agent may have created/edited/deleted files — refresh the tree.
      loadWorkspace();
      break;
    case 'task_error':
      clearAssistantPlaceholder();
      addMessage('error', evt.message);
      setStatus('error');
      toast(`${t('toast.taskFailed')}: ${evt.message}`, 'err');
      break;
    case 'new_chat':
      addActivity('info', t('act.newChat'));
      break;
    case 'account_switched':
      addActivity('info', `${t('accounts.switched')}: ${evt.account ? evt.account.name : ''}`);
      if (els.accountsModal && els.accountsModal.classList.contains('open')) refreshAccounts();
      break;
    case 'account_added':
    case 'account_removed':
      if (els.accountsModal && els.accountsModal.classList.contains('open')) refreshAccounts();
      break;
    default:
      break;
  }
}

// ─────────────────────────────────────────────
//  API calls
// ─────────────────────────────────────────────
async function fetchStatus() {
  try {
    const r = await fetch('/api/status');
    const data = await r.json();
    setStatus(data.status);
    els.hintWorkingDir.textContent = data.workingDir || '';
  } catch (err) {
    console.warn('Status fetch failed', err);
  }
}

async function submitTask(task) {
  if (!task || state.taskRunning) return;

  addMessage('user', task);
  addAssistantPlaceholder();

  setStatus('running');
  els.taskInput.value = '';
  autosizeTextarea();
  updateComposerState();

  try {
    const res = await fetch('/api/task', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        task,
        keepSession: els.keepSession.checked,
        newChat    : !els.keepSession.checked,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
  } catch (err) {
    clearAssistantPlaceholder();
    addMessage('error', err.message);
    setStatus('error');
    toast(err.message, 'err');
  }
}

// ─────────────────────────────────────────────
//  Settings modal
// ─────────────────────────────────────────────
async function loadTokenUsage() {
  if (!els.tokTodayTotal) return;
  try {
    const res = await fetch('/api/tokens');
    const data = await res.json();
    const today = data.today || {};
    els.tokTodayTotal.textContent  = Number(today.total  || 0).toLocaleString();
    els.tokTodayInput.textContent  = Number(today.input  || 0).toLocaleString();
    els.tokTodayOutput.textContent = Number(today.output || 0).toLocaleString();
    els.tokTodayTasks.textContent  = Number(today.tasks  || 0).toLocaleString();
  } catch (err) {
    console.warn('Token usage fetch failed', err);
  }
}

async function openSettings() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    els.cfgWorkingDir.value = cfg.workingDir || '';
    els.cfgMaxIter.value    = cfg.maxIterations ?? 40;
    els.cfgHeadless.checked = !!cfg.headless;
    els.cfgDebug.checked    = !!cfg.debug;
  } catch (err) {
    toast(`${t('toast.settingsLoadFailed')}: ${err.message}`, 'err');
  }
  loadTokenUsage();
  els.settingsModal.classList.add('open');
}

async function saveSettings() {
  const body = {
    workingDir   : els.cfgWorkingDir.value.trim(),
    maxIterations: Number(els.cfgMaxIter.value) || 40,
    headless     : els.cfgHeadless.checked,
    debug        : els.cfgDebug.checked,
  };
  try {
    const res = await fetch('/api/config', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    els.hintWorkingDir.textContent = data.config.WORKING_DIR || '';
    toast(t('toast.settingsSaved'), 'ok');
    els.settingsModal.classList.remove('open');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ─────────────────────────────────────────────
//  Tools modal
// ─────────────────────────────────────────────
function renderTools(tools) {
  if (!tools || tools.length === 0) {
    els.toolsBody.innerHTML = `<div class="loading-line">${escapeHtml(t('tools.none'))}</div>`;
    return;
  }
  els.toolsBody.innerHTML = tools.map(tool => {
    const params = tool.parameters.length
      ? tool.parameters.map(p =>
          `<div class="tool-param"><b>${escapeHtml(p.name)}</b>` +
          ` <span style="color:var(--text-3)">(${escapeHtml(p.type)}${p.required ? ', <span class="req">' + escapeHtml(t('tools.required')) + '</span>' : ''})</span>` +
          `${p.description ? ' — ' + escapeHtml(p.description) : ''}</div>`
        ).join('')
      : `<div class="tool-param">${escapeHtml(t('tools.noParams'))}</div>`;
    return `
      <div class="tool-item">
        <h4>${escapeHtml(tool.name)}</h4>
        <p>${escapeHtml(tool.description || '')}</p>
        <div class="tool-params">${params}</div>
      </div>`;
  }).join('');
}

async function openTools() {
  els.toolsModal.classList.add('open');
  els.toolsBody.innerHTML = `<div class="loading-line"><span class="spin"></span> ${escapeHtml(t('tools.loading'))}</div>`;
  try {
    const res = await fetch('/api/tools');
    const data = await res.json();
    state.toolsCache = data.tools || [];
    renderTools(state.toolsCache);
  } catch (err) {
    els.toolsBody.innerHTML = `<div class="loading-line" style="color:var(--rose)">${escapeHtml(t('tools.loadFailed'))}: ${escapeHtml(err.message)}</div>`;
  }
}

// ─────────────────────────────────────────────
//  Conversation history
// ─────────────────────────────────────────────
async function openHistory() {
  if (!els.historyModal) return;
  els.historyModal.classList.add('open');
  els.historyBody.innerHTML = `<div class="loading-line"><span class="spin"></span> ${escapeHtml(t('history.loading'))}</div>`;
  try {
    const res  = await fetch('/api/conversations');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderHistory(data.conversations || []);
  } catch (err) {
    els.historyBody.innerHTML = `<div class="loading-line" style="color:var(--rose)">${escapeHtml(t('history.loadFailed'))}: ${escapeHtml(err.message)}</div>`;
  }
}

function renderHistory(conversations) {
  if (!conversations || conversations.length === 0) {
    els.historyBody.innerHTML = `<div class="loading-line">${escapeHtml(t('history.empty'))}</div>`;
    return;
  }
  els.historyBody.innerHTML = conversations.map(c => `
    <div class="history-item" data-ref="${escapeHtml(String(c.index))}" data-title="${escapeHtml(c.title || '')}">
      <div class="history-item-main">
        <span class="history-num">${c.index}</span>
        <span class="history-title">${escapeHtml(c.title || '(untitled)')}</span>
      </div>
      <div class="history-item-actions">
        <button class="btn btn-ghost" data-action="view"     data-ref="${escapeHtml(String(c.index))}" data-title="${escapeHtml(c.title || '')}">${escapeHtml(t('history.view'))}</button>
        <button class="btn btn-primary" data-action="continue" data-ref="${escapeHtml(String(c.index))}" data-title="${escapeHtml(c.title || '')}">${escapeHtml(t('history.continue'))}</button>
      </div>
    </div>`).join('');

  els.historyBody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ref   = /^\d+$/.test(btn.dataset.ref) ? Number(btn.dataset.ref) : btn.dataset.ref;
      const title = btn.dataset.title || '';
      if (btn.dataset.action === 'view') {
        viewConversation(ref, title);
      } else {
        continueConversation(ref, title);
      }
    });
  });
}

async function continueConversation(ref, title) {
  try {
    const res  = await fetch('/api/conversations/open', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ ref }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'open failed');

    els.historyModal.classList.remove('open');
    hideWelcome();
    addMessage('assistant', `📂 ${t('history.title')}: ${title || ''}`);
    if (Array.isArray(data.turns) && data.turns.length > 0) {
      renderConversationTurns(data.turns);
    }
    els.keepSession.checked = true; // continue this same thread
    toast(`${t('topbar.history')}: ${title || ''}`, 'ok');
  } catch (err) {
    toast(`${t('history.openFailed')}: ${err.message}`, 'err');
  }
}

async function viewConversation(ref, title) {
  try {
    const res  = await fetch('/api/conversations/open', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ ref }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'open failed');

    els.historyModal.classList.remove('open');
    hideWelcome();
    addMessage('assistant', `📂 ${t('history.preview')}: ${title || ''}`);
    if (Array.isArray(data.turns) && data.turns.length > 0) {
      renderConversationTurns(data.turns);
    } else {
      addMessage('assistant', t('history.noTurns'));
    }
  } catch (err) {
    toast(`${t('history.openFailed')}: ${err.message}`, 'err');
  }
}

function renderConversationTurns(turns) {
  for (const turn of turns) {
    const role = turn.role === 'user' ? 'user' : 'assistant';
    addMessage(role, turn.content);
  }
}

// ─────────────────────────────────────────────
//  Accounts
// ─────────────────────────────────────────────
async function openAccounts() {
  if (!els.accountsModal) return;
  els.accountsModal.classList.add('open');
  els.accountsBody.innerHTML = `<div class="loading-line"><span class="spin"></span> ${escapeHtml(t('accounts.loading'))}</div>`;
  await refreshAccounts();
}

async function refreshAccounts() {
  try {
    const res  = await fetch('/api/accounts');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderAccounts(data.accounts || []);
  } catch (err) {
    els.accountsBody.innerHTML = `<div class="loading-line" style="color:var(--rose)">${escapeHtml(t('accounts.loadFailed'))}: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAccounts(accounts) {
  if (!accounts || accounts.length === 0) {
    els.accountsBody.innerHTML = `<div class="loading-line">${escapeHtml(t('accounts.empty'))}</div>`;
    return;
  }
  els.accountsBody.innerHTML = accounts.map(a => `
    <div class="history-item">
      <div class="history-item-main">
        <span class="history-num">${a.active ? '●' : '○'}</span>
        <span class="history-title">${escapeHtml(a.name)}${a.active ? ' — ' + escapeHtml(t('accounts.active')) : ''}</span>
      </div>
      <div class="history-item-actions">
        ${a.active ? '' : `<button class="btn btn-primary" data-acct-use="${escapeHtml(a.name)}">${escapeHtml(t('accounts.use'))}</button>`}
        ${a.name === 'default' ? '' : `<button class="btn btn-ghost" data-acct-remove="${escapeHtml(a.name)}">${escapeHtml(t('accounts.remove'))}</button>`}
      </div>
    </div>`).join('');

  els.accountsBody.querySelectorAll('button[data-acct-use]').forEach(btn => {
    btn.addEventListener('click', () => switchAccount(btn.dataset.acctUse));
  });
  els.accountsBody.querySelectorAll('button[data-acct-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeAccount(btn.dataset.acctRemove));
  });
}

async function switchAccount(name) {
  try {
    const res  = await fetch('/api/accounts/switch', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'switch failed');
    toast(`${t('accounts.switched')}: ${name}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

async function addAccount() {
  const name = (els.newAccountName.value || '').trim();
  if (!name) return;
  try {
    const res  = await fetch('/api/accounts/add', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'add failed');
    els.newAccountName.value = '';
    toast(`${t('accounts.added')}: ${name}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

async function removeAccount(name) {
  if (!window.confirm(t('accounts.removeConfirm'))) return;
  try {
    const res  = await fetch('/api/accounts/remove', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name, deleteProfile: true }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'remove failed');
    toast(`${t('accounts.removed')}: ${name}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

async function rotateAccount() {
  try {
    const res  = await fetch('/api/accounts/rotate', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'rotate failed');
    toast(`${t('accounts.rotated')}: ${data.account ? data.account.name : ''}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

// ─────────────────────────────────────────────
//  Accounts
// ─────────────────────────────────────────────
async function openAccounts() {
  if (!els.accountsModal) return;
  els.accountsModal.classList.add('open');
  els.accountsBody.innerHTML = `<div class="loading-line"><span class="spin"></span> ${escapeHtml(t('accounts.loading'))}</div>`;
  await refreshAccounts();
}

async function refreshAccounts() {
  try {
    const res  = await fetch('/api/accounts');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderAccounts(data.accounts || []);
  } catch (err) {
    els.accountsBody.innerHTML = `<div class="loading-line" style="color:var(--rose)">${escapeHtml(t('accounts.loadFailed'))}: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAccounts(accounts) {
  if (!accounts || accounts.length === 0) {
    els.accountsBody.innerHTML = `<div class="loading-line">${escapeHtml(t('accounts.empty'))}</div>`;
    return;
  }
  els.accountsBody.innerHTML = accounts.map(a => `
    <div class="history-item">
      <div class="history-item-main">
        <span class="history-num">${a.active ? '●' : '○'}</span>
        <span class="history-title">${escapeHtml(a.name)}${a.active ? ' — ' + escapeHtml(t('accounts.active')) : ''}</span>
      </div>
      <div class="history-item-actions">
        ${a.active ? '' : `<button class="btn btn-primary" data-acct-use="${escapeHtml(a.name)}">${escapeHtml(t('accounts.use'))}</button>`}
        ${a.name === 'default' ? '' : `<button class="btn btn-ghost" data-acct-remove="${escapeHtml(a.name)}">${escapeHtml(t('accounts.remove'))}</button>`}
      </div>
    </div>`).join('');

  els.accountsBody.querySelectorAll('button[data-acct-use]').forEach(btn => {
    btn.addEventListener('click', () => switchAccount(btn.dataset.acctUse));
  });
  els.accountsBody.querySelectorAll('button[data-acct-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeAccount(btn.dataset.acctRemove));
  });
}

async function switchAccount(name) {
  try {
    const res  = await fetch('/api/accounts/switch', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'switch failed');
    toast(`${t('accounts.switched')}: ${name}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

async function addAccount() {
  const name = (els.newAccountName.value || '').trim();
  if (!name) return;
  try {
    const res  = await fetch('/api/accounts/add', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'add failed');
    els.newAccountName.value = '';
    toast(`${t('accounts.added')}: ${name}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

async function removeAccount(name) {
  if (!window.confirm(t('accounts.removeConfirm'))) return;
  try {
    const res  = await fetch('/api/accounts/remove', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name, deleteProfile: true }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'remove failed');
    toast(`${t('accounts.removed')}: ${name}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

async function rotateAccount() {
  try {
    const res  = await fetch('/api/accounts/rotate', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'rotate failed');
    toast(`${t('accounts.rotated')}: ${data.account ? data.account.name : ''}`, 'ok');
    await refreshAccounts();
  } catch (err) {
    toast(`${t('accounts.opFailed')}: ${err.message}`, 'err');
  }
}

// ─────────────────────────────────────────────
//  Composer autosize
// ─────────────────────────────────────────────
function autosizeTextarea() {
  const ta = els.taskInput;
  ta.style.height = 'auto';
  const maxH = 220;
  const h = Math.min(ta.scrollHeight, maxH);
  ta.style.height = h + 'px';
  ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
}

// ─────────────────────────────────────────────
//  Suggestion task localization
// ─────────────────────────────────────────────
function refreshSuggestionTasks() {
  if (!els.suggestions) return;
  const buttons = els.suggestions.querySelectorAll('.suggestion');
  for (const btn of buttons) {
    const key = btn.getAttribute('data-i18n-task');
    if (key) btn.dataset.task = t(key);
  }
}

// ─────────────────────────────────────────────
//  Language change handling
// ─────────────────────────────────────────────
function applyLanguageDependentUI() {
  // i18n.applyTranslations() already handled static text
  refreshSuggestionTasks();
  updateComposerState();
  setStatus(state.status); // re-render the status label
  if (state.toolsCache && els.toolsModal.classList.contains('open')) {
    renderTools(state.toolsCache);
  }
  if (els.activityEmpty && els.activityEmpty.parentNode) {
    const p = els.activityEmpty.querySelector('p');
    if (p) p.textContent = t('activity.empty');
  }
}

// ─────────────────────────────────────────────
//  Event wiring
// ─────────────────────────────────────────────
function wireEvents() {
  // Compose / send
  els.taskInput.addEventListener('input', () => {
    autosizeTextarea();
    updateComposerState();
  });
  els.taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!els.sendBtn.disabled) submitTask(els.taskInput.value.trim());
    }
  });
  els.sendBtn.addEventListener('click', () => submitTask(els.taskInput.value.trim()));

  // Suggestion chips
  els.suggestions.addEventListener('click', (e) => {
    const btn = e.target.closest('.suggestion');
    if (!btn) return;
    els.taskInput.value = btn.dataset.task || '';
    autosizeTextarea();
    updateComposerState();
    els.taskInput.focus();
  });

  // Language toggle
  els.langBtn.addEventListener('click', () => {
    window.i18n.toggleLang();
  });

  // Theme & background picker
  if (els.themeBtn) {
    els.themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleThemePanel();
    });
  }
  if (els.themeClose) {
    els.themeClose.addEventListener('click', () => toggleThemePanel(false));
  }
  if (els.themeGrid) {
    els.themeGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-id]');
      if (!btn) return;
      applyTheme(btn.dataset.themeId);
    });
  }
  if (els.bgRow) {
    els.bgRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bg-id]');
      if (!btn) return;
      applyTheme(undefined, btn.dataset.bgId);
    });
  }
  // Close the theme panel on outside click / Escape
  document.addEventListener('click', (e) => {
    if (!els.themePanel || !els.themePanel.classList.contains('open')) return;
    if (els.themePanel.contains(e.target) || (els.themeBtn && els.themeBtn.contains(e.target))) return;
    toggleThemePanel(false);
  });

  // Modals
  els.settingsBtn.addEventListener('click', openSettings);
  els.toolsBtn.addEventListener('click', openTools);
  if (els.historyBtn) els.historyBtn.addEventListener('click', openHistory);
  if (els.accountsBtn) els.accountsBtn.addEventListener('click', openAccounts);
  if (els.addAccountBtn) els.addAccountBtn.addEventListener('click', addAccount);
  if (els.rotateAccountBtn) els.rotateAccountBtn.addEventListener('click', rotateAccount);
  els.saveSettings.addEventListener('click', saveSettings);

  document.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById(el.dataset.closeModal).classList.remove('open');
    });
  });
  [els.settingsModal, els.toolsModal, els.historyModal, els.accountsModal, els.fileModal].filter(Boolean).forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('open');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.settingsModal.classList.remove('open');
      els.toolsModal.classList.remove('open');
      if (els.historyModal) els.historyModal.classList.remove('open');
      if (els.accountsModal) els.accountsModal.classList.remove('open');
      if (els.fileModal) els.fileModal.classList.remove('open');
      toggleThemePanel(false);
    }
  });

  // Activity clear
  els.clearActivity.addEventListener('click', clearActivity);

  // React to language changes
  window.i18n.onChange(() => {
    applyLanguageDependentUI();
    toast(t('toast.langChanged'), 'info', 1800);
  });
}

// ─────────────────────────────────────────────
//  Workspace file browser
// ─────────────────────────────────────────────
function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['js','mjs','cjs','jsx'].includes(ext)) return '🟨';
  if (['ts','tsx'].includes(ext))           return '🟦';
  if (['json','jsonc'].includes(ext))       return '🔧';
  if (['md','markdown','txt'].includes(ext))return '📄';
  if (['css','scss','sass','less'].includes(ext)) return '🎨';
  if (['html','htm','vue','svelte'].includes(ext)) return '🌐';
  if (['png','jpg','jpeg','gif','svg','webp','ico'].includes(ext)) return '🖼️';
  if (['sh','bat','ps1','cmd'].includes(ext))return '⚙️';
  if (['yml','yaml','toml','ini','env'].includes(ext)) return '🧾';
  if (['lock'].includes(ext))                return '🔒';
  return '📄';
}

function ensureOpenDirs() {
  if (!state.workspaceOpenDirs) state.workspaceOpenDirs = new Set();
  return state.workspaceOpenDirs;
}

function buildWorkspaceNodes(entries, depth) {
  const frag = document.createDocumentFragment();
  const openDirs = ensureOpenDirs();

  for (const entry of entries) {
    const row = document.createElement('div');

    if (entry.type === 'dir') {
      const open = openDirs.has(entry.path);
      const btn = document.createElement('button');
      btn.className = 'ws-item ws-dir';
      btn.dataset.path = entry.path;
      btn.dataset.type = 'dir';
      btn.title = entry.path;
      btn.innerHTML = `
        <span class="ws-caret ${open ? 'open' : ''}">▶</span>
        <span class="ws-icon">${open ? '📂' : '📁'}</span>
        <span class="ws-name"></span>`;
      btn.querySelector('.ws-name').textContent = entry.name;
      row.appendChild(btn);

      const children = document.createElement('div');
      children.className = 'ws-children' + (open ? '' : ' collapsed');
      children.dataset.parent = entry.path;
      if (entry.children && entry.children.length) {
        children.appendChild(buildWorkspaceNodes(entry.children, depth + 1));
      }
      row.appendChild(children);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ws-item ws-file';
      if (state.workspaceActiveFile === entry.path) btn.classList.add('is-active');
      btn.dataset.path = entry.path;
      btn.dataset.type = 'file';
      btn.title = entry.path;
      btn.style.paddingLeft = (8 + depth * 14) + 'px';
      btn.innerHTML = `
        <span class="ws-icon"></span>
        <span class="ws-name"></span>`;
      btn.querySelector('.ws-icon').textContent = fileIcon(entry.name);
      btn.querySelector('.ws-name').textContent = entry.name;
      row.appendChild(btn);
    }

    frag.appendChild(row);
  }
  return frag;
}

function renderWorkspace(data) {
  if (!els.workspaceTree) return;
  els.workspaceTree.innerHTML = '';

  if (els.workspaceRoot) {
    els.workspaceRoot.textContent = data && data.name ? data.name : '';
    els.workspaceRoot.title = data && data.root ? data.root : '';
  }

  if (!data || !data.tree || data.tree.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'workspace-empty';
    const p = document.createElement('p');
    p.setAttribute('data-i18n', 'workspace.empty');
    p.textContent = t('workspace.empty');
    empty.appendChild(p);
    els.workspaceTree.appendChild(empty);
    return;
  }

  els.workspaceTree.appendChild(buildWorkspaceNodes(data.tree, 0));

  if (data.truncated) {
    const note = document.createElement('div');
    note.className = 'workspace-empty';
    const p = document.createElement('p');
    p.textContent = t('workspace.truncated');
    note.appendChild(p);
    els.workspaceTree.appendChild(note);
  }
}

async function loadWorkspace() {
  if (!els.workspaceTree) return;
  // Show a loading state on first load only.
  if (!state.workspaceData) {
    els.workspaceTree.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'workspace-empty';
    const p = document.createElement('p');
    p.textContent = t('workspace.loading');
    loading.appendChild(p);
    els.workspaceTree.appendChild(loading);
  }
  try {
    const res = await fetch('/api/workspace/tree');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const data = await res.json();
    state.workspaceData = data;
    renderWorkspace(data);
  } catch (err) {
    els.workspaceTree.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'workspace-empty';
    const p = document.createElement('p');
    p.textContent = `${t('workspace.loadFailed')}: ${err.message}`;
    box.appendChild(p);
    els.workspaceTree.appendChild(box);
  }
}

function toggleWorkspaceDir(path, open) {
  const openDirs = ensureOpenDirs();
  if (open) openDirs.add(path); else openDirs.delete(path);
}

async function openWorkspaceFile(path) {
  if (!els.fileModal) return;
  state.workspaceActiveFile = path;
  // Refresh active-row highlight
  els.workspaceTree.querySelectorAll('.ws-file.is-active').forEach(el => el.classList.remove('is-active'));
  const activeBtn = els.workspaceTree.querySelector(`.ws-file[data-path="${CSS.escape(path)}"]`);
  if (activeBtn) activeBtn.classList.add('is-active');

  els.fileModalTitle.textContent = path;
  els.filePreview.textContent = t('workspace.loading');
  els.fileModal.classList.add('open');

  try {
    const res = await fetch('/api/workspace/file?path=' + encodeURIComponent(path));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    els.filePreview.textContent = data.binary
      ? t('workspace.binary')
      : (data.content != null ? data.content : '');
  } catch (err) {
    els.filePreview.textContent = `${t('workspace.fileFailed')}: ${err.message}`;
  }
}

function wireWorkspaceEvents() {
  if (els.workspaceRefresh) {
    els.workspaceRefresh.addEventListener('click', loadWorkspace);
  }
  if (els.workspaceTree) {
    els.workspaceTree.addEventListener('click', (e) => {
      const btn = e.target.closest('.ws-item');
      if (!btn) return;
      const path = btn.dataset.path;
      if (btn.dataset.type === 'dir') {
        const open = !btn.querySelector('.ws-caret').classList.contains('open');
        toggleWorkspaceDir(path, open);
        // Re-render just this subtree for snappy toggling.
        const children = els.workspaceTree.querySelector(`.ws-children[data-parent="${CSS.escape(path)}"]`);
        const caret = btn.querySelector('.ws-caret');
        const icon  = btn.querySelector('.ws-icon');
        if (children) children.classList.toggle('collapsed', !open);
        caret.classList.toggle('open', open);
        icon.textContent = open ? '📂' : '📁';
      } else if (btn.dataset.type === 'file') {
        openWorkspaceFile(path);
      }
    });
  }
  // Modal is closed via the generic [data-close-modal] handler wired in wireEvents().
}

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
function boot() {
  // Apply the saved theme before anything else to avoid a flash of default colors
  initTheme();
  // Apply translations before wiring so the initial paint matches the language
  window.i18n.applyTranslations();
  wireEvents();
  wireWorkspaceEvents();
  refreshSuggestionTasks();
  autosizeTextarea();
  updateComposerState();
  fetchStatus();
  connectEventStream();
  loadWorkspace();
}

document.addEventListener('DOMContentLoaded', boot);
