/* «پرسش از هرمس» — selection bubble + page context collector.
   Runs at document_idle on <all_urls>; all UI lives in a shadow root so site CSS cannot touch it. */
(() => {
  'use strict';

  const MAX_PAGE = 30000;
  const MAX_SEL = 12000;
  const HOST_ID = '__hermes_ask_host__';
  let host = null;
  let button = null;

  function pageText() {
    const root = document.querySelector('article, main, [role="main"]') || document.body;
    const raw = (root && (root.innerText || root.textContent)) || '';
    return raw.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_PAGE);
  }

  function selectedText() {
    const sel = window.getSelection ? window.getSelection() : null;
    return sel ? String(sel).trim().slice(0, MAX_SEL) : '';
  }

  function hideBubble() {
    if (host) {
      host.remove();
      host = null;
      button = null;
    }
  }

  function buildBubble() {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'پرسش از هرمس';
    button.setAttribute(
      'style',
      'cursor:pointer;font:600 13px/1.6 system-ui,Tahoma,sans-serif;direction:rtl;' +
        'color:#fff;background:#1f6feb;border:0;border-radius:8px;padding:6px 12px;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.35);'
    );
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      askAboutSelection();
    });
    shadow.append(button);
    (document.body || document.documentElement).append(host);
  }

  function showBubble(rect) {
    if (!host) buildBubble();
    const top = Math.min(Math.max(rect.bottom + 6, 6), window.innerHeight - 44);
    const left = Math.min(Math.max(rect.right - 120, 6), Math.max(window.innerWidth - 132, 6));
    host.style.top = top + 'px';
    host.style.left = left + 'px';
  }

  function askAboutSelection() {
    const text = selectedText();
    hideBubble();
    if (!text) return;
    try {
      browser.runtime.sendMessage({ type: 'ask-selection', selection: text });
    } catch (err) {
      /* extension was reloaded under us — nothing to do */
    }
  }

  function insideHost(event) {
    if (!host) return false;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.includes(host);
  }

  function init() {
    document.addEventListener(
      'mouseup',
      (event) => {
        if (insideHost(event)) return;
        setTimeout(() => {
          const text = selectedText();
          const sel = window.getSelection();
          if (!text || !sel || !sel.rangeCount) return hideBubble();
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          if (!rect || (!rect.width && !rect.height)) return hideBubble();
          showBubble(rect);
        }, 0);
      },
      true
    );
    document.addEventListener('mousedown', (event) => { if (!insideHost(event)) hideBubble(); }, true);
    document.addEventListener('scroll', hideBubble, true);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideBubble(); }, true);

    browser.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'collect') {
        return Promise.resolve({
          url: location.href,
          title: document.title,
          selection: selectedText(),
          text: pageText(),
        });
      }
    });
  }

  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) init();
  globalThis.HermesAskCore = { pageText, selectedText, showBubble, hideBubble, HOST_ID };
})();
