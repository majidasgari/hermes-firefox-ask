/* Minimal, dependency-free markdown → HTML for the sidebar answers.
   Text is ALWAYS escaped; the only HTML produced is the tags below.
   Direction rule: every block element (paragraph, list item, table cell, heading,
   blockquote, table) whose text holds even one Persian/Arabic character is RTL and
   right aligned; otherwise LTR. Code is always LTR. */
(() => {
  'use strict';

  const RTL_CHARS = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);
  const rtl = (s) => RTL_CHARS.test(s);
  const dirAttr = (s) => (rtl(s) ? 'dir="rtl"' : 'dir="ltr"');

  function inline(text) {
    let out = esc(text);
    out = out.replace(/`([^`]+)`/g, (_, code) => `<code dir="ltr">${code}</code>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    );
    return out;
  }

  function cellsOf(row) {
    return row
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
  const isTableStart = (lines, i) =>
    lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_DIVIDER.test(lines[i + 1]);
  const isBlockStart = (lines, i) =>
    /^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]) || isTableStart(lines, i);

  function tableHtml(header, rows) {
    const tableDir = rtl(header.join(' ')) ? 'rtl' : 'ltr';
    const head = header.map((cell) => `<th ${dirAttr(cell)}>${inline(cell)}</th>`).join('');
    const body = rows
      .map((row) => `<tr>${row.map((cell) => `<td ${dirAttr(cell)}>${inline(cell)}</td>`).join('')}</tr>`)
      .join('');
    return (
      `<table class="md-table" dir="${tableDir}"><thead><tr>${head}</tr></thead>` +
      (body ? `<tbody>${body}</tbody>` : '') +
      '</table>'
    );
  }

  function listHtml(items, ordered) {
    const tag = ordered ? 'ol' : 'ul';
    const listDir = items.some((item) => rtl(item)) ? 'rtl' : 'ltr';
    const lis = items.map((item) => `<li ${dirAttr(item)}>${inline(item)}</li>`).join('');
    return `<${tag} class="md-list" dir="${listDir}">${lis}</${tag}>`;
  }

  function render(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let list = null;
    let i = 0;

    const flushList = () => {
      if (list) {
        out.push(listHtml(list.items, list.ordered));
        list = null;
      }
    };

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*```/.test(line)) {
        const buf = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i += 1;
        flushList();
        out.push(`<pre class="md-pre" dir="ltr"><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }

      if (!line.trim()) {
        flushList();
        i += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushList();
        const level = Math.min(heading[1].length + 2, 6);
        const body = heading[2].trim();
        out.push(`<h${level} ${dirAttr(body)}>${inline(body)}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        flushList();
        out.push('<hr>');
        i += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        flushList();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        const body = buf.join(' ').trim();
        out.push(`<blockquote ${dirAttr(body)}>${inline(body)}</blockquote>`);
        continue;
      }

      if (isTableStart(lines, i)) {
        flushList();
        const header = cellsOf(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cellsOf(lines[i++]));
        out.push(tableHtml(header, rows));
        continue;
      }

      const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (item) {
        const ordered = /\d/.test(item[1]);
        if (!list || list.ordered !== ordered) {
          flushList();
          list = { ordered, items: [] };
        }
        list.items.push(item[2]);
        i += 1;
        continue;
      }

      const buf = [line.trim()];
      i += 1;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) buf.push(lines[i++].trim());
      flushList();
      const body = buf.join(' ');
      out.push(`<p ${dirAttr(body)}>${inline(body)}</p>`);
    }

    flushList();
    return out.join('');
  }

  globalThis.HermesMarkdown = { render, rtl };
})();
