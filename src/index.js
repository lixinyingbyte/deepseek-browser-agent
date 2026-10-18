#!/usr/bin/env node
// src/index.js — CLI entry point for DeepSeek Agent
'use strict';

const path         = require('path');
const fs           = require('fs');
const config       = require('./config');
const logger       = require('./logger');
const DeepSeekAgent = require('./agent');
const i18n         = require('./i18n');

// ─────────────────────────────────────────────
//  Parse CLI arguments
// ─────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    task        : null,
    interactive : false,
    debug       : false,
    headless    : false,
    saveLog     : false,
    workingDir  : null,
    calibrate   : false,
    keepSession : false,
    ui          : false,
    lang        : null,
    help        : false,
    history     : false,
    openConv    : null,
    viewConv    : false,
    account     : null,
    accountsCmd : false,   // list accounts
    acctAdd     : null,
    acctUse     : null,
    acctRemove  : null,
    acctNext    : false,
    rotation    : null,
  };

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-i':
      case '--interactive': opts.interactive = true;    break;
      case '--debug':       opts.debug       = true;    break;
      case '--headless':    opts.headless    = true;    break;
      case '--save-log':    opts.saveLog     = true;    break;
      case '--keep-session': opts.keepSession = true;   break;
      case '--calibrate':   opts.calibrate   = true;    break;
      case '--ui':          opts.ui          = true;    break;
      case '--history':     opts.history     = true;    break;
      case '--view':        opts.viewConv    = true;    break;
      case '--accounts':    opts.accountsCmd = true;    break;
      case '--account-next':opts.acctNext    = true;    break;

      case '--account':
        opts.account = args[++i];
        break;

      case '--account-add':
        opts.acctAdd = args[++i];
        break;

      case '--account-use':
        opts.acctUse = args[++i];
        break;

      case '--account-remove':
        opts.acctRemove = args[++i];
        break;

      case '--rotation':
        opts.rotation = args[++i];
        break;

      case '--open':
        opts.openConv = args[++i];
        break;
      case '-h':
      case '--help':        opts.help        = true;    break;

      case '-d':
      case '--dir':
        opts.workingDir = args[++i];
        break;

      case '--lang':
        opts.lang = args[++i];
        break;

      case '-t':
      case '--task':
        opts.task = args[++i];
        break;

      default:
        // If it doesn't start with '-', treat it as an inline task
        if (!a.startsWith('-')) {
          opts.task = args.slice(i).join(' ');
          i = args.length; // consume the rest
        }
    }
    i++;
  }

  return opts;
}

// ─────────────────────────────────────────────
//  Help text
// ─────────────────────────────────────────────

