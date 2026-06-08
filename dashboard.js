// API_BASE already declared by script.js, which loads before this file on dashboard.html

const PLAN_LABELS = { starter: 'Starter', standard: 'Standard', advanced: 'Advanced', elite: 'Elite', pro: 'Pro' };
const PHASE_LABELS = { 1: 'Phase 1 — Evaluation', 2: 'Phase 2 — Evaluation', 3: 'Funded Account' };
const PHASE_TARGET_PCT = { 1: 10, 2: 5, 3: 0 };
const PHASE_MAX_DAYS = { 1: 30, 2: 60, 3: null };
const DAILY_LOSS_PCT = 5;
const DRAWDOWN_PCT = 10;
const STATUS_BADGES = {
  active: '🟢 Active', passed: '✅ Passed', failed: '🔴 Failed', funded: '🏆 Funded',
};
// ── FTMO-aligned KYC steps ───────────────────────────────────────
const KYC_STEPS = [
  {
    docType:  'identity_document',
    label:    'Identity Document',
    icon:     '🪪',
    desc:     'A valid government-issued photo ID showing your full name, photo, and date of birth.',
    accepted: 'Passport (data page) · National Identity Card (front)',
    rejected: 'Driver\'s license · Residence permit · Student ID',
    subtypes: [
      { value: 'passport',    label: 'Passport' },
      { value: 'national_id', label: 'National ID Card' },
    ],
  },
  {
    docType:       'identity_document_back',
    label:         'Identity Document (Back)',
    icon:          '🪪',
    desc:          'The reverse side of your national ID card showing the MRZ strip or barcode.',
    conditionalOn: 'national_id', // only show when identity_document subtype = national_id
    note:          'Only required if your identity document is a National ID card.',
  },
  {
    docType:  'proof_of_address',
    label:    'Proof of Address',
    icon:     '📋',
    desc:     'A document confirming your current residential address, issued within the last 6 months.',
    accepted: 'Bank statement · Utility bill · Lease agreement · Government letter',
    rejected: 'Bank cards · Handwritten notes · Screenshots · P.O. Box only',
    ageNote:  'Must not be older than 6 months and must show your name and full address.',
    subtypes: [
      { value: 'utility_bill',      label: 'Utility Bill' },
      { value: 'bank_statement',    label: 'Bank Statement' },
      { value: 'lease_agreement',   label: 'Lease Agreement' },
      { value: 'government_letter', label: 'Government Letter' },
    ],
  },
];

const token  = localStorage.getItem('ilf_token');
let trader          = null;
let challenges      = [];
let payouts         = [];
let paymentMethods  = [];
let kycDocs         = [];
let kycStatus       = 'not_started';
let active          = null; // active/most-relevant challenge
let selectedPmId    = null; // chosen payment method for payout
let trialStatus     = { has_trial: false, trial: null };

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function clampPct(n) { return Math.max(0, Math.min(100, n)); }
function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

async function authFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    localStorage.removeItem('ilf_token');
    localStorage.removeItem('ilf_trader');
    window.location.href = 'login.html';
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function pickActive(list) {
  if (!list.length) return null;
  return list.find(c => c.status === 'active') || list.find(c => c.status === 'funded') || list[0];
}

function emptyState(message, ctaLabel, ctaHandler) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'text-align:center;padding:2.5rem 1rem;color:var(--muted);';
  wrap.innerHTML = `<p style="margin-bottom:${ctaLabel ? '1rem' : '0'};font-size:0.9rem;">${message}</p>`;
  if (ctaLabel) {
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.style.cssText = 'cursor:pointer;';
    btn.textContent = ctaLabel;
    btn.addEventListener('click', ctaHandler);
    wrap.appendChild(btn);
  }
  return wrap;
}

// ── UI helpers (sidebar / tabs / toast) ─────────────────────────
function switchTab(id) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.side-link[data-tab]').forEach(l => l.classList.remove('active'));
  const section = document.getElementById(id);
  if (section) section.classList.add('active');
  document.querySelectorAll(`.side-link[data-tab="${id}"]`).forEach(l => l.classList.add('active'));
  closeSidebar();
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const dh = document.getElementById('dash-hamburger');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('open');
  if (dh) dh.classList.remove('open');
}

function dashToast(msg, type) {
  const t = document.getElementById('dash-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast toast-' + type + ' show';
  setTimeout(() => t.className = 'toast', 4500);
}

// ── Renderers ────────────────────────────────────────────────────
function renderTopbar() {
  const chip = document.querySelector('.balance-chip strong');
  if (chip) chip.textContent = active ? `USD ${Number(active.account_size).toLocaleString()}.00` : '—';
}

function renderTrialBanner(container) {
  let banner = document.getElementById(‘trial-offer-banner’);
  if (trialStatus.has_trial) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement(‘div’);
    banner.id = ‘trial-offer-banner’;
    banner.style.cssText = ‘background:linear-gradient(135deg,rgba(201,168,76,0.15),rgba(201,168,76,0.05));border:1px solid var(--accent);border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;’;
    banner.innerHTML = `
      <div>
        <p style="margin:0 0 0.25rem;font-weight:700;font-size:1rem;color:var(--accent);">Try IMARA Free — $5,000 Practice Account</p>
        <p style="margin:0;font-size:0.85rem;color:var(--muted);">No payment required. Same rules as the real challenge. One free trial per account.</p>
      </div>
      <button id="start-trial-btn" class="btn-primary" style="white-space:nowrap;padding:0.55rem 1.25rem;">Start Free Trial</button>
    `;
    container.insertBefore(banner, container.firstChild);

    document.getElementById(‘start-trial-btn’).addEventListener(‘click’, async () => {
      const btn = document.getElementById(‘start-trial-btn’);
      btn.disabled = true; btn.textContent = ‘Starting…’;
      try {
        await authFetch(‘/challenges’, {
          method: ‘POST’,
          headers: { ‘Content-Type’: ‘application/json’ },
          body: JSON.stringify({ plan: ‘free_trial’ }),
        });
        dashToast(‘Free trial started! Your $5,000 practice account is ready.’, ‘success’);
        challenges     = await authFetch(‘/challenges’);
        trialStatus    = await authFetch(‘/challenges/trial-status’);
        active         = pickActive(challenges);
        renderTrialBanner(container);
        renderOverview();
        renderChallenges();
      } catch (err) {
        dashToast(err.message || ‘Could not start free trial’, ‘error’);
        btn.disabled = false; btn.textContent = ‘Start Free Trial’;
      }
    });
  }
}

