// src/postinstall.js — Runs after `npm install -g deepseek-browser-agent`
// Automatically downloads the Playwright Chromium browser.
'use strict';

const { execSync } = require('child_process');
const path         = require('path');
const os           = require('os');
const i18n         = require('./i18n');

const t = i18n.t;

// Skip in CI environments where a display isn't available
if (process.env.CI || process.env.SKIP_PLAYWRIGHT_INSTALL) {
  console.log(t('setup.skip'));
  process.exit(0);
}

console.log('');
console.log('  ══════════════════════════════════════════════');
console.log('   ' + t('setup.bannerTitle'));
console.log('  ══════════════════════════════════════════════');
console.log('');
console.log(t('setup.downloading'));
console.log(t('setup.once') + '\n');

try {
  // Use the playwright binary bundled in this package's node_modules
  const playwrightBin = path.join(__dirname, '..', 'node_modules', '.bin', 'playwright');

  execSync(`"${playwrightBin}" install chromium`, {
    stdio : 'inherit',
    env   : { ...process.env },
  });

  console.log('');
  console.log(t('setup.installed'));
  console.log('');
  console.log(t('setup.getStarted'));
  console.log('    deepseek-agent --interactive');
  console.log('    deepseek-agent "build a REST API in Express"');
  console.log('');
} catch (err) {
  console.warn('');
  console.warn(t('setup.warn1'));
  console.warn(t('setup.warn2'));
  console.warn('');
  console.warn(t('setup.warnCmd'));
  console.warn('');
  // Don't exit(1) — don't break the install if browser download fails
}
