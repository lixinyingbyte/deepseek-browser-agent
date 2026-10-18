// src/confirm.js — Human-in-the-loop confirmation for dangerous operations
'use strict';

let handler = null;

/**
 * Plug in a custom confirmation handler (e.g. from the web UI).
 * The handler receives (question, opts) and must resolve to a boolean.
 */
function setConfirmHandler(fn) {
  handler = typeof fn === 'function' ? fn : null;
}

function readlineConfirm(question) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input : process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

/**
 * Ask for confirmation before a risky operation.
 *
 * @param {string} question  Human-readable prompt.
 * @param {object} [opts]
 * @param {boolean} [opts.defaultAllow]  Answer used when non-interactive.
 * @returns {Promise<boolean>}
 */
async function confirm(question, opts) {
  const options = opts || {};

  if (handler) {
    try {
      return !!(await handler(question, options));
    } catch {
      return false;
    }
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return options.defaultAllow === true;
  }

  const suffix = options.defaultAllow === true ? ' [Y/n] ' : ' [y/N] ';
  return readlineConfirm(question + suffix);
}

module.exports = { confirm, setConfirmHandler };
