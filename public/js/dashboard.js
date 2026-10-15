/* ==========================================================================
   dashboard.js — Santander México account dashboard (activation-gated)
   --------------------------------------------------------------------------
   Loaded on /dashboard.html.

   Responsibilities:
     - Guard: redirect to /index.html if no local session marker.
     - Fetch GET /api/dashboard?username=<local user>.
     - If the user's kycStatus is NOT "active":
         * Mask balance, pending balance, account number, CLABE, holder name.
         * Show a warning banner explaining activation is required.
         * Show a "Completar activación" button that calls
           POST /api/account/activate.
         * Show empty-state message in the transaction table.
     - If the user's kycStatus IS "active":
         * Show real balance, pending balance, account number, CLABE, holder.
         * Render transactions with Santander badges and MXN formatting.
     - Show inline errors in #dashboard-error instead of alert().
     - Wire #logout to clear the local session and redirect.

   Response shape expected from /api/dashboard:
     {
       success: true,
       balance: number,
       pendingBalance: number,
       user: {
         fullName, email, idNumber,
         accountNumber, clabe, photo, kycStatus
       },
       transactions: [ { username, date, description, amount, status, reference } ]
     }

   The activation gate is UI-enforced here. It is NOT a server-side
   authorization check. Anyone who edits localStorage or calls the API
   directly can still see unmasked values. Real enforcement requires
   server-side sessions and per-route authorization — a separate, larger
   refactor. Documented, not pretended.
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Constants
     ---------------------------------------------------------------------- */

  var STORAGE_USER_KEY = 'user';
  var LOGIN_URL = '/index.html';
  var DASHBOARD_ENDPOINT = '/api/dashboard';
  var ACTIVATE_ENDPOINT = '/api/account/activate';

  // Placeholder shown in place of real values while unactivated.
  var MASK = '••••••••';

  /* ----------------------------------------------------------------------
     Module state
     ---------------------------------------------------------------------- */

  var state = {
    username: null,
    activated: false,
    activating: false
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

  function formatMXN(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    try {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) {
      return '$' + n.toFixed(2) + ' MXN';
    }
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var parts = String(iso).split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    return String(iso);
  }

  function statusMeta(statusRaw) {
    var s = String(statusRaw || '').toLowerCase();
    if (s === 'completed' || s === 'activa' || s === 'active') {
      return { cls: 's-badge s-badge--completed', key: 'dash.status_completed' };
    }
    if (s === 'failed' || s === 'fallida') {
      return { cls: 's-badge s-badge--failed', key: 'dash.status_failed' };
    }
    if (s === 'pending' || s === 'en proceso' || s === 'pending activation') {
      return { cls: 's-badge s-badge--pending', key: 'dash.status_pending' };
    }
    return { cls: 's-badge s-badge--info', key: null, raw: statusRaw || '—' };
  }

  /* ----------------------------------------------------------------------
     Error surface
     ---------------------------------------------------------------------- */

  function showError(msgKey) {
    var box = $('dashboard-error');
    if (!box) return;
    box.textContent = t(msgKey);
    box.classList.remove('s-hidden');
  }

  function clearError() {
    var box = $('dashboard-error');
    if (!box) return;
    box.textContent = '';
    box.classList.add('s-hidden');
  }

  /* ----------------------------------------------------------------------
     Activation banner
     ---------------------------------------------------------------------- */

  // Injects a banner above the dashboard content when the account is not
  // active. Creates the DOM once; safe to call multiple times.
  function renderActivationBanner() {
    var existing = $('activation-banner');
    if (existing) return;

    var main = document.querySelector('main .s-container') || document.body;
    var banner = document.createElement('div');
    banner.id = 'activation-banner';
    banner.className = 's-alert s-alert--warning s-mt-4';
    banner.setAttribute('role', 'status');

    var text = document.createElement('p');
    text.className = 's-mb-0';
    text.setAttribute('data-i18n', 'dash.activation_required');
    text.textContent = t('dash.activation_required');

    var actions = document.createElement('div');
    actions.className = 's-row s-mt-3';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'activate-account-btn';
    btn.className = 's-btn s-btn--primary';
    btn.setAttribute('data-i18n', 'dash.activate_now');
    btn.textContent = t('dash.activate_now');

    actions.appendChild(btn);
    banner.appendChild(text);
    banner.appendChild(actions);

    // Insert at the top of the dashboard content, before the first child.
    main.insertBefore(banner, main.firstChild);

    btn.addEventListener('click', onActivateClick);

    if (window.Santander && window.Santander.applyTranslations) {
      window.Santander.applyTranslations(banner);
    }
  }

  function removeActivationBanner() {
    var b = $('activation-banner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  /* ----------------------------------------------------------------------
     Rendering — user, balances, transactions
     ---------------------------------------------------------------------- */

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value == null || value === '' ? '—' : String(value);
  }

  function renderUser(user) {
    if (!user) return;

    if (state.activated) {
      setText('account-holder-top', user.fullName || '—');
      setText('account-holder',     user.fullName || '—');
      setText('account-number',     user.accountNumber || '—');
      setText('account-clabe',      user.clabe || '—');
    } else {
      var placeholder = t('dash.pending_verification');
      setText('account-holder-top', placeholder);
      setText('account-holder',     placeholder);
      setText('account-number',     MASK);
      setText('account-clabe',      MASK);
    }

    var idSlot = $('account-id');
    if (idSlot) {
      setText('account-id', state.activated ? (user.idNumber || '—') : MASK);
    }
  }

  function renderBalances(balance, pendingBalance) {
    var balEl = $('balance');
    var pendEl = $('pending-balance');

    if (state.activated) {
      if (balEl) balEl.textContent = formatMXN(balance);
      if (pendEl) pendEl.textContent = formatMXN(pendingBalance);
    } else {
      if (balEl) balEl.textContent = MASK;
      if (pendEl) pendEl.textContent = MASK;
    }
  }

  function renderTransactions(txs) {
    var tbody = $('transaction-table');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Gate: unactivated users see only an empty-state message.
    if (!state.activated) {
      var lockedRow = document.createElement('tr');
      var lockedCell = document.createElement('td');
      lockedCell.colSpan = 4;
      lockedCell.className = 's-center s-muted s-text-sm';
      lockedCell.setAttribute('data-i18n', 'dash.tx_locked');
      lockedCell.textContent = t('dash.tx_locked');
      lockedRow.appendChild(lockedCell);
      tbody.appendChild(lockedRow);
      return;
    }

    if (!txs || txs.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.className = 's-center s-muted s-text-sm';
      emptyCell.setAttribute('data-i18n', 'dash.tx_empty');
      emptyCell.textContent = t('dash.tx_empty');
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    txs.forEach(function (tx) {
      var row = document.createElement('tr');

      var tdDate = document.createElement('td');
      tdDate.textContent = formatDate(tx.date);

      var tdDesc = document.createElement('td');
      tdDesc.textContent = tx.description || '—';

      var tdAmount = document.createElement('td');
      tdAmount.className = 's-amount';
      tdAmount.textContent = formatMXN(tx.amount);

      var tdStatus = document.createElement('td');
      var meta = statusMeta(tx.status);
      var badge = document.createElement('span');
      badge.className = meta.cls;
      if (meta.key) {
        badge.setAttribute('data-i18n', meta.key);
        badge.textContent = t(meta.key);
      } else {
        badge.textContent = meta.raw;
      }
      tdStatus.appendChild(badge);

      row.appendChild(tdDate);
      row.appendChild(tdDesc);
      row.appendChild(tdAmount);
      row.appendChild(tdStatus);

      tbody.appendChild(row);
    });

    if (window.Santander && window.Santander.applyTranslations) {
      window.Santander.applyTranslations(tbody);
    }
  }

  /* ----------------------------------------------------------------------
     Data fetch
     ---------------------------------------------------------------------- */

  function loadDashboard(username) {
    clearError();

    return fetch(DASHBOARD_ENDPOINT + '?username=' + encodeURIComponent(username), {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.success !== true) {
          showError('dash.error_load');
          return;
        }

        var user = data.user || {};
        state.activated = String(user.kycStatus || '').toLowerCase() === 'active';

        if (state.activated) {
          removeActivationBanner();
        } else {
          renderActivationBanner();
        }

        renderUser(user);
        renderBalances(data.balance, data.pendingBalance);
        renderTransactions(data.transactions || []);
      })
      .catch(function (err) {
        console.error('Dashboard load error:', err);
        showError('dash.error_load');
      });
  }

  /* ----------------------------------------------------------------------
     Activation
     ---------------------------------------------------------------------- */

  function onActivateClick() {
    if (state.activating) return;
    if (!state.username) return;

    state.activating = true;
    clearError();

    var btn = $('activate-account-btn');
    if (btn) {
      btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = t('dash.activating');
      btn.setAttribute('data-original-label', original);
    }

    fetch(ACTIVATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        // The activation endpoint keys off email. For a user created via
        // /api/account, username === email. For the seeded user, username
        // is "carlos.hernandez" and there is no email field — but the
        // seeded user is already active, so this path is not hit.
        email: state.username,
        agree: true
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.success !== true) {
          showError('dash.error_activate');
          state.activating = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.getAttribute('data-original-label') || t('dash.activate_now');
          }
          return;
        }
        // Re-load the dashboard: server now returns kycStatus "active",
        // and this script will unmask everything.
        state.activating = false;
        loadDashboard(state.username);
      })
      .catch(function (err) {
        console.error('Activation error:', err);
        showError('dash.error_activate');
        state.activating = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.getAttribute('data-original-label') || t('dash.activate_now');
        }
      });
  }

  /* ----------------------------------------------------------------------
     Logout
     ---------------------------------------------------------------------- */

  function wireLogout() {
    var btn = $('logout');
    if (!btn) return;
    btn.addEventListener('click', function () {
      try { window.localStorage.removeItem(STORAGE_USER_KEY); } catch (e) {}
      window.location.href = LOGIN_URL;
    });
  }

  /* ----------------------------------------------------------------------
     Language change — re-render dynamic text
     ---------------------------------------------------------------------- */

  function wireLanguageRefresh() {
    if (!window.Santander || !window.Santander.onChange) return;
    window.Santander.onChange(function () {
      // Re-render dynamic badges, masks, and the activation banner.
      var banner = $('activation-banner');
      if (banner) {
        var txt = banner.querySelector('[data-i18n="dash.activation_required"]');
        if (txt) txt.textContent = t('dash.activation_required');
        var btn = $('activate-account-btn');
        if (btn && !state.activating) {
          btn.textContent = t('dash.activate_now');
        }
      }

      // Re-render transaction badges and empty-state text.
      var tbody = $('transaction-table');
      if (tbody) {
        tbody.querySelectorAll('[data-i18n]').forEach(function (el) {
          el.textContent = t(el.getAttribute('data-i18n'));
        });
      }

      // Re-render the masked/unmasked name.
      if (!state.activated) {
        var placeholder = t('dash.pending_verification');
        setText('account-holder-top', placeholder);
        setText('account-holder', placeholder);
      } else {
        // If activated, we could re-fetch; instead, refresh from cache by
        // reloading. Simpler: reload the page on language change when active.
        // To keep the page responsive, we only reload if a full refresh is
        // needed. Currently we do nothing — the name is data, not chrome.
      }
    });
  }

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function init() {
    try { state.username = window.localStorage.getItem(STORAGE_USER_KEY); } catch (e) {}

    if (!state.username) {
      window.location.href = LOGIN_URL;
      return;
    }

    wireLogout();
    wireLanguageRefresh();
    loadDashboard(state.username);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
