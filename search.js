// IMARA site search — finds pages & sections you can't easily browse to
(function () {
  'use strict';

  const btn     = document.getElementById('nav-search-btn');
  const overlay = document.getElementById('search-overlay');
  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  const closeBtn = document.getElementById('search-close');

  if (!btn || !overlay || !input || !results) return;

  // ── Searchable index — title, description, destination & match keywords ──
  const INDEX = [
    { title: 'How the IMARA Challenge Works', desc: 'The 2-phase evaluation, profit targets and funded accounts', url: 'index.html#how', kw: 'challenge evaluation phase profit target funded process how it works' },
    { title: 'Pricing & Account Sizes', desc: 'Choose your challenge size — Starter to Pro ($10K–$200K)', url: 'index.html#challenge', kw: 'pricing fee cost plan account size starter standard advanced elite pro challenge' },
    { title: 'Trading Platform — MetaTrader 5', desc: 'Download MT5, server details, charting & EAs', url: 'index.html#platform', kw: 'platform mt5 metatrader download server expert advisor ea charting' },
    { title: 'Live Markets — Real-Time Charts', desc: 'Interactive live chart — Forex, Gold, Indices & more', url: 'index.html#livecharts', kw: 'live charts markets real time chart price gold forex candlestick trading view' },
    { title: 'Economic Calendar', desc: 'Live interest-rate decisions, jobs data & high-impact news', url: 'index.html#calendar', kw: 'economic calendar news events interest rate data release' },
    { title: 'Trading Calculators', desc: 'Position size, pip value & profit/loss tools', url: 'calculators.html', kw: 'calculator calculators position size pip value profit loss lot risk tools trading' },
    { title: 'Trading Rules & Objectives', desc: 'Profit targets, max daily loss, drawdown & trading days', url: 'index.html#rules', kw: 'rules drawdown daily loss objective target trading days requirements' },
    { title: 'Top Funded Traders', desc: 'Leaderboard of standout IMARA traders', url: 'index.html#traders', kw: 'traders leaderboard top funded stories profiles' },
    { title: 'Payouts & Profit Split', desc: 'Up to 90% profit split — wire, crypto & mobile money', url: 'index.html#payouts', kw: 'payout withdraw profit split mpesa mtn orange wire crypto money' },
    { title: 'People of IMARA', desc: 'Our story, team and where we operate', url: 'index.html#people', kw: 'people team since members countries imara story' },
    { title: 'FAQ', desc: 'Answers to common questions about IMARA', url: 'index.html#faq', kw: 'faq questions answers help support' },
    { title: 'Sign Up / Get Started', desc: 'Create your free IMARA account', url: 'index.html#contact', kw: 'sign up register create account get started form contact join' },
    { title: 'Blog & Insights', desc: 'Strategy notes, market updates and trading lessons', url: 'blog.html', kw: 'blog insights articles posts news strategy market updates lessons' },
    { title: 'About IMARA', desc: 'Our story, mission, values and stats', url: 'about.html', kw: 'about us company story mission values nairobi founded' },
    { title: 'Careers at IMARA', desc: 'Open roles and how to apply', url: 'careers.html', kw: 'careers jobs hiring open positions apply work vacancy' },
    { title: 'Academy — Gateway to Trading', desc: 'New to trading? Start here', url: 'academy.html#gateway', kw: 'academy gateway beginner start learn trading basics demo risk management' },
    { title: 'Academy — Financial Markets', desc: 'Forex, metals, indices, commodities & crypto', url: 'academy.html#markets', kw: 'academy markets forex gold metals indices commodities crypto instruments' },
    { title: 'Academy — Technical Analysis', desc: 'Candlesticks, support & resistance, indicators', url: 'academy.html#technical', kw: 'academy technical analysis chart candlestick indicator support resistance rsi macd' },
    { title: 'Academy — Fundamental Analysis', desc: 'Interest rates, news & economic data', url: 'academy.html#fundamental', kw: 'academy fundamental analysis news interest rates inflation employment' },
    { title: 'Log In — Trader Portal', desc: 'Access your IMARA dashboard', url: 'login.html', kw: 'log in login sign in trader portal account access' },
    { title: 'Terms & Conditions', desc: 'Our rules, terms and legal information', url: 'terms.html', kw: 'terms conditions legal policy rules agreement' },
  ];

  function openSearch() {
    overlay.classList.add('open');
    input.value = '';
    renderResults('');
    setTimeout(() => input.focus(), 60);
  }
  function closeSearch() {
    overlay.classList.remove('open');
  }

  btn.addEventListener('click', openSearch);
  closeBtn.addEventListener('click', closeSearch);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSearch(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeSearch();
    if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) && !overlay.classList.contains('open') && document.activeElement !== input) {
      e.preventDefault();
      openSearch();
    }
  });

  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return INDEX;
    const terms = q.split(/\s+/).filter(Boolean);
    return INDEX
      .map(item => {
        const haystack = `${item.title} ${item.desc} ${item.kw}`.toLowerCase();
        let score = 0;
        terms.forEach(t => {
          if (item.title.toLowerCase().includes(t)) score += 3;
          if (haystack.includes(t)) score += 1;
        });
        return { item, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.item);
  }

  function renderResults(query) {
    const matches = search(query);
    results.innerHTML = '';

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = query.trim()
        ? `No results for "${query.trim()}" — try a different word, e.g. "payouts" or "rules".`
        : 'Start typing to search across IMARA — pages, pricing, platform, academy and more.';
      results.appendChild(empty);
      return;
    }

    matches.forEach((item, i) => {
      const a = document.createElement('a');
      a.className = 'search-result-item' + (i === 0 ? ' active' : '');
      a.href = item.url;
      a.innerHTML = `<span class="sr-title">${esc(item.title)}</span><span class="sr-desc">${esc(item.desc)}</span>`;
      a.addEventListener('click', () => closeSearch());
      results.appendChild(a);
    });
  }

  input.addEventListener('input', () => renderResults(input.value));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const top = results.querySelector('.search-result-item');
      if (top) { window.location.href = top.getAttribute('href'); closeSearch(); }
    }
  });
})();
