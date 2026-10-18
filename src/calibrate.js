#!/usr/bin/env node
// src/calibrate.js — Auto-detect DeepSeek UI selectors and update browser.js
'use strict';

const { chromium } = require('playwright');
const path         = require('path');
const fs           = require('fs');
const config       = require('./config');
const i18n         = require('./i18n');

const t = i18n.t;

console.log('\n' + t('calib.toolTitle') + '\n');
console.log(t('calib.toolDesc1'));
console.log(t('calib.toolDesc2') + '\n');

async function calibrate() {
  const context = await chromium.launchPersistentContext(config.SESSION_DIR, {
    headless : false,
    viewport : { width: 1280, height: 900 },
  });

  const pages = context.pages();
  const page  = pages.length > 0 ? pages[0] : await context.newPage();

  console.log(t('calib.navigating', { url: config.DEEPSEEK_URL }));
  await page.goto(config.DEEPSEEK_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3_000);

  console.log(t('calib.inspecting') + '\n');

  const report = await page.evaluate(() => {
    function isVisible(el) {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.offsetParent !== null;
    }

    function classify(el) {
      return {
        tag         : el.tagName.toLowerCase(),
        id          : el.id || null,
        classes     : el.className?.slice?.(0, 120) || null,
        placeholder : el.placeholder || null,
        ariaLabel   : el.getAttribute('aria-label') || null,
        dataTestId  : el.dataset?.testid || null,
        role        : el.getAttribute('role') || null,
        visible     : isVisible(el),
        text        : (el.innerText || '').slice(0, 40).replace(/\n/g, ' ') || null,
        type        : el.getAttribute('type') || null,
      };
    }

    // ── Inputs ───────────────────────────────────────────────────────────
    const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'))
      .map(classify);

    // ── Buttons ──────────────────────────────────────────────────────────
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(isVisible)
      .map(classify)
      .slice(0, 30);

    // ── All named classes ─────────────────────────────────────────────────
    const classFreq = {};
    document.querySelectorAll('*').forEach(el => {
      (el.getAttribute('class') || '').split(/\s+/).forEach(c => {
        if (c.length > 2 && c.length < 50) {
          classFreq[c] = (classFreq[c] || 0) + 1;
        }
      });
    });
    const topClasses = Object.entries(classFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80)
      .map(([cls, n]) => ({ cls, n }));

    // ── Suggested selectors ───────────────────────────────────────────────
    const suggestedInput = (
      inputs.find(i => i.placeholder?.toLowerCase().includes('message'))?.id ||
      inputs.find(i => i.placeholder?.toLowerCase().includes('ask'))?.id ||
      inputs.find(i => i.visible)?.id ||
      null
    );

    const sendBtn = buttons.find(b =>
      /send/i.test(b.ariaLabel || '') ||
      /send/i.test(b.text || '') ||
      /send/i.test(b.classes || '')
    );

    const stopBtn = buttons.find(b =>
      /stop/i.test(b.ariaLabel || '') ||
      /stop/i.test(b.text || '') ||
      /stop/i.test(b.classes || '')
    );

    const newChatBtn = buttons.find(b =>
      /new chat/i.test(b.ariaLabel || '') ||
      /new chat/i.test(b.text || '') ||
      /new.?chat/i.test(b.classes || '')
    );

    return {
      url    : window.location.href,
      title  : document.title,
      inputs,
      buttons,
      topClasses,
      suggestions: { suggestedInput, sendBtn, stopBtn, newChatBtn },
    };
  });

  // ── Print report ──────────────────────────────────────────────────────────
  const sep = '─'.repeat(60);

  console.log(sep);
  console.log(t('calib.url'), report.url);
  console.log(t('calib.title'), report.title);
  console.log(sep);

  console.log('\n' + t('calib.inputs'));
  if (report.inputs.length === 0) {
    console.log(t('calib.noneFound'));
  }
  report.inputs.forEach((el, i) => {
    console.log(`  [${i}] ${JSON.stringify(el)}`);
  });

  console.log('\n' + t('calib.buttons'));
  report.buttons.forEach((el, i) => {
    console.log(`  [${i}] ${JSON.stringify(el)}`);
  });

  console.log('\n' + t('calib.classes'));
  report.topClasses.slice(0, 40).forEach(({ cls, n }) => {
    console.log(`  ${String(n).padStart(4)}x  .${cls}`);
  });

  console.log('\n' + sep);
  console.log(t('calib.suggested'));
  console.log(sep);

  const s = report.suggestions;

  if (s.suggestedInput) {
    console.log(t('calib.chatInput', { id: s.suggestedInput }));
  }
  if (s.sendBtn) {
    const sel = s.sendBtn.ariaLabel
      ? `button[aria-label="${s.sendBtn.ariaLabel}"]`
      : s.sendBtn.id ? `#${s.sendBtn.id}` : `.${s.sendBtn.classes?.split(' ')[0]}`;
    console.log(t('calib.sendButton', { sel }));
  }
  if (s.stopBtn) {
    const sel = s.stopBtn.ariaLabel
      ? `button[aria-label="${s.stopBtn.ariaLabel}"]`
      : `.${s.stopBtn.classes?.split(' ')[0]}`;
    console.log(t('calib.stopButton', { sel }));
  }
  if (s.newChatBtn) {
    const sel = s.newChatBtn.ariaLabel
      ? `button[aria-label="${s.newChatBtn.ariaLabel}"]`
      : `.${s.newChatBtn.classes?.split(' ')[0]}`;
    console.log(t('calib.newChat', { sel }));
  }

  console.log(sep);
  console.log('\n' + t('calib.screenshot'));
  await page.screenshot({ path: '/tmp/deepseek-calibrate.png', fullPage: false });

  console.log('\n' + t('calib.complete'));
  console.log(t('calib.exit') + '\n');

  // Keep browser open so user can inspect manually
  await new Promise(() => {}); // wait forever
}

calibrate().catch(err => {
  console.error(t('calib.error'), err.message);
  process.exit(1);
});
