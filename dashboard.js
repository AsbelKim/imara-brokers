// API_BASE already declared by script.js, which loads before this file on dashboard.html

const PLAN_LABELS = { starter: 'Starter', standard: 'Standard', advanced: 'Advanced', elite: 'Elite', pro: 'Pro' };
const PHASE_LABELS = { 1: 'Phase 1 — Evaluation', 2: 'Phase 2 — Evaluation', 3: 'Funded Account' };
const PHASE_TARGET_PCT = { 1: 8, 2: 5, 3: 0 };
const PHASE_MAX_DAYS = { 1: 30, 2: 60, 3: null };
const DAILY_LOSS_PCT = 5;
const DRAWDOWN_PCT = 10;
const STATUS_BADGES = {
  active: '🟢 Active', passed: '✅ Passed', failed: '🔴 Failed', funded: '🏆 Funded',
};
const KYC_DOC_META = {
  national_id_front: { icon: '🪪', name: 'National ID (Front)' },
  national_id_back:  { icon: '🪪', name: 'National ID (Back)' },
  selfie:            { icon: '🤳', name: 'Selfie with ID' },
  bank_statement:    { icon: '🏦', name: 'Bank Statement' },
  utility_bill:      { icon: '📄', name: 'Utility Bill' },
};
const KYC_DOC_NOTE = {
  bank_statement: 'Last 3 months, PDF or image',
  utility_bill: 'Proof of address, not older than 3 months',
};

const token  = localStorage.getItem('ilf_token');
let trader   = null;
let challenges = [];
let payouts  = [];
let kycDocs  = [];
let active   = null; // active/most-relevant challenge

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

function renderOverview() {
  const overview = document.getElementById('tab-overview');
  if (!overview) return;

  const banner = overview.querySelector('.eval-banner');
  const statsWrap = overview.querySelector('.dash-stats');
  const tradesPanel = overview.querySelector('.mini-trades-panel');

  if (!active) {
    banner.replaceWith(emptyState(
      'You don’t have an active challenge yet. Start one to see your evaluation progress here.',
      'View Challenge Plans', () => { window.location.href = 'index.html#challenges'; }
    ));
    statsWrap.style.display = 'none';
    const tbl = tradesPanel.querySelector('table');
    if (tbl) tbl.replaceWith(emptyState('No trade activity yet.'));
    return;
  }

  const targetPct = PHASE_TARGET_PCT[active.phase] ?? 0;
  const target = active.account_size * targetPct / 100;
  const dailyLossLimit = active.account_size * DAILY_LOSS_PCT / 100;
  const drawdownLimit = active.account_size * DRAWDOWN_PCT / 100;
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
    { label: `Profit (${PHASE_LABELS[active.phase] || 'Phase ' + active.phase})`, value: `${active.profit_usd >= 0 ? '+' : ''}${fmtMoney(active.profit_usd)}`, change: targetPct ? `▲ ${profitPct.toFixed(1)}% toward target` : 'No profit target — funded account', green: active.profit_usd >= 0 },
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
    const targetPct = PHASE_TARGET_PCT[active.phase] ?? 0;
    const target = active.account_size * targetPct / 100;
    const dailyLossLimit = active.account_size * DAILY_LOSS_PCT / 100;
    const drawdownLimit = active.account_size * DRAWDOWN_PCT / 100;
    const profitPct = target ? clampPct((active.profit_usd / target) * 100) : 0;
    const lossPct = clampPct((active.daily_loss_usd / dailyLossLimit) * 100);
    const ddPct = clampPct((active.drawdown_usd / drawdownLimit) * 100);
    const elapsed = daysSince(active.start_date);
    const maxDays = PHASE_MAX_DAYS[active.phase];
    const daysLeft = maxDays ? Math.max(0, maxDays - elapsed) : null;

    card.querySelector('.ch-phase-badge').textContent = PHASE_LABELS[active.phase] || `Phase ${active.phase}`;
    card.querySelector('.ch-status-badge').textContent = STATUS_BADGES[active.status] || active.status;
    card.querySelector('.ch-title').textContent = `${PLAN_LABELS[active.plan] || active.plan} Challenge — $${active.account_size.toLocaleString()}`;
    card.querySelector('.ch-sub').innerHTML = `Started ${fmtDate(active.start_date)} &bull; ${elapsed} of ${maxDays ?? '—'} days elapsed &bull; Fee paid: <strong>$${active.fee}</strong> (refunded on first payout)`;
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
        histBody.innerHTML += `<tr>
          <td><strong>${esc(PLAN_LABELS[c.plan] || c.plan)}</strong></td>
          <td>$${Number(c.account_size).toLocaleString()}</td>
          <td>$${c.fee}</td>
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

function renderPayout() {
  const tab = document.getElementById('tab-payout');
  if (!tab) return;

  const availCard = tab.querySelector('.payout-avail-card');
  const notice = tab.querySelector('.payout-notice');
  const formCard = tab.querySelector('.payout-form-card');
  const rulesCard = tab.querySelector('.payout-rules-card');

  if (!active) {
    availCard.querySelector('.payout-avail-amount').textContent = '$0.00';
    availCard.querySelector('.payout-avail-sub').textContent = 'Start and pass a challenge to unlock payouts.';
    notice.innerHTML = '<strong>🔒 Payouts are locked</strong> — payouts become available once you have a funded account.';
    formCard.style.display = 'none';
  } else {
    const available = (active.profit_usd * active.profit_split) / 100;
    availCard.querySelector('.payout-avail-label').textContent = `Available Profit (${active.profit_split}% split)`;
    availCard.querySelector('.payout-avail-amount').textContent = fmtMoney(Math.max(0, available));
    availCard.querySelector('.payout-avail-sub').textContent = `From ${fmtMoney(active.profit_usd)} gross profit • ${PLAN_LABELS[active.plan] || active.plan} plan — ${active.profit_split}% share`;

    if (active.status !== 'funded') {
      notice.innerHTML = '<strong>🔒 Not yet funded</strong> — payouts unlock once you pass your evaluation and move to a funded account.';
      formCard.style.display = 'none';
    } else {
      const elapsed = daysSince(active.start_date);
      if (elapsed < 14) {
        const remaining = 14 - elapsed;
        notice.innerHTML = `<strong>⏳ Payout available in ${remaining} day${remaining !== 1 ? 's' : ''}</strong> — your first payout unlocks after 14 days of funded trading. You're at day ${elapsed}.`;
      } else {
        notice.innerHTML = `<strong>✅ You’re eligible for payout</strong> — bi-weekly payouts are available. Submit a request below.`;
      }
      formCard.style.display = '';
    }

    const splitRow = rulesCard.querySelector('.prule:nth-child(5) p');
    if (splitRow) splitRow.innerHTML = `Your profit share: <strong>${active.profit_split}%</strong> (${PLAN_LABELS[active.plan] || active.plan} plan)`;
  }

  // Recent payout requests
  let histWrap = tab.querySelector('.payout-history-card');
  if (!histWrap) {
    histWrap = document.createElement('div');
    histWrap.className = 'ch-history-card payout-history-card';
    histWrap.style.marginTop = '1.25rem';
    histWrap.innerHTML = `<h3>Recent Payout Requests</h3><table class="trade-table"><thead><tr><th>Amount</th><th>Method</th><th>Requested</th><th>Status</th></tr></thead><tbody></tbody></table>`;
    formCard.parentElement.appendChild(histWrap);
  }
  const pBody = histWrap.querySelector('tbody');
  pBody.innerHTML = '';
  if (!payouts.length) {
    pBody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:1.25rem;">No payout requests yet</td></tr>`;
  } else {
    payouts.forEach(p => {
      const cls = p.status === 'paid' ? 'status-closed' : 'status-open';
      pBody.innerHTML += `<tr>
        <td><strong>${fmtMoney(p.amount_usd)}</strong></td>
        <td>${p.method === 'mpesa' ? 'M-Pesa' : 'Bank Transfer'}</td>
        <td>${fmtDate(p.requested_at)}</td>
        <td><span class="${cls}">${esc(p.status)}</span></td>
      </tr>`;
    });
  }
}

