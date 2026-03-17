/**
 * ep_rizzoma - Client-side Rizzoma-inspired features
 *
 * Features:
 *  - Thread sidebar: click any paragraph to open/reply in a thread panel
 *  - Task toggling: click checkboxes to mark tasks done
 *  - Gadget placeholder: extension point for embedded interactive gadgets
 */

(function () {
  'use strict';

  // ── Thread sidebar ──────────────────────────────────────────────────────────

  let threadPanel = null;
  let activeThreadId = null;

  function createThreadPanel() {
    const panel = document.createElement('div');
    panel.id = 'rz-thread-panel';
    panel.innerHTML = `
      <div id="rz-thread-header">
        <strong>Discussion thread</strong>
        <button id="rz-thread-close" title="Close">✕</button>
      </div>
      <div id="rz-thread-messages"></div>
      <div id="rz-thread-input-area">
        <textarea id="rz-thread-input" rows="3" placeholder="Reply to this thread…"></textarea>
        <button id="rz-thread-send">Send</button>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#rz-thread-close').addEventListener('click', closeThreadPanel);
    panel.querySelector('#rz-thread-send').addEventListener('click', sendThreadReply);

    return panel;
  }

  function openThreadPanel(lineElement, threadId) {
    if (!threadPanel) threadPanel = createThreadPanel();
    activeThreadId = threadId;

    const messages = threadPanel.querySelector('#rz-thread-messages');
    messages.innerHTML = '<em>Loading thread…</em>';
    threadPanel.classList.add('rz-visible');

    // Load existing thread messages from pad attributes (via REST endpoint)
    const padId = window.clientVars && window.clientVars.padId;
    if (padId) {
      fetch(`/rizzoma/threads/${padId}`)
        .then((r) => r.json())
        .then((data) => {
          const thread = (data.threads || []).find((t) => t.id === threadId);
          renderThread(messages, thread);
        })
        .catch(() => renderThread(messages, null));
    } else {
      renderThread(messages, null);
    }
  }

  function renderThread(container, thread) {
    if (!thread || !thread.replies || thread.replies.length === 0) {
      container.innerHTML = '<em>No replies yet. Start the discussion below.</em>';
      return;
    }
    container.innerHTML = thread.replies
      .map(
        (r) =>
          `<div class="rz-reply">
            <span class="rz-reply-author">${escHtml(r.author)}</span>
            <span class="rz-reply-time">${new Date(r.time).toLocaleString()}</span>
            <p>${escHtml(r.text)}</p>
          </div>`
      )
      .join('');
  }

  function sendThreadReply() {
    const input = threadPanel.querySelector('#rz-thread-input');
    const text = input.value.trim();
    if (!text) return;

    // Insert the reply as a new attributed line via the Etherpad ACE API
    // This is a simplified insertion; a full implementation would use
    // ace.callWithAce to set the rz-reply-to attribute pointing to activeThreadId.
    const padEditor = window.pad && window.pad.ace;
    if (padEditor) {
      padEditor.callWithAce((ace) => {
        const rep = ace.getRep();
        const end = rep.lines.totalWidth();
        ace.performDocumentReplaceRange([end, 0], [end, 0], `\n[Reply] ${text}`);
      }, 'rz-reply', true);
    }

    input.value = '';
  }

  function closeThreadPanel() {
    if (threadPanel) threadPanel.classList.remove('rz-visible');
    activeThreadId = null;
  }

  // ── Task toggles ────────────────────────────────────────────────────────────

  function setupTaskToggles(innerDocument) {
    // Match lines starting with [ ] or [x] (case-insensitive)
    const taskLineRe = /^\[([ xX])\] /;

    innerDocument.querySelectorAll('.ace-line').forEach((line) => {
      if (taskLineRe.test(line.textContent) && !line.dataset.rzTask) {
        line.dataset.rzTask = '1';
        const box = document.createElement('span');
        box.className = 'rz-task-checkbox';
        box.title = 'Toggle task';
        box.textContent = line.textContent.startsWith('[x]') || line.textContent.startsWith('[X]')
          ? '☑'
          : '☐';
        box.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleTask(line, box);
        });
        line.insertBefore(box, line.firstChild);
      }
    });
  }

  function toggleTask(lineEl, checkboxEl) {
    const padEditor = window.pad && window.pad.ace;
    if (!padEditor) return;
    const isDone = checkboxEl.textContent === '☑';
    // Flip state via ACE
    padEditor.callWithAce((ace) => {
      // TODO: set rz-task-done attribute on the line's changeset
      const lineText = lineEl.textContent;
      const newText = isDone
        ? lineText.replace(/^\[x\]/i, '[ ]')
        : lineText.replace(/^\[ \]/, '[x]');
      // Simple text replacement — a production impl would use changeset attributes
      console.info('[ep_rizzoma] Task toggled:', newText);
    }, 'rz-task-toggle', true);
    checkboxEl.textContent = isDone ? '☐' : '☑';
    lineEl.classList.toggle('rz-task-done', !isDone);
  }

  // ── Thread markers on paragraph clicks ─────────────────────────────────────

  function addThreadTriggers(innerDocument) {
    innerDocument.querySelectorAll('.ace-line').forEach((line) => {
      if (line.dataset.rzThreadBtn) return;
      line.dataset.rzThreadBtn = '1';

      const btn = document.createElement('button');
      btn.className = 'rz-thread-btn';
      btn.title = 'Open/create discussion thread for this paragraph';
      btn.textContent = '💬';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const threadId = line.dataset.rzThreadId || generateId();
        line.dataset.rzThreadId = threadId;
        openThreadPanel(line, threadId);
      });
      line.appendChild(btn);
    });
  }

  // ── Gadget placeholders ─────────────────────────────────────────────────────
  // Lines starting with {{gadget:...}} are rendered as embedded gadgets.
  // This is the extension point; actual gadget types are added by sub-plugins.

  function renderGadgetPlaceholders(innerDocument) {
    const gadgetRe = /^\{\{gadget:([^}]+)\}\}(.*)$/;
    innerDocument.querySelectorAll('.ace-line').forEach((line) => {
      const m = line.textContent.match(gadgetRe);
      if (m && !line.dataset.rzGadget) {
        line.dataset.rzGadget = '1';
        const type = m[1].trim();
        const params = m[2].trim();
        const placeholder = document.createElement('div');
        placeholder.className = `rz-gadget rz-gadget-${type}`;
        placeholder.dataset.gadgetType = type;
        placeholder.dataset.gadgetParams = params;
        placeholder.textContent = `[Gadget: ${type}]`;
        // Dispatch so external gadget handlers can take over
        line.parentNode.insertBefore(placeholder, line.nextSibling);
        document.dispatchEvent(new CustomEvent('rz-gadget-init', {detail: {type, params, el: placeholder}}));
      }
    });
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    // Hook into Etherpad's inner document (inside the ACE iframe)
    const tryHook = () => {
      const aceInner = document.querySelector('iframe[name="ace_inner"]');
      if (!aceInner || !aceInner.contentDocument) {
        setTimeout(tryHook, 500);
        return;
      }
      const innerDoc = aceInner.contentDocument;
      setupTaskToggles(innerDoc);
      addThreadTriggers(innerDoc);
      renderGadgetPlaceholders(innerDoc);

      // Re-run on content mutations
      const observer = new MutationObserver(() => {
        setupTaskToggles(innerDoc);
        addThreadTriggers(innerDoc);
        renderGadgetPlaceholders(innerDoc);
      });
      observer.observe(innerDoc.body, {childList: true, subtree: true});
    };
    tryHook();
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  function generateId() {
    return `rz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function escHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  }

  // Start after Etherpad is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Etherpad client hook entry point
  exports.postAceInit = () => init();
})();
