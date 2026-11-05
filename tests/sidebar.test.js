// Offline check of the sidebar: health dot, selection prefill, ask round-trip through the bridge.
// Run: node tests/sidebar.test.js
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('./_jsdom');

const root = path.join(__dirname, '..', 'extension', 'sidebar');
const html = fs.readFileSync(path.join(root, 'sidebar.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'moz-extension://test/sidebar/sidebar.html', runScripts: 'outside-only' });
const { window } = dom;

const posts = [];
let pendingSelection = 'متن انتخاب‌شده از صفحه';
const context = { url: 'https://example.com/a', title: 'صفحه', text: 'کل متن صفحه', selection: '' };

window.browser = {
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: async (msg) => {
      if (msg.type === 'take-pending') {
        const out = pendingSelection ? { selection: pendingSelection } : null;
        pendingSelection = '';
        return out;
      }
      if (msg.type === 'get-context') return context;
      return undefined;
    },
  },
  tabs: { onActivated: { addListener: () => {} } },
};

window.fetch = async (url, opts = {}) => {
  const target = String(url);
  if (target.endsWith('/health')) return { ok: true, json: async () => ({ ok: true }) };
  if (target.endsWith('/actions') && (opts.method || 'GET') === 'GET') {
    return {
      ok: true,
      json: async () => ({
        message: [{ label: 'خلاصه', prompt: 'این را خلاصه کن' }],
        chat: [{ label: 'این صفحه', prompt: 'این صفحه درباره چیست؟' }],
      }),
    };
  }
  posts.push(JSON.parse(opts.body));
  return { ok: true, json: async () => ({ answer: 'پاسخ آزمایشی هرمس', session: 'sess-1' }) };
};

const copied = [];
// jsdom has no execCommand: record the value of the textarea the copy path selects.
window.document.execCommand = (cmd) => {
  const area = window.document.querySelector('textarea[readonly]');
  copied.push(cmd + ':' + (area ? area.value : ''));
  return true;
};

window.eval(fs.readFileSync(path.join(root, 'markdown.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(root, 'sidebar.js'), 'utf8'));

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

async function run() {
  await flush();

  assert.strictEqual(window.document.getElementById('status').dataset.state, 'ok');
  assert.strictEqual(window.document.querySelector('input[value="selection"]').checked, true, 'selection pre-selected');
  assert.strictEqual(window.document.querySelector('input[value="selection"]').disabled, false);
  assert.match(window.document.getElementById('preview').textContent, /متن انتخاب‌شده/);

  const q = window.document.getElementById('q');
  q.value = 'این بخش یعنی چه؟';
  window.document.getElementById('send').click();
  await flush();

  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].question, 'این بخش یعنی چه؟');
  assert.strictEqual(posts[0].selection, 'متن انتخاب‌شده از صفحه', 'asked about the selection, not the page');
  assert.strictEqual(posts[0].page.url, 'https://example.com/a');
  assert.strictEqual(posts[0].session, null);

  const log = window.document.getElementById('log');
  assert.match(log.textContent, /پاسخ آزمایشی هرمس/);
  assert.match(log.textContent, /این بخش یعنی چه؟/);

  // Copy button on an answer hands the raw markdown (not the rendered text) to the clipboard.
  const copyBtn = log.querySelector('.msg.assistant .copy');
  assert.ok(copyBtn, 'assistant answer has a copy button');
  copyBtn.click();
  await flush();
  assert.deepStrictEqual(copied, ['copy:پاسخ آزمایشی هرمس']);
  assert.strictEqual(copyBtn.textContent, 'کپی شد');

  // Follow-up reuses the session the bridge returned.
  q.value = 'بیشتر توضیح بده';
  window.document.getElementById('send').click();
  await flush();
  assert.strictEqual(posts[1].session, 'sess-1');

  // Whole-page mode sends no selection.
  window.document.querySelector('input[value="page"]').checked = true;
  context.selection = 'یک انتخاب دیگر';
  q.value = 'کل صفحه درباره چیست؟';
  window.document.getElementById('send').click();
  await flush();
  assert.strictEqual(posts[2].selection, '');
  assert.strictEqual(posts[2].page.text, 'کل متن صفحه');

  // Bridge down → a readable note, not a crash.
  window.fetch = async () => { throw new Error('offline'); };
  q.value = 'سلام';
  window.document.getElementById('send').click();
  await flush();
  assert.match(log.textContent, /systemctl --user start hermes-ask-bridge/);
  assert.strictEqual(window.document.getElementById('status').dataset.state, 'down');

  // Clear: history gone, next question starts a fresh Hermes session.
  window.document.getElementById('clear').click();
  await flush();
  assert.strictEqual(window.document.querySelectorAll('#log .msg.user').length, 0);
  assert.match(window.document.getElementById('log').textContent, /گفتگو پاک شد/);
  window.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ ok: true }) };
    posts.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ answer: 'ب', session: 'sess-2' }) };
  };
  q.value = 'سؤال تازه';
  window.document.getElementById('send').click();
  await flush();
  assert.strictEqual(posts.at(-1).session, null, 'cleared conversation must not resume the old session');

  // Configured actions: one row above the composer, one under each message.
  const chatActs = [...window.document.querySelectorAll('#chat-actions .act')];
  assert.strictEqual(chatActs.length, 1);
  assert.strictEqual(chatActs[0].textContent, 'این صفحه');

  const lastAnswer = [...window.document.querySelectorAll('#log .msg.assistant')].at(-1);
  const msgAct = lastAnswer.querySelector('.msg-actions .act');
  assert.ok(msgAct, 'message action under an answer');
  const beforeMsg = posts.length;
  msgAct.click();
  await flush();
  assert.strictEqual(posts.length, beforeMsg + 1);
  assert.strictEqual(posts.at(-1).question, 'این را خلاصه کن');
  assert.strictEqual(posts.at(-1).selection, lastAnswer.querySelector('p').textContent, 'message text goes as the selection');

  const beforeChat = posts.length;
  const pageInput = window.document.querySelector('input[value="page"]');
  pageInput.checked = true;
  pageInput.dispatchEvent(new window.Event('change'));
  chatActs[0].click();
  await flush();
  assert.strictEqual(posts.at(-1).question, 'این صفحه درباره چیست؟');
  assert.strictEqual(posts.at(-1).selection, '', 'chat action uses the page, not the message');
  assert.strictEqual(posts.length, beforeChat + 1);

  console.log('sidebar.test.js ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
