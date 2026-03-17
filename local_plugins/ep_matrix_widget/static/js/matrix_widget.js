/**
 * ep_matrix_widget - Client-side Matrix widget integration
 *
 * When Etherpad is embedded as a Matrix widget, this module:
 *  1. Detects the Matrix widget context
 *  2. Uses the Matrix Widget API to request capabilities and fetch user info
 *  3. Pre-populates the Etherpad author name from the Matrix user identity
 */

'use strict';

function getParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function isMatrixWidget() {
  const widgetId = getParam('widgetId') || getParam('widget_id');
  const parentUrl = getParam('parentUrl') || document.referrer;
  return (
    window.self !== window.top &&
    !!(widgetId || parentUrl.includes('matrix') || parentUrl.includes('element'))
  );
}

function applyMatrixIdentity(userId, displayName) {
  waitForEtherpad(() => {
    try {
      if (window.pad && window.pad.myUserInfo) {
        window.pad.myUserInfo.name = displayName;
        if (window.pad.socket) {
          window.pad.socket.json.send({
            type: 'userChanges',
            userInfo: window.pad.myUserInfo,
          });
        }
      }
      if (userId) {
        localStorage.setItem('ep_matrix_userId', userId);
        localStorage.setItem('ep_matrix_displayName', displayName);
      }
      console.info(`[ep_matrix_widget] Identity applied: ${displayName} (${userId})`);
    } catch (e) {
      console.warn('[ep_matrix_widget] Could not apply Matrix identity:', e);
    }
  });
}

function applyFromUrlParams() {
  const userId = getParam('userId') || getParam('matrix_user_id') || '';
  const displayName =
    getParam('displayName') ||
    getParam('displayname') ||
    (userId ? userId.split(':')[0].replace('@', '') : 'Matrix User');
  applyMatrixIdentity(userId, displayName);
}

function initMatrixWidgetFallback() {
  const widgetId = getParam('widgetId') || getParam('widget_id');
  applyFromUrlParams();

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.api !== 'toWidget') return;
    if (event.data.action === 'identity') {
      const d = event.data.data || {};
      const userId = d.userId || getParam('matrix_user_id') || '';
      const displayName = d.displayName || getParam('displayName') || userId;
      applyMatrixIdentity(userId, displayName);
    }
  });

  if (window.parent && widgetId) {
    window.parent.postMessage({
      api: 'fromWidget',
      widgetId,
      requestId: 'capability-request-1',
      action: 'capabilities',
      data: {capabilities: ['org.matrix.msc2931.navigate']},
    }, '*');
  }
}

function initMatrixWidget() {
  const widgetId = getParam('widgetId') || getParam('widget_id');
  const parentUrl = getParam('parentUrl') || document.referrer;

  // Try to load the matrix-widget-api library
  const script = document.createElement('script');
  script.src = '/static/plugins/ep_matrix_widget/static/js/matrix-widget-api.min.js';
  script.onload = () => {
    const WidgetApi = window.mxwidgets && window.mxwidgets.WidgetApi;
    if (!WidgetApi) {
      initMatrixWidgetFallback();
      return;
    }
    const api = new WidgetApi(widgetId || 'kunplanejo', parentUrl);
    api.requestCapability('org.matrix.msc2931.navigate');
    api.on('ready', async () => {
      try {
        await api.getOpenIDToken();
        const userId = getParam('userId') || getParam('matrix_user_id') || '';
        const displayName =
          getParam('displayName') ||
          (userId ? userId.split(':')[0].replace('@', '') : 'Matrix User');
        applyMatrixIdentity(userId, displayName);
      } catch (e) {
        console.warn('[ep_matrix_widget] Widget API error, falling back:', e);
        applyFromUrlParams();
      }
    });
    api.start();
  };
  script.onerror = initMatrixWidgetFallback;
  document.head.appendChild(script);
}

function waitForEtherpad(cb, attempts) {
  attempts = attempts || 0;
  if (attempts > 50) return;
  if (window.pad && window.pad.myUserInfo) {
    cb();
  } else {
    setTimeout(() => waitForEtherpad(cb, attempts + 1), 100);
  }
}

function showWidgetUrlBanner() {
  // Only show when NOT already embedded as a widget
  if (isMatrixWidget()) return;

  const padId = (window.clientVars && window.clientVars.padId) || '';
  if (!padId) return;

  const host = window.location.origin;
  // Matrix Widget API v2 URL template — paste this into Element's "Add widget" dialog
  const url =
    host + '/p/' + encodeURIComponent(padId) +
    '?widgetId=$matrix_widget_id' +
    '&userId=$matrix_user_id' +
    '&displayName=$matrix_display_name' +
    '&parentUrl=$org.matrix.msc2762.as_widget_url';

  const bar = document.createElement('div');
  bar.id = 'rz-matrix-url-bar';
  bar.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;z-index:99998;' +
    'background:#1d2531;color:#ddd;font:12px/1.4 monospace;' +
    'padding:6px 10px;display:flex;align-items:center;gap:8px;';

  const label = document.createElement('span');
  label.textContent = '\ud83e\uddf5 Matrix widget URL:';
  label.style.cssText = 'color:#7ec8e3;white-space:nowrap;font-family:sans-serif;';

  const urlBox = document.createElement('input');
  urlBox.type = 'text';
  urlBox.readOnly = true;
  urlBox.value = url;
  urlBox.style.cssText =
    'flex:1;background:#0d1117;color:#ccc;border:1px solid #444;' +
    'border-radius:3px;padding:2px 5px;font:12px monospace;';
  urlBox.addEventListener('click', () => { urlBox.select(); });

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText =
    'background:#4a90d9;color:#fff;border:none;border-radius:3px;' +
    'cursor:pointer;padding:2px 8px;font-size:12px;white-space:nowrap;';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\xd7';
  closeBtn.title = 'Dismiss';
  closeBtn.style.cssText =
    'background:transparent;color:#888;border:none;cursor:pointer;' +
    'font-size:16px;padding:0 4px;';
  closeBtn.addEventListener('click', () => bar.remove());

  bar.appendChild(label);
  bar.appendChild(urlBox);
  bar.appendChild(copyBtn);
  bar.appendChild(closeBtn);
  document.body.appendChild(bar);
}

// Etherpad client hook — called after the ACE editor initialises
exports.postAceInit = () => {
  showWidgetUrlBanner();
  if (!isMatrixWidget()) return;
  initMatrixWidget();
};
