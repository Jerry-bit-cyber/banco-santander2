/* ==========================================================================
   auth.js — Santander México login
   --------------------------------------------------------------------------
   Loaded on /index.html with:
     <script src="/js/auth.js" defer></script>

   Responsibilities:
     - Bind #login-form submit.
     - Read #username and #password.
     - POST to /api/login.
     - On success: store the username in localStorage under the key "user"
       (same key the rest of the app already reads) and redirect to
       /dashboard.html.
     - On failure: show an inline error in #login-error instead of alert().
     - Disable #login-submit while the request is in flight.
     - Clear the error on new input.
     - Re-render the error message on language toggle.

   Storage key "user" is preserved deliberately. dashboard.js, transfer.js,
   and statement.js all read it, and changing it now would break the flow
   until all four files are updated in lockstep. When server-side sessions
   are introduced, this key goes away entirely.
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Constants
     ---------------------------------------------------------------------- */

  var STORAGE_USER_KEY = 'user';         // matches dashboard.js / transfer.js / statement.js
  var LOGIN_ENDPOINT = '/api/login';
  var DASHBOARD_URL = '/dashboard.html';

  /* ----------------------------------------------------------------------
     Module state
     ---------------------------------------------------------------------- */

  var state = {
    lastErrorKey: null,   // translation key of the currently displayed error
    submitting: false
  };

  /* ----------------------------------------------------------------------
     Helpers
     ---------------------------------------------------------------------- */

  function $(id) { return document.getElementById(id); }

  function t(key) {
    return window.Santander && window.Santander.t
      ? window.Santander.t(key)
      : key;
  }

  /* ----------------------------------------------------------------------
     Error surface
     ---------------------------------------------------------------------- */

  function showError(msgKey) {
    var box = $('login-error');
    if (!box) return;
    state.lastErrorKey = msgKey;
    box.textContent = t(msgKey);
    box.classList.remove('s-hidden');
  }

  function clearError() {
    var box = $('login-error');
    if (!box) return;
    state.lastErrorKey = null;
    box.textContent = '';
    box.classList.add('s-hidden');
  }

  /* ----------------------------------------------------------------------
     Submit
     ---------------------------------------------------------------------- */

  function setSubmitting(on) {
    state.submitting = on;
    var btn = $('login-submit');
    if (!btn) return;
    btn.disabled = on;
    // Button label is driven by data-i18n; do not overwrite it here.
  }

  function onSubmit(ev) {
    ev.preventDefault();

    if (state.submitting) return;
    clearError();

    var usernameEl = $('username');
    var passwordEl = $('password');

    var username = usernameEl ? usernameEl.value.trim() : '';
    var password = passwordEl ? passwordEl.value : '';

    if (!username || !password) {
      showError('home.error_empty');
      return;
    }

    setSubmitting(true);

    fetch(LOGIN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, body: body }; });
      })
      .then(function (res) {
        if (!res.body || res.body.success !== true) {
          showError('home.error_invalid');
          setSubmitting(false);
          return;
        }

        // Store the session marker. Key matches what the rest of the app reads.
        try {
          window.localStorage.setItem(STORAGE_USER_KEY, username);
        } catch (e) {
          // localStorage unavailable (private mode, quota). The next page
          // will redirect back to login — acceptable for the prototype.
        }

        window.location.href = DASHBOARD_URL;
      })
      .catch(function (err) {
        console.error('Login error:', err);
        showError('home.error_network');
        setSubmitting(false);
      });
  }

  /* ----------------------------------------------------------------------
     Wiring
     ---------------------------------------------------------------------- */

  function wireForm() {
    var form = $('login-form');
    if (!form) return;
    form.addEventListener('submit', onSubmit);

    // Clear the error when the user starts typing again.
    ['username', 'password'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (state.lastErrorKey) clearError();
      });
    });
  }

  function wireLanguageRefresh() {
    if (!window.Santander || !window.Santander.onChange) return;
    window.Santander.onChange(function () {
      // If an error is currently displayed, re-render it in the new language.
      if (state.lastErrorKey) {
        var box = $('login-error');
        if (box) box.textContent = t(state.lastErrorKey);
      }
    });
  }

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function init() {
    wireForm();
    wireLanguageRefresh();
    setSubmitting(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