function renderOverview() {
  const overview = document.getElementById(‘tab-overview’);
  if (!overview) return;

  const banner = overview.querySelector(‘.eval-banner’);
  const statsWrap = overview.querySelector(‘.dash-stats’);
  const tradesPanel = overview.querySelector(‘.mini-trades-panel’);

  // Inject trial offer if applicable
  const overviewInner = overview.querySelector(‘.tab-inner’) ?? overview;
  renderTrialBanner(overviewInner);

  if (!active) {
    banner.replaceWith(emptyState(
      ‘You don\’t have an active challenge yet. Start a free trial or choose a plan.’,
      ‘View Challenge Plans’, () => { window.location.href = ‘index.html#challenges’; }
    ));
    statsWrap.style.display = ‘none’;
    const tbl = tradesPanel.querySelector(‘table’);
    if (tbl) tbl.replaceWith(emptyState(‘No trade activity yet.’));
    return;
  }

  const target         = active.profit_target_usd    ?? (active.account_size * (PHASE_TARGET_PCT[active.phase] ?? 0) / 100);
  const dailyLossLimit = active.daily_loss_limit_usd ?? (active.account_size * DAILY_LOSS_PCT / 100);
  const drawdownLimit  = active.max_drawdown_usd      ?? (active.account_size * DRAWDOWN_PCT   / 100);
  const profitPct = target ? clampPct((active.profit_usd / target) * 100) : 0;
  const lossPct = clampPct((active.daily_loss_usd / dailyLossLimit) * 100);
  const ddPct = clampPct((active.drawdown_usd / drawdownLimit) * 100);

  banner.querySelector('.eval-phase').textContent = active.status === 'funded'
    ? 'Funded Account' : (PHASE_LABELS[active.phase] || `Phase ${active.phase}`);
  banner.querySelector('.eval-account').textContent = `$${active.account_size.toLocaleString()} ${PLAN_LABELS[active.plan] || active.plan} Challenge`;

  const items = banner.querySelectorAll('.eval-item');
  items[0].querySelector('.eval-fill').style.width = profitPct + '%';
  items[0].querySelector('.eval-pct').innerHTML = `${fmtMoney(active.profit_usd)} / ${fmtMoney(target)} <small>(${profitPct.toFixed(0)}%)</small>`;
  items[1].querySelector('.eval-fill').style.width = lossPct + '%';
  items[1].querySelector('.eval-pct').innerHTML = `${fmtMoney(active.daily_loss_usd)} used of ${fmtMoney(dailyLossLimit)} <small>(${lossPct.toFixed(0)}%)</small>`;
  items[2].querySelector('.eval-fill').style.width = ddPct + '%';
  items[2].querySelector('.eval-pct').innerHTML = `${fmtMoney(active.drawdown_usd)} used of ${fmtMoney(drawdownLimit)} <small>(${ddPct.toFixed(0)}%)</small>`;
  banner.querySelector('.eval-days-n').textContent = active.trading_days;

  const maxDays = PHASE_MAX_DAYS[active.phase];
  statsWrap.innerHTML = '';
  const stats = [
    { label: `Profit (${PHASE_LABELS[active.phase] || 'Phase ' + active.phase})`, value: `${active.profit_usd >= 0 ? '+' : ''}${fmtMoney(active.profit_usd)}`, change: target ? `▲ ${profitPct.toFixed(1)}% toward target` : 'No profit target — funded account', green: active.profit_usd >= 0 },
    { label: 'Daily Loss Used', value: fmtMoney(active.daily_loss_usd), change: `${lossPct.toFixed(0)}% of ${fmtMoney(dailyLossLimit)} limit` },
    { label: 'Max Drawdown Used', value: fmtMoney(active.drawdown_usd), change: `${ddPct.toFixed(0)}% of ${fmtMoney(drawdownLimit)} limit` },
    { label: 'Trading Days', value: maxDays ? `${active.trading_days} of ${maxDays}` : `${active.trading_days}`, change: `Started ${fmtDate(active.start_date)}` },
  ];
  stats.forEach(s => {
    const d = document.createElement('div');
    d.className = s.green ? 'dstat green' : 'dstat';
    d.innerHTML = `<p class="dstat-label">${esc(s.label)}</p><p class="dstat-value ${s.green ? 'green-text' : ''}">${esc(s.value)}</p><p class="dstat-change">${esc(s.change)}</p>`;
    statsWrap.appendChild(d);
  });
  statsWrap.style.display = '';

  const tbl = tradesPanel.querySelector('table');
  if (tbl) tbl.replaceWith(emptyState('No trade activity yet — your live trades will appear here once your MT5 account is connected and you start trading.'));
}

function progressRow(label, valueLabel, pct, danger) {
  return `
    <div class="ch-prog-item">
      <div class="ch-prog-label"><span>${esc(label)}</span><span class="${danger ? '' : 'green-text'}">${valueLabel}</span></div>
      <div class="eval-bar ${danger ? 'eval-bar-red' : ''}" style="height:8px;"><div class="eval-fill ${danger ? 'red-fill' : ''}" style="width:${pct}%;"></div></div>
      <span class="ch-prog-pct ${danger ? '' : 'green-text'}">${pct.toFixed(0)}% ${danger ? 'of limit' : 'complete'}</span>
    </div>`;
}

function renderChallenges() {
  const tab = document.getElementById('tab-challenges');
  if (!tab) return;
  const card = tab.querySelector('.ch-active-card');

  if (!active) {
    card.replaceWith(emptyState(
      'You haven’t started a challenge yet. Choose a plan to begin your evaluation.',
      'View Challenge Plans', () => { window.location.href = 'index.html#challenges'; }
    ));
  } else {
    const target         = active.profit_target_usd    ?? (active.account_size * (PHASE_TARGET_PCT[active.phase] ?? 0) / 100);
    const dailyLossLimit = active.daily_loss_limit_usd ?? (active.account_size * DAILY_LOSS_PCT / 100);
    const drawdownLimit  = active.max_drawdown_usd      ?? (active.account_size * DRAWDOWN_PCT   / 100);
    const profitPct = target ? clampPct((active.profit_usd / target) * 100) : 0;
    const lossPct = clampPct((active.daily_loss_usd / dailyLossLimit) * 100);
    const ddPct = clampPct((active.drawdown_usd / drawdownLimit) * 100);
    const elapsed = daysSince(active.start_date);
    const maxDays = active.max_calendar_days ?? PHASE_MAX_DAYS[active.phase];
    const daysLeft = maxDays ? Math.max(0, maxDays - elapsed) : null;

    card.querySelector('.ch-phase-badge').textContent = PHASE_LABELS[active.phase] || `Phase ${active.phase}`;
    card.querySelector('.ch-status-badge').textContent = STATUS_BADGES[active.status] || active.status;
    const isTrial = active.plan === 'free_trial';
    card.querySelector('.ch-title').textContent = isTrial
      ? `Free Trial — $${active.account_size.toLocaleString()} Practice Account`
      : `${PLAN_LABELS[active.plan] || active.plan} Challenge — $${active.account_size.toLocaleString()}`;
    const deadlineStr = active.deadline ? ` &bull; Deadline: <strong>${fmtDate(active.deadline)}</strong>` : '';
    card.querySelector('.ch-sub').innerHTML = `Started ${fmtDate(active.start_date)} &bull; ${elapsed} of ${maxDays ?? '—'} days elapsed${deadlineStr} &bull; Fee paid: <strong>$${active.fee}</strong> (refunded on first payout)`;
    card.querySelector('.ch-progress-row').innerHTML =
      progressRow('Profit Target', `${fmtMoney(active.profit_usd)} / ${fmtMoney(target)}`, profitPct, false) +
      progressRow('Daily Loss Used', `${fmtMoney(active.daily_loss_usd)} / ${fmtMoney(dailyLossLimit)}`, lossPct, true) +
      progressRow('Max Drawdown Used', `${fmtMoney(active.drawdown_usd)} / ${fmtMoney(drawdownLimit)}`, ddPct, true);

    const statBoxes = card.querySelectorAll('.ch-stat-box');
    statBoxes[0].querySelector('.ch-stat-n').textContent = `${active.profit_usd >= 0 ? '+' : ''}${fmtMoney(active.profit_usd)}`;
    statBoxes[1].querySelector('.ch-stat-n').textContent = daysLeft === null ? '—' : daysLeft;
    statBoxes[2].querySelector('.ch-stat-n').textContent = `${active.profit_split}%`;

    // Mark phase rule cards active/locked based on the real phase
    const ruleCards = tab.querySelectorAll('.ch-rule-card');
    ruleCards.forEach(rc => rc.classList.remove('ch-rule-active'));
    if (active.phase === 1) ruleCards[0]?.classList.add('ch-rule-active');
    else if (active.phase === 2) ruleCards[1]?.classList.add('ch-rule-active');
    else if (active.status === 'funded') ruleCards[2]?.classList.add('ch-rule-active');

    // Populate rule card values dynamically from account size
    const sz = active.account_size;
    const ph1T  = active.profit_target_usd    ?? Math.round(sz * 0.10);
    const daily = active.daily_loss_limit_usd ?? Math.round(sz * 0.05);
    const dd    = active.max_drawdown_usd      ?? Math.round(sz * 0.10);
    const ph1D  = active.min_trading_days      ?? 4;
    const ph2T  = Math.round(sz * 0.05);

    if (ruleCards[0]) {
      const items = ruleCards[0].querySelectorAll('.ch-rule-item strong');
      if (items[0]) items[0].textContent = `10% (${fmtMoney(ph1T)})`;
      if (items[1]) items[1].textContent = `5% (${fmtMoney(daily)})`;
      if (items[2]) items[2].textContent = `10% (${fmtMoney(dd)})`;
      if (items[3]) items[3].textContent = `${ph1D} days`;
      if (items[4]) items[4].textContent = `30 days`;
      if (items[5]) items[5].textContent = '1:100';
      ruleCards[0].querySelector('.ch-rule-label').textContent =
        active.phase === 1 ? '📋 Phase 1 — In Progress' : '✅ Phase 1 — Completed';
    }
    if (ruleCards[1]) {
      const items = ruleCards[1].querySelectorAll('.ch-rule-item strong');
      if (items[0]) items[0].textContent = `5% (${fmtMoney(ph2T)})`;
      if (items[1]) items[1].textContent = `5% (${fmtMoney(daily)})`;
      if (items[2]) items[2].textContent = `10% (${fmtMoney(dd)})`;
      if (items[3]) items[3].textContent = `4 days`;
      if (items[4]) items[4].textContent = `60 days`;
      if (items[5]) items[5].textContent = '1:100';
      ruleCards[1].querySelector('.ch-rule-label').textContent =
        active.phase === 2 ? '📋 Phase 2 — In Progress' : (active.phase > 2 ? '✅ Phase 2 — Completed' : '🔒 Phase 2 — Locked');
    }
    if (ruleCards[2]) {
      const items = ruleCards[2].querySelectorAll('.ch-rule-item strong');
      if (items[4]) items[4].textContent = `${active.profit_split}%`;
      ruleCards[2].querySelector('.ch-rule-label').textContent =
        active.status === 'funded' ? '🏆 Funded Account — Active' : '🏆 Funded Account — Upon Passing';
    }
  }

  // Challenge history table — every challenge the trader has purchased
  const histBody = tab.querySelector('.ch-history-card tbody');
  if (histBody) {
    histBody.innerHTML = '';
    if (!challenges.length) {
      histBody.innerHTML = `<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:1.5rem;">No challenges yet</td></tr>`;
    } else {
      challenges.forEach(c => {
        const statusCls = c.status === 'active' ? 'status-open' : 'status-closed';
        const planLabel = c.plan === 'free_trial'
          ? '<span style="color:var(--accent);font-weight:700;">Free Trial</span>'
          : `<strong>${esc(PLAN_LABELS[c.plan] || c.plan)}</strong>`;
        histBody.innerHTML += `<tr>
          <td>${planLabel}</td>
          <td>$${Number(c.account_size).toLocaleString()}</td>
          <td>${c.plan === 'free_trial' ? '<span style="color:var(--accent);">Free</span>' : `$${c.fee}`}</td>
          <td>${fmtDate(c.start_date)}</td>
          <td><span class="${statusCls}">${esc(STATUS_BADGES[c.status] || c.status)}</span></td>
        </tr>`;
      });
    }
  }
}

function renderTradeHistory() {
  const tab = document.getElementById('tab-history');
  if (!tab) return;
  const cards = tab.querySelectorAll('.hscard-val');
  cards.forEach(c => { c.textContent = '—'; c.classList.remove('green-text'); });
  const wrap = tab.querySelector('.trade-table-wrap');
  const tableEl = wrap.querySelector('table');
  if (tableEl) {
    tableEl.replaceWith(emptyState('No trades recorded yet — once you start trading on your MT5 account, your trade history will appear here.'));
  }
  const filter = wrap.querySelector('.table-filter');
  if (filter) filter.style.display = 'none';
}

const METHOD_LABELS = { mpesa: ‘M-Pesa’, bank_transfer: ‘Bank Transfer’, crypto: ‘Crypto’, skrill: ‘Skrill’ };

function renderPayoutMethods() {
  const list = document.getElementById(‘payout-methods-list’);
  if (!list) return;
  list.innerHTML = ‘’;
  selectedPmId = null;

  if (!paymentMethods.length) {
    list.innerHTML = `<p style="font-size:0.8rem;color:var(--muted);margin:0 0 0.5rem;">No saved payment methods. Add one below.</p>`;
    return;
  }

  paymentMethods.forEach((pm, i) => {
    const id = `pm-${pm.id}`;
    const isDefault = pm.is_default === 1;
    const div = document.createElement(‘div’);
    div.className = ‘method-opt’;
    div.innerHTML = `
      <input type="radio" name="pm_sel" id="${id}" value="${pm.id}" ${isDefault ? ‘checked’ : ‘’}>
      <label for="${id}" class="method-label">
        <span style="font-size:1.1rem;">${pm.type === ‘mpesa’ ? ‘📱’ : pm.type === ‘bank_transfer’ ? ‘🏦’ : pm.type === ‘crypto’ ? ‘🪙’ : ‘💳’}</span>
        <div>
          <span>${esc(pm.label)}</span><br/>
          <small>${METHOD_LABELS[pm.type] || pm.type}${isDefault ? ‘ &bull; Default’ : ‘’}</small>
        </div>
      </label>`;
    list.appendChild(div);
    if (isDefault || i === 0) selectedPmId = pm.id;
  });

  list.querySelectorAll(‘input[name="pm_sel"]’).forEach(r => {
    r.addEventListener(‘change’, () => { selectedPmId = r.value; });
  });
}

function renderPayout() {
  const tab = document.getElementById(‘tab-payout’);
  if (!tab) return;

  const availCard = tab.querySelector(‘.payout-avail-card’);
  const notice    = tab.querySelector(‘.payout-notice’);
  const formCard  = tab.querySelector(‘.payout-form-card’);
  const rulesCard = tab.querySelector(‘.payout-rules-card’);

  if (active?.plan === ‘free_trial’) {
    availCard.querySelector(‘.payout-avail-amount’).textContent = ‘N/A’;
    availCard.querySelector(‘.payout-avail-sub’).textContent = ‘Free trial accounts do not earn real payouts.’;
    notice.innerHTML = `<strong>🎓 This is a free trial account.</strong> Pass the evaluation to prove your skills, then purchase a paid challenge to earn real payouts. <a href="index.html#challenges" style="color:var(--accent);">View plans →</a>`;
    formCard.style.display = ‘none’;
    const splitRow = rulesCard.querySelector(‘.prule:nth-child(4) p’);
    if (splitRow) splitRow.innerHTML = `Free trial — no real payouts`;
  } else if (!active) {
    availCard.querySelector(‘.payout-avail-amount’).textContent = ‘$0.00’;
    availCard.querySelector(‘.payout-avail-sub’).textContent = ‘Start and pass a challenge to unlock payouts.’;
    notice.innerHTML = ‘<strong>🔒 Payouts are locked</strong> — payouts become available once you have a funded account.’;
    formCard.style.display = ‘none’;
  } else {
    const available = (active.profit_usd * active.profit_split) / 100;
    availCard.querySelector(‘.payout-avail-label’).textContent = `Available Profit (${active.profit_split}% split)`;
    availCard.querySelector(‘.payout-avail-amount’).textContent = fmtMoney(Math.max(0, available));
    availCard.querySelector(‘.payout-avail-sub’).textContent = `From ${fmtMoney(active.profit_usd)} gross profit • ${PLAN_LABELS[active.plan] || active.plan} plan — ${active.profit_split}% share`;

    if (active.status !== ‘funded’) {
      notice.innerHTML = ‘<strong>🔒 Not yet funded</strong> — payouts unlock once you pass your evaluation and move to a funded account.’;
      formCard.style.display = ‘none’;
    } else {
      const daysFunded = active.funded_at ? Math.floor((Date.now() - new Date(active.funded_at).getTime()) / 86_400_000) : daysSince(active.start_date);
      if (daysFunded < 14) {
        const remaining = 14 - daysFunded;
        notice.innerHTML = `<strong>⏳ Payout available in ${remaining} day${remaining !== 1 ? ‘s’ : ‘’}</strong> — your first payout unlocks after 14 days of funded trading. You’re at day ${daysFunded}.`;
      } else {
        notice.innerHTML = `<strong>✅ You’re eligible for payout</strong> — submit your request below.`;
      }
      formCard.style.display = ‘’;
    }

    const splitRow = rulesCard.querySelector(‘.prule:nth-child(4) p’);
    if (splitRow) splitRow.innerHTML = `Your profit share: <strong>${active.profit_split}%</strong> (${PLAN_LABELS[active.plan] || active.plan} plan)`;
  }

  renderPayoutMethods();

  // Recent payout requests
  let histWrap = tab.querySelector(‘.payout-history-card’);
  if (!histWrap) {
    histWrap = document.createElement(‘div’);
    histWrap.className = ‘ch-history-card payout-history-card’;
    histWrap.style.marginTop = ‘1.25rem’;
    histWrap.innerHTML = `<h3>Recent Payout Requests</h3><table class="trade-table"><thead><tr><th>Amount</th><th>Method</th><th>Requested</th><th>Status</th></tr></thead><tbody></tbody></table>`;
    formCard.parentElement.appendChild(histWrap);
  }
  const pBody = histWrap.querySelector(‘tbody’);
  pBody.innerHTML = ‘’;
  if (!payouts.length) {
    pBody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:1.25rem;">No payout requests yet</td></tr>`;
  } else {
    payouts.forEach(p => {
      const statusCls = p.status === ‘paid’ ? ‘status-closed’ : ‘status-open’;
      pBody.innerHTML += `<tr>
        <td><strong>${fmtMoney(p.amount_usd)}</strong></td>
        <td>${METHOD_LABELS[p.method] || esc(p.method)}</td>
        <td>${fmtDate(p.requested_at)}</td>
        <td><span class="${statusCls}">${esc(p.status)}</span></td>
      </tr>`;
    });
  }
}

function setupPayoutForm() {
  const form = document.getElementById('payout-form');
  if (!form || form.dataset.wired) return;
  form.dataset.wired = '1';

  // Add payment method toggle
  const addBtn    = document.getElementById('add-payment-method-btn');
  const newPmForm = document.getElementById('new-pm-form');
  const savePmBtn = document.getElementById('save-pm-btn');
  const cancelPmBtn = document.getElementById('cancel-pm-btn');

  addBtn?.addEventListener('click', () => { newPmForm.style.display = ''; addBtn.style.display = 'none'; });
  cancelPmBtn?.addEventListener('click', () => { newPmForm.style.display = 'none'; addBtn.style.display = ''; });

  savePmBtn?.addEventListener('click', async () => {
    const type    = document.getElementById('new-pm-type').value;
    const label   = document.getElementById('new-pm-label').value.trim();
    const details = document.getElementById('new-pm-details').value.trim();
    if (!label || !details) { dashToast('Please fill in label and account details', 'error'); return; }

    savePmBtn.disabled = true; savePmBtn.textContent = 'Saving…';
    try {
      const pm = await authFetch('/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, label, details: { value: details }, is_default: !paymentMethods.length }),
      });
      paymentMethods = await authFetch('/payments');
      selectedPmId = pm.id;
      newPmForm.style.display = 'none';
      addBtn.style.display = '';
      document.getElementById('new-pm-type').value = 'mpesa';
      document.getElementById('new-pm-label').value = '';
      document.getElementById('new-pm-details').value = '';
      renderPayoutMethods();
      dashToast('Payment method saved', 'success');
    } catch (err) {
      dashToast(err.message || 'Could not save payment method', 'error');
    } finally {
      savePmBtn.disabled = false; savePmBtn.textContent = 'Save Method';
    }
  });

  // Payout submission
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!active) return;
    if (active.status !== 'funded') {
      dashToast('Payouts are only available on funded accounts', 'error');
      return;
    }
    if (!selectedPmId) {
      dashToast('Please select or add a payment method first', 'error');
      return;
    }

    const amount = Number(document.getElementById('payout-amount').value);
    if (!amount || amount <= 0) { dashToast('Enter a valid payout amount', 'error'); return; }

    const submitBtn = form.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      await authFetch('/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: active.id, amount_usd: amount, payment_method_id: selectedPmId }),
      });
      dashToast('Payout request submitted successfully', 'success');
      document.getElementById('payout-amount').value = '';
      payouts = await authFetch('/payouts');
      renderPayout();
    } catch (err) {
      dashToast(err.message || 'Failed to submit payout request', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Payout Request';
    }
  });
}

