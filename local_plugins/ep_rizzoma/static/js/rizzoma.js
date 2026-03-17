/**
 * ep_rizzoma - Rizzoma-inspired features for Etherpad
 *
 * Toolbar buttons:
 *   💬  Open thread sub-pad for current line (floating iframe)
 *   ☐   Insert / toggle [ ] / [x] task marker
 *
 * Thread pads: named  thread--<padId>--line<N>
 *   - Open as draggable/resizable floating iframe
 *   - Maximize button (⬜/⬛) to fill the viewport
 *   - Also openable in a new browser window
 *   - Thread pads receive ?rzParent=<padId>&rzLine=<N> and show a back-link
 *
 * Thread indicator: augments existing span.line-number in ace_inner —
 *   thread lines show "N 💬" in blue and are clickable.
 */

'use strict';

// ── CSS ───────────────────────────────────────────────────────────────────────

function injectCSS(doc, css) {
  if (!doc || !doc.head) return;
  const s = doc.createElement('style');
  s.textContent = css;
  doc.head.appendChild(s);
}

const OUTER_CSS = `
.rz-toolbar-btn {
  font-size: 17px; line-height: 1; cursor: pointer; padding: 0 6px;
  background: transparent; border: none; vertical-align: middle;
  opacity: 0.75; transition: opacity .1s;
}
.rz-toolbar-btn:hover { opacity: 1; }

/* Floating thread windows */
.rz-thread-win {
  position: fixed; width: 480px; height: 400px;
  border: 2px solid #4a90d9; border-radius: 6px; background: #fff;
  box-shadow: 0 8px 32px rgba(0,0,0,.25); z-index: 10000;
  display: flex; flex-direction: column;
  resize: both; overflow: hidden; min-width: 280px; min-height: 180px;
}
.rz-thread-titlebar {
  background: #4a90d9; color: #fff; padding: 5px 8px;
  display: flex; align-items: center; justify-content: space-between;
  cursor: move; user-select: none; flex-shrink: 0;
  font-size: 13px; font-family: sans-serif; gap: 6px;
}
.rz-thread-titlebar span { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rz-thread-titlebar-btns { display: flex; gap: 4px; flex-shrink: 0; }
.rz-thread-titlebar-btns button {
  background: transparent; border: 1px solid rgba(255,255,255,.4); color: #fff;
  border-radius: 3px; cursor: pointer; font-size: 13px; padding: 1px 5px; line-height: 1.2;
}
.rz-thread-titlebar-btns button:hover { background: rgba(255,255,255,.2); }
.rz-thread-win iframe { flex: 1; width: 100%; border: none; }

/* Parent back-link banner (shown in thread pads) */
#rz-parent-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
  background: #4a90d9; color: #fff; padding: 6px 14px;
  font-family: sans-serif; font-size: 13px;
  display: flex; align-items: center; gap: 10px;
}
#rz-parent-banner a { color: #fff; font-weight: bold; text-decoration: underline; }
#rz-parent-banner-close {
  margin-left: auto; background: transparent; border: none;
  color: #fff; font-size: 16px; cursor: pointer;
}
`;

const INNER_CSS = `
.rz-cb { cursor: pointer; margin-right: 4px; user-select: none; }
.rz-task-done { text-decoration: line-through; color: #999; }
/* Thread line numbers get highlighted in the existing line-number span */
span.line-number[data-rz-thread] {
  color: #4a90d9 !important; font-weight: bold; cursor: pointer;
}
span.line-number[data-rz-thread]:hover { background: rgba(74,144,217,.15); border-radius: 2px; }
`;

// ── Module-level state ────────────────────────────────────────────────────────

let threadLineSet = new Set();
let currentPadId = '';
let aceInnerFrameRef = null;
let rafPending = null;

// ── Thread windows ────────────────────────────────────────────────────────────

let threadCount = 0;

function threadPadId(padId, lineNum) {
  return 'thread--' + padId.replace(/[^a-zA-Z0-9_-]/g, '_') + '--line' + lineNum;
}

function threadUrl(padId, lineNum) {
  const tPadId = threadPadId(padId, lineNum);
  const params = new URLSearchParams({
    rzParent: padId,
    rzLine: String(lineNum),
  });
  return '/p/' + encodeURIComponent(tPadId) + '?' + params.toString();
}

