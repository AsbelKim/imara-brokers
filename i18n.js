// IMARA site translation engine — swaps text for elements tagged with data-i18n*
(function () {
  'use strict';

  const RTL = { ar: true };

  function dig(dict, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
  }

  function applyLang(code) {
    const lc = code.toLowerCase();
    const dict = window.IMARA_TRANSLATIONS && window.IMARA_TRANSLATIONS[lc];

    document.documentElement.lang = lc === 'sw' ? 'sw' : lc;
    document.documentElement.dir = RTL[lc] ? 'rtl' : 'ltr';
    document.body.classList.toggle('rtl', !!RTL[lc]);

    // Plain text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.textContent;
      const key = el.getAttribute('data-i18n');
      const val = dict && dig(dict, key);
      el.textContent = (lc !== 'en' && val) ? val : el.dataset.i18nOrig;
    });

    // Inner HTML (for strings containing inline tags like <strong>)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.innerHTML;
      const key = el.getAttribute('data-i18n-html');
      const val = dict && dig(dict, key);
      el.innerHTML = (lc !== 'en' && val) ? val : el.dataset.i18nOrig;
    });

    // Attributes — format: data-i18n-attr="placeholder:key.path|title:other.key"
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const pairs = el.getAttribute('data-i18n-attr').split('|');
      pairs.forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (!attr || !key) return;
        const origAttr = `data-i18n-orig-${attr}`;
        if (el.getAttribute(origAttr) === null) el.setAttribute(origAttr, el.getAttribute(attr) || '');
        const val = dict && dig(dict, key);
        el.setAttribute(attr, (lc !== 'en' && val) ? val : el.getAttribute(origAttr));
      });
    });
  }

  window.IMARA_I18N = { applyLang };

  document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('ilf_lang') || 'EN';
    applyLang(saved);
  });
})();
