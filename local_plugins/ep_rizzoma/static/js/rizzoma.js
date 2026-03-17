/**
 * ep_rizzoma - Rizzoma-inspired features for Etherpad
 *
 * Toolbar buttons:
 *   💬  Open a thread sub-pad for the current line in a floating iframe
 *   ☐   Insert / toggle a [ ] / [x] task marker on the current line
 *
 * Thread model: each thread is a real Etherpad pad named
 *   thread--<padId>--line<N>
 * opened in a draggable floating iframe. Multiple threads can be layered.
 *
 * Task display: aceCreateDomLine hook prepends a read-only ☐/☑ span.
 *
 * Rules:
 *   - Never write to ace_inner's contenteditable DOM from outside Etherpad hooks
 *   - Inside callWithAce callbacks, methods are ace_-prefixed on editorInfo
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
  font-size: 17px; line-height: 1; cursor: pointer;
  padding: 0 6px; background: transparent; border: none;
  vertical-align: middle; opacity: 0.75; transition: opacity .1s;
}
.rz-toolbar-btn:hover { opacity: 1; }

/* Floating thread iframes */
.rz-thread-win {
  position: fixed;
  width: 480px; height: 400px;
  border: 2px solid #4a90d9; border-radius: 6px;
  background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.25);
  z-index: 10000; display: flex; flex-direction: column;
  resize: both; overflow: hidden; min-width: 300px; min-height: 200px;
}
.rz-thread-titlebar {
  background: #4a90d9; color: #fff; padding: 6px 10px;
  display: flex; align-items: center; justify-content: space-between;
  cursor: move; user-select: none; flex-shrink: 0; font-size: 13px;
  font-family: sans-serif;
}
.rz-thread-titlebar span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rz-thread-close {
  background: transparent; border: none; color: #fff;
  font-size: 18px; cursor: pointer; padding: 0 4px; flex-shrink: 0;
}
.rz-thread-win iframe {
  flex: 1; width: 100%; border: none;
}
`;

const INNER_CSS = `
.rz-cb { cursor: pointer; margin-right: 4px; user-select: none; font-size: 1em; }
.rz-task-done { text-decoration: line-through; color: #999; }
`;

// ── Thread windows (floating iframe sub-pads) ─────────────────────────────────

let threadCount = 0;

function openThreadPad(padId, lineNum) {
  const threadPadId = 'thread--' + padId.replace(/[^a-zA-Z0-9_-]/g, '_') + '--line' + lineNum;
  const threadUrl = '/p/' + encodeURIComponent(threadPadId);

  // Cascade new windows slightly
  const offset = (threadCount % 8) * 28;
  threadCount++;

  const win = document.createElement('div');
  win.className = 'rz-thread-win';
  win.style.right = (20 + offset) + 'px';
  win.style.bottom = (20 + offset) + 'px';

  const titlebar = document.createElement('div');
  titlebar.className = 'rz-thread-titlebar';
  titlebar.innerHTML =
    '<span>\ud83d\udcac Thread: line ' + (lineNum + 1) + '</span>' +
    '<button class="rz-thread-close" title="Close">\xd7</button>';

  const frame = document.createElement('iframe');
  frame.src = threadUrl;
  frame.title = 'Thread for line ' + (lineNum + 1);

  win.appendChild(titlebar);
  win.appendChild(frame);
  document.body.appendChild(win);

  // Close button
  titlebar.querySelector('.rz-thread-close').addEventListener('click', () => {
    win.remove();
    threadCount = Math.max(0, threadCount - 1);
  });

  // Drag to move
  makeDraggable(win, titlebar);

  // Bring to front on click
  win.addEventListener('mousedown', () => {
    const maxZ = Math.max(10000, ...Array.from(
      document.querySelectorAll('.rz-thread-win')
    ).map((el) => parseInt(el.style.zIndex || '10000', 10)));
    win.style.zIndex = maxZ + 1;
  }, true);
}

function makeDraggable(el, handle) {
  let startX, startY, startRight, startBottom;

  const onMouseMove = (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.right = Math.max(0, startRight - dx) + 'px';
    el.style.bottom = Math.max(0, startBottom - dy) + 'px';
    el.style.left = 'auto';
    el.style.top = 'auto';
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  handle.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('rz-thread-close')) return;
    startX = e.clientX;
    startY = e.clientY;
    startRight = parseInt(el.style.right || '20', 10);
    startBottom = parseInt(el.style.bottom || '20', 10);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });
}

// ── Toolbar buttons ───────────────────────────────────────────────────────────

exports.postToolbarInit = (hookName, {toolbar, ace}) => {
  const $ = window.$;

  // ── Thread button ──────────────────────────────────────────────────────────
  toolbar.registerCommand('rzThread', () => {
    const padId = (window.clientVars && window.clientVars.padId) || 'pad';
    let lineNum = 0;
    ace.callWithAce((editorInfo) => {
      const rep = editorInfo.ace_getRep();
      if (rep && rep.selStart) lineNum = rep.selStart[0];
    }, 'rzGetLine');
    openThreadPad(padId, lineNum);
  });

  // ── Task button ────────────────────────────────────────────────────────────
  toolbar.registerCommand('rzTask', () => {
    ace.callWithAce((editorInfo) => {
      const rep = editorInfo.ace_getRep();
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

      editorInfo.ace_performDocumentReplaceRange(
        [lineNum, 0], [lineNum, lineText.length], newText
      );
    }, 'rzTask', true);
  });

  // ── Inject buttons into toolbar ───────────────────────────────────────────
  const threadBtn = $(
    '<li title="Open thread sub-pad for current line">' +
    '<button class="rz-toolbar-btn" aria-label="Thread">&#x1F4AC;</button></li>'
  );
  const taskBtn = $(
    '<li title="Insert/toggle task marker on current line">' +
    '<button class="rz-toolbar-btn" aria-label="Task">&#x2610;</button></li>'
  );

  $('.menu_left').append('<li class="separator"></li>').append(threadBtn).append(taskBtn);

  threadBtn.on('click', () => toolbar.triggerCommand('rzThread'));
  taskBtn.on('click', () => toolbar.triggerCommand('rzTask'));
};

// ── aceCreateDomLine: render task checkboxes ──────────────────────────────────

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

// ── postAceInit: inject CSS ───────────────────────────────────────────────────

exports.postAceInit = (hookName, {ace}) => {
  injectCSS(document, OUTER_CSS);
  const tryInner = (n) => {
    if (n > 30) return;
    const outer = document.querySelector('iframe[name="ace_outer"]');
    if (!outer || !outer.contentDocument) return setTimeout(() => tryInner(n + 1), 250);
    const inner = outer.contentDocument.querySelector('iframe[name="ace_inner"]');
    if (!inner || !inner.contentDocument || !inner.contentDocument.head) return setTimeout(() => tryInner(n + 1), 250);
    injectCSS(inner.contentDocument, INNER_CSS);
  };
  tryInner(0);
};