function setupEditProfile(profileCard, profRows) {
  const btn = profileCard.querySelector('.btn-sec');
  if (btn.dataset.wired) return;
  btn.dataset.wired = '1';

  let editing = false;
  btn.addEventListener('click', async () => {
    if (!editing) {
      editing = true;
      btn.lastChild.textContent = ' Save Changes';
      [2, 3].forEach(i => {
        const valSpan = profRows[i].querySelector('span:last-child');
        const current = valSpan.textContent === 'Not provided' ? '' : valSpan.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = current;
        input.style.cssText = 'background:var(--panel2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:0.25rem 0.5rem;font-size:0.85rem;max-width:160px;text-align:right;';
        valSpan.replaceWith(input);
      });
    } else {
      const phone = profRows[2].querySelector('input').value.trim();
      const country = profRows[3].querySelector('input').value.trim();
      btn.disabled = true;
      try {
        trader = await authFetch('/auth/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, country }),
        });
        localStorage.setItem('ilf_trader', JSON.stringify(trader));
        dashToast('Profile updated', 'success');
      } catch (err) {
        dashToast(err.message || 'Failed to update profile', 'error');
      } finally {
        btn.disabled = false;
        editing = false;
        btn.lastChild.textContent = ' Edit Profile';
        renderAccount();
      }
    }
  });
}

