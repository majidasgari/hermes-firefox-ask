'use strict';

const MENU_ID = 'hermes-ask-selection';
let pending = null; // the selection a right-click / bubble handed to the sidebar

function ensureMenu() {
  browser.contextMenus
    .removeAll()
    .then(() =>
      browser.contextMenus.create({
        id: MENU_ID,
        title: 'پرسش از هرمس درباره این انتخاب',
        contexts: ['selection'],
      })
    )
    .catch(() => {});
}

browser.runtime.onInstalled.addListener(ensureMenu);
browser.runtime.onStartup.addListener(ensureMenu);

async function openSidebar() {
  try {
    await browser.sidebarAction.open();
  } catch (err) {
    /* no user gesture left in the chain — the toolbar button still works */
  }
  // An already-open sidebar keeps its state, so tell it to pick up the new selection.
  try {
    await browser.runtime.sendMessage({ type: 'pending' });
  } catch (err) {
    /* sidebar closed: it consumes the pending selection when it opens */
  }
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  pending = { selection: (info.selectionText || '').trim().slice(0, 12000), tabId: tab ? tab.id : null };
  await openSidebar();
});

async function activeContext() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const empty = { url: (tab && tab.url) || '', title: (tab && tab.title) || '', text: '', selection: '' };
  if (!tab || !tab.id) return empty;
  try {
    const ctx = await browser.tabs.sendMessage(tab.id, { type: 'collect' });
    return ctx ? Object.assign(empty, ctx) : empty;
  } catch (err) {
    return empty; // about:, PDF viewer, restricted pages
  }
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return undefined;
  if (msg.type === 'take-pending') {
    const taken = pending;
    pending = null;
    return Promise.resolve(taken);
  }
  if (msg.type === 'get-context') return activeContext();
  if (msg.type === 'ask-selection') {
    pending = { selection: String(msg.selection || '').slice(0, 12000) };
    return openSidebar().then(() => true);
  }
  return undefined;
});