function openThreadPad(padId, lineNum) {
  const url = threadUrl(padId, lineNum);
  const offset = (threadCount % 8) * 28;
  threadCount++;

  const win = document.createElement('div');
  win.className = 'rz-thread-win';
  win.style.right = (20 + offset) + 'px';
  win.style.bottom = (20 + offset) + 'px';

  const titlebar = document.createElement('div');
  titlebar.className = 'rz-thread-titlebar';

  const label = document.createElement('span');
  label.textContent = '\ud83d\udcac Thread \u2014 line ' + (lineNum + 1);

  const btns = document.createElement('div');
  btns.className = 'rz-thread-titlebar-btns';

  const maximizeBtn = document.createElement('button');
  maximizeBtn.title = 'Maximize';
  maximizeBtn.textContent = '\u2b1c'; // ⬜
  let isMaximized = false;
  maximizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isMaximized = !isMaximized;
    if (isMaximized) {
      win.dataset.rzRight = win.style.right;
      win.dataset.rzBottom = win.style.bottom;
      win.dataset.rzWidth = win.style.width || '480px';
      win.dataset.rzHeight = win.style.height || '400px';
      Object.assign(win.style, {
        right: '0', bottom: '0', top: '0', left: '0',
        width: '100vw', height: '100vh',
        resize: 'none', borderRadius: '0',
      });
      maximizeBtn.textContent = '\u2b1b'; // ⬛ restore
      maximizeBtn.title = 'Restore';
    } else {
      Object.assign(win.style, {
        right: win.dataset.rzRight || (20 + offset) + 'px',
        bottom: win.dataset.rzBottom || (20 + offset) + 'px',
        width: win.dataset.rzWidth || '480px',
        height: win.dataset.rzHeight || '400px',
        top: 'auto', left: 'auto',
        resize: 'both', borderRadius: '6px',
      });
      maximizeBtn.textContent = '\u2b1c';
      maximizeBtn.title = 'Maximize';
    }
  });

  const newWinBtn = document.createElement('button');
  newWinBtn.title = 'Open in new window';
  newWinBtn.textContent = '\u2197'; // ↗
  newWinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(url, '_blank', 'width=700,height=500,resizable=yes');
  });

  const closeBtn = document.createElement('button');
  closeBtn.title = 'Close';
  closeBtn.textContent = '\xd7';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    win.remove();
    threadCount = Math.max(0, threadCount - 1);
  });

  btns.appendChild(maximizeBtn);
  btns.appendChild(newWinBtn);
  btns.appendChild(closeBtn);
  titlebar.appendChild(label);
  titlebar.appendChild(btns);

  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = 'Thread for line ' + (lineNum + 1);

  win.appendChild(titlebar);
  win.appendChild(frame);
  document.body.appendChild(win);

  makeDraggable(win, titlebar);
  win.addEventListener('mousedown', () => bringToFront(win), true);

  threadLineSet.add(lineNum);
  scheduleUpdateLineNumbers();
}

function bringToFront(el) {
  const others = document.querySelectorAll('.rz-thread-win');
  const maxZ = Array.from(others).reduce((m, w) => Math.max(m, parseInt(w.style.zIndex || '10000', 10)), 10000);
  el.style.zIndex = maxZ + 1;
}

