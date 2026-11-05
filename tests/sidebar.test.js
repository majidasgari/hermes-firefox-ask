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
        start: [{ label: 'این صفحه را خلاصه کن', prompt: 'این صفحه را در چند جمله خلاصه کن.' }],
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
  const log = window.document.getElementById('log');

  assert.strictEqual(window.document.getElementById('status').dataset.state, 'ok');
  assert.strictEqual(window.document.querySelector('input[value="selection"]').checked, true, 'selection pre-selected');
  assert.strictEqual(window.document.querySelector('input[value="selection"]').disabled, false);
  assert.match(window.document.getElementById('preview').textContent, /متن انتخاب‌شده/);

  // Starter ("first message") action: visible while the panel is empty, runs in a separate chat,
  // leaves the conversation empty.
  const starters = window.document.querySelectorAll('#log .starters .act');
  assert.strictEqual(starters.length, 1);
  assert.strictEqual(starters[0].textContent, 'این صفحه را خلاصه کن');
  starters[0].click();
  await flush();
  const starterRequest = posts.at(-1);
  assert.strictEqual(starterRequest.question, 'این صفحه را در چند جمله خلاصه کن.');
  assert.strictEqual(starterRequest.selection, 'متن انتخاب‌شده از صفحه', 'sends the current selection');
  assert.strictEqual(starterRequest.session, undefined, 'starter runs in a separate chat');
  assert.strictEqual(log.querySelectorAll('.msg.user, .msg.assistant').length, 0, 'conversation still empty');
  const starterResult = log.querySelector('.msg.result');
  assert.ok(starterResult && /پاسخ آزمایشی هرمس/.test(starterResult.textContent));
  starterResult.remove();
  window.document.querySelector('.starters')?.remove();

  const q = window.document.getElementById('q');
  const beforeAsk = posts.length;
  q.value = 'این بخش یعنی چه؟';
  window.document.getElementById('send').click();
  await flush();

  assert.strictEqual(posts.length, beforeAsk + 1);
  assert.strictEqual(posts.at(-1).question, 'این بخش یعنی چه؟');
  assert.strictEqual(posts.at(-1).selection, 'متن انتخاب‌شده از صفحه', 'asked about the selection, not the page');
  assert.strictEqual(posts.at(-1).page.url, 'https://example.com/a');
  assert.strictEqual(posts.at(-1).session, null);
  assert.strictEqual(log.querySelector('.starters'), null, 'starters disappear after the first message');

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
  assert.strictEqual(posts.at(-1).session, 'sess-1');

  // Whole-page mode sends no selection.
  window.document.querySelector('input[value="page"]').checked = true;
  context.selection = 'یک انتخاب دیگر';
  q.value = 'کل صفحه درباره چیست؟';
  window.document.getElementById('send').click();
  await flush();
  assert.strictEqual(posts.at(-1).selection, '');
  assert.strictEqual(posts.at(-1).page.text, 'کل متن صفحه');

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
  // Fresh bridge stub for this section: it answers with a session id of its own, so the test can
  // prove an action never adopts it.
  window.fetch = async (url, opts = {}) => {
    const target = String(url);
    if (target.endsWith('/health')) return { ok: true, json: async () => ({ ok: true }) };
    posts.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ answer: 'پاسخ آزمایشی هرمس', session: 'sess-action' }) };
  };
  const chatActs = [...window.document.querySelectorAll('#chat-actions .act')];
  assert.strictEqual(chatActs.length, 1);
  assert.strictEqual(chatActs[0].textContent, 'این صفحه');

  const beforeAction = log.querySelectorAll('.msg.user, .msg.assistant').length;
  const lastAnswer = [...log.querySelectorAll('.msg.assistant')].at(-1);
  const msgAct = lastAnswer.querySelector('.msg-actions .act');
  assert.ok(msgAct, 'message action under an answer');
  msgAct.click();
  await flush();

  // A message action sends that one message to a SEPARATE Hermes chat: no session, no new turn.
  const msgRequest = posts.at(-1);
  assert.strictEqual(msgRequest.question, 'این را خلاصه کن');
  assert.strictEqual(msgRequest.text, lastAnswer.querySelector('p').textContent);
  assert.strictEqual(msgRequest.selection, undefined, 'the page selection is not involved');
  assert.strictEqual(msgRequest.session, undefined, 'never resumes this chat');
  assert.strictEqual(log.querySelectorAll('.msg.user, .msg.assistant').length, beforeAction, 'chat untouched');
  const resultCard = lastAnswer.nextElementSibling;
  assert.ok(resultCard && resultCard.classList.contains('result'), 'result card sits under the message');
  assert.match(resultCard.textContent, /پاسخ آزمایشی هرمس/);
  assert.strictEqual(resultCard.querySelector('.result-title').textContent, 'خلاصه');
  assert.strictEqual(msgRequest.transcript, undefined);

  // The panel session is unchanged by the action: the next normal turn still resumes it.
  q.value = 'سؤال بعدی';
  window.document.getElementById('send').click();
  await flush();
  assert.strictEqual(posts.at(-1).session, 'sess-2', 'action session id was not adopted');
  const afterTurn = log.querySelectorAll('.msg.user, .msg.assistant').length;
  assert.strictEqual(afterTurn, beforeAction + 2, 'the normal turn still appends question + answer');

  // A chat action sends the WHOLE conversation, not the page.
  const pageInput = window.document.querySelector('input[value="page"]');
  pageInput.checked = true;
  pageInput.dispatchEvent(new window.Event('change'));
  chatActs[0].click();
  await flush();
  const chatRequest = posts.at(-1);
  assert.strictEqual(chatRequest.question, 'این صفحه درباره چیست؟');
  assert.strictEqual(chatRequest.session, undefined);
  assert.match(chatRequest.transcript, /^کاربر: سؤال تازه/);
  assert.match(chatRequest.transcript, /هرمس: ب/);
  assert.match(chatRequest.transcript, /کاربر: سؤال بعدی/);
  assert.strictEqual(
    chatRequest.transcript.split('پاسخ آزمایشی هرمس').length - 1,
    1,
    'the action result card is not part of the chat transcript'
  );
  assert.strictEqual(log.lastElementChild.classList.contains('result'), true, 'chat action result at the end');

  console.log('sidebar.test.js ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
