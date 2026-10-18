// src/browser.js — Playwright controller for chat.deepseek.com
'use strict';

const { chromium } = require('playwright');
const path         = require('path');
const config       = require('./config');
const logger       = require('./logger');
const i18n         = require('./i18n');

// ─────────────────────────────────────────────────────────────────────────────
//  Selector banks — ordered by likelihood, with fallbacks
//  We never depend on a single selector; DeepSeek's UI can change.
// ─────────────────────────────────────────────────────────────────────────────

const SEL = {
  // Text input where the user types
  chatInput: [
    '#chat-input',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ],

  // Button that submits the message
  sendButton: [
    'button[aria-label*="Send" i]',
    'button[aria-label*="send" i]',
    '[data-testid="send-button"]',
    'button[type="submit"]',
    '[class*="send-btn"]',
    '[class*="sendBtn"]',
    '[class*="send-button"]',
  ],

  // "Stop generating" button — visible while streaming
  stopButton: [
    'button[aria-label*="Stop" i]',
    '[aria-label*="stop generating" i]',
    '[data-testid="stop-button"]',
    '[class*="stop-btn"]',
    '[class*="stopBtn"]',
  ],

  // "Regenerate" button shown under a completed assistant message — used
  // as a last-resort recovery when a reply keeps getting cut off.
  regenerateButton: [
    'button[aria-label*="Regenerate" i]',
    'button[aria-label*="Regenerate response" i]',
    'button[aria-label*="重新生成"]',
    '[data-testid="regenerate-button"]',
    '[class*="regenerate"]',
    '[class*="regenerate-btn"]',
    '[class*="refresh-btn"]',
  ],

  // "New chat" / "New conversation" button in sidebar
  newChat: [
    'button[aria-label*="New chat" i]',
    'button[aria-label*="New conversation" i]',
    'a[href="/"][aria-label]',
    '[data-testid="new-chat"]',
    '[class*="new-chat"]',
    '[class*="newChat"]',
  ],

  // The main chat messages container
  messageContainer: [
    '[class*="chat-content"]',
    '[class*="message-list"]',
    '[class*="conversation"]',
    'main',
  ],

  // ── Conversation history (sidebar) ───────────────────────────────────────
  // Each entry is one prior conversation. Ordered most-specific first so we
  // never fall back to a broad "a[href]" grab that would match nav links.
  historyItem: [
    'a[href*="/a/chat/s/"]',
    'a[href*="/chat/s/"]',
    'a[href*="/a/chat/"]',
    '[class*="history-item"]',
    '[class*="historyItem"]',
    '[class*="conversation-item"]',
    '[class*="conversationItem"]',
    '[class*="chat-item"]',
    '[class*="chatItem"]',
    '[class*="history"] a[href]',
  ],

  // Buttons that expand / reveal the sidebar when it is collapsed
  sidebarToggle: [
    'button[aria-label*="sidebar" i]',
    'button[aria-label*="menu" i]',
    'button[aria-label*="history" i]',
    '[class*="sidebar-toggle"]',
    '[class*="sidebarToggle"]',
    '[class*="expand-sidebar"]',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
//  DeepSeekBrowser class
// ─────────────────────────────────────────────────────────────────────────────

class DeepSeekBrowser {
  constructor(options = {}) {
    this.context  = null;
    this.page     = null;
    this._closed  = false;
    // When set, overrides config.SESSION_DIR — used to give each account its
    // own persistent browser profile.
    this.sessionDir = options.sessionDir || null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async launch() {
    const t = i18n.t;
    logger.info(t('browser.launching'));

    const sessionDir = path.resolve(this.sessionDir || config.SESSION_DIR);
    // Make sure the (possibly per-account) profile directory exists.
    try { require('fs').mkdirSync(sessionDir, { recursive: true }); } catch { /* ignore */ }

    this.context = await chromium.launchPersistentContext(sessionDir, {
      headless      : config.HEADLESS,
      viewport      : { width: 1280, height: 900 },
      userAgent     : [
        'Mozilla/5.0 (X11; Linux x86_64)',
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        'Chrome/124.0.0.0 Safari/537.36',
      ].join(' '),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--disable-default-apps',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    // Grab existing page or open a new one
    const pages   = this.context.pages();
    this.page     = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Mask automation signals
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await this._navigate(config.DEEPSEEK_URL);
    await this._ensureLoggedIn();

    logger.success(t('browser.ready'));
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    try { await this.context?.close(); } catch {}
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async _navigate(url) {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await this.page.waitForTimeout(1_500);
    } catch (err) {
      logger.warn(`${i18n.t('browser.navWarning')} ${err.message}`);
    }
  }

  async newChat() {
    try {
      // Try clicking the "New Chat" button in the sidebar
      for (const sel of SEL.newChat) {
        try {
          const el = await this.page.$(sel);
          if (el && await el.isVisible()) {
            await el.click();
            await this.page.waitForTimeout(1_000);
            logger.dim(i18n.t('browser.newChatDone'));
            return;
          }
        } catch {}
      }
    } catch {}

    // Fallback: navigate to home which usually opens a fresh chat
    await this._navigate(config.DEEPSEEK_URL);
    logger.dim(i18n.t('browser.homeFallback'));
  }

  // ── Conversation history ───────────────────────────────────────────────────

  /**
   * Make sure the sidebar (which holds the conversation history) is visible.
   * DeepSeek collapses it on narrow viewports; if we can find a toggle we click
   * it.  Best-effort — a failure here is never fatal.
   */
  async _ensureSidebarOpen() {
    try {
      // Already-visible history entry means the sidebar is open.
      for (const sel of SEL.historyItem) {
        const el = await this.page.$(sel);
        if (el && await el.isVisible().catch(() => false)) return;
      }
      // Try to reveal it.
      for (const sel of SEL.sidebarToggle) {
        try {
          const el = await this.page.$(sel);
          if (el && await el.isVisible().catch(() => false)) {
            await el.click();
            await this.page.waitForTimeout(600);
            return;
          }
        } catch { /* try next */ }
      }
    } catch { /* ignore */ }
  }

  /**
   * List the DeepSeek conversation history shown in the sidebar.
   *
   * Returns an array of { index, title, href } objects, newest first (the order
   * DeepSeek renders them).  When no conversations are found an empty array is
   * returned rather than throwing, so callers can present a friendly message.
   */
  async listConversations() {
    await this._ensureSidebarOpen();

    const items = await this.page.evaluate((selectors) => {
      // Try each selector bank in order; the first that yields results wins.
      let nodes = [];
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) { nodes = found; break; }
      }

      const seen = new Set();
      const out  = [];
      for (const el of nodes) {
        if (!el || typeof el.closest !== 'function') continue;

        // Prefer an anchor target; if the matched node is not an <a>, look for
        // a descendant/ancestor anchor that carries the conversation link.
        let anchor = null;
        if (el.tagName && el.tagName.toLowerCase() === 'a') anchor = el;
        if (!anchor) anchor = el.querySelector && el.querySelector('a[href]');
        if (!anchor) anchor = el.closest && el.closest('a[href]');

        const href = anchor ? anchor.getAttribute('href') : null;

        // Title: prefer the anchor's own text, fall back to the container's.
        let title = '';
        const titleEl = (anchor && anchor.querySelector && anchor.querySelector(
          '[class*="title"], [class*="name"], [class*="text"], span, div'
        )) || anchor || el;
        title = (titleEl.innerText || titleEl.textContent || '').trim();
        if (!title) title = (el.innerText || '').trim();

        // Collapse whitespace and drop the trailing "..." that DeepSeek adds.
        title = title.replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();

        if (!title && !href) continue;
        // Skip obvious non-conversation rows.
        if (/^(new chat|new conversation|新对话|新建对话)$/i.test(title)) continue;

        const key = href || title;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({ title: title || '(untitled)', href: href || null });
      }
      return out;
    }, SEL.historyItem);

    return items.map((item, i) => ({ index: i + 1, ...item }));
  }

  /**
   * Open a conversation from the history list.
   *
   * `ref` may be:
   *   • a 1-based index from listConversations() (number), or
   *   • an exact/partial title (string), or
   *   • a full or partial href (string starting with '/').
   *
   * Returns the matched conversation descriptor on success; throws if nothing
   * matches so the caller can report a clear error.
   */
  async openConversation(ref) {
    const list = await this.listConversations();
    if (list.length === 0) {
      throw new Error(i18n.t('browser.noHistory'));
    }

    let match = null;

    if (typeof ref === 'number' && Number.isFinite(ref)) {
      match = list[ref - 1] || null;
    } else if (typeof ref === 'string') {
      const needle = ref.trim().toLowerCase();
      // Exact title first, then partial title, then href.
      match = list.find(c => (c.title || '').toLowerCase() === needle)
           || list.find(c => (c.title || '').toLowerCase().includes(needle))
           || list.find(c => c.href && c.href.toLowerCase().includes(needle))
           || null;
    }

    if (!match) throw new Error(i18n.t('browser.noMatch', { ref: String(ref) }));

    // Click the matching sidebar entry.  Re-query the DOM because the node list
    // captured above is a plain snapshot, not live handles.
    const clicked = await this.page.evaluate(({ selectors, target }) => {
      let nodes = [];
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) { nodes = found; break; }
      }
      for (const el of nodes) {
        let anchor = null;
        if (el.tagName && el.tagName.toLowerCase() === 'a') anchor = el;
        if (!anchor) anchor = el.querySelector && el.querySelector('a[href]');
        if (!anchor) anchor = el.closest && el.closest('a[href]');
        const href  = anchor ? anchor.getAttribute('href') : null;
        const title = ((anchor || el).innerText || '').replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();
        if ((target.href && href && href === target.href) || (target.title && title === target.title)) {
          (anchor || el).click();
          return true;
        }
      }
      return false;
    }, { selectors: SEL.historyItem, target: { href: match.href, title: match.title } });

    if (!clicked) throw new Error(i18n.t('browser.noMatch', { ref: String(ref) }));

    // Give the SPA time to swap the conversation into view.
    await this.page.waitForTimeout(1_500);
    return match;
  }

  /**
   * Extract the full text of the currently open conversation as an ordered list
   * of { role: 'user' | 'assistant', content } turns.
   *
   * This walks every message bubble on the page.  Selectors mirror the ones
   * used for the live-response reader so the two stay consistent.
   */
  async readCurrentConversation() {
    return await this.page.evaluate(() => {
      // Reconstruct text from a node, re-adding ``` fences for code blocks.
      function getFullText(el) {
        if (!el) return '';
        let result = '';
        function walk(node) {
          if (node.nodeType === Node.TEXT_NODE) { result += node.textContent; return; }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const tag = node.tagName.toLowerCase();
          if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            if (codeEl) {
              const cls  = codeEl.className || '';
              const lang = (cls.match(/language-(\S+)/) || [])[1] || '';
              result += '\n```' + lang + '\n' + (codeEl.textContent || '') + '\n```\n';
            } else {
              result += '\n```\n' + node.textContent + '\n```\n';
            }
            return;
          }
          if (tag === 'code') {
            const parentTag = node.parentElement && node.parentElement.tagName
              ? node.parentElement.tagName.toLowerCase() : '';
            if (parentTag !== 'pre') result += '`' + node.textContent + '`';
            return;
          }
          for (const child of node.childNodes) walk(child);
          if (['p','div','li','br','h1','h2','h3','h4','h5','h6'].includes(tag)) result += '\n';
        }
        walk(el);
        return result.trim();
      }

      // User turns are almost always marked with a class containing "user".
      const USER_SELS = [
        '[class*="user"] [class*="message"]',
        '[class*="user-message"]',
        '[class*="userMessage"]',
        '[data-role="user"]',
        '[class*="message"][class*="user"]',
      ];
      // Assistant turns — reuse the same banks as the live reader.
      const ASSISTANT_SELS = [
        '.ds-markdown',
        '[class*="assistant"] [class*="markdown"]',
        '[class*="assistant"] [class*="content"]',
        '[data-role="assistant"] [class*="content"]',
        '[class*="ai-message"] [class*="content"]',
        '[class*="bot-message"] [class*="content"]',
      ];

      function firstVisible(selList) {
        for (const sel of selList) {
          const els = Array.from(document.querySelectorAll(sel));
          if (els.length > 0) return els;
        }
        return [];
      }

      // ── Strategy: pair up user & assistant blocks positionally. ──────────
      // We collect user nodes and assistant nodes, tag each with its document
      // order (compareDocumentPosition), then merge into one chronological list.
      const userNodes = firstVisible(USER_SELS);
      const asstNodes = firstVisible(ASSISTANT_SELS);

      const all = [];
      for (const el of userNodes) all.push({ el, role: 'user' });
      for (const el of asstNodes) all.push({ el, role: 'assistant' });

      // Drop assistant nodes that are nested inside a user node (and vice
      // versa) to avoid emitting the same text twice.
      const filtered = all.filter((a, i) => {
        return !all.some((b, j) => {
          if (i === j) return false;
          return b.el.contains(a.el);
        });
      });

      filtered.sort((a, b) => {
        if (a.el === b.el) return 0;
        const pos = a.el.compareDocumentPosition(b.el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING)  return 1;
        return 0;
      });

      const turns = [];
      for (const { el, role } of filtered) {
        const content = getFullText(el);
        if (!content) continue;
        turns.push({ role, content });
      }
      return turns;
    });
  }

  // ── Login handling ─────────────────────────────────────────────────────────

  async _ensureLoggedIn() {
    await this.page.waitForTimeout(2_000);

    const needsLogin = await this.page.evaluate(() => {
      const url = window.location.href;
      const bodyText = document.body?.innerText || '';
      return (
        url.includes('/auth') ||
        url.includes('/login') ||
        url.includes('/sign') ||
        bodyText.includes('Sign in') ||
        bodyText.includes('Log in') ||
        !!document.querySelector('input[type="password"]')
      );
    });

    if (needsLogin) {
      this._printLoginBanner();
      await this._waitForEnter();
      await this.page.waitForTimeout(2_000);
    }
  }

  _printLoginBanner() {
    const t = i18n.t;
    const line = '═'.repeat(50);
    console.log('');
    console.log(`  \x1b[93m${line}\x1b[0m`);
    logger.warn(`  ${t('browser.loginTitle')}`);
    logger.warn('');
    logger.warn(`  ${t('browser.loginStep1')}`);
    logger.warn(`  ${t('browser.loginStep2')}`);
    console.log(`  \x1b[93m${line}\x1b[0m`);
    console.log('');
  }

  async _waitForEnter() {
    return new Promise(resolve => {
      const stdin   = process.stdin;
      const wasRaw  = stdin.isRaw;
      const wasPaused = !stdin.readable;

      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.resume();

      const handler = chunk => {
        const s = chunk.toString();
        if (s.includes('\n') || s.includes('\r')) {
          stdin.removeListener('data', handler);
          if (stdin.isTTY && wasRaw) stdin.setRawMode(true);
          if (wasPaused)            stdin.pause();
          resolve();
        }
      };

      stdin.on('data', handler);
    });
  }

  // ── Sending Messages ───────────────────────────────────────────────────────

  async sendMessage(text) {
    // Find input element
    const { el, isTextarea } = await this._findInput();

    // Click to focus
    await el.click({ force: true });
    await this.page.waitForTimeout(80);

    // Clear existing content
    await this.page.keyboard.press('Control+a');

    if (isTextarea) {
      // Standard textarea — use fill() which is reliable
      await el.fill(text);
    } else {
      // contenteditable div — needs execCommand
      await this.page.evaluate((element, content) => {
        element.focus();
        // Select all and delete
        document.execCommand('selectAll', false, null);
        document.execCommand('delete',    false, null);
        // Insert text (fires proper input events)
        document.execCommand('insertText', false, content);
        // Belt-and-suspenders: fire input event manually
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: content }));
      }, el, text);
    }

    // Wait (briefly) for the send button to become enabled instead of a
    // fixed delay, then submit. This shaves ~0.4s off every message.
    let clicked = false;
    const waitUntil = Date.now() + 1_500;
    while (Date.now() < waitUntil) {
      clicked = await this._clickSendButton();
      if (clicked) break;
      await this.page.waitForTimeout(60);
    }
    if (!clicked) {
      // DeepSeek uses plain Enter to submit (Shift+Enter for newlines)
      await this.page.keyboard.press('Enter');
    }

    // Verify the message was actually submitted: the input box must be empty.
    // Previously a failed submit left the text in the box, and the next
    // waitForResponse picked that text up as if it were the AI's reply — the
    // "reply was interrupted" loop.  Retry the submit a couple of times before
    // giving up and throwing a clear error.
    let submitted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.page.waitForTimeout(250);
      if (await this._isInputEmpty(el, isTextarea)) {
        submitted = true;
        break;
      }
      // Try the send button once more, then Enter.
      if (!(await this._clickSendButton())) {
        await this.page.keyboard.press('Enter');
      }
    }

    if (!submitted) {
      // Last-ditch: clear the box so stale text can never be mistaken for a
      // response, then report failure to the caller.
      try {
        await el.click({ force: true });
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Delete');
      } catch { /* ignore */ }
      throw new Error(
        'Failed to submit the message — the chat input still contained text after sending. ' +
        'The page may be busy or disconnected; the next waitForResponse would have ' +
        'mistaken this text for the AI reply.'
      );
    }

    this._lastSentText = text;
  }

  /**
   * True when the chat input box is empty (i.e. the message was submitted).
   */
  async _isInputEmpty(el, isTextarea) {
    try {
      if (isTextarea) {
        const v = await el.evaluate(e => e.value || '');
        return v.trim().length === 0;
      }
      const v = await el.evaluate(e => (e.innerText || e.textContent || ''));
      return v.trim().length === 0;
    } catch {
      return false;
    }
  }

  async _findInput() {
    for (const sel of SEL.chatInput) {
      try {
        const el = await this.page.waitForSelector(sel, { timeout: 4_000, state: 'visible' });
        if (!el) continue;
        const tagName          = await el.evaluate(e => e.tagName.toLowerCase());
        const isContentEditable = await el.evaluate(e => e.isContentEditable);
        return { el, isTextarea: tagName === 'textarea' && !isContentEditable };
      } catch {}
    }
    throw new Error(
      'Cannot find the DeepSeek chat input box.\n' +
      '  → Make sure the page is fully loaded and you are logged in.\n' +
      '  → Run with --debug to inspect DOM selectors.\n' +
      '  → Run: node src/calibrate.js to auto-detect selectors.'
    );
  }

  async _clickSendButton() {
    for (const sel of SEL.sendButton) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible() && await el.isEnabled()) {
          await el.click();
          return true;
        }
      } catch {}
    }
    return false;
  }

  /**
   * Click DeepSeek's "Regenerate" button under the last assistant message.
   * Used by the agent loop as a last-resort recovery: when a reply keeps
   * getting truncated, asking the model to continue in-place can loop; a
   * full regenerate often produces a clean, complete answer instead.
   *
   * Returns true if a button was found and clicked.
   */
  async clickRegenerate() {
    for (const sel of SEL.regenerateButton) {
      try {
        const handles = await this.page.$(sel);
        // DeepSeek renders one regenerate button per assistant message; the
        // LAST one belongs to the reply we want to retry.
        for (let i = handles.length - 1; i >= 0; i--) {
          const el = handles[i];
          if (await el.isVisible().catch(() => false) &&
              await el.isEnabled().catch(() => false)) {
            await el.click();
            return true;
          }
        }
      } catch { /* try next selector */ }
    }
    return false;
  }

  // ── Waiting for Response ───────────────────────────────────────────────────

  /**
   * Wait until DeepSeek finishes generating and return the response text.
   *
   * Algorithm:
   *  1. Record how many assistant messages are on the page right now.
   *  2. Wait until a new message appears (count goes up).
   *  3. Poll the last message text every 500 ms.
   *  4. When the text has not changed for STABLE_DELAY ms AND
   *     no stop/loading indicator is visible → done.
   */
  async waitForResponse() {
    const timeout     = config.RESPONSE_TIMEOUT;
    const stableDelay = config.STABLE_DELAY;
    // How long the text must stay unchanged before we trust that generation
    // has genuinely finished.  A short server pause used to look identical to
    // "done", which is what caused half-finished thoughts to be accepted as
    // complete answers.
    const stallTimeout = Math.max(config.STALL_TIMEOUT || 25_000, stableDelay * 4);

    // Metadata about this wait, consumed by the agent loop to decide whether
    // the response was cut short by a network problem and should be resumed.
    this.lastWaitMeta = { appeared: false, timedOut: false, truncated: false, stillGenerating: false, netError: null };

    logger.thinking(i18n.t('browser.receiving', { dots: '...', n: 0 }));

    // ── Fast path ──────────────────────────────────────────────────────────
    // Everything (message detection, text extraction, stability check and
    // streaming detection) runs INSIDE the page in a single evaluate() call.
    // Previously each 500 ms tick did 2-3 Node↔browser round-trips plus a full
    // DOM tree walk, which is what made replies feel slow. Now there are zero
    // round-trips during the wait and polling happens at 120 ms in-page.
    let result;
    try {
      const sentText = this._lastSentText || '';
      result = await this.page.evaluate(async ({ timeout, stableDelay, stallTimeout, sentText }) => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // The text we just submitted must never be mistaken for the AI reply.
        // A failed submit used to leave it in the DOM, and extract() would
        // return it as the "response" — the root cause of the endless
        // "your response was interrupted, please continue" loop.
        function looksLikeEcho(t) {
          if (!t || !sentText) return false;
          const a = t.replace(/\s+/g, ' ').trim();
          const b = sentText.replace(/\s+/g, ' ').trim();
          if (!a || !b) return false;
          return !!a && a === b;
        }

        // ── Text extraction (reconstructs ``` fences) ────────────────────
        function getFullText(el) {
          if (!el) return '';
          let result = '';
          function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
              result += node.textContent;
              return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const tag = node.tagName.toLowerCase();
            if (tag === 'pre') {
              const codeEl = node.querySelector('code');
              if (codeEl) {
                const cls  = codeEl.className || '';
                const lang = (cls.match(/language-(\S+)/) || [])[1] || '';
                result += '\n```' + lang + '\n' + (codeEl.textContent || '') + '\n```\n';
              } else {
                result += '\n```\n' + node.textContent + '\n```\n';
              }
              return;
            }
            if (tag === 'code') {
              const parentTag = node.parentElement && node.parentElement.tagName
                ? node.parentElement.tagName.toLowerCase() : '';
              if (parentTag !== 'pre') result += '`' + node.textContent + '`';
              return;
            }
            for (const child of node.childNodes) walk(child);
            if (['p','div','li','br','h1','h2','h3','h4','h5','h6'].includes(tag)) {
              result += '\n';
            }
          }
          walk(el);
          return result.trim();
        }

        const DIRECT_SELECTORS = [
          '.ds-markdown',
          '[class*="assistant"] [class*="markdown"]',
          '[class*="assistant"] [class*="content"]',
          '[data-role="assistant"] [class*="content"]',
          '[class*="ai-message"] [class*="content"]',
          '[class*="bot-message"] [class*="content"]',
          '[class*="response-content"]',
          '[class*="message-content"]:last-child',
        ];

        function extract() {
          for (const sel of DIRECT_SELECTORS) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
              const t = getFullText(els[els.length - 1]);
              if (t.length > 10 && !looksLikeEcho(t)) return t;
              if (t.length > 10 && looksLikeEcho(t)) return '';
            }
          }
          const markdownEls = document.querySelectorAll(
            '[class*="markdown"], [class*="prose"], [class*="rendered"]'
          );
          if (markdownEls.length > 0) {
            const t = getFullText(markdownEls[markdownEls.length - 1]);
            if (t.length > 10 && !looksLikeEcho(t)) return t;
          }
          const allBlocks = Array.from(
            document.querySelectorAll('[class*="message"], [class*="chat-item"], [class*="turn"]')
          );
          const candidates = allBlocks.filter(el => {
            const cls = el.className || '';
            return (
              !cls.toLowerCase().includes('input') &&
              !cls.toLowerCase().includes('user') &&
              !el.querySelector('textarea, input[type="text"]') &&
              (el.innerText || '').length > 20
            );
          });
          if (candidates.length > 0) {
            const t = getFullText(candidates[candidates.length - 1]);
            if (!looksLikeEcho(t)) return t;
          }
          return '';
        }

        // Return true ONLY while DeepSeek is actively streaming a reply.
        //
        // The previous implementation also scanned broad selectors like
        // [class*="loading"] / [class*="cursor"] / [class*="spinner"].
        // DeepSeek keeps hidden loader nodes mounted permanently, so those
        // selectors matched all the time and `generating` was effectively
        // always true.  That made the normal "clean finish" path unreachable
        // and forced every reply through the HARD_STABLE bail-out, which then
        // flagged it as truncated because `generating` was true — the cause of
        // the "your response was interrupted, please continue" loop.
        //
        // We now trust the stop button (only rendered mid-stream) plus a
        // couple of stop-button-specific classes.  A short "no new text for
        // a while" combined with the absence of a stop button is a far more
        // reliable finish signal.
        function isGenerating() {
          const stopSelectors = [
            'button[aria-label*="Stop" i]',
            '[aria-label*="stop generating" i]',
            '[data-testid="stop-button"]',
            '[class*="stop-gen"]',
            '[class*="stopGen"]',
          ];
          for (const sel of stopSelectors) {
            const nodes = document.querySelectorAll(sel);
            for (const el of nodes) {
              const s = window.getComputedStyle(el);
              if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) return true;
              }
            }
          }
          return false;
        }

        const start       = Date.now();
        let lastText      = '';
        let stableStart   = null;
        let appeared      = false;
        let sawGenerating = false;
        const initialText = extract();

        // A reasoning/thinking block that never closes means the model was
        // cut off mid-thought — the text is a fragment, not a finished answer.
        function hasOpenReasoning(t) {
          if (!t) return false;
          const opens  = (t.match(/<think>/gi) || []).length;
          const closes = (t.match(/<\/think>/gi) || []).length;
          return opens > closes;
        }

        // A response is only trusted as complete once the text has stayed
        // unchanged for `stallTimeout` (default 25 s).  The old 1.2 s window
        // treated a momentary server stall as "finished", so half-written
        // reasoning blocks and cut-off tool calls were reported as final
        // answers.  When the text also ends on a clear completion signal we
        // can accept it sooner, because we have independent evidence that the
        // model is done rather than merely paused.
        const COMPLETION_MARKERS = [
          /^\s*(all done|done|完成|已全部完成|任务完成|完毕)[。.!！]?\s*$/im,
        ];

        const FENCE = String.fromCharCode(96, 96, 96); // triple backtick

        function hasCompletionMarker(t) {
          if (!t) return false;
          const tail = t.slice(-400);
          if (COMPLETION_MARKERS.some(re => re.test(tail))) return true;
          // A well-formed, balanced tool_call block at the very end means the
          // model finished emitting its action — it is not mid-emission.
          const openFence = FENCE + 'tool_call';
          const lastOpen  = tail.lastIndexOf(openFence);
          if (lastOpen === -1) return false;
          const after = tail.slice(lastOpen);
          // Must contain a JSON object and a closing fence at the end.
          if (!/\{/.test(after) || !/\}/.test(after)) return false;
          const trimmed = after.trimEnd();
          return trimmed.endsWith(FENCE);
        }

        // Hard cap — never wait longer than this for a stalled answer even if
        // the page keeps a false-positive "generating" indicator alive.
        const HARD_STABLE = Math.max(stallTimeout * 2, 60_000);

        while (Date.now() - start < timeout) {
          const text = extract();

          // Track whether a NEW reply has appeared.  Without this check the
          // function could return the PREVIOUS reply while the model had not
          // even started answering — it looked "stable" and was accepted as
          // final, which the agent then reported as an interrupted response.
          const isNewText = text.length > 0 && text !== initialText;
          if (isNewText) appeared = true;

          const generating = isGenerating();
          if (generating) sawGenerating = true;

          if (text !== lastText) {
            lastText    = text;
            stableStart = null;
          } else if (text.length > 0 && appeared) {
            if (!stableStart) stableStart = Date.now();
            const stableFor = Date.now() - stableStart;

            // Fast finish: a clear completion marker (or a balanced tool_call
            // fence at the very end) plus no stop button means the reply is
            // genuinely done.  A short stability window is enough.
            if (!generating && hasCompletionMarker(lastText) && stableFor >= Math.min(stableDelay, 1_200)) {
              return {
                text: lastText,
                appeared: true,
                timedOut: false,
                truncated: false,
                stillGenerating: false,
                completed: true,
                completionSignal: 'marker',
              };
            }

            // Normal completion: new text unchanged for the full stall window.
            if (stableFor >= stallTimeout && !generating) {
              const truncated = hasOpenReasoning(lastText);
              return {
                text: lastText,
                appeared: true,
                timedOut: truncated,
                truncated,
                stillGenerating: false,
                completed: !truncated,
                completionSignal: truncated ? 'open-reasoning' : 'stall',
              };
            }

            // Bail-out on the hard cap.
            if (stableFor >= HARD_STABLE) {
              const truncated = generating || hasOpenReasoning(lastText);
              return {
                text: lastText,
                appeared: true,
                timedOut: truncated,
                truncated,
                stillGenerating: generating,
                completed: !truncated,
                completionSignal: truncated ? 'hard-cap' : 'stall',
              };
            }
          }

          await sleep(120);
        }

        // Timed out.  Only treat it as a real answer if new text appeared;
        // otherwise the model never started replying and the caller must not
        // mistake the old message for a response.
        return {
          text: appeared ? lastText : '',
          appeared,
          timedOut: true,
          truncated: appeared,
          stillGenerating: sawGenerating,
          completed: false,
          completionSignal: 'timeout',
        };
      }, { timeout, stableDelay, stallTimeout, sentText });
    } catch (err) {
      // evaluate() can throw if the page navigates mid-wait — recover once
      logger.warn(`${i18n.t('browser.responseDelayed')} (${err.message})`);
      const fallback = await this._extractLastMessage().catch(() => '');
      logger.clearLine();
      // Treat an aborted wait as a truncated response so the agent resumes.
      this.lastWaitMeta = {
        appeared        : false,
        timedOut        : true,
        truncated       : true,
        stillGenerating : false,
        netError        : null,
      };
      return this._cleanText(fallback);
    }

    logger.clearLine();

    if (!result.appeared) logger.warn(i18n.t('browser.responseDelayed'));

    // One final in-page read to guarantee we return the latest text
    const finalText = result.text && result.text.length > 0
      ? result.text
      : await this._extractLastMessage().catch(() => '');

    // Inspect the page for a network / connection error banner.  When
    // DeepSeek drops the connection mid-answer it renders an inline error
    // (e.g. "网络异常" / "Network error" / "Failed to fetch") instead of
    // finishing the response.  Detecting this lets the agent auto-resume.
    const netError = await this._detectNetworkError().catch(() => null);

    this.lastWaitMeta = {
      appeared         : !!result.appeared,
      timedOut         : !!result.timedOut,
      truncated        : !!result.truncated,
      stillGenerating  : !!result.stillGenerating,
      completed        : !!result.completed,
      completionSignal : result.completionSignal || null,
      netError,
      length           : this._cleanText(finalText).length,
    };

    return this._cleanText(finalText);
  }

  /**
   * Detect an inline network/connection error banner rendered by DeepSeek.
   * Returns the matched error text, or null when none is present.
   */
  async _detectNetworkError() {
    return await this.page.evaluate(() => {
      const PATTERNS = [
        /network\s*error/i,
        /connection\s*(error|lost|failed|closed|reset)/i,
        /failed\s*to\s*fetch/i,
        /request\s*(failed|timed?\s*out)/i,
        /something\s*went\s*wrong/i,
        /please\s*try\s*again/i,
        /try\s*again\s*later/i,
        /网络(异常|错误|中断|连接失败)/,
        /连接(中断|失败|异常)/,
        /请求(失败|超时)/,
        /生成(中断|失败|出错|异常)/,
        /重新生成/,
      ];

      // Scan small, message-adjacent elements rather than the whole body so a
      // benign use of these words in the AI's own answer does not trigger us.
      const candidates = document.querySelectorAll(
        '[class*="error"], [class*="toast"], [class*="alert"], ' +
        '[class*="notify"], [class*="warning"], [role="alert"]'
      );

      for (const el of candidates) {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
        const text = (el.innerText || '').trim();
        if (!text || text.length > 300) continue;
        for (const re of PATTERNS) {
          if (re.test(text)) return text.slice(0, 200);
        }
      }
      return null;
    });
  }

  // ── DOM Extraction ─────────────────────────────────────────────────────────

  /** Count how many "response" blocks are visible */
  async _getMessageCount() {
    return await this.page.evaluate(() => {
      const candidates = [
        '[class*="assistant"][class*="message"]',
        '[data-role="assistant"]',
        '[class*="markdown-content"]',
        '.ds-markdown',
        '[class*="chat-message"]',
        '[class*="message-bubble"]',
      ];
      for (const sel of candidates) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return els.length;
      }
      // Broad fallback
      return document.querySelectorAll('[class*="message"]').length;
    });
  }

  /** Extract the text of the last assistant message — including code blocks */
  async _extractLastMessage() {
    return await this.page.evaluate(() => {

      // ── Helper: get all text including code blocks ────────────────────────
      // Walks the DOM and reconstructs text, re-adding fence markers for code
      // blocks so the parser can recognise tool_call fences even after the
      // browser markdown renderer has converted them to <pre><code> elements.
      function getFullText(el) {
        if (!el) return '';
        let result = '';

        function walk(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent;
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const tag = node.tagName.toLowerCase();

          // <pre> wraps a fenced code block — reconstruct the backtick fence
          // so the parser can match the ```tool_call regex.
          if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            if (codeEl) {
              const cls  = codeEl.className || '';
              const lang = (cls.match(/language-(\S+)/) || [])[1] || '';
              const body = codeEl.textContent || '';
              result += '\n```' + lang + '\n' + body + '\n```\n';
            } else {
              result += '\n```\n' + node.textContent + '\n```\n';
            }
            return;
          }

          // Inline <code> — skip if inside a <pre> (already handled)
          if (tag === 'code') {
            const parentTag = node.parentElement && node.parentElement.tagName
              ? node.parentElement.tagName.toLowerCase() : '';
            if (parentTag !== 'pre') {
              result += '`' + node.textContent + '`';
            }
            return;
          }

          for (const child of node.childNodes) walk(child);

          if (['p','div','li','br','h1','h2','h3','h4','h5','h6'].includes(tag)) {
            result += '\n';
          }
        }

        walk(el);
        return result.trim();
      }

      // ── Attempt 1: Specific assistant-message selectors ──────────────────
      const directSelectors = [
        '.ds-markdown',
        '[class*="assistant"] [class*="markdown"]',
        '[class*="assistant"] [class*="content"]',
        '[data-role="assistant"] [class*="content"]',
        '[class*="ai-message"] [class*="content"]',
        '[class*="bot-message"] [class*="content"]',
        '[class*="response-content"]',
        '[class*="message-content"]:last-child',
      ];

      for (const sel of directSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          const t = getFullText(els[els.length - 1]);
          if (t.length > 10) return t;
        }
      }

      // ── Attempt 2: Any markdown/prose container ───────────────────────────
      const markdownEls = document.querySelectorAll(
        '[class*="markdown"], [class*="prose"], [class*="rendered"]'
      );
      if (markdownEls.length > 0) {
        const t = getFullText(markdownEls[markdownEls.length - 1]);
        if (t.length > 10) return t;
      }

      // ── Attempt 3: Heuristic — large non-user text blocks ────────────────
      const allBlocks = Array.from(
        document.querySelectorAll('[class*="message"], [class*="chat-item"], [class*="turn"]')
      );
      const candidates = allBlocks.filter(el => {
        const cls = el.className || '';
        return (
          !cls.toLowerCase().includes('input') &&
          !cls.toLowerCase().includes('user') &&
          !el.querySelector('textarea, input[type="text"]') &&
          (el.innerText || '').length > 20
        );
      });

      if (candidates.length > 0) {
        return getFullText(candidates[candidates.length - 1]);
      }

      return '';
    });
  }

  /** True if DeepSeek is still streaming / generating */
  async _isGenerating() {
    return await this.page.evaluate(() => {
      // Check for stop button
      const stopSelectors = [
        'button[aria-label*="Stop" i]',
        '[class*="stop-gen"]',
        '[class*="stopGen"]',
        '[class*="generating"]',
      ];
      for (const sel of stopSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const s = window.getComputedStyle(el);
          if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') return true;
        }
      }

      // Check for animated loading/typing indicators
      const loaderSelectors = [
        '[class*="typing"]',
        '[class*="loading"]',
        '[class*="spinner"]',
        '[class*="blink"]',
        '[class*="cursor"]',
        '[class*="pulsing"]',
        'svg[class*="loading"]',
        'svg[class*="spinner"]',
      ];
      for (const sel of loaderSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const s = window.getComputedStyle(el);
          if (s.display !== 'none' && s.visibility !== 'hidden') return true;
        }
      }

      return false;
    });
  }

  // ── Text Cleanup ───────────────────────────────────────────────────────────

  _cleanText(text) {
    if (!text) return '';

    return text
      // Strip DeepSeek R1 chain-of-thought blocks
      .replace(/<think>[\s\S]*?<\/think>\n?/gi, '')
      // Strip "Thinking..." headers that sometimes prefix responses
      .replace(/^Thinking\.{0,3}\n[\s\S]*?\n\n/m, '')
      // Strip copy-code button artifacts like "1CopyRunInsert"
      .replace(/^\d+(?:Copy|Run|Insert|Edit)\b.*$/gm, '')
      // Collapse 3+ blank lines into 2
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── Debug / Calibration Utilities ─────────────────────────────────────────

  /**
   * Dump useful DOM information to stdout.
   * Called by `node src/calibrate.js` or `--debug` flag.
   */
  async dumpDebugInfo() {
    const info = await this.page.evaluate(() => {
      const classFreq = {};
      document.querySelectorAll('*').forEach(el => {
        el.classList.forEach(c => {
          if (c.match(/message|chat|input|send|stop|markdown|content|assistant|user|bot/i)) {
            classFreq[c] = (classFreq[c] || 0) + 1;
          }
        });
      });

      const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable]')).map(e => ({
        tag         : e.tagName,
        id          : e.id || null,
        class       : e.className?.slice(0, 80) || null,
        placeholder : e.placeholder || null,
        editable    : e.isContentEditable,
        visible     : e.offsetParent !== null,
      }));

      return {
        url    : window.location.href,
        title  : document.title,
        classes: Object.entries(classFreq).sort((a, b) => b[1] - a[1]).slice(0, 40),
        inputs,
      };
    });

    const t = i18n.t;
    console.log('\n' + '═'.repeat(60));
    console.log('  ' + t('browser.domHeader'));
    console.log('═'.repeat(60));
    console.log(t('browser.domUrl'), info.url);
    console.log(t('browser.domTitle'), info.title);
    console.log('\n' + t('browser.domInputs'));
    info.inputs.forEach(i => console.log(' ', JSON.stringify(i)));
    console.log('\n' + t('browser.domClasses'));
    info.classes.forEach(([cls, count]) => console.log(`  ${String(count).padStart(3)}x  .${cls}`));
    console.log('═'.repeat(60) + '\n');
  }

  /** Take a screenshot (for debugging) */
  async screenshot(filePath = '/tmp/deepseek-agent-debug.png') {
    await this.page.screenshot({ path: filePath, fullPage: false });
    logger.info(`${i18n.t('browser.screenshotSaved')} ${filePath}`);
  }
}

module.exports = DeepSeekBrowser;
