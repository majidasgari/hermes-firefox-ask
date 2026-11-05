'use strict';

// Actions live in the bridge's config file (~/.config/hermes-firefox-ask/actions.json), so they
// can be edited here or in any text editor, and no extra add-on permission is needed.
const BRIDGE = 'http://127.0.0.1:8790';
const messageEl = document.getElementById('message');
const chatEl = document.getElementById('chat');
const startEl = document.getElementById('start');
const statusEl = document.getElementById('status');

const toLines = (items) => (items || []).map((item) => `${item.label} | ${item.prompt}`).join('\n');

function parseLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('|');
      const label = at === -1 ? line : line.slice(0, at).trim();
      const prompt = at === -1 ? line : line.slice(at + 1).trim();
      return { label: label.slice(0, 60), prompt: prompt.slice(0, 2000) };
    })
    .filter((item) => item.prompt);
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.dataset.state = text ? 'ok' : '';
}

async function load() {
  try {
    const res = await fetch(BRIDGE + '/actions', { cache: 'no-store' });
    const data = await res.json();
    messageEl.value = toLines(data.message);
    chatEl.value = toLines(data.chat);
    startEl.value = toLines(data.start);
    setStatus('');
  } catch (err) {
    setStatus('بریج در دسترس نیست — سرویس hermes-ask-bridge را اجرا کن');
  }
}

async function save() {
  try {
    const res = await fetch(BRIDGE + '/actions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: parseLines(messageEl.value),
        chat: parseLines(chatEl.value),
        start: parseLines(startEl.value),
      }),
    });
    const data = await res.json();
    messageEl.value = toLines(data.message);
    chatEl.value = toLines(data.chat);
    startEl.value = toLines(data.start);
    setStatus('ذخیره شد');
    setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    setStatus('ذخیره نشد — بریج خاموش است؟');
  }
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('path').textContent = 'فایل تنظیمات: ~/.config/hermes-firefox-ask/actions.json';

load();
