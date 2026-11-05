'use strict';

const BRIDGE = 'http://127.0.0.1:8790';
const logEl = document.getElementById('log');
const questionEl = document.getElementById('q');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const selectionRadio = document.querySelector('input[name="ctx"][value="selection"]');
const pageRadio = document.querySelector('input[name="ctx"][value="page"]');
const chatActionsEl = document.getElementById('chat-actions');

let hermesSession = null;
let pendingSelection = '';
let busy = false;
let userPicked = false;
let messageActions = []; // {label, prompt} — one row of buttons under every message
let chatActions = []; // {label, prompt} — one row of buttons above the composer
let startActions = []; // {label, prompt} — shown while the panel has no messages yet
let history = []; // {role, text} of the real conversation, for chat actions

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
  return btn;
}

function actionButton(action, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'act';
  btn.textContent = action.label;
  btn.title = action.prompt;
  btn.addEventListener('click', onClick);
  return btn;
}

function actionRow(role, text) {
  const row = document.createElement('div');
  row.className = 'msg-actions';
  messageActions.forEach((action) =>
    row.append(actionButton(action, (event) => runAction(action, { text }, event.currentTarget.closest('.msg'))))
  );
  if (role === 'assistant') row.append(copyButton(text));
  return row.childElementCount ? row : null;
}

// The panel conversation as plain text, for chat actions.
function transcript() {
  return history
    .map((entry) => (entry.role === 'user' ? 'کاربر: ' : 'هرمس: ') + entry.text)
    .join('\n\n');
}

// An action never touches this conversation: no session id, no message in the history —
// the result lands in its own card, fetched from a separate Hermes chat.
async function runAction(action, target, anchor) {
  const card = document.createElement('div');
  card.className = 'msg result';
  const head = document.createElement('div');
  head.className = 'result-head';
  const title = document.createElement('span');
  title.className = 'result-title';
  title.dir = 'auto';
  title.textContent = action.label;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'copy';
  close.textContent = '×';
  close.title = 'بستن این نتیجه';
  close.addEventListener('click', () => card.remove());
  const body = document.createElement('div');
  body.className = 'result-body';
  renderText(body, '…');
  head.append(title, close);
  card.append(head, body);
  if (anchor) anchor.after(card);
  else logEl.append(card);
  if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });

  try {
    const res = await fetch(BRIDGE + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ question: action.prompt }, target)),
    });
    const data = await res.json();
    const answer = data.answer || data.error || 'پاسخی نیامد.';
    renderText(body, answer);
    head.insertBefore(copyButton(answer), close);
    setStatus('ok');
  } catch (err) {
    renderText(body, 'به بریج هرمس وصل نشدم (۱۲۷.۰.۰.۱:۸۷۹۰).');
    setStatus('down');
  }
}

// Page context for actions that are about the page rather than a message or the conversation.
async function pageTarget() {
  const ctx = (await browser.runtime.sendMessage({ type: 'get-context' })) || {};
  const selection = selectionRadio.checked ? (ctx.selection || pendingSelection || '').trim() : '';
  if (selection) return { selection };
  return { page: { url: ctx.url || '', title: ctx.title || '', text: ctx.text || '' } };
}

// The starter row: the "first message" actions, only while nothing has been asked yet.
function renderStarters() {
  const old = logEl.querySelector('.starters');
  if (old) old.remove();
  if (history.length || !startActions.length) return;
  const box = document.createElement('div');
  box.className = 'starters';
  startActions.forEach((action) =>
    box.append(
      actionButton(action, async () => {
        const target = await pageTarget();
        runAction(action, target, null);
      })
    )
  );
  logEl.prepend(box);
}

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  renderText(el, text);
  const actionable = (role === 'assistant' || role === 'user') && text !== '…' && String(text).trim();
  const row = actionable ? actionRow(role, text) : null;
  if (row) el.append(row);
  if ((role === 'user' || role === 'assistant') && text !== '…') history.push({ role, text: String(text) });
  logEl.append(el);
  logEl.scrollTop = logEl.scrollHeight;
  renderStarters(); // no starters once the conversation has a message
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

async function loadActions() {
  try {
    const res = await fetch(BRIDGE + '/actions', { cache: 'no-store' });
    const data = await res.json();
    messageActions = Array.isArray(data.message) ? data.message : [];
    chatActions = Array.isArray(data.chat) ? data.chat : [];
    startActions = Array.isArray(data.start) ? data.start : [];
  } catch (err) {
    messageActions = [];
    chatActions = [];
    startActions = [];
  }
  renderChatActions();
  renderStarters();
}

function renderChatActions() {
  chatActionsEl.replaceChildren();
  chatActions.forEach((action) =>
    chatActionsEl.append(
      actionButton(action, () => {
        const text = transcript();
        if (!text) {
          addMessage('note', 'هنوز گفتگویی نیست که اکشن روی آن اجرا شود.');
          return;
        }
        runAction(action, { transcript: text }, null);
      })
    )
  );
  chatActionsEl.hidden = chatActions.length === 0;
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
  if (!question || busy) return; // keep the text if a turn is still running
  questionEl.value = '';
  await send(question);
}

// One turn of this panel's own conversation (page/selection context, resumed session).
async function send(question) {
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

document.getElementById('settings').addEventListener('click', () => browser.runtime.openOptionsPage());

document.getElementById('clear').addEventListener('click', () => {
  logEl.replaceChildren();
  hermesSession = null; // next question opens a fresh Hermes session
  history = [];
  pendingSelection = '';
  showPreview('');
  addMessage('note', 'گفتگو پاک شد. پرسش بعدی یک نشست تازه در هرمس می‌سازد.');
  renderStarters();
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
  await loadActions();
  await consumePending();
  await refreshContext();
}

// Actions edited in the options page apply on the next focus, without reopening the panel.
window.addEventListener('focus', loadActions);

init();
