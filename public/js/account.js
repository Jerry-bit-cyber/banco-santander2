/* ==========================================================================
   account.js — Santander México, KYC-style account opening
   --------------------------------------------------------------------------
   Handles:
     - File upload previews (ID front, ID back, profile photo)
     - Client-side validation (file type, size, required fields, CURP/RFC/CP)
     - Base64-encoding of uploads for JSON storage
     - POST /api/account with full payload
     - Rendering the "Tu cuenta" result panel
     - POST /api/account/activate to flip status to "Activa"
   ========================================================================== */

(function () {
  'use strict';

  var MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
  var ALLOWED_TYPES = ['image/jpeg', 'image/png'];

  var state = {
    idFront: null,
    idBack: null,
    photo: null,
    createdUser: null // server response after POST /api/account
  };

  function $(id) { return document.getElementById(id); }

  function t(key) {
    return window.Santander && window.Santander.t
      ? window.Santander.t(key)
      : key;
  }

  /* ---------------------------------------------------------------------- */
  /* Error helpers                                                          */
  /* ---------------------------------------------------------------------- */

  function showError(msgKey) {
    var box = $('account-error');
    if (!box) return;
    box.textContent = t(msgKey);
    box.classList.remove('s-hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearError() {
    var box = $('account-error');
    if (!box) return;
    box.textContent = '';
    box.classList.add('s-hidden');
  }

  /* ---------------------------------------------------------------------- */
  /* File handling                                                          */
  /* ---------------------------------------------------------------------- */

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  function validateFile(file) {
    if (!file) return 'acc.error_required';
    if (ALLOWED_TYPES.indexOf(file.type) === -1) return 'acc.error_file_type';
    if (file.size > MAX_FILE_BYTES) return 'acc.error_file_size';
    return null;
  }

  /**
   * Wire one uploader input to a preview <img> and to state[slot].
   */
  function wireUploader(inputId, previewId, slotKey, shape) {
    var input = $(inputId);
    var preview = $(previewId);
    if (!input || !preview) return;

    input.addEventListener('change', function () {
      clearError();
      var file = input.files && input.files[0];
      var errKey = validateFile(file);
      if (errKey) {
        showError(errKey);
        input.value = '';
        preview.classList.remove('is-visible');
        preview.removeAttribute('src');
        state[slotKey] = null;
        return;
      }
      readFileAsDataURL(file)
        .then(function (dataUrl) {
          state[slotKey] = { name: file.name, type: file.type, size: file.size, dataUrl: dataUrl };
          preview.src = dataUrl;
          preview.classList.add('is-visible');
          if (shape === 'avatar') preview.classList.add('is-visible');
        })
        .catch(function () {
          showError('acc.error_server');
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Validation                                                             */
  /* ---------------------------------------------------------------------- */

  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
  }

  function isPhone(v) {
    return /^[+\d][\d\s\-()]{7,}$/.test(v || '');
  }

  function isCurp(v) {
    return /^[A-Z]{4}\d{6}[A-Z]{6}[A-Z0-9]\d$/.test((v || '').toUpperCase());
  }

  function isRfc(v) {
    var s = (v || '').toUpperCase();
    return s.length === 12 || s.length === 13;
  }

  function isCp(v) {
    return /^\d{5}$/.test(v || '');
  }

  function collect() {
    return {
      fullName: $('full-name').value.trim(),
      birthdate: $('birthdate').value,
      curp: $('curp').value.trim().toUpperCase(),
      rfc: $('rfc').value.trim().toUpperCase(),

      idFront: state.idFront,
      idBack: state.idBack,
      photo: state.photo,

      street: $('street').value.trim(),
      number: $('number').value.trim(),
      colonia: $('colonia').value.trim(),
      cp: $('cp').value.trim(),
      city: $('city').value.trim(),
      state: $('state').value.trim(),
      phone: $('phone').value.trim(),
      email: $('email').value.trim(),
      password: $('password').value,

      agree: $('agree').checked
    };
  }

  function validate(data) {
    if (!data.fullName) return 'acc.error_required';
    if (!data.birthdate) return 'acc.error_required';
    if (!isCurp(data.curp)) return 'acc.error_curp';
    if (!isRfc(data.rfc)) return 'acc.error_rfc';
    if (!data.idFront) return 'acc.error_id_front';
    if (!data.idBack) return 'acc.error_id_back';
    if (!data.photo) return 'acc.error_photo';
    if (!data.street || !data.number || !data.colonia) return 'acc.error_required';
    if (!isCp(data.cp)) return 'acc.error_cp';
    if (!data.city || !data.state) return 'acc.error_required';
    if (!isPhone(data.phone)) return 'acc.error_phone';
    if (!isEmail(data.email)) return 'acc.error_email';
    if (!data.password || data.password.length < 8) return 'acc.error_password';
    if (!data.agree) return 'acc.error_agree';
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Result panel                                                           */
  /* ---------------------------------------------------------------------- */

  function renderResult(user, activated) {
    $('result-photo').src = (state.photo && state.photo.dataUrl) || '';
    $('result-holder').textContent = user.fullName || '—';
    $('result-id').textContent = user.idNumber || '—';
    $('result-email').textContent = user.email || '—';
    $('result-rfc').textContent = user.rfc || '—';

    var status = $('result-status');
    if (activated) {
      status.className = 's-badge s-badge--completed';
      status.textContent = t('acc.opened_status_active');
      $('activate-btn').classList.add('acc-hidden');
      $('go-to-login').classList.remove('acc-hidden');
    } else {
      status.className = 's-badge s-badge--pending';
      status.textContent = t('acc.opened_status_pending');
      $('activate-btn').classList.remove('acc-hidden');
      $('go-to-login').classList.add('acc-hidden');
    }

    $('account-result').classList.remove('acc-hidden');
    $('account-form').classList.add('acc-hidden');
    $('account-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------------------------------------------------------------- */
  /* Submit handler                                                         */
  /* ---------------------------------------------------------------------- */

  function onSubmit(ev) {
    ev.preventDefault();
    clearError();

    var data = collect();
    var errKey = validate(data);
    if (errKey) {
      showError(errKey);
      return;
    }

    var btn = $('account-submit');
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('acc.submitting');

    fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.body || res.body.success !== true) {
          var msg = res.body && res.body.message === 'Email already exists'
            ? 'acc.error_duplicate'
            : 'acc.error_server';
          showError(msg);
          return;
        }
        state.createdUser = res.body.user || data;
        // Backend generates idNumber; fall back to email if absent.
        if (!state.createdUser.idNumber) {
          state.createdUser.idNumber = state.createdUser.email || data.email;
        }
        renderResult(state.createdUser, false);
      })
      .catch(function () {
        showError('acc.error_server');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = originalLabel;
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Activation handler                                                     */
  /* ---------------------------------------------------------------------- */

  function onActivate() {
    if (!state.createdUser) return;
    var btn = $('activate-btn');
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = t('acc.activating');

    fetch('/api/account/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: state.createdUser.email,
        agree: true
      })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.body && res.body.success === true) {
          renderResult(state.createdUser, true);
          var msg = $('activate-message');
          msg.textContent = t('acc.activated_text');
          msg.classList.remove('s-hidden');
        } else {
          showError('acc.error_server');
        }
      })
      .catch(function () {
        showError('acc.error_server');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  function init() {
    wireUploader('id-front', 'id-front-preview', 'idFront', 'preview');
    wireUploader('id-back',  'id-back-preview',  'idBack',  'preview');
    wireUploader('photo',    'photo-preview',    'photo',   'avatar');

    var form = $('account-form');
    if (form) form.addEventListener('submit', onSubmit);

    var activateBtn = $('activate-btn');
    if (activateBtn) activateBtn.addEventListener('click', onActivate);

    var goLogin = $('go-to-login');
    if (goLogin) goLogin.addEventListener('click', function () {
      window.location.href = '/index.html';
    });

    // Re-render status badge text on language change.
    if (window.Santander && window.Santander.onChange) {
      window.Santander.onChange(function () {
        if (state.createdUser) {
          var status = $('result-status');
          if (!status) return;
          var isActive = status.classList.contains('s-badge--completed');
          status.textContent = t(isActive
            ? 'acc.opened_status_active'
            : 'acc.opened_status_pending');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
