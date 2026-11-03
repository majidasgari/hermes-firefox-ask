// Offline check of the content script: page collection, selection → bubble, bubble teardown.
// Run: node tests/content.test.js
'use strict';

const assert = require('node:assert');
const path = require('node:path');

const { JSDOM } = require('./_jsdom');

const script = require('node:fs').readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content.js'),
  'utf8'
);

const longText = 'x'.repeat(50000);
const dom = new JSDOM(
  `<!doctype html><html><head><title>صفحه آزمایش</title></head><body>
     <article><h1>عنوان مقاله</h1><p id="p1">این پاراگراف قابل انتخاب است.</p>
     <p>${longText}</p></article></body></html>`,
  { url: 'https://example.com/a', runScripts: 'outside-only', pretendToBeVisual: true }
);

const { window } = dom;
let handler = null;
const sent = [];
window.browser = {
  runtime: {
    onMessage: { addListener: (fn) => { handler = fn; } },
    sendMessage: (msg) => { sent.push(msg); },
  },
};
// jsdom never lays out, so give ranges a rect the bubble can be placed against.
window.Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 120, right: 300, width: 120, height: 20 });

window.eval(script);

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

async function run() {
  assert.ok(handler, 'content script registered a message listener');

  const ctx = await handler({ type: 'collect' });
  assert.strictEqual(ctx.url, 'https://example.com/a');
  assert.strictEqual(ctx.title, 'صفحه آزمایش');
  assert.match(ctx.text, /عنوان مقاله/);
  assert.ok(ctx.text.length <= 30000, 'page text is capped');
  assert.strictEqual(ctx.selection, '');

  const hostId = window.HermesAskCore.HOST_ID;
  assert.strictEqual(window.document.getElementById(hostId), null, 'no bubble before a selection');

  const range = window.document.createRange();
  range.selectNodeContents(window.document.getElementById('p1'));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await flush();

  const host = window.document.getElementById(hostId);
  assert.ok(host, 'bubble appears next to a selection');
  const button = host.shadowRoot.querySelector('button');
  assert.strictEqual(button.textContent, 'پرسش از هرمس');

  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.strictEqual(sent.at(-1).type, 'ask-selection');
  assert.strictEqual(sent.at(-1).selection, 'این پاراگراف قابل انتخاب است.');
  assert.strictEqual(window.document.getElementById(hostId), null, 'bubble closes after asking');

  sel.removeAllRanges();
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await flush();
  assert.strictEqual(window.document.getElementById(hostId), null, 'no bubble without a selection');

  console.log('content.test.js ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
