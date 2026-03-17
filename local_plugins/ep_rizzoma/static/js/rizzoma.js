/**
 * ep_rizzoma - Client-side Rizzoma-inspired features
 *
 * Features:
 *  - Thread sidebar: click 💬 next to any paragraph to open a discussion panel
 *  - Task toggles: interactive checkboxes for lines starting with [ ] / [x]
 *  - Gadget placeholders: {{gadget:TYPE}} extension point
 */

'use strict';

// ── CSS injection ────────────────────────────────────────────────────────────

function injectCSS(doc, cssText) {
  const style = doc.createElement('style');
  style.textContent = cssText;
  doc.head.appendChild(style);
}

const OUTER_CSS = `
#rz-thread-panel {
  position: fixed; right: 0; top: 0; bottom: 0; width: 320px;
  background: #fff; border-left: 2px solid #4a90d9;
  box-shadow: -4px 0 16px rgba(0,0,0,.12);
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
`;

const INNER_CSS = `
.ace-line { position: relative; }
.rz-thread-btn {
  position: absolute; right: -32px; top: 50%; transform: translateY(-50%);
  background: transparent; border: none; cursor: pointer;
  font-size: 14px; opacity: 0; transition: opacity .15s; padding: 2px; line-height: 1;
}
.ace-line:hover .rz-thread-btn { opacity: .7; }
.rz-thread-btn:hover { opacity: 1 !important; }
.rz-task-checkbox { cursor: pointer; font-size: 15px; margin-right: 4px; user-select: none; }
.rz-task-done { text-decoration: line-through; color: #888; }
.rz-gadget {
  display: block; margin: 4px 0; padding: 8px 12px;
  background: #f5f8ff; border: 1px dashed #4a90d9;
  border-radius: 4px; color: #4a90d9; font-style: italic; font-size: 13px;
}
`;

// ── Thread sidebar ────────────────────────────────────────────────────────────

let threadPanel = null;
let activeThreadId = null;

function getThreadPanel() {
  if (threadPanel) return threadPanel;
  threadPanel = document.createElement('div');
  threadPanel.id = 'rz-thread-panel';
  threadPanel.innerHTML =
    '<div id="rz-thread-header"><strong>Discussion</strong>' +
    '<button id="rz-thread-close" title="Close">\u00d7</button></div>' +
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
  const messages = panel.querySelector('#rz-thread-messages');
  messages.innerHTML = '<em>No replies yet. Start the discussion below.</em>';
  panel.classList.add('rz-visible');

  const padId = window.clientVars && window.clientVars.padId;
  if (padId) {
    fetch('/rizzoma/threads/' + padId)
      .then((r) => r.json())
      .then((data) => {
        const thread = (data.threads || []).find((t) => t.id === threadId);
        if (thread && thread.replies && thread.replies.length) {
          messages.innerHTML = thread.replies.map((r) =>
            '<div class="rz-reply"><span class="rz-reply-author">' + escHtml(r.author) + '</span>' +
            '<span class="rz-reply-time">' + new Date(r.time).toLocaleString() + '</span>' +
            '<p>' + escHtml(r.text) + '</p></div>'
          ).join('');
        }
      })
      .catch(() => {});
  }
}

function closeThread() {
  if (threadPanel) threadPanel.classList.remove('rz-visible');
  activeThreadId = null;
}

function sendReply() {
  const input = threadPanel && threadPanel.querySelector('#rz-thread-input');
  if (!input || !input.value.trim()) return;
  // TODO: persist via ACE attributes
  input.value = '';
}

// ── Inner-frame DOM setup ─────────────────────────────────────────────────────

function setupInnerDoc(innerDoc) {
  injectCSS(innerDoc, INNER_CSS);

  const observer = new MutationObserver(() => decorateLines(innerDoc));
  observer.observe(innerDoc.body, {childList: true, subtree: true});
  decorateLines(innerDoc);
}

function decorateLines(innerDoc) {
  innerDoc.querySelectorAll('.ace-line').forEach((line) => {
    // Task toggles
    if (!line.dataset.rzTask) {
      const text = line.textContent || '';
      if (/^\[([ xX])\]/.test(text)) {
        line.dataset.rzTask = '1';
        const done = /^\[[xX]\]/.test(text);
        const box = innerDoc.createElement('span');
        box.className = 'rz-task-checkbox' + (done ? ' rz-task-done' : '');
        box.textContent = done ? '\u2611' : '\u2610';
        box.addEventListener('click', (e) => {
          e.stopPropagation();
          box.textContent = box.textContent === '\u2611' ? '\u2610' : '\u2611';
          line.classList.toggle('rz-task-done');
        });
        line.insertBefore(box, line.firstChild);
      }
    }

    // Thread trigger buttons
    if (!line.dataset.rzThreadBtn) {
      line.dataset.rzThreadBtn = '1';
      const btn = innerDoc.createElement('button');
      btn.className = 'rz-thread-btn';
      btn.title = 'Open discussion thread';
      btn.textContent = '\ud83d\udcac'; // 💬
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!line.dataset.rzThreadId) line.dataset.rzThreadId = generateId();
        openThread(line.dataset.rzThreadId);
      });
      line.appendChild(btn);
    }

    // Gadget placeholders
    if (!line.dataset.rzGadget) {
      const m = (line.textContent || '').match(/^\{\{gadget:([^}]+)\}\}(.*)$/);
      if (m) {
        line.dataset.rzGadget = '1';
        const el = innerDoc.createElement('div');
        el.className = 'rz-gadget rz-gadget-' + m[1].trim();
        el.textContent = '[Gadget: ' + m[1].trim() + ']';
        document.dispatchEvent(new CustomEvent('rz-gadget-init', {
          detail: {type: m[1].trim(), params: m[2].trim(), el},
        }));
        line.parentNode.insertBefore(el, line.nextSibling);
      }
    }
  });
}

// ── Initialisation ────────────────────────────────────────────────────────────

function init(ace) {
  injectCSS(document, OUTER_CSS);

  // Navigate: outer pad frame → ace_outer iframe → ace_inner iframe
  const tryHook = (attempts) => {
    if (attempts > 40) return;
    const aceOuter = document.querySelector('iframe[name="ace_outer"]');
    if (!aceOuter || !aceOuter.contentDocument) {
      return setTimeout(() => tryHook(attempts + 1), 200);
    }
    const aceInner = aceOuter.contentDocument.querySelector('iframe[name="ace_inner"]');
    if (!aceInner || !aceInner.contentDocument || !aceInner.contentDocument.body) {
      return setTimeout(() => tryHook(attempts + 1), 200);
    }
    setupInnerDoc(aceInner.contentDocument);
  };
  tryHook(0);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function generateId() {
  return 'rz-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// Etherpad client hook
exports.postAceInit = (hookName, {ace}) => init(ace);