function printHelp() {
  const t  = i18n.t;
  const Y  = '\x1b[33m';
  const C  = '\x1b[36m';
  const B  = '\x1b[1m';
  const R  = '\x1b[0m';

  console.log(`
${B}${t('help.title')}${R}

${Y}${t('help.usage')}${R}
  ${t('help.usage.line')}

${Y}${t('help.options')}${R}
  -t, --task <task>    ${t('help.opt.task')}
  -i, --interactive    ${t('help.opt.interactive')}
  --ui                 ${t('help.opt.ui')}
  -d, --dir <path>     ${t('help.opt.dir')}
  --debug              ${t('help.opt.debug')}
  --headless           ${t('help.opt.headless')}
  --save-log           ${t('help.opt.savelog')}
  --keep-session       ${t('help.opt.keepsession')}
  --calibrate          ${t('help.opt.calibrate')}
  --history            ${t('help.opt.history')}
  --open <n|title>     ${t('help.opt.open')}
  --view               ${t('help.opt.view')}
  --account <name>     ${t('help.opt.account')}
  --accounts           ${t('help.opt.accounts')}
  --account-add <name> ${t('help.opt.acctadd')}
  --account-use <name> ${t('help.opt.acctuse')}
  --account-remove <n> ${t('help.opt.acctremove')}
  --account-next       ${t('help.opt.acctnext')}
  --rotation <policy>  ${t('help.opt.rotation')}
  --lang <en|zh>       ${t('help.opt.lang')}
  -h, --help           ${t('help.opt.help')}

${Y}${t('help.examples')}${R}
  # ${t('help.ex.single')}
  node src/index.js "Create a REST API in Express with CRUD for users"

  # ${t('help.ex.interactive')}
  node src/index.js --interactive

  # ${t('help.ex.dir')}
  node src/index.js --dir ~/projects/myapp "Add TypeScript to this project"

  # ${t('help.ex.debug')}
  node src/index.js --debug "Write a binary search in Python"

  # ${t('help.ex.headless')}
  node src/index.js --headless "Refactor index.js to use async/await"

  # ${t('help.ex.ui')}
  node src/index.js --ui

  # ${t('help.ex.history')}
  node src/index.js --history

  # ${t('help.ex.open')}
  node src/index.js --open 2 "Continue where we left off"

  # ${t('help.ex.accounts')}
  node src/index.js --accounts

  # ${t('help.ex.account')}
  node src/index.js --account work --interactive

${Y}${t('help.setup')}${R}
  1. ${t('help.setup.1')}
  2. ${t('help.setup.2')}
     ${t('help.setup.note')}

${Y}${t('help.config')}${R}
  ${t('help.config.desc').replace('deepseek-agent.config.json', C + 'deepseek-agent.config.json' + R)}
  {
    "HEADLESS": true,
    "MAX_ITERATIONS": 50,
    "STABLE_DELAY": 3000
  }
`);
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // ── Language selection ─────────────────────────────────────────────────────
  if (opts.lang) i18n.setLanguage(opts.lang);
  const t = i18n.t;

  // ── Help ───────────────────────────────────────────────────────────────────
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // ── Apply options to config ────────────────────────────────────────────────
  if (opts.debug)      config.DEBUG    = true;
  if (opts.headless)   config.HEADLESS = true;
  if (opts.workingDir) {
    const resolved = path.resolve(opts.workingDir);
    if (!fs.existsSync(resolved)) {
      logger.error(`${t('runtime.dirNotFound')} ${resolved}`);
      process.exit(1);
    }
    config.WORKING_DIR = resolved;
  }

  // ── Rotation policy override ───────────────────────────────────────────────
  if (opts.rotation) config.ACCOUNT_ROTATION = opts.rotation;

  // ── Account administration (no browser needed) ─────────────────────────────
  if (opts.accountsCmd || opts.acctAdd || opts.acctUse || opts.acctRemove || opts.acctNext) {
    const { AccountManager } = require('./accounts');
    const am = new AccountManager({ rotation: config.ACCOUNT_ROTATION });

    try {
      if (opts.acctAdd) {
        const acct = am.add(opts.acctAdd);
        logger.success(t('accounts.added', { name: acct.name }));
        logger.info(`${t('runtime.sessionDir')} \x1b[36m${acct.sessionDir}\x1b[0m`);
      }
      if (opts.acctRemove) {
        const removed = am.remove(opts.acctRemove, { deleteProfile: true });
        logger.success(t('accounts.removed', { name: removed.name }));
      }
      if (opts.acctUse) {
        const acct = am.setActive(opts.acctUse);
        logger.success(t('accounts.switched', { name: acct.name }));
      }
      if (opts.acctNext) {
        if (am.list().length <= 1) {
          logger.warn(t('accounts.rotationNone'));
        } else {
          const acct = am.next({ force: true });
          logger.success(t('accounts.rotated', { name: acct.name }));
        }
      }
      // Always end by printing the account list.
      const list = am.list();
      logger.header(t('accounts.header'));
      if (list.length === 0) {
        logger.warn(t('accounts.empty'));
      } else {
        for (const a of list) {
          const mark  = a.active ? '\x1b[92m●\x1b[0m' : '\x1b[90m○\x1b[0m';
          const label = a.label && a.label !== a.name ? ` (${a.label})` : '';
          logger.info(t('accounts.item', { mark, name: a.name, label }));
        }
        console.log('');
      }
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // ── Web UI mode ────────────────────────────────────────────────────────────
  if (opts.ui) {
    logger.info(t('runtime.startingUI'));
    require('./ui/server').start();
    return; // the UI server manages its own lifecycle
  }

  // ── Banner ─────────────────────────────────────────────────────────────────
  logger.banner();
  logger.info(`${t('runtime.workingDir')} \x1b[36m${config.WORKING_DIR}\x1b[0m`);
  logger.info(`${t('runtime.sessionDir')} \x1b[36m${config.SESSION_DIR}\x1b[0m`);
  logger.info(`${t('runtime.headless')} \x1b[36m${config.HEADLESS}\x1b[0m`);
  logger.info(`${t('runtime.debug')} \x1b[36m${config.DEBUG}\x1b[0m`);
  logger.info(`${t('accounts.activeLabel')} \x1b[36m${agent.currentAccount}\x1b[0m`);
  console.log('');

  // ── Create agent ───────────────────────────────────────────────────────────
  const agent = new DeepSeekAgent({
    saveLog     : opts.saveLog,
    keepSession : opts.keepSession,
    account     : opts.account,
    rotation    : opts.rotation || config.ACCOUNT_ROTATION,
  });

  // Tracks whether the browser has already been launched so the history flow
  // does not accidentally initialize it twice.
  let agentInited = false;

  // ── Graceful shutdown handler ──────────────────────────────────────────────
  const shutdown = async (code = 0) => {
    logger.info(`\n${t('runtime.shuttingDown')}`);
    try { await agent.shutdown(); } catch {}
    process.exit(code);
  };

  process.on('SIGINT',  () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', async err => {
    logger.error(`${t('runtime.uncaught')} ${err.message}`);
    if (config.DEBUG) console.error(err.stack);
    await shutdown(1);
  });
  process.on('unhandledRejection', async reason => {
    logger.error(`${t('runtime.unhandled')} ${reason}`);
    if (config.DEBUG) console.error(reason);
    await shutdown(1);
  });

  // ── Calibrate mode ─────────────────────────────────────────────────────────
  if (opts.calibrate) {
    logger.header(t('calib.header'));
    await agent.init();
    await agent.browser.dumpDebugInfo();
    await agent.browser.screenshot();
    logger.info(t('calib.done'));
    await shutdown(0);
  }

  // ── History mode (list / open / view past conversations) ───────────────────
  if (opts.history || opts.openConv != null || opts.viewConv) {
    try {
      await agent.init();
      agentInited = true;
    } catch (err) {
      logger.error(`${t('runtime.launchFailed')} ${err.message}`);
      if (config.DEBUG) console.error(err.stack);
      process.exit(1);
    }

    try {
      if (opts.history) {
        const list = await agent.listConversations();
        if (!list || list.length === 0) {
          logger.warn(t('repl.historyEmpty'));
        } else {
          logger.header(t('repl.historyHeader'));
          for (const c of list) {
            logger.info(t('repl.historyItem', { n: c.index, title: c.title }));
          }
          console.log('');
        }
      }

      if (opts.openConv != null) {
        const ref = /^\d+$/.test(opts.openConv) ? Number(opts.openConv) : opts.openConv;
        await agent.openConversation(ref);

        // When a task is supplied alongside --open, run it against the opened
        // conversation so the user can immediately continue the thread.
        if (opts.task) {
          await agent.run(opts.task);
        } else if (opts.viewConv) {
          // handled below
        } else if (!opts.history) {
          // Nothing else requested — drop into interactive mode so the user can
          // keep talking to the reopened conversation.
          opts.interactive = true;
        }
      }

      if (opts.viewConv && !opts.task) {
        const turns = await agent.readCurrentConversation();
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
      }
    } catch (err) {
      logger.error(`${t('repl.openFailed')} ${err.message}`);
      if (config.DEBUG) console.error(err.stack);
      await shutdown(1);
    }

    // If nothing further was requested, we're done.
    if (!opts.interactive && !opts.task) {
      await shutdown(0);
    }

    // Otherwise fall through to the normal run / interactive flow below.
    if (opts.task) {
      await shutdown(0);
    }
  }

  // ── Validate we have a task or interactive mode ────────────────────────────
  if (!opts.interactive && !opts.task && !opts.history && opts.openConv == null && !opts.viewConv) {
    logger.warn(`${t('runtime.noTask')}\n`);
    opts.interactive = true;
  }

  // ── Launch browser ─────────────────────────────────────────────────────────
  if (!agentInited) {
    try {
      await agent.init();
      agentInited = true;
    } catch (err) {
      logger.error(`${t('runtime.launchFailed')} ${err.message}`);
      if (config.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  }

  // ── Run ────────────────────────────────────────────────────────────────────
  try {
    if (opts.interactive) {
      await agent.runInteractive();
    } else {
      await agent.run(opts.task);
    }
  } catch (err) {
    logger.error(`${t('runtime.agentError')} ${err.message}`);
    if (config.DEBUG) console.error(err.stack);
    await shutdown(1);
  }

  await shutdown(0);
}

main();
