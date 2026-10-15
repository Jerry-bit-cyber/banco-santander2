/* ==========================================================================
   statement.js — Santander México account statement
   --------------------------------------------------------------------------
   Loaded on /statement.html.

   Responsibilities:
     - Fetch account + transactions from /api/statement?username=…
     - Populate account header (holder, account number, CLABE, generated).
     - Populate balance summary cards.
     - Render the transaction table with a correct running balance.
     - Apply client-side filters (date range + status).
     - Recompute period summaries (credits, debits, net) from filtered rows.
     - Bind the print button to window.print().
     - Bind the reset button to clear filters.
     - Re-render dynamic values on language toggle.

   Running balance algorithm:
     The server returns a list of transactions with a signed-or-unsigned
     amount and no per-row balance. To display a running balance we sort
     the transactions oldest-first, then start from the balance at the
     beginning of the list.

     Since the server only gives us the CURRENT balance, we derive the
     "opening balance" as:
        opening = current_balance − sum(signed_amounts of all transactions)

     Then we walk forward:
        row_balance = opening + running_sum_of_signed_amounts

     The result: the final row's balance equals the current server balance.

   Amount signs:
     Transactions are stored with a positive number as `amount`. We treat a
     transaction as a credit if its description matches credit keywords
     (Deposit, Salary, Investment, Return, Sale, Revenue, Dividend, Income,
     Gift, Royalty, Payout, Refund, Abono, Depósito) and as a debit
     otherwise. This is a heuristic for the prototype; a real backend
     would carry an explicit `direction` field.
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Constants
     ---------------------------------------------------------------------- */

  var STORAGE_USER_KEY = 'user';
  var LOGIN_URL = '/index.html';
  var STATEMENT_ENDPOINT = '/api/statement';

  // Keywords that mark a transaction as a credit (money in).
  // Matched case-insensitively against the description.
  var CREDIT_KEYWORDS = [
    'deposit', 'salary', 'investment', 'return', 'sale', 'revenue',
    'dividend', 'income', 'gift', 'royalty', 'payout', 'refund',
    'abono', 'depósito', 'deposito', 'salario', 'ingreso'
  ];

  /* ----------------------------------------------------------------------
     Module state
     ---------------------------------------------------------------------- */

  var state = {
    username: null,
    currentBalance: 0,
    account: {
      fullName: '—',
      email: '',
      accountNumber: '',
      clabe: '',
      idNumber: ''
    },
    // Full list of transactions (newest first), as returned by the server.
    transactions: [],
    // Filtered list currently shown.
    filtered: []
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

  // YYYY-MM-DD → DD/MM/YYYY
  function formatDate(iso) {
    if (!iso) return '—';
    var parts = String(iso).split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    return String(iso);
  }

  // Now as DD/MM/YYYY HH:MM
  function formatNow() {
    var d = new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + mi;
  }

  function statusMeta(statusRaw) {
    var s = String(statusRaw || '').toLowerCase();
    if (s === 'completed' || s === 'activa' || s === 'active') {
      return { cls: 's-badge s-badge--completed', key: 'stmt.status_completed' };
    }
    if (s === 'failed' || s === 'fallida') {
      return { cls: 's-badge s-badge--failed', key: 'stmt.status_failed' };
    }
    if (s === 'pending' || s === 'en proceso') {
      return { cls: 's-badge s-badge--pending', key: 'stmt.status_pending' };
    }
    return { cls: 's-badge s-badge--info', key: null, raw: statusRaw || '—' };
  }

  // Heuristic: is this transaction a credit (money in)?
  function isCredit(tx) {
    var desc = String(tx && tx.description || '').toLowerCase();
    for (var i = 0; i < CREDIT_KEYWORDS.length; i++) {
      if (desc.indexOf(CREDIT_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }

  // Signed amount: positive for credits, negative for debits.
  function signedAmount(tx) {
    var n = Number(tx && tx.amount) || 0;
    return isCredit(tx) ? n : -n;
  }

  // Extract a reference number from the transaction if present.
  // The transfer endpoint writes "Transfer to <id> (<email>)" into
  // the description. We surface that as the reference.
  function extractReference(tx) {
    if (tx && tx.reference) return tx.reference;
    var desc = String(tx && tx.description || '');
    var m = desc.match(/Transfer to ([^\s(]+)/i);
    if (m && m[1]) return m[1];
    return '—';
  }

  /* ----------------------------------------------------------------------
     Error surface
     ---------------------------------------------------------------------- */

  function showError(msgKey) {
    var box = $('statement-error');
    if (!box) return;
    box.textContent = t(msgKey);
    box.classList.remove('s-hidden');
  }

  function clearError() {
    var box = $('statement-error');
    if (!box) return;
    box.textContent = '';
    box.classList.add('s-hidden');
  }

  /* ----------------------------------------------------------------------
     Account header + balances
     ---------------------------------------------------------------------- */

  function renderAccountHeader() {
    setText('stmt-holder', state.account.fullName || '—');
    setText('stmt-account-number', state.account.accountNumber || '—');
    setText('stmt-clabe', state.account.clabe || '—');
    setText('stmt-generated', formatNow());
  }

  function renderBalanceCards(pendingBalance) {
    var available = Number(state.currentBalance) || 0;
    var pending = Number(pendingBalance) || 0;
    var total = available + pending;

    setText('stmt-balance-available', formatMXN(available));
    setText('stmt-balance-pending', formatMXN(pending));
    setText('stmt-balance-total', formatMXN(total));
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value == null || value === '' ? '—' : String(value);
  }

  /* ----------------------------------------------------------------------
     Filtering
     ---------------------------------------------------------------------- */

  function applyFilters() {
    var fromEl = $('filter-from');
    var toEl = $('filter-to');
    var statusEl = $('filter-status');

    var from = fromEl && fromEl.value ? new Date(fromEl.value + 'T00:00:00') : null;
    var to   = toEl   && toEl.value   ? new Date(toEl.value   + 'T23:59:59') : null;
    var status = statusEl ? statusEl.value : 'all';

    state.filtered = state.transactions.filter(function (tx) {
      var d = new Date(String(tx.date) + 'T12:00:00');
      if (from && d < from) return false;
      if (to && d > to) return false;

      if (status !== 'all') {
        var s = String(tx.status || '').toLowerCase();
        if (status === 'pending' && s !== 'pending') return false;
        if (status === 'completed' && s !== 'completed') return false;
        if (status === 'failed' && s !== 'failed') return false;
      }

      return true;
    });

    renderTransactions();
  }

  function resetFilters() {
    var fromEl = $('filter-from');
    var toEl = $('filter-to');
    var statusEl = $('filter-status');

    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    if (statusEl) statusEl.value = 'all';

    state.filtered = state.transactions.slice();
    renderTransactions();
  }

  /* ----------------------------------------------------------------------
     Transactions rendering (with correct running balance)
     ---------------------------------------------------------------------- */

  function renderTransactions() {
    var tbody = $('statement-table');
    if (!tbody) return;

    // Sort oldest first for the running balance calculation.
    // The list shown to the user is newest-first (below).
    var chronological = state.filtered.slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });

    // Derive the opening balance:
    //   opening = current_balance − Σ(signed amounts of ALL transactions)
    // Using ALL transactions (not just filtered) so the running balance is
    // correct even when filters are applied.
    var totalSigned = state.transactions.reduce(function (sum, tx) {
      return sum + signedAmount(tx);
    }, 0);
    var opening = Number(state.currentBalance) - totalSigned;

    // Walk forward and record the balance after each transaction.
    var running = opening;
    var balanceByTx = new WeakMap();
    chronological.forEach(function (tx) {
      running += signedAmount(tx);
      balanceByTx.set(tx, running);
    });

    // Display newest first.
    var display = state.filtered.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });

    tbody.innerHTML = '';

    if (display.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 6;
      emptyCell.className = 's-center s-muted s-text-sm';
      emptyCell.textContent = t('stmt.tx_empty');
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      setText('stmt-count', '0');
      renderPeriodSummary();
      return;
    }

    display.forEach(function (tx) {
      var row = document.createElement('tr');
      var credit = isCredit(tx);
      var meta = statusMeta(tx.status);

      // Fecha
      var tdDate = document.createElement('td');
      tdDate.textContent = formatDate(tx.date);

      // Descripción
      var tdDesc = document.createElement('td');
      tdDesc.textContent = tx.description || '—';

      // Referencia
      var tdRef = document.createElement('td');
      tdRef.className = 'stmt-tx-ref';
      tdRef.textContent = extractReference(tx);

      // Monto (signed)
      var tdAmount = document.createElement('td');
      tdAmount.className = 's-amount ' +
        (credit ? 's-amount--credit stmt-amount-credit'
                : 's-amount--debit stmt-amount-debit');
      tdAmount.textContent = formatMXN(Math.abs(Number(tx.amount) || 0));

      // Saldo (running balance at this row)
      var tdBalance = document.createElement('td');
      tdBalance.className = 's-amount';
      var bal = balanceByTx.get(tx);
      tdBalance.textContent = formatMXN(bal);

      // Estado
      var tdStatus = document.createElement('td');
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
      row.appendChild(tdRef);
      row.appendChild(tdAmount);
      row.appendChild(tdBalance);
      row.appendChild(tdStatus);

      tbody.appendChild(row);
    });

    setText('stmt-count', String(display.length));
    renderPeriodSummary();

    // Re-apply translations to freshly-injected nodes.
    if (window.Santander && window.Santander.applyTranslations) {
      window.Santander.applyTranslations(tbody);
    }
  }

  /* ----------------------------------------------------------------------
     Period summary (computed from filtered rows)
     ---------------------------------------------------------------------- */

  function renderPeriodSummary() {
    var credits = 0;
    var debits = 0;

    state.filtered.forEach(function (tx) {
      var n = Math.abs(Number(tx.amount) || 0);
      if (isCredit(tx)) credits += n;
      else debits += n;
    });

    var net = credits - debits;

    setText('stmt-sum-credits', formatMXN(credits));
    setText('stmt-sum-debits', formatMXN(debits));
    setText('stmt-sum-net', formatMXN(net));
  }

  /* ----------------------------------------------------------------------
     Data fetch
     ---------------------------------------------------------------------- */

  function loadStatement() {
    clearError();

    return fetch(
      STATEMENT_ENDPOINT + '?username=' + encodeURIComponent(state.username),
      { headers: { 'Accept': 'application/json' } }
    )
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.success !== true) {
          showError('stmt.error_load');
          return;
        }

        state.currentBalance = Number(data.balance) || 0;
        state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
        state.filtered = state.transactions.slice();

        // Populate account header from /api/dashboard (has the extended user object).
        // /api/statement does not return the user object, so we fetch it separately.
        return fetchDashboardUser().then(function (user) {
          if (user) {
            state.account = user;
          }
          renderAccountHeader();
          renderBalanceCards(user && user.pendingBalance);
          renderTransactions();
        });
      })
      .catch(function (err) {
        console.error('Statement load error:', err);
        showError('stmt.error_load');
      });
  }

  // Fetch the dashboard endpoint to obtain the extended user object
  // (fullName, accountNumber, clabe, pendingBalance). /api/statement
  // does not return these fields.
  function fetchDashboardUser() {
    return fetch(
      '/api/dashboard?username=' + encodeURIComponent(state.username),
      { headers: { 'Accept': 'application/json' } }
    )
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.success !== true) return null;
        var u = data.user || {};
        return {
          fullName: u.fullName || '—',
          email: u.email || '',
          accountNumber: u.accountNumber || '',
          clabe: u.clabe || '',
          idNumber: u.idNumber || '',
          pendingBalance: Number(data.pendingBalance) || 0
        };
      })
      .catch(function () { return null; });
  }

  /* ----------------------------------------------------------------------
     Print
     ---------------------------------------------------------------------- */

  function wirePrint() {
    var btn = $('print-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      try { window.print(); } catch (e) { /* non-fatal */ }
    });
  }

  /* ----------------------------------------------------------------------
     Filters wiring
     ---------------------------------------------------------------------- */

  function wireFilters() {
    var applyBtn = $('filter-apply');
    if (applyBtn) applyBtn.addEventListener('click', applyFilters);

    var resetBtn = $('filter-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);
  }

  /* ----------------------------------------------------------------------
     Language change — re-render dynamic text
     ---------------------------------------------------------------------- */

  function wireLanguageRefresh() {
    if (!window.Santander || !window.Santander.onChange) return;
    window.Santander.onChange(function () {
      // Re-render dates/months and badges in the table.
      renderTransactions();
      renderAccountHeader();
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

    wireFilters();
    wirePrint();
    wireLanguageRefresh();

    setText('stmt-generated', formatNow());
    loadStatement();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
