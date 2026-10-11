// Slyfox page script. Injected on toolbar click: extracts the page's visible
// text, shows the panel, and highlights cited passages. It never sees the
// API key; the background worker does all network calls.
//
// Injected with scripting.executeScript, so it is a classic script, not a module.

(() => {
  if (window.__slyfox) {
    window.__slyfox.toggle();
    return;
  }

  const ext = globalThis.browser ?? globalThis.chrome;
  const HIGHLIGHT_NAME = 'slyfox-quote';
  const HIDDEN_NOTICE_CHARS = 200;
  const HEARTBEAT_MS = 20_000;
  const ZERO_WIDTH = /[​-‍⁠﻿]/g;
  const SKIP_SELECTOR =
    'script, style, noscript, template, svg, canvas, iframe, nav, aside, button, select, textarea, input, [contenteditable=""], [contenteditable="true"], #slyfox-host';

  const STEPS = [
    ['extract', 'Reading the page'],
    ['scrub', 'Removing personal details'],
    ['screen', 'Checking for hidden instructions'],
    ['analyze', 'Analyzing the terms'],
    ['verify', 'Checking every quote against the page'],
  ];

  // ---------- Extraction ----------

  function pickRoot() {
    const bodyLength = (document.body.innerText || '').length;
    let best = null;
    let bestLength = 0;
    for (const el of document.querySelectorAll('main, article, [role="main"]')) {
      const length = (el.innerText || '').length;
      if (length > bestLength) {
        best = el;
        bestLength = length;
      }
    }
    // A main/article holding under a third of the page's text is probably a widget.
    return best && bestLength >= bodyLength / 3 ? best : document.body;
  }

  const visibility = new WeakMap();

  function isVisible(el) {
    if (visibility.has(el)) return visibility.get(el);
    let visible = true;
    // Text in a closed <details> is one click away for the reader, so it counts as visible.
    const probe = el.closest('details:not([open])') ?? el;
    if (el.closest('[aria-hidden="true"], [hidden]:not(details)')) {
      visible = false;
    } else if (typeof probe.checkVisibility === 'function' && !probe.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      visible = false;
    } else {
      const style = getComputedStyle(el);
      const rect = probe.getBoundingClientRect();
      if (parseFloat(style.fontSize) < 4) visible = false;
      else if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') visible = false;
      // A zero-size box only hides its text when it also clips overflow.
      else if ((rect.width < 1 || rect.height < 1) && (style.overflow !== 'visible' || (rect.width < 1 && rect.height < 1))) visible = false;
      // Pushed off the page's top or left edge (the classic left: -9999px trick). Only negative
      // coordinates count: content further down a scrollable terms box is legitimately out of view.
      else if (rect.right + window.scrollX <= 0 || rect.bottom + window.scrollY <= -500) visible = false;
    }
    visibility.set(el, visible);
    return visible;
  }

  const blockCache = new WeakMap();

  // The nearest ancestor that isn't inline: one segment per paragraph-like block.
  function blockOf(el, root) {
    if (blockCache.has(el)) return blockCache.get(el);
    let block = el;
    while (block !== root && block.parentElement && getComputedStyle(block).display.startsWith('inline')) {
      block = block.parentElement;
    }
    blockCache.set(el, block);
    return block;
  }

  function extract() {
    const root = pickRoot();
    const blocks = new Map();
    let hiddenChars = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.replace(ZERO_WIDTH, '');
      if (!text.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR)) continue;
      // Site-wide header and footer only; a header inside an article is part of the document.
      if (root === document.body && parent.closest('header, footer')) continue;
      if (!isVisible(parent)) {
        hiddenChars += text.trim().length;
        continue;
      }
      const block = blockOf(parent, root);
      if (!blocks.has(block)) blocks.set(block, []);
      blocks.get(block).push(text);
    }

    const segments = [];
    const elements = new Map();
    for (const [el, parts] of blocks) {
      const text = parts.join('').replace(/\s+/g, ' ').trim();
      if (text.length < 2) continue;
      const id = `s${segments.length + 1}`;
      segments.push({ id, text });
      elements.set(id, el);
    }
    return { segments, elements, hiddenChars };
  }

  // ---------- Highlighting ----------

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function quotePattern(quote) {
    const words = (part) =>
      part
        .trim()
        .split(/\s+/)
        .map((w) => escapeRegExp(w).replace(/['‘’]/g, "['‘’]").replace(/["“”]/g, '["“”]'))
        .join('\\s*');
    const parts = quote
      .replace(/^["'“‘]+|["'”’]+$/g, '')
      .split(/\s*(?:\.\.\.|…)\s*/)
      .filter((p) => p.trim());
    return parts.length ? new RegExp(parts.map(words).join('[\\s\\S]*?'), 'i') : null;
  }

  function findQuoteRange(el, quote) {
    const nodes = [];
    let full = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, start: full.length });
      full += node.nodeValue;
    }
    const pattern = quotePattern(quote);
    const match = pattern && pattern.exec(full);
    if (!match) return null;
    const locate = (index) => {
      let entry = nodes[0];
      for (const n of nodes) {
        if (n.start <= index) entry = n;
        else break;
      }
      return { node: entry.node, offset: index - entry.start };
    };
    const start = locate(match.index);
    const end = locate(match.index + match[0].length - 1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
  }

  function highlight(el, quote) {
    if (!el || !el.isConnected) return;
    // Citations can point into a collapsed section; open it so the highlight is visible.
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    let range = null;
    try {
      range = findQuoteRange(el, quote);
    } catch {
      range = null;
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
    }
    try {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
      return;
    } catch {
      // No CSS Custom Highlight API here: fall back to outlining the block.
    }
    el.classList.add('slyfox-outline');
    setTimeout(() => el.classList.remove('slyfox-outline'), 2500);
  }

  function clearHighlight() {
    try {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    } catch {
      // nothing to clear
    }
  }

  // ---------- Panel ----------

  const PANEL_CSS = `
    :host {
      --bg: #ffffff; --fg: #1d1d1f; --muted: #5f6368; --line: #e3e3e6; --card: #f6f6f8;
      --high: #b3261e; --high-bg: #fdecea; --medium: #8a4b00; --medium-bg: #fff3df;
      --low: #24508f; --low-bg: #e8f0fb; --accent: #1a73e8;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #1f1f22; --fg: #ececf1; --muted: #a0a0a8; --line: #3a3a40; --card: #2a2a2e;
        --high: #ff8a80; --high-bg: #3b1f1f; --medium: #ffcc80; --medium-bg: #3a2d17;
        --low: #90caf9; --low-bg: #1b2a3d; --accent: #8ab4f8;
      }
    }
    * { box-sizing: border-box; }
    .panel {
      height: 100%; display: flex; flex-direction: column;
      background: var(--bg); color: var(--fg);
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      border-left: 1px solid var(--line); box-shadow: -8px 0 24px rgba(0, 0, 0, 0.14);
    }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--line); }
    header h1 { font-size: 15px; font-weight: 650; margin: 0; }
    .close { border: 0; background: transparent; color: var(--muted); font: 20px/1 system-ui, sans-serif; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }
    .close:hover { background: var(--card); color: var(--fg); }
    .body { flex: 1; overflow-y: auto; padding: 16px; }
    footer { padding: 10px 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
    h2 { font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 20px 0 8px; }
    h2:first-child { margin-top: 0; }
    .steps { list-style: none; margin: 0; padding: 0; }
    .steps li { position: relative; padding: 5px 0 5px 22px; color: var(--muted); }
    .steps li::before { content: ""; position: absolute; left: 3px; top: 12px; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--muted); }
    .steps li.done::before { background: var(--muted); }
    .steps li.active { color: var(--fg); font-weight: 600; }
    .steps li.active::before { border-color: var(--accent); background: var(--accent); animation: pulse 0.9s ease-in-out infinite alternate; }
    @keyframes pulse { to { opacity: 0.3; } }
    .notice { border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; background: var(--card); font-size: 13px; }
    .notice.warn { background: var(--medium-bg); }
    .notice.critical { background: var(--high-bg); border-left: 3px solid var(--high); }
    .notice q { display: block; margin-top: 4px; font-style: italic; color: var(--muted); }
    .summary { margin: 0; padding-left: 18px; }
    .summary li { margin-bottom: 4px; }
    .flag { background: var(--card); border-radius: 8px; padding: 12px; margin-bottom: 10px; }
    .flag-head { display: flex; align-items: baseline; gap: 8px; }
    .flag h3 { font-size: 14px; font-weight: 650; margin: 0; }
    .flag p { margin: 6px 0 0; }
    .badge { flex: none; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 1px 6px; border-radius: 4px; }
    .badge.high { color: var(--high); background: var(--high-bg); }
    .badge.medium { color: var(--medium); background: var(--medium-bg); }
    .badge.low { color: var(--low); background: var(--low-bg); }
    .cite {
      display: block; width: 100%; margin-top: 8px; padding: 2px 0 2px 10px; text-align: left; cursor: pointer;
      border: 0; border-left: 2px solid var(--line); background: transparent;
      color: var(--muted); font: italic 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .cite:hover, .cite:focus-visible { border-left-color: var(--accent); color: var(--fg); outline: none; }
    .empty { color: var(--muted); }
    .meta { margin-top: 16px; font-size: 12px; color: var(--muted); }
    .error { margin: 0 0 12px; }
    .actions { display: flex; gap: 8px; }
    .actions button {
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 8px 12px; border-radius: 6px; cursor: pointer;
      border: 1px solid var(--line); background: transparent; color: var(--fg);
    }
    .actions button.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  `;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    // Model output is untrusted: it only ever enters the DOM as text nodes.
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  function createPanel() {
    const host = document.createElement('div');
    host.id = 'slyfox-host';
    host.style.cssText =
      'all: initial; position: fixed; top: 0; right: 0; width: 400px; max-width: 100vw; height: 100vh; z-index: 2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PANEL_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      // Constructable stylesheets can fail across Firefox's content-script boundary.
      const style = document.createElement('style');
      style.textContent = PANEL_CSS;
      shadow.append(style);
    }
    const body = el('div', { class: 'body' });
    shadow.append(
      el(
        'aside',
        { class: 'panel', 'aria-label': 'Slyfox terms analysis' },
        el(
          'header',
          {},
          el('h1', {}, 'Slyfox'),
          el('button', { class: 'close', type: 'button', 'aria-label': 'Close Slyfox', onclick: destroy }, '×'),
        ),
        body,
        el(
          'footer',
          {},
          "Not legal advice. Slyfox points out clauses worth reading; it can miss things, and an empty list doesn't mean the terms are fair.",
        ),
      ),
    );
    document.documentElement.append(host);
    return { host, body };
  }

  // ---------- State and rendering ----------

  const pageKey = () => location.origin + location.pathname + location.search;
  const startKey = pageKey();
  const panel = createPanel();
  let segmentElements = new Map();
  let port = null;
  let heartbeat = null;

  function render(...children) {
    panel.body.replaceChildren(...children.flat().filter(Boolean));
  }

  function renderProgress(step) {
    const current = STEPS.findIndex(([id]) => id === step);
    render(
      el('h2', {}, 'Analyzing'),
      el(
        'ul',
        { class: 'steps' },
        STEPS.map(([, label], i) => el('li', { class: i < current ? 'done' : i === current ? 'active' : '' }, label)),
      ),
    );
  }

  function renderError(result) {
    const actions = el('div', { class: 'actions' });
    if (result.code === 'no_key' || result.code === 'bad_key' || result.code === 'model_unavailable') {
      actions.append(el('button', { class: 'primary', type: 'button', onclick: () => ext.runtime.sendMessage({ type: 'open-options' }) }, 'Open settings'));
    }
    if (!['no_terms', 'too_long', 'too_many_tokens'].includes(result.code)) {
      actions.append(el('button', { type: 'button', onclick: run }, 'Try again'));
    }
    render(el('p', { class: 'error' }, result.message), actions);
  }

  function citationButton(segmentId, quote) {
    const label = quote.length > 160 ? `${quote.slice(0, 157)}…` : quote;
    return el(
      'button',
      { class: 'cite', type: 'button', title: 'Show on the page', onclick: () => highlight(segmentElements.get(segmentId), quote) },
      `“${label}”`,
    );
  }

  function renderResult(result) {
    const notices = [];
    if (result.injection.detected) {
      notices.push(
        el(
          'div',
          { class: 'notice critical', role: 'alert' },
          el('strong', {}, 'This page contains text aimed at AI tools. '),
          'It may be trying to change how its terms are summarized. Read the flagged clauses yourself.',
          result.injection.evidence ? el('q', {}, result.injection.evidence) : null,
        ),
      );
    } else if (!result.injection.checked) {
      notices.push(el('div', { class: 'notice warn' }, "The check for hidden instructions didn't run for this page."));
    }
    if (result.hiddenChars >= HIDDEN_NOTICE_CHARS) {
      notices.push(
        el('div', { class: 'notice warn' }, `${result.hiddenChars.toLocaleString()} characters of hidden text on this page were ignored.`),
      );
    }
    if (result.redactions > 0) {
      notices.push(
        el('div', { class: 'notice' }, `${result.redactions} personal detail${result.redactions === 1 ? ' was' : 's were'} removed before sending.`),
      );
    }

    const flags = result.flags.length
      ? result.flags.map((flag) =>
          el(
            'article',
            { class: 'flag' },
            el('div', { class: 'flag-head' }, el('span', { class: `badge ${flag.severity}` }, flag.severity), el('h3', {}, flag.title)),
            el('p', {}, flag.explanation),
            flag.citations.map((c) => citationButton(c.segmentId, c.quote)),
          ),
        )
      : [el('p', { class: 'empty' }, 'No items from our checklist were found.')];

    const { stats } = result;
    render(
      notices,
      result.summary.length ? [el('h2', {}, 'Summary'), el('ul', { class: 'summary' }, result.summary.map((s) => el('li', {}, s)))] : null,
      el('h2', {}, `Flags (${result.flags.length})`),
      flags,
      el(
        'p',
        { class: 'meta' },
        `${stats.model} · reasoning ${stats.reasoning}`,
        stats.droppedCitations ? ` · ${stats.droppedCitations} citation${stats.droppedCitations === 1 ? '' : 's'} removed because the quote wasn't on the page` : '',
      ),
    );
  }

  function stopPort() {
    clearInterval(heartbeat);
    heartbeat = null;
    if (port) {
      const old = port;
      port = null;
      old.disconnect();
    }
  }

  function run() {
    stopPort();
    clearHighlight();
    renderProgress('extract');
    const { segments, elements, hiddenChars } = extract();
    segmentElements = elements;

    let finished = false;
    const current = ext.runtime.connect({ name: 'slyfox' });
    port = current;
    heartbeat = setInterval(() => current.postMessage({ type: 'ping' }), HEARTBEAT_MS);
    current.onMessage.addListener((msg) => {
      if (msg?.type === 'progress') {
        renderProgress(msg.step);
      } else if (msg?.type === 'result') {
        finished = true;
        stopPort();
        if (msg.result.status === 'ok') renderResult(msg.result);
        else renderError(msg.result);
      }
    });
    current.onDisconnect.addListener(() => {
      if (port !== current) return;
      port = null;
      clearInterval(heartbeat);
      if (!finished) renderError({ code: 'internal', message: 'Lost the connection to Slyfox before the analysis finished.' });
    });
    current.postMessage({ type: 'analyze', segments, hiddenChars });
  }

  // The panel belongs to this page: navigating away, including in single-page apps, removes it.
  const navigationWatch = setInterval(() => {
    if (pageKey() !== startKey) destroy();
  }, 1000);

  function destroy() {
    clearInterval(navigationWatch);
    stopPort();
    clearHighlight();
    panel.host.remove();
    delete window.__slyfox;
  }

  window.__slyfox = { toggle: destroy };
  run();
})();