function setupPayoutForm() {
  const form = document.getElementById('payout-form');
  if (!form || form.dataset.wired) return;
  form.dataset.wired = '1';

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!active) return;
    if (active.status !== 'funded') {
      dashToast('Payouts are only available on funded accounts', 'error');
      return;
    }

    const amount = Number(form.querySelector('input[type="number"]').value);
    const method = form.querySelector('input[name="method"]:checked')?.value;
    const account_details = form.querySelectorAll('input[type="text"]')[0].value.trim();
    const account_name = form.querySelectorAll('input[type="text"]')[1].value.trim();

    if (!amount || !method || !account_details || !account_name) {
      dashToast('Please fill in all payout fields', 'error');
      return;
    }

    const submitBtn = form.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      await authFetch('/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: active.id, amount_usd: amount, method, account_details, account_name }),
      });
      dashToast('Payout request submitted successfully', 'success');
      form.reset();
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
  const totalDocs = Object.keys(KYC_DOC_META).length;
  const verified = kycDocs.filter(d => d.status === 'approved').length;
  const kycLabel = verified === totalDocs
    ? '<span style="color:var(--green);font-weight:700;">✓ Verified</span>'
    : `<span style="color:#fbbf24;font-weight:700;">${verified} of ${totalDocs} verified</span>`;
  const profRows = profileCard.querySelectorAll('.arow');
  profRows[0].querySelector('span:last-child').textContent = trader.full_name;
  profRows[1].querySelector('span:last-child').textContent = trader.email;
  profRows[2].querySelector('span:last-child').textContent = trader.phone || 'Not provided';
  profRows[3].querySelector('span:last-child').textContent = trader.country || 'Not provided';
  profRows[4].querySelector('span:last-child').innerHTML = kycLabel;
  setupEditProfile(profileCard, profRows);

  // MT5 credentials — not yet provisioned in our system; be honest about it
  const mt5Rows = mt5Card.querySelectorAll('.arow');
  mt5Rows[0].lastElementChild.textContent = active ? 'Sent to your email' : '— (start a challenge first)';
  mt5Rows[1].lastElementChild.textContent = active?.status === 'funded' ? 'live.imaralogic.co.ke' : 'eval.imaralogic.co.ke';
  mt5Rows[4].querySelector('span:last-child').textContent = active?.status === 'funded' ? '1:100 (Funded)' : '1:200 (Evaluation)';
  const emailBtn = mt5Card.querySelector('.btn-sec');
  emailBtn.onclick = () => dashToast(`MT5 credentials request sent to ${trader.email}`, 'success');

  // Challenge status
  const chRows = statusCard.querySelectorAll('.arow');
  if (active) {
    const targetPct = PHASE_TARGET_PCT[active.phase] ?? 0;
    const target = active.account_size * targetPct / 100;
    const elapsed = daysSince(active.start_date);
    const maxDays = PHASE_MAX_DAYS[active.phase];
    chRows[0].querySelector('span:last-child').textContent = `${PLAN_LABELS[active.plan] || active.plan} — $${active.account_size.toLocaleString()}`;
    chRows[1].querySelector('span:last-child').innerHTML = `<span class="challenge-phase-badge">${PHASE_LABELS[active.phase] || `Phase ${active.phase}`}</span>`;
    chRows[2].querySelector('span:last-child').textContent = fmtDate(active.start_date);
    chRows[3].querySelector('span:last-child').textContent = maxDays ? `${elapsed} of ${maxDays}` : `${active.trading_days}`;
    chRows[4].querySelector('span:last-child').textContent = targetPct ? `${fmtMoney(active.profit_usd)} / ${fmtMoney(target)}` : 'No target — funded';
    chRows[5].querySelector('span:last-child').textContent = `$${active.fee} (refunded on 1st payout)`;
  } else {
    chRows.forEach(r => r.querySelector('span:last-child').textContent = '—');
    chRows[0].querySelector('span:last-child').textContent = 'No active challenge';
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

  const docTypes = Object.keys(KYC_DOC_META);
  const verified = docTypes.filter(t => kycDocs.find(d => d.doc_type === t && d.status === 'approved')).length;
  tab.querySelector('.kyc-progress').innerHTML = `Verified: <strong>${verified} of ${docTypes.length}</strong> documents`;

  const grid = tab.querySelector('.kyc-grid');
  grid.innerHTML = '';

  docTypes.forEach(docType => {
    const meta = KYC_DOC_META[docType];
    const existing = kycDocs.find(d => d.doc_type === docType);
    const card = document.createElement('div');
    card.className = 'kyc-card';

    let statusHtml, extra = '';
    if (existing?.status === 'approved') {
      card.classList.add('kyc-approved');
      statusHtml = '<span class="kyc-status approved">✓ Approved</span>';
    } else if (existing?.status === 'under_review') {
      card.classList.add('kyc-review');
      statusHtml = '<span class="kyc-status review">⏳ Under Review</span>';
    } else if (existing?.status === 'rejected') {
      statusHtml = '<span class="kyc-status required">✗ Rejected — re-upload</span>';
      extra = `<button class="kyc-upload-btn" data-doc="${docType}">Click to Re-upload</button>`;
      if (existing.notes) extra += `<p class="kyc-note">${esc(existing.notes)}</p>`;
    } else {
      statusHtml = '<span class="kyc-status required">⬆ Upload Required</span>';
      extra = `<button class="kyc-upload-btn" data-doc="${docType}">Click to Upload</button>`;
      if (KYC_DOC_NOTE[docType]) extra += `<p class="kyc-note">${KYC_DOC_NOTE[docType]}</p>`;
    }

    card.innerHTML = `<div class="kyc-icon">${meta.icon}</div><div class="kyc-name">${meta.name}</div>${statusHtml}${extra}`;
    grid.appendChild(card);

    const uploadBtn = card.querySelector('.kyc-upload-btn');
    if (uploadBtn) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.jpg,.jpeg,.png,.webp,.pdf';
      fileInput.style.display = 'none';
      card.appendChild(fileInput);

      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading…';
        try {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('doc_type', docType);
          await authFetch('/kyc/upload', { method: 'POST', body: fd });
          dashToast(`${meta.name} uploaded — under review`, 'success');
          kycDocs = await authFetch('/kyc');
          renderKyc();
        } catch (err) {
          dashToast(err.message || 'Upload failed', 'error');
          uploadBtn.disabled = false;
          uploadBtn.textContent = 'Click to Upload';
        }
      });
    }
  });
}

// ── Bootstrap ────────────────────────────────────────────────────
async function loadAll() {
  try {
    [trader, challenges, payouts, kycDocs] = await Promise.all([
      authFetch('/auth/me'),
      authFetch('/challenges'),
      authFetch('/payouts'),
      authFetch('/kyc'),
    ]);
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

  loadAll();
});
