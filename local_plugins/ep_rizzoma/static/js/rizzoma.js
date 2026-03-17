/**
 * ep_rizzoma - Rizzoma-inspired features for Etherpad
 *
 * Toolbar buttons:
 *   💬  Open discussion thread anchored to the current line
 *   ☐   Insert / toggle a task marker on the current line
 *
 * Thread panel:  slide-in sidebar in the outer pad frame
 * Task display:  aceCreateDomLine hook adds a read-only checkbox span
 *
 * Rules to keep Etherpad sane:
 *   - Never modify ace_inner's contenteditable DOM from outside Etherpad hooks
 *   - CSS is injected dynamically into each frame that needs it
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
/* Rizzoma toolbar buttons */
.rz-toolbar-btn {
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  padding: 0 6px;
  background: transparent;
  border: none;
  vertical-align: middle;
  opacity: 0.75;
  transition: opacity .1s;
}
.rz-toolbar-btn:hover { opacity: 1; }

/* Thread panel */
#rz-thread-panel {
  position: fixed; right: 0; top: 0; bottom: 0; width: 320px;
  background: #fff; border-left: 2px solid #4a90d9;
  box-shadow: -4px 0 16px rgba(0,0,0,.15);
  display: none; flex-direction: column; z-index: 10000;
  font-family: sans-serif; font-size: 14px;
}
#rz-thread-panel.rz-visible { display: flex; }
#rz-thread-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: #4a90d9; color: #fff;
}
#rz-thread-close {
  background: transparent; border: none; color: #fff;
  font-size: 18px; cursor: pointer; padding: 0 4px;
}
#rz-thread-messages { flex: 1; overflow-y: auto; padding: 12px 16px; }
.rz-reply { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #eee; }
.rz-reply-author { font-weight: bold; color: #4a90d9; }
.rz-reply-time { font-size: 11px; color: #888; margin-left: 8px; }
.rz-reply p { margin: 4px 0 0; }
#rz-thread-input-area {
  padding: 12px 16px; border-top: 1px solid #ddd;
  display: flex; flex-direction: column; gap: 8px;
}
#rz-thread-input {
  width: 100%; box-sizing: border-box; border: 1px solid #ccc;
  border-radius: 4px; padding: 6px 8px; resize: vertical; font-size: 13px;
}
#rz-thread-send {
  align-self: flex-end; background: #4a90d9; color: #fff;
  border: none; border-radius: 4px; padding: 6px 16px; cursor: pointer;
}
#rz-thread-send:hover { background: #357abd; }
`;

const INNER_CSS = `
/* Task checkboxes added by aceCreateDomLine — these are outside the editable span */
.rz-cb {
  cursor: default;
  margin-right: 4px;
  user-select: none;
  font-size: 1em;
}
.rz-task-line .rz-cb { cursor: pointer; }
`;

// ── Thread panel ──────────────────────────────────────────────────────────────

let threadPanel = null;

function getThreadPanel() {
  if (threadPanel) return threadPanel;
  const $ = window.$;
  threadPanel = document.createElement('div');
  threadPanel.id = 'rz-thread-panel';
  threadPanel.innerHTML =
    '<div id="rz-thread-header"><strong>Discussion thread</strong>' +
    '<button id="rz-thread-close" title="Close">\xd7</button></div>' +
    '<div id="rz-thread-messages"></div>' +
    '<div id="rz-thread-input-area">' +
    '<textarea id="rz-thread-input" rows="3" placeholder="Reply\u2026"></textarea>' +
    '<button id="rz-thread-send">Send</button></div>';
  document.body.appendChild(threadPanel);
  document.getElementById('rz-thread-close').addEventListener('click', closeThread);
  document.getElementById('rz-thread-send').addEventListener('click', sendReply);
  return threadPanel;
}

function openThread(lineKey) {
  const panel = getThreadPanel();
  panel.querySelector('#rz-thread-header strong').textContent =
    'Thread: line ' + (lineKey || '?');
  const box = panel.querySelector('#rz-thread-messages');
  box.innerHTML = '<em>No replies yet. Start the discussion below.</em>';
  panel.classList.add('rz-visible');

  const padId = window.clientVars && window.clientVars.padId;
  if (!padId) return;
  fetch('/rizzoma/threads/' + encodeURIComponent(padId))
    .then((r) => r.json())
    .then((data) => {
      const thread = (data.threads || []).find((t) => t.id === lineKey);
      if (!thread || !thread.replies || !thread.replies.length) return;
      box.innerHTML = thread.replies.map((r) =>
        '<div class="rz-reply"><span class="rz-reply-author">' + esc(r.author) +
        '</span><span class="rz-reply-time">' + new Date(r.time).toLocaleString() +
        '</span><p>' + esc(r.text) + '</p></div>'
      ).join('');
    })
    .catch(() => {});
}

function closeThread() {
  if (threadPanel) threadPanel.classList.remove('rz-visible');
}

function sendReply() {
  const input = document.getElementById('rz-thread-input');
  if (!input || !input.value.trim()) return;
  // TODO: persist via REST
  input.value = '';
}

// ── Toolbar buttons ───────────────────────────────────────────────────────────

exports.postToolbarInit = (hookName, {toolbar, ace}) => {
  const $ = window.$;

  // ── Thread button ──────────────────────────────────────────────────────────
  toolbar.registerCommand('rzThread', () => {
    // Get current line number from the ace editor to use as thread key
    let lineKey = 'line-0';
    try {
      ace.callWithAce((innerAce) => {
        const rep = innerAce.getRep();
        lineKey = 'line-' + (rep.selStart ? rep.selStart[0] : 0);
      }, 'rzGetLine');
    } catch (_) {}
    openThread(lineKey);
  });

  // ── Task button ────────────────────────────────────────────────────────────
  toolbar.registerCommand('rzTask', () => {
    ace.callWithAce((innerAce) => {
      const rep = innerAce.getRep();
      if (!rep.selStart) return;
      const lineNum = rep.selStart[0];
      const lineText = rep.lines.atIndex(lineNum).text;

      let newText;
      if (/^\[x\] /i.test(lineText)) {
        newText = '[ ] ' + lineText.replace(/^\[[xX]\] /, '');
      } else if (/^\[ \] /.test(lineText)) {
        newText = '[x] ' + lineText.replace(/^\[ \] /, '');
      } else {
        newText = '[ ] ' + lineText;
      }

      const lineLen = lineText.length;
      innerAce.performDocumentReplaceRange(
        [lineNum, 0], [lineNum, lineLen], newText
      );
    }, 'rzTask', true);
  });

  // ── Inject button HTML into toolbar ───────────────────────────────────────
  // postToolbarInit fires AFTER the initial [data-key] click bindings,
  // so we add our own click handlers explicitly.
  const sep = $('<li class="separator"></li>');
  const threadBtn = $(
    '<li title="Open discussion thread for current line">' +
    '<button class="rz-toolbar-btn" aria-label="Thread">&#x1F4AC;</button></li>'
  );
  const taskBtn = $(
    '<li title="Insert / toggle task on current line">' +
    '<button class="rz-toolbar-btn" aria-label="Task">&#x2610;</button></li>'
  );

  $('.menu_left').append(sep).append(threadBtn).append(taskBtn);

  threadBtn.on('click', () => toolbar.triggerCommand('rzThread'));
  taskBtn.on('click', () => toolbar.triggerCommand('rzTask'));
};

// ── aceCreateDomLine: visual task checkbox in the inner editor ────────────────
// This hook runs inside the ace_inner frame and lets us prepend a read-only
// element to each rendered line without touching the contenteditable content.

exports.aceCreateDomLine = (hookName, args) => {
  const lineNode = args.domline && args.domline.lineNode;
  if (!lineNode) return [];

  const text = lineNode.textContent || '';
  const isTask = /^\[ \] /.test(text) || /^\[[xX]\] /.test(text);
  if (!isTask) return [];

  const done = /^\[[xX]\] /.test(text);
  return [{
    extraOpenTags:
      '<span class="rz-cb">' + (done ? '\u2611' : '\u2610') + '</span>',
    extraCloseTags: '',
    cls: args.cls + (done ? ' rz-task-done' : ''),
  }];
};

// ── postAceInit: inject CSS into inner frame ──────────────────────────────────

exports.postAceInit = (hookName, {ace}) => {
  injectCSS(document, OUTER_CSS);

  // Inject CSS into ace_inner for task display
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

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
