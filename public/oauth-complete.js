// The OAuth consent popup's last stop. The OAuth callback, on the API server,
// redirects here with the outcome in the query: `result=ok&connection=<id>`,
// `result=pending&connection=<id>` (authorized, waiting for a member to
// confirm it in the console) or `result=error&error=<code>`. This page is on the console's origin, so it
// can tell the console wherever the API is hosted: over a BroadcastChannel,
// which needs no link to the opener (a provider's
// Cross-Origin-Opener-Policy can sever it), and over window.opener when that
// link survived. The console takes the connection's state from the API; the
// message only tells it to look. Kept apart from the app: no analytics, no
// sign-in, nothing loaded but this.
(function () {
  var MESSAGES = {
    access_denied: 'Access was denied.',
    invalid_state:
      'The authorization expired or was already used. Please try again.',
    invalid_request: "The provider's answer was incomplete. Please try again.",
    token_exchange_failed: 'The provider did not issue a token.',
    browser_mismatch:
      'Finish the authorization in the browser you started it in.',
  };

  var params = new URLSearchParams(window.location.search);
  var title = document.getElementById('title');
  var detail = document.getElementById('detail');
  var close = document.getElementById('close');

  // No outcome in the query: a reload, after the first visit removed it.
  // Report nothing; reading it as a failure failed whatever flow was running
  // elsewhere (CN-3).
  if (!params.get('result')) {
    title.textContent = 'Authorization finished';
    detail.textContent = 'You can close this window.';
    close.hidden = false;
    close.addEventListener('click', function () {
      window.close();
    });
    return;
  }

  var pending = params.get('result') === 'pending';
  var success = params.get('result') === 'ok' || pending;
  // The flow id the console wrote before opening this popup; the popup's
  // sessionStorage started as a copy of the console's.
  var flow = '';
  try {
    flow = window.sessionStorage.getItem('runtara-oauth-flow') || '';
  } catch (e) {
    // No sessionStorage: the message names no flow.
  }
  var message = {
    type: 'oauth-complete',
    flow: flow,
    success: success,
    pending: pending,
    connectionId: params.get('connection') || '',
    error: success ? '' : params.get('error') || 'server_error',
  };
  // Keep the outcome out of the history entry.
  window.history.replaceState(null, '', window.location.pathname);

  try {
    var channel = new BroadcastChannel('runtara-oauth');
    channel.postMessage(message);
    channel.close();
  } catch (e) {
    // No BroadcastChannel: the opener is the only way back.
  }
  if (window.opener) {
    try {
      window.opener.postMessage(message, window.location.origin);
    } catch (e) {
      // The opener is gone or on another origin; the channel covered it.
    }
  }

  if (pending) {
    title.textContent = 'Authorization received';
    title.className = 'success';
    detail.textContent =
      'A member must confirm this connection in the console within 15 minutes. You can close this window.';
    close.hidden = false;
    close.addEventListener('click', function () {
      window.close();
    });
  } else if (success) {
    title.textContent = 'Authorization successful';
    title.className = 'success';
    detail.textContent = 'You can close this window.';
    setTimeout(function () {
      window.close();
    }, 1000);
  } else {
    title.textContent = 'Authorization failed';
    title.className = 'error';
    detail.textContent =
      (MESSAGES[message.error] || 'Authorization failed.') +
      ' (' +
      message.error +
      ')';
    close.hidden = false;
    close.addEventListener('click', function () {
      window.close();
    });
  }
})();
