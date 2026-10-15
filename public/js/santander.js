(function () {
  'use strict';

  var LOGO_URL = 'https://upload.wikimedia.org/wikipedia/commons/b/b8/Banco_Santander_Logotipo.svg';
  var STORAGE_KEY = 'santander.lang';
  var DEFAULT_LANG = 'es';
  var SUPPORTED_LANGS = ['es', 'en'];

  var NAV_ITEMS = [
    { href: '/index.html',     key: 'nav.home'      },
    { href: '/account.html',   key: 'nav.account'   },
    { href: '/dashboard.html', key: 'nav.dashboard' },
    { href: '/transfer.html',  key: 'nav.transfer'  },
    { href: '/statement.html', key: 'nav.statement' }
  ];

  var DICT = {
    es: {
      'nav.home': 'Inicio', 'nav.account': 'Abrir Cuenta',
      'nav.dashboard': 'Panel', 'nav.transfer': 'Transferir',
      'nav.statement': 'Estado de Cuenta',
      'header.brand': 'Santander México',
      'header.menu_open': 'Abrir menú', 'header.menu_close': 'Cerrar menú',
      'header.nav_aria': 'Navegación principal', 'header.lang_aria': 'Seleccionar idioma',
      'chat.label': 'Chatear con un agente',
      'footer.copy': '© 2026 Santander México. Todos los derechos reservados.',
      'footer.disclaimer': 'licenciado por la CNBV.'
    },
    en: {
      'nav.home': 'Home', 'nav.account': 'Open Account',
      'nav.dashboard': 'Dashboard', 'nav.transfer': 'Transfer',
      'nav.statement': 'Statement',
      'header.brand': 'Santander México',
      'header.menu_open': 'Open menu', 'header.menu_close': 'Close menu',
      'header.nav_aria': 'Main navigation', 'header.lang_aria': 'Select language',
      'chat.label': 'Chat with an agent',
      'footer.copy': '© 2026 Santander México. All rights reserved.',
      'footer.disclaimer': 'licensed by the CNBV.'
    }
  };

  var currentLang = DEFAULT_LANG;
  var listeners = [];

  function readStoredLang() {
    try { var v = window.localStorage.getItem(STORAGE_KEY);
      if (v && SUPPORTED_LANGS.indexOf(v) !== -1) return v; } catch (e) {}
    return DEFAULT_LANG;
  }
  function writeStoredLang(lang) {
    try { window.localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function t(key) {
    var table = DICT[currentLang] || {};
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    var fb = DICT[DEFAULT_LANG] || {};
    if (Object.prototype.hasOwnProperty.call(fb, key)) return fb[key];
    return key;
  }
  function extendDict(lang, additions) {
    if (!DICT[lang]) DICT[lang] = {};
    Object.keys(additions || {}).forEach(function (k) { DICT[lang][k] = additions[k]; });
    if (lang === currentLang) applyTranslations(document);
  }
  function mergePageDictionary() {
    var pageDict = window.__SANTANDER_PAGE_DICT__;
    if (!pageDict || typeof pageDict !== 'object') return;
    Object.keys(pageDict).forEach(function (lang) {
      if (!DICT[lang]) DICT[lang] = {};
      var entries = pageDict[lang];
      if (!entries || typeof entries !== 'object') return;
      Object.keys(entries).forEach(function (k) { DICT[lang][k] = entries[k]; });
    });
  }
  function applyTranslations(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    document.documentElement.setAttribute('lang', currentLang === 'es' ? 'es-MX' : 'en');
    document.documentElement.setAttribute('data-lang', currentLang);
  }
  function setLang(lang) {
    if (SUPPORTED_LANGS.indexOf(lang) === -1) return;
    currentLang = lang;
    writeStoredLang(lang);
    document.querySelectorAll('.s-lang__btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
    applyTranslations(document);
    var toggle = document.getElementById('s-menu-toggle');
    var panel = document.getElementById('s-mobile-nav');
    if (toggle && panel) {
      var isOpen = !panel.hasAttribute('hidden');
      toggle.setAttribute('aria-label', t(isOpen ? 'header.menu_close' : 'header.menu_open'));
    }
    listeners.forEach(function (fn) { try { fn(lang); } catch (e) { console.error(e); } });
  }
  function getLang() { return currentLang; }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function currentPath() {
    var p = window.location.pathname;
    return (p === '' || p === '/') ? '/index.html' : p;
  }

  function renderHeader(mount) {
    var path = currentPath();

    var desktopLinks = NAV_ITEMS.map(function (item) {
      var active = path === item.href;
      return '<a href="' + esc(item.href) + '" class="s-nav__link"' +
        ' data-i18n="' + esc(item.key) + '"' +
        (active ? ' aria-current="page"' : '') +
        '>' + esc(t(item.key)) + '</a>';
    }).join('');

    var mobileLinks = NAV_ITEMS.map(function (item) {
      return '<li><a href="' + esc(item.href) + '"' +
        ' data-i18n="' + esc(item.key) + '">' + esc(t(item.key)) + '</a></li>';
    }).join('');

    // The hamburger uses three <span> bars with inline sizes so it cannot
    // collapse regardless of CSS load order or specificity.
    var barStyle = 'display:block;width:22px;height:2px;background:#ffffff;border-radius:2px;';
    var hamburgerInner =
      '<span style="' + barStyle + 'margin-bottom:5px;"></span>' +
      '<span style="' + barStyle + 'margin-bottom:5px;"></span>' +
      '<span style="' + barStyle + '"></span>';

    mount.innerHTML =
      '<header class="s-header">' +
        '<div class="s-container">' +
          '<div class="s-header__inner">' +
            '<a href="/index.html" class="s-header__brand" aria-label="Santander México">' +
              '<img src="' + esc(LOGO_URL) + '" alt="Santander México">' +
              '<span class="s-header__brand-name" data-i18n="header.brand">' + esc(t('header.brand')) + '</span>' +
            '</a>' +
            '<div class="s-header__right">' +
              '<nav class="s-nav" aria-label="' + esc(t('header.nav_aria')) + '"' +
                ' data-i18n-aria-label="header.nav_aria">' + desktopLinks + '</nav>' +
              '<div class="s-lang" role="group"' +
                ' aria-label="' + esc(t('header.lang_aria')) + '"' +
                ' data-i18n-aria-label="header.lang_aria">' +
                '<button type="button" class="s-lang__btn" data-lang="es"' +
                  ' aria-pressed="' + (currentLang === 'es' ? 'true' : 'false') + '">ES</button>' +
                '<button type="button" class="s-lang__btn" data-lang="en"' +
                  ' aria-pressed="' + (currentLang === 'en' ? 'true' : 'false') + '">EN</button>' +
              '</div>' +
              '<button type="button" class="s-menu-toggle" id="s-menu-toggle"' +
                ' aria-label="' + esc(t('header.menu_open')) + '"' +
                ' aria-controls="s-mobile-nav" aria-expanded="false"' +
                ' style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:40px;height:40px;padding:0;">' +
                hamburgerInner +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="s-mobile-nav" id="s-mobile-nav" hidden>' +
          '<ul>' + mobileLinks + '</ul>' +
        '</div>' +
      '</header>';

    mount.querySelectorAll('.s-lang__btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setLang(btn.getAttribute('data-lang')); });
    });

    var toggle = mount.querySelector('#s-menu-toggle');
    var panel = mount.querySelector('#s-mobile-nav');
    if (toggle && panel) {
      toggle.addEventListener('click', function () {
        var willOpen = panel.hasAttribute('hidden');
        if (willOpen) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        toggle.setAttribute('aria-label', t(willOpen ? 'header.menu_close' : 'header.menu_open'));
      });
      panel.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          panel.setAttribute('hidden', '');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', t('header.menu_open'));
        });
      });
    }
  }

  function renderFooter(mount) {
    mount.innerHTML =
      '<footer class="s-footer">' +
        '<div class="s-container">' +
          '<div class="s-footer__inner">' +
            '<div class="s-footer__brand">' +
              '<img src="' + esc(LOGO_URL) + '" alt="Santander México">' +
            '</div>' +
            '<div class="s-footer__copy" data-i18n="footer.copy">' + esc(t('footer.copy')) + '</div>' +
          '</div>' +
          '<p class="s-footer__disclaimer" data-i18n="footer.disclaimer">' + esc(t('footer.disclaimer')) + '</p>' +
        '</div>' +
      '</footer>';
  }

  function renderChatFab() {
    if (document.querySelector('.s-chat-fab')) return;
    var a = document.createElement('a');
    a.className = 's-chat-fab';
    a.href = 'https://chat.google.com';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', t('chat.label'));
    a.setAttribute('data-i18n-aria-label', 'chat.label');
    a.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M3.5 4h17c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H10.5L6 20.5V17H3.5c-.83 0-1.5-.67-1.5-1.5v-10C2 4.67 2.67 4 3.5 4z" fill="#00AC47"/>' +
        '<circle cx="8"  cy="10.5" r="1.1" fill="#ffffff"/>' +
        '<circle cx="12" cy="10.5" r="1.1" fill="#ffffff"/>' +
        '<circle cx="16" cy="10.5" r="1.1" fill="#ffffff"/>' +
      '</svg>' +
      '<span class="s-chat-fab__tooltip" data-i18n="chat.label">' + esc(t('chat.label')) + '</span>';
    document.body.appendChild(a);
  }

  function init() {
    mergePageDictionary();
    currentLang = readStoredLang();
    var headerMount = document.getElementById('santander-header');
    var footerMount = document.getElementById('santander-footer');
    if (headerMount) renderHeader(headerMount);
    if (footerMount) renderFooter(footerMount);
    renderChatFab();
    applyTranslations(document);
  }

  window.Santander = {
    t: t, setLang: setLang, getLang: getLang,
    extendDict: extendDict, onChange: onChange,
    applyTranslations: applyTranslations
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