function renderAccount() {
  const tab = document.getElementById('tab-account');
  if (!tab) return;
  const cards = tab.querySelectorAll('.account-card');
  const [profileCard, mt5Card, statusCard, securityCard] = cards;

  // Trader profile
  const kycLabelMap = {
    verified:       '<span style="color:var(--green);font-weight:700;">✓ Verified</span>',
    pending_review: '<span style="color:#fbbf24;font-weight:700;">⏳ Pending Review</span>',
    action_required:'<span style="color:#ef4444;font-weight:700;">⚠ Action Required</span>',
    in_progress:    '<span style="color:#fbbf24;font-weight:700;">In Progress</span>',
    not_started:    '<span style="color:var(--muted);font-weight:700;">Not Started</span>',
  };
  const kycLabel = kycLabelMap[kycStatus] ?? kycLabelMap.not_started;
  const profRows = profileCard.querySelectorAll('.arow');
  profRows[0].querySelector('span:last-child').textContent = trader.full_name;
  profRows[1].querySelector('span:last-child').textContent = trader.email;
  profRows[2].querySelector('span:last-child').textContent = trader.phone || 'Not provided';
  profRows[3].querySelector('span:last-child').textContent = trader.country || 'Not provided';
  profRows[4].querySelector('span:last-child').innerHTML = kycLabel;
  setupEditProfile(profileCard, profRows);

  // MT5 credentials — from challenge data (provisioned by admin)
  const mt5Rows = mt5Card.querySelectorAll('.arow');
  if (active?.mt5_login) {
    mt5Rows[0].lastElementChild.textContent = active.mt5_login;
    mt5Rows[1].querySelector('code,span:last-child').textContent = active.mt5_server ?? (active.status === 'funded' ? 'trade.imaralogic.co.ke:443' : 'eval.imaralogic.co.ke:443');
  } else {
    mt5Rows[0].lastElementChild.textContent = active ? 'Pending provisioning — will be emailed' : '—';
    mt5Rows[1].querySelector('code,span:last-child').textContent = active?.status === 'funded' ? 'trade.imaralogic.co.ke:443' : (active ? 'eval.imaralogic.co.ke:443' : '—');
  }
  mt5Rows[4].querySelector('span:last-child').textContent = active?.status === 'funded' ? '1:100 (Funded)' : (active ? '1:100 (Evaluation)' : '—');
  const emailBtn = mt5Card.querySelector('.btn-sec');
  emailBtn.onclick = async () => {
    emailBtn.disabled = true;
    try {
      await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trader.email }),
      });
      dashToast('MT5 credentials re-sent to your email', 'success');
    } catch { dashToast('Could not send — please contact support', 'error'); }
    finally { emailBtn.disabled = false; }
  };

  // Challenge status
  const chRows = statusCard.querySelectorAll('.arow');
  if (active) {
    const target    = active.profit_target_usd ?? (active.account_size * (PHASE_TARGET_PCT[active.phase] ?? 0) / 100);
    const elapsed   = daysSince(active.start_date);
    const maxDays   = active.max_calendar_days ?? PHASE_MAX_DAYS[active.phase];
    chRows[0].querySelector('span:last-child').textContent = `${PLAN_LABELS[active.plan] || active.plan} — $${active.account_size.toLocaleString()}`;
    chRows[1].querySelector('span:last-child').innerHTML = `<span class="challenge-phase-badge">${PHASE_LABELS[active.phase] || `Phase ${active.phase}`}</span>`;
    chRows[2].querySelector('span:last-child').textContent = fmtDate(active.start_date);
    chRows[3].querySelector('span:last-child').textContent = maxDays ? `${elapsed} of ${maxDays}` : `${active.trading_days}`;
    chRows[4].querySelector('span:last-child').textContent = target ? `${fmtMoney(active.profit_usd)} / ${fmtMoney(target)}` : 'No target — funded';
    chRows[5].querySelector('span:last-child').textContent = `$${active.fee} (refunded on 1st payout)`;
  } else {
    chRows.forEach(r => r.querySelector('span:last-child').textContent = '—');
    chRows[0].querySelector('span:last-child').textContent = 'No active challenge';
  }

  // Agreement signing — show if any challenge is in 'passed' state waiting for funded
  const passedCh = challenges.find(c => c.status === 'passed' && !c.agreement_signed_at);
  let agreementBanner = statusCard.querySelector('.agreement-banner');
  if (passedCh && kycStatus === 'verified') {
    if (!agreementBanner) {
      agreementBanner = document.createElement('div');
      agreementBanner.className = 'agreement-banner';
      agreementBanner.style.cssText = 'margin-top:1rem;padding:0.875rem 1rem;background:rgba(201,168,76,0.12);border:1px solid var(--accent);border-radius:8px;';
      statusCard.appendChild(agreementBanner);
    }
    agreementBanner.innerHTML = `
      <p style="font-size:0.85rem;margin:0 0 0.75rem;color:var(--text);">
        <strong>Action required:</strong> You passed Phase 2. Sign the Trader Account Agreement to activate your funded account.
      </p>
      <button class="btn-primary" id="sign-agreement-btn" style="font-size:0.8rem;padding:0.45rem 1rem;">Sign Agreement</button>
    `;
    agreementBanner.querySelector('#sign-agreement-btn').addEventListener('click', async () => {
      const btn = agreementBanner.querySelector('#sign-agreement-btn');
      btn.disabled = true; btn.textContent = 'Signing…';
      try {
        await authFetch(`/challenges/${passedCh.id}/sign-agreement`, { method: 'POST' });
        dashToast('Agreement signed — your funded account is being activated', 'success');
        challenges = await authFetch('/challenges');
        active = pickActive(challenges);
        renderAccount();
        renderChallenges();
      } catch (err) {
        dashToast(err.message || 'Could not sign agreement', 'error');
        btn.disabled = false; btn.textContent = 'Sign Agreement';
      }
    });
  } else if (agreementBanner) {
    agreementBanner.remove();
  }

  // Security
  const secRows = securityCard.querySelectorAll('.arow');
  secRows[2].querySelector('span:last-child').textContent = `Member since ${fmtDate(trader.created_at)}`;
  const changePwBtn = securityCard.querySelector('.btn-sec');
  changePwBtn.onclick = async () => {
    changePwBtn.disabled = true;
    try {
      await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trader.email }),
      });
      dashToast('Password reset link sent to your email', 'success');
    } catch {
      dashToast('Could not send reset link — please try again', 'error');
    } finally {
      changePwBtn.disabled = false;
    }
  };
}

