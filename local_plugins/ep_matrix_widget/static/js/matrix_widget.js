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

// Etherpad client hook — called after the ACE editor initialises
exports.postAceInit = () => {
  if (!isMatrixWidget()) return;
  initMatrixWidget();
};
