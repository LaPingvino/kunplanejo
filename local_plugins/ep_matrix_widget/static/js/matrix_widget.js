/**
 * ep_matrix_widget - Client-side Matrix widget integration
 *
 * When Etherpad is embedded as a Matrix widget, this module:
 *  1. Detects the Matrix widget context
 *  2. Uses the Matrix Widget API to request capabilities and fetch user info
 *  3. Pre-populates the Etherpad author name and color from the Matrix user
 *
 * Loaded via Etherpad's padInitialized hook.
 */

(function () {
  'use strict';

  // Parse query params to detect Matrix widget context
  function getParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  const widgetId = getParam('widgetId') || getParam('widget_id');
  const parentUrl = getParam('parentUrl') || document.referrer;

  // Only activate when embedded as a Matrix widget
  const isMatrixWidget =
    window.self !== window.top &&
    (widgetId || parentUrl.includes('matrix') || parentUrl.includes('element'));

  if (!isMatrixWidget) return;

  // Dynamically load matrix-widget-api from the plugin's static assets
  // (bundled separately; see README)
  const script = document.createElement('script');
  script.src = '../ep_matrix_widget/static/js/matrix-widget-api.min.js';
  script.onload = initMatrixWidget;
  script.onerror = () => {
    // Fallback: try to use postMessage directly without the library
    initMatrixWidgetFallback();
  };
  document.head.appendChild(script);

  function initMatrixWidget() {
    // matrix-widget-api v1.x exposes WidgetApi on window after the bundle loads
    const WidgetApi = window.mxwidgets && window.mxwidgets.WidgetApi;
    if (!WidgetApi) {
      initMatrixWidgetFallback();
      return;
    }

    const api = new WidgetApi(widgetId || 'kunplanejo', parentUrl);

    // Request capabilities we need
    api.requestCapability('org.matrix.msc2931.navigate');

    api.on('ready', async () => {
      try {
        const userInfo = await api.getOpenIDToken();
        const userId = getParam('userId') || getParam('matrix_user_id') || '';
        const displayName = getParam('displayName') || userId.split(':')[0].replace('@', '') || 'Matrix User';

        applyMatrixIdentity(userId, displayName);
      } catch (e) {
        console.warn('[ep_matrix_widget] Could not fetch Matrix user info:', e);
        applyFromUrlParams();
      }
    });

    api.start();
  }

  /**
   * Fallback when the widget API library is unavailable.
   * Matrix clients inject $matrix_user_id and $displayname into widget URLs
   * at registration time, so we can read them from query params.
   */
  function initMatrixWidgetFallback() {
    const userId = getParam('userId') || getParam('matrix_user_id') || '';
    const displayName = getParam('displayName') || getParam('displayname') ||
      (userId ? userId.split(':')[0].replace('@', '') : 'Matrix User');

    applyMatrixIdentity(userId, displayName);

    // Also listen for postMessage events from the Matrix client
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.api !== 'toWidget') return;
      if (event.data.action === 'identity') {
        const d = event.data.data || {};
        applyMatrixIdentity(d.userId || userId, d.displayName || displayName);
      }
    });

    // Send a capability request to the parent
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

  function applyMatrixIdentity(userId, displayName) {
    // Wait for the Etherpad clientVars to be available
    waitForEtherpad(() => {
      try {
        // Set the author name in Etherpad
        if (window.pad && window.pad.myUserInfo) {
          window.pad.myUserInfo.name = displayName;
          if (window.pad.socket) {
            window.pad.socket.json.send({
              type: 'userChanges',
              userInfo: window.pad.myUserInfo,
            });
          }
        }

        // Store in localStorage so it persists across reconnects
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
    const displayName = getParam('displayName') || getParam('displayname') ||
      (userId ? userId.split(':')[0].replace('@', '') : 'Matrix User');
    applyMatrixIdentity(userId, displayName);
  }

  function waitForEtherpad(cb, attempts) {
    attempts = attempts || 0;
    if (attempts > 50) return; // Give up after ~5s
    if (window.pad && window.pad.myUserInfo) {
      cb();
    } else {
      setTimeout(() => waitForEtherpad(cb, attempts + 1), 100);
    }
  }
})();