function renderKyc() {
  const tab = document.getElementById('tab-documents');
  if (!tab) return;

  const idDoc     = kycDocs.find(d => d.doc_type === 'identity_document');
  const needsBack = idDoc?.doc_subtype === 'national_id';

  // Compute overall status label
  const statusCfg = {
    verified:        { cls: 'kyc-badge-ok',      label: '✓ Verified' },
    pending_review:  { cls: 'kyc-badge-review',  label: '⏳ Pending Review' },
    action_required: { cls: 'kyc-badge-warn',    label: '⚠ Action Required' },
    in_progress:     { cls: 'kyc-badge-review',  label: 'In Progress' },
    not_started:     { cls: 'kyc-badge-empty',   label: 'Not Started' },
  };
  const sc = statusCfg[kycStatus] ?? statusCfg.not_started;

  tab.innerHTML = `
    <div class="kyc-page">
      <div class="kyc-page-header">
        <div>
          <h3 class="kyc-page-title">Identity Verification</h3>
          <p class="kyc-page-sub">Complete all steps below to unlock your funded account and process payouts.</p>
        </div>
        <span class="kyc-badge ${sc.cls}">${sc.label}</span>
      </div>

      <div class="kyc-steps" id="kyc-steps"></div>

      <div class="kyc-tips">
        <div class="kyc-tips-title">Document Guidelines</div>
        <ul>
          <li>Upload clear, fully visible documents — no glare, shadows, or cropping</li>
          <li>Files must be under 10 MB — accepted formats: JPG, PNG, WebP, or PDF</li>
          <li>Documents must be valid and not expired</li>
          <li>Proof of address must be issued within the last 6 months</li>
          <li>For PDF documents, a compliance officer will review within 1 business day</li>
        </ul>
      </div>
    </div>
  `;

  const stepsEl = tab.querySelector('#kyc-steps');

  KYC_STEPS.forEach((step, idx) => {
    // Hide back-of-ID step unless national_id was uploaded
    if (step.conditionalOn && !needsBack) {
      if (!idDoc) return; // hide entirely until front is uploaded
      // If front uploaded but it's a passport, skip back
      if (idDoc.doc_subtype !== step.conditionalOn) return;
    }

    const doc    = kycDocs.find(d => d.doc_type === step.docType);
    const stepEl = document.createElement('div');
    stepEl.className = 'kyc-step';

    const statusInfo = kycStepStatus(doc);
    stepEl.classList.add(`kyc-step-${statusInfo.state}`);

    const hasUpload = statusInfo.state !== 'approved';

    stepEl.innerHTML = `
      <div class="kyc-step-header">
        <div class="kyc-step-num">${idx + 1}</div>
        <div class="kyc-step-info">
          <div class="kyc-step-label">${step.icon} ${step.label}</div>
          <div class="kyc-step-desc">${step.desc}</div>
        </div>
        <span class="kyc-step-badge ${statusInfo.badgeCls}">${statusInfo.badgeText}</span>
      </div>

      ${statusInfo.state === 'rejected' && doc?.notes ? `
        <div class="kyc-rejection-reason">
          <strong>Rejection reason:</strong> ${esc(doc.notes)}
        </div>` : ''}

      ${statusInfo.state === 'under_review' && doc?.notes ? `
        <div class="kyc-review-note">${esc(doc.notes)}</div>` : ''}

      ${statusInfo.state === 'approved' && doc?.notes ? `
        <div class="kyc-approved-note">${esc(doc.notes)}</div>` : ''}

      ${statusInfo.state === 'approved' ? `
        <div class="kyc-step-actions">
          <button class="kyc-btn-secondary kyc-view-btn" data-id="${doc.id}">View Document</button>
          <button class="kyc-btn-reupload kyc-upload-trigger">Replace</button>
        </div>` : ''}

      ${statusInfo.state === 'under_review' ? `
        <div class="kyc-step-actions">
          <button class="kyc-btn-secondary kyc-view-btn" data-id="${doc.id}">View Document</button>
          <button class="kyc-btn-reupload kyc-upload-trigger">Re-upload</button>
        </div>` : ''}

      ${hasUpload && statusInfo.state !== 'approved' && statusInfo.state !== 'under_review' ? `
        <div class="kyc-upload-area" id="upload-area-${step.docType}">
          ${step.subtypes?.length ? `
            <div class="kyc-subtype-row">
              ${step.subtypes.map(s => `
                <label class="kyc-radio-label">
                  <input type="radio" name="subtype-${step.docType}" value="${s.value}">
                  ${s.label}
                </label>
              `).join('')}
            </div>` : ''}
          ${step.accepted ? `<div class="kyc-accepted"><span class="kyc-accept-label">Accepted:</span> ${step.accepted}</div>` : ''}
          ${step.rejected ? `<div class="kyc-not-accepted"><span class="kyc-reject-label">Not accepted:</span> ${step.rejected}</div>` : ''}
          ${step.ageNote  ? `<div class="kyc-age-note">⚠ ${step.ageNote}</div>` : ''}
          ${step.note     ? `<div class="kyc-cond-note">${step.note}</div>` : ''}
          <button class="kyc-btn-upload kyc-upload-trigger"
                  data-doc="${step.docType}"
                  ${step.subtypes?.length ? 'data-needs-subtype="1"' : ''}>
            Upload Document
          </button>
        </div>` : ''}

      ${statusInfo.state === 'rejected' ? `
        <div class="kyc-upload-area" id="upload-area-${step.docType}">
          ${step.subtypes?.length ? `
            <div class="kyc-subtype-row">
              ${step.subtypes.map(s => `
                <label class="kyc-radio-label">
                  <input type="radio" name="subtype-${step.docType}" value="${s.value}"
                    ${doc?.doc_subtype === s.value ? 'checked' : ''}>
                  ${s.label}
                </label>
              `).join('')}
            </div>` : ''}
          <button class="kyc-btn-upload kyc-upload-trigger"
                  data-doc="${step.docType}"
                  ${step.subtypes?.length ? 'data-needs-subtype="1"' : ''}>
            Re-upload Document
          </button>
        </div>` : ''}
    `;

    // Hidden file input
    const fileInput = document.createElement('input');
    fileInput.type    = 'file';
    fileInput.accept  = '.jpg,.jpeg,.png,.webp,.pdf';
    fileInput.style.display = 'none';
    stepEl.appendChild(fileInput);

    // View document buttons
    stepEl.querySelectorAll('.kyc-view-btn').forEach(btn => {
      btn.addEventListener('click', () => viewKycFile(btn.dataset.id));
    });

    // Upload trigger buttons
    stepEl.querySelectorAll('.kyc-upload-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const needsSub = btn.dataset.needsSubtype === '1';
        if (needsSub) {
          const checked = stepEl.querySelector(`input[name="subtype-${step.docType}"]:checked`);
          if (!checked) {
            dashToast('Please select a document type first', 'error');
            return;
          }
        }
        fileInput.click();
      });
    });

    // File selected → upload
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      const subtype = stepEl.querySelector(`input[name="subtype-${step.docType}"]:checked`)?.value ?? null;
      const triggers = stepEl.querySelectorAll('.kyc-upload-trigger');
      triggers.forEach(b => { b.disabled = true; b.textContent = 'Checking document…'; });

      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('doc_type', step.docType);
        if (subtype) fd.append('doc_subtype', subtype);

        const result = await authFetch('/kyc/upload', { method: 'POST', body: fd });
        kycStatus = result.kyc_status ?? kycStatus;

        if (result.status === 'approved') {
          dashToast(`${step.label} verified and approved`, 'success');
        } else if (result.status === 'rejected') {
          dashToast(result.notes || `${step.label} rejected — please re-upload`, 'error');
        } else {
          dashToast(`${step.label} submitted — compliance review within 1 business day`, 'success');
        }

        const kycData = await authFetch('/kyc');
        kycDocs   = kycData.documents  ?? kycData ?? [];
        kycStatus = kycData.kyc_status ?? kycStatus;
        renderKyc();
      } catch (err) {
        dashToast(err.message || 'Upload failed', 'error');
        triggers.forEach(b => { b.disabled = false; b.textContent = 'Upload Document'; });
      }
    });

    stepsEl.appendChild(stepEl);
  });
}

