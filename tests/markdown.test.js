// Direction + markdown checks for the sidebar renderer. Run: node tests/markdown.test.js
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('./_jsdom');

const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'sidebar', 'markdown.js'), 'utf8');
const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
window.eval(code);
const md = window.HermesMarkdown;

const render = (text) => {
  const div = window.document.createElement('div');
  div.innerHTML = md.render(text);
  return div;
};

// A block with even one Persian/Arabic character is RTL — whatever it starts with.
let el = render('Use `dir` here — اما این پاراگراف فارسی است.');
assert.strictEqual(el.querySelector('p').getAttribute('dir'), 'rtl', 'Persian anywhere → rtl');
assert.strictEqual(el.querySelector('code').getAttribute('dir'), 'ltr', 'inline code stays ltr');

el = render('Plain English paragraph with `code`.');
assert.strictEqual(el.querySelector('p').getAttribute('dir'), 'ltr');
assert.strictEqual(el.querySelector('strong'), null);

el = render('**پرچم** و *متن*');
assert.ok(el.querySelector('strong'), 'bold parsed');
assert.ok(el.querySelector('em'), 'italic parsed');

// Code fences never flip, whatever is inside.
el = render('```js\nconst x = "فارسی";\n```');
assert.strictEqual(el.querySelector('pre').getAttribute('dir'), 'ltr');
assert.match(el.querySelector('pre').textContent, /فارسی/);

// Heading levels + direction.
el = render('## عنوان فارسی');
assert.strictEqual(el.querySelector('h4').getAttribute('dir'), 'rtl');

// Lists: the list flows RTL when any item is Persian, each item picks its own direction.
el = render('- مورد اول\n- second item\n- مورد سوم');
assert.strictEqual(el.querySelector('ul').getAttribute('dir'), 'rtl');
const lis = [...el.querySelectorAll('li')];
assert.deepStrictEqual(lis.map((li) => li.getAttribute('dir')), ['rtl', 'ltr', 'rtl']);

el = render('1. یکی\n2. دو');
assert.strictEqual(el.querySelector('ol').getAttribute('dir'), 'rtl');

// Tables: header picks the table direction, every cell is decided on its own text.
el = render('| نام | value |\n|---|---|\n| علی | 42 |\n| plain | متن فارسی |');
const table = el.querySelector('table');
assert.strictEqual(table.getAttribute('dir'), 'rtl');
const ths = [...el.querySelectorAll('th')].map((c) => c.getAttribute('dir'));
assert.deepStrictEqual(ths, ['rtl', 'ltr']);
const tds = [...el.querySelectorAll('td')].map((c) => c.getAttribute('dir'));
assert.deepStrictEqual(tds, ['rtl', 'ltr', 'ltr', 'rtl'], 'each cell judged on its own text');

// Blockquote + hr + link, and no raw HTML injection from page/LLM text.
el = render('> نقل قول فارسی\n\n---\n\n[link](https://example.com) and <img src=x onerror=alert(1)>');
assert.strictEqual(el.querySelector('blockquote').getAttribute('dir'), 'rtl');
assert.ok(el.querySelector('hr'));
assert.strictEqual(el.querySelector('a').getAttribute('href'), 'https://example.com');
assert.strictEqual(el.querySelector('img'), null, 'raw html is escaped');
assert.match(el.textContent, /<img src=x/);

// Paragraphs separated by a blank line stay separate blocks.
el = render('پاراگراف یک.\n\nParagraph two.');
assert.strictEqual(el.querySelectorAll('p').length, 2);
assert.strictEqual(el.querySelectorAll('p')[1].getAttribute('dir'), 'ltr');

console.log('markdown.test.js ok');
