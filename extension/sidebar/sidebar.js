'use strict';

const BRIDGE = 'http://127.0.0.1:8790';
const logEl = document.getElementById('log');
const questionEl = document.getElementById('q');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const selectionRadio = document.querySelector('input[name="ctx"][value="selection"]');
const pageRadio = document.querySelector('input[name="ctx"][value="page"]');

let hermesSession = null;
let pendingSelection = '';
let busy = false;
let userPicked = false;

function renderText(el, text) {
  // Markdown → HTML, with per-block RTL/LTR decided inside HermesMarkdown.
  el.innerHTML = globalThis.HermesMarkdown.render(text);
}

function copyText(text) {
  // execCommand path on purpose: navigator.clipboard.writeText needs the clipboardWrite
  // permission, and adding a permission makes Firefox ask the user before every update.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  area.remove();
  return ok;
}

function copyButton(text) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy';
  btn.textContent = 'کپی';
  btn.title = 'کپی مارک‌داون این پاسخ';
  btn.addEventListener('click', () => {
    btn.textContent = copyText(text) ? 'کپی شد' : 'کپی نشد';
    setTimeout(() => {
      btn.textContent = 'کپی';
    }, 1500);
  });
  actions.append(btn);
  return actions;
}

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  renderText(el, text);
  if (role === 'assistant' && text !== '…') el.append(copyButton(text));
  logEl.append(el);
  logEl.scrollTop = logEl.scrollHeight;
  return el;
}

function setStatus(state) {
  statusEl.dataset.state = state;
  statusEl.title = state === 'ok' ? 'بریج هرمس فعال است' : 'بریج هرمس در دسترس نیست';
}

async function checkHealth() {
  try {
    const res = await fetch(BRIDGE + '/health', { cache: 'no-store' });
    setStatus(res.ok ? 'ok' : 'down');
    return res.ok;
  } catch (err) {
    setStatus('down');
    return false;
  }
}

function showPreview(text) {
  if (!text) {
    previewEl.hidden = true;
    previewEl.textContent = '';
    return;
  }
  previewEl.textContent = text.replace(/\s+/g, ' ').slice(0, 90) + (text.length > 90 ? '…' : '');
  previewEl.hidden = false;
}

async function refreshContext() {
  const ctx = (await browser.runtime.sendMessage({ type: 'get-context' })) || {};
  const selection = (ctx.selection || pendingSelection || '').trim();
  selectionRadio.disabled = !selection;
  if (!selection) {
    pageRadio.checked = true;
    showPreview('');
    return;
  }
  if (!userPicked) selectionRadio.checked = true;
  showPreview(selection);
}

async function ask() {
  const question = questionEl.value.trim();
  if (!question || busy) return;
  const ctx = (await browser.runtime.sendMessage({ type: 'get-context' })) || {};
  const useSelection = selectionRadio.checked;
  const selection = useSelection ? (ctx.selection || pendingSelection || '').trim() : '';
  if (useSelection && !selection) {
    addMessage('note', 'چیزی در صفحه انتخاب نشده است. بخشی از متن را انتخاب کن و دوباره بپرس.');
    return;
  }

  busy = true;
  sendBtn.disabled = true;
  questionEl.value = '';
  addMessage('user', question);
  const thinking = addMessage('assistant', '…');

  try {
    const res = await fetch(BRIDGE + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        selection,
        page: { url: ctx.url || '', title: ctx.title || '', text: ctx.text || '' },
        session: hermesSession,
      }),
    });
    const data = await res.json();
    thinking.remove();
    if (data.session) hermesSession = data.session;
    addMessage('assistant', data.answer || data.error || 'پاسخی نیامد.');
    setStatus('ok');
  } catch (err) {
    thinking.remove();
    addMessage(
      'note',
      'به بریج هرمس وصل نشدم (۱۲۷.۰.۰.۱:۸۷۹۰). یک بار اجرا کن: systemctl --user start hermes-ask-bridge'
    );
    setStatus('down');
  } finally {
    busy = false;
    sendBtn.disabled = false;
    questionEl.focus();
  }
}

sendBtn.addEventListener('click', ask);

document.getElementById('clear').addEventListener('click', () => {
  logEl.replaceChildren();
  hermesSession = null; // next question opens a fresh Hermes session
  pendingSelection = '';
  showPreview('');
  addMessage('note', 'گفتگو پاک شد. پرسش بعدی یک نشست تازه در هرمس می‌سازد.');
  refreshContext();
  questionEl.focus();
});

questionEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    ask();
  }
});

document.querySelectorAll('input[name="ctx"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    userPicked = true;
  });
});

// A new tab means a new page: start a fresh Hermes conversation, keep the visible history.
browser.tabs.onActivated.addListener(() => {
  hermesSession = null;
  pendingSelection = '';
  userPicked = false;
  refreshContext();
});

async function consumePending() {
  const pending = await browser.runtime.sendMessage({ type: 'take-pending' });
  if (!pending || !pending.selection) return false;
  pendingSelection = pending.selection;
  selectionRadio.disabled = false;
  selectionRadio.checked = true;
  userPicked = false;
  showPreview(pending.selection);
  return true;
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'pending') consumePending().then(() => refreshContext());
});

async function init() {
  checkHealth();
  questionEl.focus();
  await consumePending();
  await refreshContext();
}

init();