function kycStepStatus(doc) {
  if (!doc) return { state: 'empty',        badgeCls: 'badge-empty',   badgeText: 'Upload Required' };
  switch (doc.status) {
    case 'approved':     return { state: 'approved',     badgeCls: 'badge-ok',     badgeText: '✓ Approved' };
    case 'under_review': return { state: 'under_review', badgeCls: 'badge-review', badgeText: '⏳ Under Review' };
    case 'rejected':     return { state: 'rejected',     badgeCls: 'badge-err',    badgeText: '✗ Rejected' };
    default:             return { state: 'empty',        badgeCls: 'badge-empty',  badgeText: 'Upload Required' };
  }
}

async function viewKycFile(docId) {
  try {
    const res = await fetch(`${API_BASE}/kyc/file/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { dashToast('File not found on disk', 'error'); return; }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  } catch {
    dashToast('Could not load document', 'error');
  }
}

// ── Bootstrap ────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [t, c, p, pm, kycData, ts] = await Promise.all([
      authFetch('/auth/me'),
      authFetch('/challenges'),
      authFetch('/payouts'),
      authFetch('/payments'),
      authFetch('/kyc'),
      authFetch('/challenges/trial-status'),
    ]);
    trader          = t;
    challenges      = c;
    payouts         = p;
    paymentMethods  = pm;
    kycDocs         = kycData.documents   ?? kycData ?? [];
    kycStatus       = kycData.kyc_status  ?? 'not_started';
    trialStatus     = ts;
  } catch (err) {
    dashToast(err.message || 'Could not load your account — please refresh', 'error');
    return;
  }

  localStorage.setItem('ilf_trader', JSON.stringify(trader));
  active = pickActive(challenges);

  document.querySelectorAll('.topbar-sub').forEach(p => {
    p.textContent = `Welcome back, ${trader.full_name.split(' ')[0]} • Imara Logic Funded`;
  });

  renderTopbar();
  renderOverview();
  renderChallenges();
  renderTradeHistory();
  renderPayout();
  setupPayoutForm();
  renderAccount();
  renderKyc();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  // Mobile sidebar toggle
  const dh = document.getElementById('dash-hamburger');
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (dh && sb && ov) {
    dh.addEventListener('click', () => {
      sb.classList.toggle('open');
      ov.classList.toggle('open');
      dh.classList.toggle('open');
    });
    ov.addEventListener('click', closeSidebar);
  }

  // Tab switching via sidebar clicks
  document.querySelectorAll('.side-link[data-tab]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      switchTab(link.dataset.tab);
    });
  });

  // Trade history filter buttons (cosmetic — no real trade data yet)
  document.querySelectorAll('.table-filter .tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.table-filter').querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  loadAll().then(async () => {
    // Auto-start free trial if redirected from ?trial=1
    if (new URLSearchParams(window.location.search).get('trial') === '1' && !trialStatus.has_trial) {
      try {
        await authFetch('/challenges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: 'free_trial' }),
        });
        dashToast('Free trial started! Your $5,000 practice account is ready.', 'success');
        challenges  = await authFetch('/challenges');
        trialStatus = await authFetch('/challenges/trial-status');
        active      = pickActive(challenges);
        renderOverview();
        renderChallenges();
      } catch (err) {
        dashToast(err.message || 'Could not start free trial', 'error');
      }
      // Clean URL
      window.history.replaceState({}, '', 'dashboard.html');
    }
  });
});
