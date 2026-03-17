/**
 * ep_rizzoma - Client-side Rizzoma-inspired features
 *
 * Architecture notes:
 *  - NEVER modify the ace_inner contenteditable DOM directly; Etherpad's own
 *    MutationObserver will treat changes as user input and multiply them.
 *  - Thread button: a single floating overlay in the ace_outer frame,
 *    positioned by tracking mousemove over the editor.
 *  - Thread panel: in the outer pad frame.
 *  - Task checkboxes: via the aceCreateDomLine hook (inner frame, non-editable
 *    region added by Etherpad's own line rendering pipeline).
 */

'use strict';

// ── CSS ───────────────────────────────────────────────────────────────────────

function injectCSS(doc, css) {
  const s = doc.createElement('style');
  s.textContent = css;
  (doc.head || doc.documentElement).appendChild(s);
}

const OUTER_CSS = `
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
  font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;
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

// CSS for the floating thread button, injected into ace_outer
const ACE_OUTER_CSS = `
#rz-float-btn {
  position: absolute; right: 6px;
  background: transparent; border: none; cursor: pointer;
  font-size: 18px; opacity: 0; transition: opacity .15s;
  z-index: 100; pointer-events: auto; line-height: 1; padding: 2px 4px;
  display: none;
}
#rz-float-btn.rz-visible { display: block; }
#rz-float-btn:hover { opacity: 1 !important; }
`;

// CSS for task checkboxes, injected into ace_inner
const ACE_INNER_CSS = `
.rz-cb { cursor: pointer; margin-right: 4px; user-select: none; }
.rz-done { text-decoration: line-through; color: #888; }
`;

// ── Thread panel (outer pad frame) ───────────────────────────────────────────

let threadPanel = null;
let activeThreadId = null;

function getThreadPanel() {
  if (threadPanel) return threadPanel;
  threadPanel = document.createElement('div');
  threadPanel.id = 'rz-thread-panel';
  threadPanel.innerHTML =
    '<div id="rz-thread-header"><strong>Discussion</strong>' +
    '<button id="rz-thread-close">\u00d7</button></div>' +
    '<div id="rz-thread-messages"></div>' +
    '<div id="rz-thread-input-area">' +
    '<textarea id="rz-thread-input" rows="3" placeholder="Reply\u2026"></textarea>' +
    '<button id="rz-thread-send">Send</button></div>';
  document.body.appendChild(threadPanel);
  threadPanel.querySelector('#rz-thread-close').addEventListener('click', closeThread);
  threadPanel.querySelector('#rz-thread-send').addEventListener('click', sendReply);
  return threadPanel;
}

function openThread(threadId) {
  activeThreadId = threadId;
  const panel = getThreadPanel();
  const box = panel.querySelector('#rz-thread-messages');
  box.innerHTML = '<em>No replies yet. Start the discussion below.</em>';
  panel.classList.add('rz-visible');

  const padId = window.clientVars && window.clientVars.padId;
  if (!padId) return;
  fetch('/rizzoma/threads/' + encodeURIComponent(padId))
    .then((r) => r.json())
    .then((data) => {
      const thread = (data.threads || []).find((t) => t.id === threadId);
      if (!thread || !thread.replies || !thread.replies.length) return;
      box.innerHTML = thread.replies.map((r) =>
        '<div class="rz-reply"><span class="rz-reply-author">' + esc(r.author) + '</span>' +
        '<span class="rz-reply-time">' + new Date(r.time).toLocaleString() + '</span>' +
        '<p>' + esc(r.text) + '</p></div>'
      ).join('');
    })
    .catch(() => {});
}

function closeThread() {
  if (threadPanel) threadPanel.classList.remove('rz-visible');
  activeThreadId = null;
}

function sendReply() {
  const input = threadPanel && threadPanel.querySelector('#rz-thread-input');
  if (!input || !input.value.trim()) return;
  // TODO: persist via REST + ACE attributes
  input.value = '';
}

// ── Floating thread button in ace_outer ──────────────────────────────────────

function setupFloatButton(aceOuterDoc) {
  injectCSS(aceOuterDoc, ACE_OUTER_CSS);

  const btn = aceOuterDoc.createElement('button');
  btn.id = 'rz-float-btn';
  btn.title = 'Open discussion thread for this line';
  btn.textContent = '\ud83d\udcac'; // 💬
  aceOuterDoc.body.appendChild(btn);

  let currentLineId = null;
  let hideTimer = null;

  const show = (y) => {
    clearTimeout(hideTimer);
    btn.style.top = y + 'px';
    btn.style.opacity = '0.6';
    btn.classList.add('rz-visible');
  };

  const hide = () => {
    hideTimer = setTimeout(() => {
      btn.style.opacity = '0';
      setTimeout(() => btn.classList.remove('rz-visible'), 160);
    }, 400);
  };

  // Track mouse in the ace_inner iframe (inside ace_outer)
  const aceInnerFrame = aceOuterDoc.querySelector('iframe[name="ace_inner"]');
  if (aceInnerFrame) {
    const trackMouse = (e) => {
      // Convert coordinates: e.clientY is inside ace_inner; adjust for ace_inner's offset in ace_outer
      const rect = aceInnerFrame.getBoundingClientRect();
      const y = rect.top + e.clientY;

      // Find which line element the cursor is over
      const innerDoc = aceInnerFrame.contentDocument;
      if (!innerDoc) return;
      const el = innerDoc.elementFromPoint(e.clientX, e.clientY);
      const line = el && (el.closest('.ace-line') || (el.classList && el.classList.contains('ace-line') ? el : null));
      if (line) {
        currentLineId = line.dataset.rzLineId || (line.dataset.rzLineId = generateId());
        show(y - 2);
      } else {
        hide();
      }
    };

    try {
      aceInnerFrame.contentDocument.addEventListener('mousemove', trackMouse);
      aceInnerFrame.contentDocument.addEventListener('mouseleave', hide);
    } catch (_) {}
  }

  btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  btn.addEventListener('mouseleave', hide);
  btn.addEventListener('click', () => {
    if (currentLineId) openThread(currentLineId);
  });
}

// ── Task checkboxes via aceCreateDomLine ─────────────────────────────────────
// This hook fires in the ace_inner context (not the outer frame) so we need
// to export it from this module; it is invoked by Etherpad's inner hook system.

exports.aceCreateDomLine = (hookName, args) => {
  // args.domline is the line being rendered; args.cls is the CSS class string
  const lineText = args.domline && args.domline.lineNode && args.domline.lineNode.textContent;
  if (!lineText) return [];

  if (/^\[ \]/.test(lineText) || /^\[[xX]\]/.test(lineText)) {
    const isDone = /^\[[xX]\]/.test(lineText);
    // Return a modifier that prepends an interactive checkbox
    return [{
      extraOpenTags: '<span class="rz-cb' + (isDone ? ' rz-done' : '') + '" onclick="this.textContent=this.textContent===\'\\u2611\'?\'\\u2610\':\'\\u2611\';this.parentNode.classList.toggle(\'rz-done\')">' +
        (isDone ? '\u2611' : '\u2610') + '</span>',
      extraCloseTags: '',
      cls: args.cls,
    }];
  }
  return [];
};

// ── Entry point ───────────────────────────────────────────────────────────────

exports.postAceInit = (hookName, {ace}) => {
  injectCSS(document, OUTER_CSS);

  // Wait for ace_outer to be available, then set up the floating button
  const trySetup = (attempts) => {
    if (attempts > 40) return;
    const aceOuter = document.querySelector('iframe[name="ace_outer"]');
    if (!aceOuter || !aceOuter.contentDocument || !aceOuter.contentDocument.body) {
      return setTimeout(() => trySetup(attempts + 1), 200);
    }
    const aceInner = aceOuter.contentDocument.querySelector('iframe[name="ace_inner"]');
    if (!aceInner || !aceInner.contentDocument || !aceInner.contentDocument.body) {
      return setTimeout(() => trySetup(attempts + 1), 200);
    }
    injectCSS(aceInner.contentDocument, ACE_INNER_CSS);
    setupFloatButton(aceOuter.contentDocument);
  };
  trySetup(0);
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function generateId() {
  return 'rz-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