function makeDraggable(el, handle) {
  let startX, startY, startRight, startBottom;
  const onMove = (e) => {
    el.style.right = Math.max(0, startRight - (e.clientX - startX)) + 'px';
    el.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + 'px';
    el.style.left = 'auto'; el.style.top = 'auto';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  handle.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    if (el.style.width === '100vw') return;
    startX = e.clientX; startY = e.clientY;
    startRight = parseInt(el.style.right || '20', 10);
    startBottom = parseInt(el.style.bottom || '20', 10);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// ── Thread indicators in existing span.line-number elements ───────────────────

function setupLineNumbers(aceInnerFrame) {
  aceInnerFrameRef = aceInnerFrame;
  try {
    aceInnerFrame.contentDocument.addEventListener('scroll', scheduleUpdateLineNumbers, {passive: true});
  } catch (_) {}
  window.addEventListener('resize', scheduleUpdateLineNumbers);
  scheduleUpdateLineNumbers();
}

function scheduleUpdateLineNumbers() {
  if (rafPending) return;
  rafPending = requestAnimationFrame(() => {
    rafPending = null;
    updateLineNumbers();
  });
}

function updateLineNumbers() {
  if (!aceInnerFrameRef) return;
  const innerDoc = aceInnerFrameRef.contentDocument;
  if (!innerDoc) return;

  // Clear previous thread annotations
  innerDoc.querySelectorAll('span.line-number[data-rz-thread]').forEach((span) => {
    span.textContent = span.dataset.rzOrig;
    delete span.dataset.rzThread;
    delete span.dataset.rzOrig;
    span.onclick = null;
  });

  if (threadLineSet.size === 0) return;

  innerDoc.querySelectorAll('.ace-line').forEach((line, idx) => {
    if (!threadLineSet.has(idx)) return;
    const numSpan = line.querySelector('span.line-number');
    if (!numSpan) return;
    numSpan.dataset.rzOrig = numSpan.textContent;
    numSpan.dataset.rzThread = '1';
    numSpan.textContent = numSpan.textContent.trim() + ' \ud83d\udcac';
    numSpan.onclick = (e) => { e.stopPropagation(); openThreadPad(currentPadId, idx); };
  });
}

// ── Fetch existing thread lines from server ───────────────────────────────────

async function loadThreadLines(padId) {
  try {
    const r = await fetch('/rizzoma/thread-lines/' + encodeURIComponent(padId));
    const data = await r.json();
    threadLineSet = new Set((data.lines || []).map(Number));
    scheduleUpdateLineNumbers();
  } catch (_) {}
}

// ── Parent back-link banner (shown when pad opened as a thread) ───────────────

function maybeShowParentBanner() {
  // Prefer URL params (exact original padId), fall back to parsing the pad name itself.
  // Thread pads are named  thread--<sanitisedParentId>--line<N>  so we can always
  // detect the parent without requiring the caller to pass query params.
  const params = new URLSearchParams(window.location.search);
  let parentPad = params.get('rzParent');
  let line = params.get('rzLine');

  if (!parentPad) {
    const padId = (window.clientVars && window.clientVars.padId) || '';
    const m = padId.match(/^thread--(.+)--line(\d+)$/);
    if (m) {
      parentPad = m[1];
      line = m[2];
    }
  }

  if (!parentPad) return;

  const banner = document.createElement('div');
  banner.id = 'rz-parent-banner';
  const lineLabel = line !== null ? ' (line ' + (parseInt(line, 10) + 1) + ')' : '';
  banner.innerHTML =
    '\ud83d\udcac Thread for: <a href="/p/' + encodeURIComponent(parentPad) +
    '" target="_blank">' + esc(parentPad) + lineLabel + '</a>' +
    '<button id="rz-parent-banner-close" title="Dismiss">\xd7</button>';

  if (document.body) {
    document.body.prepend(banner);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.prepend(banner));
  }
  document.getElementById('rz-parent-banner-close').addEventListener('click', () => banner.remove());
}

// ── Toolbar buttons ───────────────────────────────────────────────────────────

exports.postToolbarInit = (hookName, {toolbar, ace}) => {
  const $ = window.$;

  toolbar.registerCommand('rzThread', () => {
    let lineNum = 0;
    ace.callWithAce((ei) => {
      const rep = ei.ace_getRep();
      if (rep && rep.selStart) lineNum = rep.selStart[0];
    }, 'rzGetLine');
    openThreadPad(currentPadId, lineNum);
  });

  toolbar.registerCommand('rzTask', () => {
    ace.callWithAce((ei) => {
      const rep = ei.ace_getRep();
      if (!rep || !rep.selStart) return;
      const lineNum = rep.selStart[0];
      const lineText = rep.lines.atIndex(lineNum).text;
      let newText;
      if (/^\[[xX]\] /.test(lineText)) {
        newText = '[ ] ' + lineText.replace(/^\[[xX]\] /, '');
      } else if (/^\[ \] /.test(lineText)) {
        newText = '[x] ' + lineText.replace(/^\[ \] /, '');
      } else {
        newText = '[ ] ' + lineText;
      }
      ei.ace_performDocumentReplaceRange([lineNum, 0], [lineNum, lineText.length], newText);
    }, 'rzTask', true);
  });

  const threadBtn = $(
    '<li title="Open thread sub-pad for current line">' +
    '<button class="rz-toolbar-btn" aria-label="Thread">&#x1F4AC;</button></li>'
  );
  const taskBtn = $(
    '<li title="Insert/toggle task marker">' +
    '<button class="rz-toolbar-btn" aria-label="Task">&#x2610;</button></li>'
  );
  $('.menu_left').append('<li class="separator"></li>').append(threadBtn).append(taskBtn);
  threadBtn.on('click', () => toolbar.triggerCommand('rzThread'));
  taskBtn.on('click', () => toolbar.triggerCommand('rzTask'));
};

// ── postAceInit ───────────────────────────────────────────────────────────────

exports.postAceInit = (hookName, {ace}) => {
  injectCSS(document, OUTER_CSS);
  maybeShowParentBanner();

  currentPadId = (window.clientVars && window.clientVars.padId) || '';
  if (currentPadId) loadThreadLines(currentPadId);

  const trySetup = (n) => {
    if (n > 30) return;
    const outer = document.querySelector('iframe[name="ace_outer"]');
    if (!outer || !outer.contentDocument) return setTimeout(() => trySetup(n + 1), 250);
    const inner = outer.contentDocument.querySelector('iframe[name="ace_inner"]');
    if (!inner || !inner.contentDocument || !inner.contentDocument.head) return setTimeout(() => trySetup(n + 1), 250);
    injectCSS(inner.contentDocument, INNER_CSS);
    setupLineNumbers(inner);
  };
  trySetup(0);
};

// ── aceCreateDomLine: task checkbox ──────────────────────────────────────────

exports.aceCreateDomLine = (hookName, args) => {
  const lineNode = args.domline && args.domline.lineNode;
  if (!lineNode) return [];
  const text = lineNode.textContent || '';
  if (!/^\[[ xX]\] /.test(text)) return [];
  const done = /^\[[xX]\] /.test(text);
  return [{
    extraOpenTags: '<span class="rz-cb">' + (done ? '\u2611' : '\u2610') + '</span>',
    extraCloseTags: '',
    cls: args.cls + (done ? ' rz-task-done' : ''),
  }];
};

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
