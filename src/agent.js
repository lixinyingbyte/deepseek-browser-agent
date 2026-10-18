// src/agent.js — The core agent loop that ties everything together
'use strict';

const fs                           = require('fs');
const os                           = require('os');
const path                         = require('path');
const { execSync }                 = require('child_process');
const config                       = require('./config');
const logger                       = require('./logger');
const DeepSeekBrowser              = require('./browser');
const { executeTool }              = require('./tools');
const { parseResponse,
        formatToolResult }         = require('./parser');
const { ConversationManager }      = require('./prompt');
const { AccountManager }           = require('./accounts');
const i18n                         = require('./i18n');
const tokenUsage                   = require('./token-usage');
const { checkFinalCompletion }     = require('./completion');

// ─────────────────────────────────────────────
//  Agent class
// ─────────────────────────────────────────────

class DeepSeekAgent {
  constructor(options = {}) {
    this.options      = options;
    this.accounts     = new AccountManager({
      rotation: options.rotation || config.ACCOUNT_ROTATION,
    });

    // Determine which account to start on:
    //   explicit option → config override → registry's active account
    let initialAccount = options.account || config.ACTIVE_ACCOUNT || null;
    if (initialAccount && !this.accounts.has(initialAccount)) {
      // Auto-register an account requested via CLI/config but not yet known.
      try { this.accounts.add(initialAccount); } catch { /* fall through */ }
    }
    if (initialAccount && this.accounts.has(initialAccount)) {
      try { this.accounts.setActive(initialAccount); } catch { /* ignore */ }
    } else {
      initialAccount = this.accounts.activeName();
    }

    this.currentAccount = initialAccount;
    this.conversation   = new ConversationManager();
    this.browser        = new DeepSeekBrowser({
      sessionDir: this.accounts.resolveSessionDir(this.currentAccount),
    });
    this._running = false;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Boot the browser and load DeepSeek.
   *
   * By default we open a fresh chat on startup. When `options.keepSession`
   * is truthy we skip `newChat()` and attempt to reuse whatever
   * conversation the page last had, preserving context across restarts.
   */
  async init() {
    const t = i18n.t;
    logger.info(t('accounts.using', { name: this.currentAccount }));
    await this.browser.launch();

    if (this.options.keepSession) {
      logger.info(t('browser.keepSession'));
    } else {
      await this.browser.newChat();
    }
  }

  // ── Account management ──────────────────────────────────────────────────────

  /** List every registered account (with an `active` flag). */
  listAccounts() {
    return this.accounts.list();
  }

  /**
   * Switch to another account, tearing down the current browser first so the
   * new account's persistent profile is used for a fresh context.
   *
   * Returns the new account descriptor.
   */
  async switchAccount(name) {
    const t = i18n.t;
    if (!this.accounts.has(name)) {
      throw new Error(t('accounts.notFound', { name }));
    }
    if (name === this.currentAccount) {
      logger.info(t('accounts.alreadyActive', { name }));
      return this.accounts.get(name);
    }

    logger.info(t('accounts.switching', { name }));

    // Close the current browser/profile before opening the next one.
    try { await this.browser.close(); } catch { /* ignore */ }

    this.accounts.setActive(name);
    this.currentAccount = name;
    this.browser = new DeepSeekBrowser({
      sessionDir: this.accounts.resolveSessionDir(name),
    });
    this.conversation = new ConversationManager();

    // Re-launch with the new profile.
    await this.browser.launch();
    if (!this.options.keepSession) {
      await this.browser.newChat();
    }

    logger.success(t('accounts.switched', { name }));
    return this.accounts.get(name);
  }

  /**
   * Rotate to the next account according to the configured policy and switch
   * to it.  Used automatically after a failure when rotation is 'on-error',
   * or on demand via the CLI / UI.
   */
  async rotateAccount({ force = false } = {}) {
    const next = this.accounts.next({ force });
    if (!next) return this.accounts.active();
    if (next.name === this.currentAccount && !force) return next;
    return await this.switchAccount(next.name);
  }

  /** Shut down cleanly */
  async shutdown() {
    await this.browser.close();
  }

  // ── Conversation history ────────────────────────────────────────────────────

  /**
   * List the DeepSeek conversations available in the sidebar.
   * Returns an array of { index, title, href }.
   */
  async listConversations() {
    return await this.browser.listConversations();
  }

  /**
   * Open a previous DeepSeek conversation and continue it.
   *
   * `ref` may be a 1-based index (number) or a title/href fragment (string).
   * On success the in-memory ConversationManager is reset so the next `run()`
   * starts a fresh turn while DeepSeek itself keeps the historical context.
   * Returns the matched conversation descriptor.
   */
  async openConversation(ref) {
    const t     = i18n.t;
    const match = await this.browser.openConversation(ref);

    // The browser now shows the historical conversation; start a new local
    // conversation manager so our own log reflects only the continuing turns.
    this.conversation = new ConversationManager();
    this.options.keepSession = true; // keep continuing this thread

    logger.success(t('browser.openedConv', { title: match.title }));
    return match;
  }

  /**
   * Read the turns of the currently open conversation.
   * Returns an array of { role: 'user' | 'assistant', content }.
   */
  async readCurrentConversation() {
    return await this.browser.readCurrentConversation();
  }

  /**
   * Run a task to completion.
   * Returns the final response string.
   */
  async run(task) {
    // When the rotation policy is 'on-error', a fatal failure (e.g. the
    // account hit its quota or the session became invalid) should transparently
    // move to the next account and retry once.
    if (config.ACCOUNT_ROTATION === 'on-error' && this.accounts.list().length > 1) {
      try {
        return await this._runOnce(task);
      } catch (err) {
        logger.warn(i18n.t('accounts.autoRotate', { err: err.message }));
        await this.rotateAccount({ force: true });
        return await this._runOnce(task);
      }
    }
    return await this._runOnce(task);
  }

  async _runOnce(task) {
    const t         = i18n.t;
    this._running   = true;
    const maxIter   = config.MAX_ITERATIONS;

    // ── 1. Snapshot working directory ──────────────────────────────────────
    const dirListing = this._getWorkingDirListing();

    // ── 2. Build and send first message ───────────────────────────────────
    logger.header(`${t('agent.task')} ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);

    // Simulate a real DeepSeek chat: only the FIRST task in a conversation
    // carries the full system prompt + tool documentation.  Follow-up tasks
    // reuse the model's existing context and send just the task.
    const isFirstTask = !this.conversation.started;
    const firstMsg = isFirstTask
      ? this.conversation.buildFirstMessage(task, dirListing)
      : this.conversation.buildTaskMessage(task, dirListing);

    if (!isFirstTask) {
      logger.info(t('agent.continuingConversation'));
    }

    if (config.DEBUG) {
      logger.dim(t('agent.firstMsgDebug'));
      logger.dim(firstMsg.slice(0, 600) + '...');
    }

    logger.info(t('agent.sending'));
    await this.browser.sendMessage(firstMsg);
    tokenUsage.record(firstMsg, null);

    // Accumulates this task's estimated token usage for the summary line.
    let taskInputTokens  = tokenUsage.estimateTokens(firstMsg);
    let taskOutputTokens = 0;

    // Tracks how many times we have auto-resumed after a network interruption.
    // Bounded so a persistently broken connection cannot loop forever.
    const maxResumes = config.AUTO_RESUME ? (config.MAX_AUTO_RESUMES || 6) : 0;
    let   resumeCount = 0;


    // Tracks how many times we have sent a final answer back for completion
    // verification.  A value of 0 (the default) means UNLIMITED retries — the
    // model is asked to finish and append (complete) as many times as needed.
    // These retries do NOT consume the iteration budget, so the MAX_ITERATIONS
    // cap only limits actual work steps, not completion hand-shakes.
    const rawMaxValidations = config.MAX_FINAL_VALIDATIONS;
    const maxFinalValidations = (rawMaxValidations === 0 || rawMaxValidations === null || rawMaxValidations === undefined)
      ? Infinity
      : rawMaxValidations;
    const maxValidationsLabel = maxFinalValidations === Infinity ? '∞' : String(maxFinalValidations);
    let   finalValidationCount = 0;

    // ── 3. Agent loop ──────────────────────────────────────────────────────
    for (let iter = 1; iter <= maxIter; iter++) {
      logger.iteration(iter, maxIter);

      // Wait for response from DeepSeek
      const rawResponse = await this.browser.waitForResponse();

      // Grab metadata about the wait — used to detect network cut-offs.
      const waitMeta = this.browser.lastWaitMeta || {};

      // ── Network-interruption recovery ──────────────────────────────────
      // If DeepSeek showed an inline connection error, or produced nothing
      // at all, the answer was cut short.  Rather than treating the partial
      // text as final, ask it to continue.  This is what makes the agent
      // "resume by itself" after a network fluctuation.
      // A response is considered interrupted when:
      //   • nothing came back at all, OR
      //   • DeepSeek rendered an inline network-error banner, OR
      //   • the wait ended while the page was still generating (stability
      //     timer fired mid-stream), OR
      //   • the text stopped inside an unclosed <think> block — i.e. the
      //     model was cut off halfway through its reasoning.
      // Without the last two checks a half-finished answer was silently
      // accepted as final, which is exactly the "interrupted mid-thought"
      // bug.
      const wasInterrupted = (
        !rawResponse ||
        rawResponse.trim().length === 0 ||
        waitMeta.netError ||
        waitMeta.truncated ||
        waitMeta.stillGenerating
      );

      if (wasInterrupted && resumeCount < maxResumes) {
        resumeCount++;

        if (waitMeta.netError) {
          logger.warn(t('agent.netErrorResume', { n: resumeCount, max: maxResumes, err: waitMeta.netError }));
        } else if (waitMeta.truncated || waitMeta.stillGenerating) {
          logger.warn(t('agent.truncatedResume', { n: resumeCount, max: maxResumes }));
        } else {
          logger.warn(t('agent.emptyResponseResume', { n: resumeCount, max: maxResumes }));
        }

        // Wait a moment before retrying — a short backoff gives a flaky
        // connection time to recover instead of hammering it immediately.
        const backoff = Math.min(1000 * resumeCount, 5_000);
        await new Promise(r => setTimeout(r, backoff));

        const contMsg = resumeCount === 1
          ? 'Your previous response was interrupted and is incomplete — it stops mid-thought. ' +
            'Please continue exactly where you left off. Do not repeat what you already wrote, ' +
            'and make sure to finish the current reasoning block and any tool_call you started.'
          : 'Still waiting — please continue your previous answer from where it stopped, ' +
            'and finish it completely.';

        try {
          await this.browser.sendMessage(contMsg);
          taskInputTokens += tokenUsage.estimateTokens(contMsg);
          tokenUsage.record(contMsg, null);
        } catch (err) {
          logger.warn(t('agent.resumeSendFailed', { err: err.message }));
        }
        continue;
      }

      if (wasInterrupted && resumeCount >= maxResumes) {
        logger.warn(t('agent.resumeExhausted', { max: maxResumes }));
      }

      // A truncated / still-generating response that we could NOT resume
      // (resume budget exhausted) must not be treated as a clean final
      // answer.  Surface it as an error so the loop retries or the caller
      // sees the failure instead of a half-finished "success".
      const unrecoverableTruncation =
        wasInterrupted && resumeCount >= maxResumes &&
        (waitMeta.truncated || waitMeta.stillGenerating) &&
        (!rawResponse || rawResponse.trim().length > 0);

      if (unrecoverableTruncation) {
        logger.warn(t('agent.truncatedUnrecoverable'));

        // Last-resort recovery: clicking DeepSeek's own "Regenerate" button
        // replays the answer from the server side, which frequently succeeds
        // where "please continue" did not.  Only fall back to a plain resend
        // when no regenerate button is available.
        let regenerated = false;
        if (config.REGENERATE_ON_EXHAUST) {
          try {
            regenerated = await this.browser.clickRegenerate();
            if (regenerated) logger.info(t('agent.regenerated'));
          } catch (err) {
            logger.warn(t('agent.regenerateFailed', { err: err.message }));
          }
        }

        if (!regenerated) {
          const retryMsg = this.conversation.addToolResult(
            'SYSTEM',
            'Your previous response was cut off mid-generation and could not be resumed automatically. ' +
            'Please re-answer the last request from scratch, completely and concisely.',
            true
          );
          await this.browser.sendMessage(retryMsg);
          taskInputTokens += tokenUsage.estimateTokens(retryMsg);
          tokenUsage.record(retryMsg, null);
        }
        continue;
      }

      if (config.DEBUG) {
        logger.dim(t('agent.rawRespDebug', { n: rawResponse.length }));
        logger.dim(rawResponse.slice(0, 400));
      }

      // Record the AI response in conversation history
      this.conversation.addAssistantMessage(rawResponse);

      // Track estimated output tokens for this turn
      const outTokens = tokenUsage.estimateTokens(rawResponse);
      taskOutputTokens += outTokens;
      tokenUsage.record(null, rawResponse);

      // Parse the response
      const parsed = parseResponse(rawResponse);

      // ── Case 1: Tool call ──────────────────────────────────────────────
      if (parsed.type === 'tool_call') {
        logger.toolCall(parsed.name, parsed.args);

        let result;
        let isError = false;

        try {
          result  = await executeTool(parsed.name, parsed.args);
          logger.toolResult(result);
        } catch (err) {
          result  = `Error: ${err.message}`;
          isError = true;
          logger.toolResult(result, true);
        }

        // Feed result back
        const feedbackMsg = this.conversation.addToolResult(parsed.name, result, isError);
        await this.browser.sendMessage(feedbackMsg);
        const inTokens = tokenUsage.estimateTokens(feedbackMsg);
        taskInputTokens += inTokens;
        tokenUsage.record(feedbackMsg, null);
        continue;
      }

      // ── Case 2: Parse error ────────────────────────────────────────────
      if (parsed.type === 'error') {
        logger.warn(`${t('agent.parseError')} ${parsed.message}`);
        const recovery = this.conversation.addToolResult(
          'SYSTEM',
          `Parse error: ${parsed.message}\n\nPlease try again with valid JSON in your tool call.`,
          true
        );
        await this.browser.sendMessage(recovery);
        taskInputTokens += tokenUsage.estimateTokens(recovery);
        tokenUsage.record(recovery, null);
        continue;
      }

      // ── Case 3: Final response ─────────────────────────────────────────
      if (parsed.type === 'final') {
        // Safety net: if the "final" response text contains a tool_call block
        // that our parser missed (e.g. garbled by DOM), send a correction prompt.
        const looksLikeToolCall = (
          /tool_call/i.test(parsed.content) ||
          /"name"\s*:\s*"[\w_]+"/.test(parsed.content) ||
          /write_file|read_file|apply_patch|run_command|list_directory|git_status|checkpoint_restore/i.test(parsed.content.slice(0, 200))
        );

        if (looksLikeToolCall && this.conversation.turnCount <= maxIter - 2) {
          logger.warn(t('agent.looksLikeTool'));
          const retry = this.conversation.addToolResult(
            'SYSTEM',
            'Your response appeared to contain a tool call but it could not be parsed. ' +
            'Please respond with ONLY a ```tool_call code block and nothing else — no prose before or after it.',
            true
          );
          await this.browser.sendMessage(retry);
          taskInputTokens += tokenUsage.estimateTokens(retry);
          tokenUsage.record(retry, null);
          continue;
        }

        // Completion verification: catch structurally unfinished answers
        // (unclosed fences, open reasoning, mid-sentence cut-offs) that used
        // to be accepted as a finished task.
        const completionCheck = checkFinalCompletion(parsed.content, waitMeta);
        if (!completionCheck.complete && finalValidationCount < maxFinalValidations) {
          finalValidationCount++;
          logger.warn(t('agent.finalIncomplete', { n: finalValidationCount, max: maxValidationsLabel, reason: completionCheck.reason }));

          // Distinguish a truncated/broken answer from one that is merely
          // missing the mandatory completion marker.  In both cases we send
          // the model back to finish, but the instruction differs.
          const missingMarker = /marker/i.test(completionCheck.reason);
          const instruction = missingMarker
            ? 'Your answer is missing the mandatory completion marker. ' +
              'If the task is truly finished, reply with a short closing summary ' +
              'and end it with the exact token (complete) on its own line. ' +
              'If work remains, continue and finish it, then add (complete).'
            : 'Your last message does not look like a finished answer (' + completionCheck.reason + '). ' +
              'It may have been cut off. Continue and finish completely, ending with a clear ' +
              'statement of what was done and then the exact token (complete) on its own line. ' +
              'Do not leave sentences, code blocks or tool calls unfinished.';

          const verdict = this.conversation.addToolResult('SYSTEM', instruction, true);
          await this.browser.sendMessage(verdict);
          taskInputTokens += tokenUsage.estimateTokens(verdict);
          tokenUsage.record(verdict, null);
          // A completion hand-shake is not a work step — give the iteration
          // back so unlimited validations cannot exhaust MAX_ITERATIONS.
          iter--;
          continue;
        }
        if (!completionCheck.complete) {
          logger.warn(t('agent.finalUnverified', { reason: completionCheck.reason }));
        }

        // Strip the protocol marker before showing the answer to the user —
        // it is a machine signal, not part of the summary.
        const displayContent = parsed.content.replace(/\s*\(complete\)\s*$/i, '').trim();
        logger.finalOutput(displayContent);

        // Record this completed task + its estimated token usage summary
        const dayTotals = tokenUsage.incrementTask();
        logger.info(i18n.t('agent.tokenSummary', {
          input : taskInputTokens,
          output: taskOutputTokens,
          total : taskInputTokens + taskOutputTokens,
          day   : dayTotals.input + dayTotals.output,
        }));

        // Optionally save conversation log
        if (this.options.saveLog) {
          await this._saveConversationLog(task, displayContent);
        }

        this._running = false;
        return displayContent;
      }
    }

    // ── Hit max iterations ─────────────────────────────────────────────────
    this._running = false;
    const warn = `⚠ ${t('agent.maxIterations', { max: maxIter })}`;
    logger.warn(warn);
    return warn;
  }

  // ── Interactive (REPL) Mode ────────────────────────────────────────────────

  /**
   * Run the agent in interactive mode — keeps the browser open
   * and accepts tasks one after another.
   */
  async runInteractive() {
    const t        = i18n.t;
    const readline = require('readline');

    logger.header(t('repl.header'));
    logger.info(`${t('repl.commands')}\n`);

    const rl = readline.createInterface({
      input    : process.stdin,
      output   : process.stdout,
      terminal : true,
    });

    const ask = () => new Promise(resolve => rl.question(`\n\x1b[96m${t('repl.prompt')}\x1b[0m `, resolve));

    // Tracks whether the next task needs a fresh DeepSeek conversation.
    // Starts true so the very first task gets a clean session.
    let freshSession = true;

    while (true) {
      let task;
      try {
        task = (await ask()).trim();
      } catch {
        break; // stdin closed
      }

      if (!task) continue;

      if (['exit', 'quit', 'q'].includes(task.toLowerCase())) {
        logger.info(t('repl.exiting'));
        break;
      }

      if (task.toLowerCase() === 'new') {
        logger.info(t('repl.newChat'));
        await this.browser.newChat();
        this.conversation = new ConversationManager();
        freshSession = true;
        continue;
      }

      // ── History commands ────────────────────────────────────────────────
      const lower = task.toLowerCase();

      // history — list past DeepSeek conversations
      if (lower === 'history' || lower === 'list') {
        try {
          const list = await this.listConversations();
          if (!list || list.length === 0) {
            logger.warn(t('repl.historyEmpty'));
          } else {
            logger.header(t('repl.historyHeader'));
            for (const c of list) {
              logger.info(t('repl.historyItem', { n: c.index, title: c.title }));
            }
            console.log('');
          }
        } catch (err) {
          logger.error(`${t('repl.openFailed')} ${err.message}`);
        }
        continue;
      }

      // open <n|title> — continue a previous conversation
      if (lower === 'open' || lower.startsWith('open ')) {
        const arg = task.slice(4).trim();
        if (!arg) {
          logger.warn(t('repl.usage'));
          continue;
        }
        const ref = /^\d+$/.test(arg) ? Number(arg) : arg;
        try {
          logger.info(t('repl.opening', { title: arg }));
          await this.openConversation(ref);
          // The conversation is now open in the browser; the next typed task
          // will be appended to it, continuing the history.
          freshSession = false;
        } catch (err) {
          logger.error(`${t('repl.openFailed')} ${err.message}`);
        }
        continue;
      }

      // ── Account commands ────────────────────────────────────────────────

      // accounts — list configured accounts
      if (lower === 'accounts' || lower === 'account') {
        const list = this.listAccounts();
        logger.header(t('accounts.header'));
        for (const a of list) {
          const mark  = a.active ? '●' : '○';
          const label = a.label && a.label !== a.name ? ` (${a.label})` : '';
          logger.info(t('accounts.item', { mark, name: a.name, label }));
        }
        console.log('');
        continue;
      }

      // account add <name>
      if (lower.startsWith('account add ')) {
        const name = task.slice('account add '.length).trim();
        try {
          const acct = this.accounts.add(name);
          logger.success(t('accounts.added', { name: acct.name }));
          logger.info(`${t('runtime.sessionDir')} ${acct.sessionDir}`);
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // account use <name>
      if (lower.startsWith('account use ')) {
        const name = task.slice('account use '.length).trim();
        try {
          await this.switchAccount(name);
          freshSession = false;
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // account remove <name>
      if (lower.startsWith('account remove ') || lower.startsWith('account rm ')) {
        const name = task.replace(/^account\s+(remove|rm)\s+/i, '').trim();
        try {
          const removed = this.accounts.remove(name, { deleteProfile: true });
          logger.success(t('accounts.removed', { name: removed.name }));
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // account next — rotate to the next account
      if (lower === 'account next' || lower === 'rotate') {
        try {
          if (this.listAccounts().length <= 1) {
            logger.warn(t('accounts.rotationNone'));
          } else {
            await this.rotateAccount({ force: true });
            freshSession = false;
          }
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // ── Account commands ────────────────────────────────────────────────

      // accounts — list configured accounts
      if (lower === 'accounts' || lower === 'account') {
        const list = this.listAccounts();
        logger.header(t('accounts.header'));
        for (const a of list) {
          const mark  = a.active ? '●' : '○';
          const label = a.label && a.label !== a.name ? ` (${a.label})` : '';
          logger.info(t('accounts.item', { mark, name: a.name, label }));
        }
        console.log('');
        continue;
      }

      // account add <name>
      if (lower.startsWith('account add ')) {
        const name = task.slice('account add '.length).trim();
        try {
          const acct = this.accounts.add(name);
          logger.success(t('accounts.added', { name: acct.name }));
          logger.info(`${t('runtime.sessionDir')} ${acct.sessionDir}`);
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // account use <name>
      if (lower.startsWith('account use ')) {
        const name = task.slice('account use '.length).trim();
        try {
          await this.switchAccount(name);
          freshSession = false;
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // account remove <name>
      if (lower.startsWith('account remove ') || lower.startsWith('account rm ')) {
        const name = task.replace(/^account\s+(remove|rm)\s+/i, '').trim();
        try {
          const removed = this.accounts.remove(name, { deleteProfile: true });
          logger.success(t('accounts.removed', { name: removed.name }));
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // account next — rotate to the next account
      if (lower === 'account next' || lower === 'rotate') {
        try {
          if (this.listAccounts().length <= 1) {
            logger.warn(t('accounts.rotationNone'));
          } else {
            await this.rotateAccount({ force: true });
            freshSession = false;
          }
        } catch (err) {
          logger.error(err.message);
        }
        continue;
      }

      // view — print the contents of the currently open conversation
      if (lower === 'view' || lower === 'show') {
        try {
          const turns = await this.readCurrentConversation();
          if (!turns || turns.length === 0) {
            logger.warn(t('repl.viewEmpty'));
          } else {
            logger.header(t('repl.viewHeader'));
            for (const turn of turns) {
              const label = turn.role === 'user' ? '👤 USER' : '🤖 ASSISTANT';
              console.log(`\n\x1b[1m${label}\x1b[0m`);
              console.log('─'.repeat(50));
              console.log(turn.content);
            }
            console.log('');
          }
        } catch (err) {
          logger.error(`${t('repl.openFailed')} ${err.message}`);
        }
        continue;
      }

      // When a conversation is already in progress, let the user decide
      // whether this task continues it (keeping context, no re-injected tool
      // prompt) or starts a brand-new chat (full system prompt again).
      if (!freshSession && this.conversation.started) {
        const choice = (await new Promise(resolve =>
          rl.question(`\n\x1b[96m${t('repl.continueOrNew')}\x1b[0m `, resolve)
        )).trim().toLowerCase();
        if (choice === 'n' || choice === 'new') {
          freshSession = true;
        }
      }

      // Only start a fresh chat when explicitly requested (new command), when
      // the user just chose a new conversation, or on the very first task.
      if (freshSession) {
        await this.browser.newChat();
        this.conversation = new ConversationManager();
        freshSession = false;
      }

      try {
        await this.run(task);
      } catch (err) {
        logger.error(`${t('repl.taskFailed')} ${err.message}`);
        if (config.DEBUG) console.error(err);
      }
    }

    rl.close();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _getWorkingDirListing() {
    try {
      const result = execSync(
        `find . -maxdepth 3 \\
          -not -path '*/node_modules/*' \\
          -not -path '*/.git/*' \\
          -not -path '*/dist/*' \\
          -not -path '*/.next/*' \\
          -not -path '*/build/*' \\
          -not -name '*.lock' \\
          | sort | head -80`,
        { cwd: config.WORKING_DIR, encoding: 'utf8', timeout: 5_000 }
      ).trim();
      return result || '(empty directory)';
    } catch {
      return '(could not read directory)';
    }
  }

  async _saveConversationLog(task, finalResponse) {
    const t = i18n.t;
    try {
      // config.LOG_DIR prefers the D: drive on Windows (see config.js)
      const logsDir = config.LOG_DIR || path.join(os.homedir(), '.deepseek-agent', 'logs');
      fs.mkdirSync(logsDir, { recursive: true });

      const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const logFile  = path.join(logsDir, `session-${ts}.txt`);
      const content  = [
        t('agent.log.title'),
        `${t('agent.log.date')} ${new Date().toISOString()}`,
        `${t('agent.log.task')} ${task}`,
        `${t('agent.log.workdir')} ${config.WORKING_DIR}`,
        '═'.repeat(60),
        this.conversation.exportLog(),
        '',
        '═'.repeat(60),
        t('agent.log.final'),
        finalResponse,
      ].join('\n');

      fs.writeFileSync(logFile, content, 'utf8');
      logger.dim(`${t('agent.logSaved')} ${logFile}`);
    } catch (err) {
      logger.warn(`${t('agent.logSaveFailed')} ${err.message}`);
    }
  }
}

module.exports = DeepSeekAgent;
