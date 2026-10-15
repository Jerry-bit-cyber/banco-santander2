/* ==========================================================================
   transfer.js — Santander México transfer flow (4-step)
   --------------------------------------------------------------------------
   Loaded on /transfer.html.

   Responsibilities:
     - Fetch origin account summary from /api/dashboard.
     - Wire CLABE ⇄ Alias toggle.
     - Wire step navigation (buttons with data-next="N").
     - Validate step 1 (destination) and step 2 (amount) inline.
     - Format the amount input as Mexican pesos while typing.
     - Build the review summary from collected data.
     - POST /api/transfer on confirm.
     - Render the result (pending or failed) with a reference number.
     - Reset the flow on "Nueva transferencia".

   Mexico-appropriate transfer model:
     - Destination is CLABE (18 digits) or a registered alias.
     - Currency is MXN.
     - No UK sort code. No IBAN. No SWIFT.
     - The rail simulated here is domestic (SPEI-like).

   Payload sent to POST /api/transfer:
     { username, accountNumber, email, amount, activationFee, date }
   The UI does not collect a phone or a sort code, so neither is sent.
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Constants
     ---------------------------------------------------------------------- */

  var STORAGE_USER_KEY = 'user';
  var LOGIN_URL = '/index.html';
  var DASHBOARD_ENDPOINT = '/api/dashboard';
  var TRANSFER_ENDPOINT = '/api/transfer';

  var MIN_AMOUNT = 1;       // MXN
  var MAX_AMOUNT = 999999999;

  /* ----------------------------------------------------------------------
     Module state
     ---------------------------------------------------------------------- */

  var state = {
    username: null,
    origin: {
      holder: '—',
      available: 0,
      pending: 0
    },
    method: 'clabe',      // 'clabe' | 'alias'
    step: 1,
    dest: {
      clabe: '',
      alias: '',
      name: '',
      email: '',
      reference: ''
    },
    amount: 0,
    sending: false
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

  // Strip everything except digits and a single decimal point.
  function parseAmount(raw) {
    if (raw == null) return 0;
    var cleaned = String(raw).replace(/[^\d.]/g, '');
    var parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('');
    }
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  // Live-format the amount input: "1234.5" → "1,234.5"
  function formatAmountInput(raw) {
    var cleaned = String(raw).replace(/[^\d.]/g, '');
    var parts = cleaned.split('.');
    var intPart = parts[0] || '';
    var decPart = parts.length > 1 ? parts.slice(1).join('') : null;
    var intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart === null ? intFormatted : intFormatted + '.' + decPart;
  }

  // Today in YYYY-MM-DD.
  function todayIso() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // Reference number: SMX-TRF-XXXXXXXX
  function makeReference() {
    var digits = '';
    for (var i = 0; i < 8; i++) {
      digits += Math.floor(Math.random() * 10);
    }
    return 'SMX-TRF-' + digits;
  }

  function isEmail(v) {
    if (!v) return true; // optional
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function isClabe(v) {
    return /^\d{18}$/.test(v || '');
  }

  function isAlias(v) {
    return /^@[A-Za-z0-9._-]{3,}$/.test(v || '');
  }

  /* ----------------------------------------------------------------------
     Error surface
     ---------------------------------------------------------------------- */

  function showError(msgKey) {
    var box = $('transfer-error');
    if (!box) return;
    box.textContent = t(msgKey);
    box.classList.remove('s-hidden');
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  function clearError() {
    var box = $('transfer-error');
    if (!box) return;
    box.textContent = '';
    box.classList.add('s-hidden');
  }

  /* ----------------------------------------------------------------------
     Origin summary
     ---------------------------------------------------------------------- */

  function loadOrigin() {
    return fetch(
      DASHBOARD_ENDPOINT + '?username=' + encodeURIComponent(state.username),
      { headers: { 'Accept': 'application/json' } }
    )
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.success !== true) {
          return;
        }
        var user = data.user || {};
        state.origin.holder = user.fullName || '—';
        state.origin.available = Number(data.balance) || 0;
        state.origin.pending = Number(data.pendingBalance) || 0;
        renderOrigin();
      })
      .catch(function (err) {
        console.error('Origin load error:', err);
      });
  }

  function renderOrigin() {
    var h = $('origin-holder');
    if (h) h.textContent = state.origin.holder;

    var a = $('origin-available');
    if (a) a.textContent = formatMXN(state.origin.available);

    var p = $('origin-pending');
    if (p) p.textContent = formatMXN(state.origin.pending);

    var availHint = $('amount-available');
    if (availHint) availHint.textContent = formatMXN(state.origin.available);
  }

  /* ----------------------------------------------------------------------
     Stepper + panels
     ---------------------------------------------------------------------- */

  function setStep(n) {
    state.step = n;

    document.querySelectorAll('.tr-panel').forEach(function (panel) {
      panel.classList.toggle('is-visible', Number(panel.getAttribute('data-panel')) === n);
    });

    document.querySelectorAll('.tr-step').forEach(function (step) {
      var num = Number(step.getAttribute('data-step'));
      step.classList.toggle('is-active', num === n);
      step.classList.toggle('is-done', num < n);
    });

    clearError();

    if (n === 2) {
      var amt = $('amount');
      if (amt) setTimeout(function () { amt.focus(); }, 50);
    }

    if (n === 3) {
      renderReview();
    }

    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      window.scrollTo(0, 0);
    }
  }

  /* ----------------------------------------------------------------------
     Destination method toggle
     ---------------------------------------------------------------------- */

  function setMethod(method) {
    state.method = method;

    document.querySelectorAll('.tr-method button').forEach(function (btn) {
      btn.setAttribute(
        'aria-pressed',
        btn.getAttribute('data-method') === method ? 'true' : 'false'
      );
    });

    document.querySelectorAll('[data-field]').forEach(function (field) {
      var f = field.getAttribute('data-field');
      field.classList.toggle('tr-hidden', f !== method);
    });
  }

  /* ----------------------------------------------------------------------
     Step 1 validation
     ---------------------------------------------------------------------- */

  function collectDestination() {
    state.dest.clabe     = ($('dest-clabe')     ? $('dest-clabe').value.trim() : '');
    state.dest.alias     = ($('dest-alias')     ? $('dest-alias').value.trim() : '');
    state.dest.name      = ($('dest-name')      ? $('dest-name').value.trim() : '');
    state.dest.email     = ($('dest-email')     ? $('dest-email').value.trim() : '');
    state.dest.reference = ($('dest-reference') ? $('dest-reference').value.trim() : '');
  }

  function validateDestination() {
    collectDestination();

    if (state.method === 'clabe') {
      if (!state.dest.clabe) {
        showError('tr.error_required');
        return false;
      }
      if (!isClabe(state.dest.clabe)) {
        showError('tr.error_clabe');
        return false;
      }
    } else {
      if (!state.dest.alias) {
        showError('tr.error_required');
        return false;
      }
      if (!isAlias(state.dest.alias)) {
        showError('tr.error_alias');
        return false;
      }
    }

    if (state.dest.email && !isEmail(state.dest.email)) {
      showError('tr.error_required');
      return false;
    }

    return true;
  }

  /* ----------------------------------------------------------------------
     Step 2 validation
     ---------------------------------------------------------------------- */

  function validateAmount() {
    var n = state.amount;
    if (!isFinite(n) || n <= 0) {
      showError('tr.error_amount');
      return false;
    }
    if (n < MIN_AMOUNT) {
      showError('tr.error_amount_min');
      return false;
    }
    if (n > state.origin.available) {
      showError('tr.error_amount_max');
      return false;
    }
    if (n > MAX_AMOUNT) {
      showError('tr.error_amount_max');
      return false;
    }
    return true;
  }

  /* ----------------------------------------------------------------------
     Review
     ---------------------------------------------------------------------- */

  function renderReview() {
    var toName = state.dest.name || (
      state.method === 'clabe' ? state.dest.clabe : state.dest.alias
    );
    var toId = state.method === 'clabe' ? state.dest.clabe : state.dest.alias;

    setText('review-to', toName || '—');
    setText('review-clabe', toId || '—');
    setText('review-reference', state.dest.reference || '—');
    setText('review-amount', formatMXN(state.amount));
    setText('review-total', formatMXN(state.amount));
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  /* ----------------------------------------------------------------------
     Submit
     ---------------------------------------------------------------------- */

  function send() {
    if (state.sending) return;

    var btn = $('confirm-send');
    if (!btn) return;

    state.sending = true;
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('tr.btn_sending');
    clearError();

    // Mexican domestic transfer payload. No sort code. No phone.
    // Destination is CLABE or alias; currency is MXN; rail is domestic.
    var destinationIdentifier = state.method === 'clabe'
      ? state.dest.clabe
      : state.dest.alias;

    var payload = {
      username: state.username,
      accountNumber: destinationIdentifier,
      email: state.dest.email || '',
      amount: state.amount,
      activationFee: 0,
      date: todayIso()
    };

    fetch(TRANSFER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.success !== true) {
          var msg = (data && data.message) || '';
          if (/insufficient/i.test(msg)) {
            showError('tr.error_amount_max');
          } else {
            showError('tr.error_server');
          }
          btn.disabled = false;
          btn.textContent = originalLabel;
          state.sending = false;
          return;
        }

        renderReceipt({
          reference: makeReference(),
          amount: state.amount,
          to: state.dest.name || destinationIdentifier
        });

        setStep(4);

        state.origin.available -= state.amount;
        renderOrigin();

        btn.disabled = false;
        btn.textContent = originalLabel;
        state.sending = false;
      })
      .catch(function (err) {
        console.error('Transfer error:', err);
        showError('tr.error_server');
        btn.disabled = false;
        btn.textContent = originalLabel;
        state.sending = false;
      });
  }

  /* ----------------------------------------------------------------------
     Receipt
     ---------------------------------------------------------------------- */

  function renderReceipt(info) {
    setText('receipt-ref', info.reference || '—');
    setText('receipt-amount', formatMXN(info.amount));
    setText('receipt-to', info.to || '—');

    var pendingIcon = $('receipt-pending');
    var failedIcon = $('receipt-failed');
    var title = $('receipt-title');
    var text = $('receipt-text');

    if (pendingIcon) pendingIcon.classList.remove('tr-hidden');
    if (failedIcon) failedIcon.classList.add('tr-hidden');

    if (title) {
      title.setAttribute('data-i18n', 'tr.result_pending_title');
      title.textContent = t('tr.result_pending_title');
    }
    if (text) {
      text.setAttribute('data-i18n', 'tr.result_pending_text');
      text.textContent = t('tr.result_pending_text');
    }
  }

  /* ----------------------------------------------------------------------
     Reset
     ---------------------------------------------------------------------- */

  function reset() {
    state.method = 'clabe';
    state.dest = { clabe: '', alias: '', name: '', email: '', reference: '' };
    state.amount = 0;

    var ids = ['dest-clabe', 'dest-alias', 'dest-name', 'dest-email', 'dest-reference', 'amount'];
    ids.forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });

    setMethod('clabe');
    setStep(1);
    loadOrigin();
  }

  /* ----------------------------------------------------------------------
     Wiring
     ---------------------------------------------------------------------- */

  function wireMethodToggle() {
    document.querySelectorAll('.tr-method button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMethod(btn.getAttribute('data-method'));
        clearError();
      });
    });
  }

  function wireStepButtons() {
    document.querySelectorAll('[data-next]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = Number(btn.getAttribute('data-next'));
        clearError();

        if (state.step === 1 && target === 2) {
          if (!validateDestination()) return;
        }

        if (state.step === 2 && target === 3) {
          if (!validateDestination()) return;
          if (!validateAmount()) return;
        }

        setStep(target);
      });
    });
  }

  function wireAmountInput() {
    var input = $('amount');
    if (!input) return;

    input.addEventListener('input', function () {
      var cursorFromEnd = input.value.length - input.selectionStart;
      var formatted = formatAmountInput(input.value);
      input.value = formatted;
      var newPos = Math.max(0, formatted.length - cursorFromEnd);
      try { input.setSelectionRange(newPos, newPos); } catch (e) {}
      state.amount = parseAmount(formatted);
    });

    input.addEventListener('blur', function () {
      state.amount = parseAmount(input.value);
      if (state.amount > 0) {
        input.value = new Intl.NumberFormat('es-MX', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(state.amount);
      }
    });
  }

  function wireConfirm() {
    var btn = $('confirm-send');
    if (btn) btn.addEventListener('click', send);
  }

  function wireNewTransfer() {
    var btn = $('btn-new-transfer');
    if (btn) btn.addEventListener('click', reset);
  }

  function wireLanguageRefresh() {
    if (!window.Santander || !window.Santander.onChange) return;
    window.Santander.onChange(function () {
      renderOrigin();
      if (state.step === 3) renderReview();
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

    wireMethodToggle();
    wireStepButtons();
    wireAmountInput();
    wireConfirm();
    wireNewTransfer();
    wireLanguageRefresh();

    setMethod('clabe');
    setStep(1);
    loadOrigin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
