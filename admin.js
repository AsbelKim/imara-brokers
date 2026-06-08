/* ── State ─────────────────────────────────────────────────────────────── */
const API = '/api/admin';
let adminKey = '';
let currentSection = 'overview';

const state = {
  kyc:        { page: 1, filter: '' },
  traders:    { page: 1, search: '' },
  challenges: { page: 1, filter: '' },
  payouts:    { page: 1, filter: '' },
};

/* ── Bootstrap ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('ilf_admin_key');
  if (saved) {
    adminKey = saved;
    showPanel();
  }

  document.getElementById('admin-login-form').addEventListener('submit', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.section));
  });

  // KYC filters
  document.querySelectorAll('#kyc-filters .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.kyc.filter = btn.dataset.filter;
      state.kyc.page = 1;
      activateTab('#kyc-filters', btn);
      loadKYC();
    });
  });

  // Challenge filters
  document.querySelectorAll('#challenge-filters .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.challenges.filter = btn.dataset.filter;
      state.challenges.page = 1;
      activateTab('#challenge-filters', btn);
      loadChallenges();
    });
  });

  // Payout filters
  document.querySelectorAll('#payout-filters .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.payouts.filter = btn.dataset.filter;
      state.payouts.page = 1;
      activateTab('#payout-filters', btn);
      loadPayouts();
    });
  });

  // Trader search
  let searchTimer;
  document.getElementById('trader-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.traders.search = e.target.value.trim();
      state.traders.page = 1;
      loadTraders();
    }, 350);
  });
});

/* ── Auth ──────────────────────────────────────────────────────────────── */
async function handleLogin(e) {
  e.preventDefault();
  const key = document.getElementById('admin-key-input').value.trim();
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res = await fetch(`${API}/stats`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) {
      errEl.textContent = 'Invalid API key. Please try again.';
      return;
    }
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    adminKey = key;
    sessionStorage.setItem('ilf_admin_key', key);
    showPanel();
  } catch (err) {
    errEl.textContent = 'Could not reach the server. Is it running?';
  }
}

function logout() {
  sessionStorage.removeItem('ilf_admin_key');
  adminKey = '';
  document.getElementById('admin-panel').classList.add('hidden');
  document.getElementById('admin-login-screen').style.display = 'flex';
}

function showPanel() {
  document.getElementById('admin-login-screen').style.display = 'none';
  document.getElementById('admin-panel').classList.remove('hidden');
  navigate('overview');
}

/* ── Navigation ────────────────────────────────────────────────────────── */
function navigate(section) {
  currentSection = section;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });

  document.querySelectorAll('.section').forEach(el => {
    el.classList.toggle('active', el.id === `section-${section}`);
    el.classList.toggle('hidden', el.id !== `section-${section}`);
  });

  const titles = { overview: 'Overview', kyc: 'KYC Review', traders: 'Traders', challenges: 'Challenges', payouts: 'Payouts' };
  document.getElementById('section-title').textContent = titles[section] || section;

  const loaders = { overview: loadOverview, kyc: loadKYC, traders: loadTraders, challenges: loadChallenges, payouts: loadPayouts };
  if (loaders[section]) loaders[section]();
}

function activateTab(selector, activeBtn) {
  document.querySelectorAll(`${selector} .filter-tab`).forEach(b => b.classList.remove('active'));
  activeBtn.classList.add('active');
}

/* ── API helper ────────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ── Overview ──────────────────────────────────────────────────────────── */
async function loadOverview() {
  try {
    const data = await api('/stats');

    const challengeMap = Object.fromEntries((data.challenges || []).map(r => [r.status, r.c]));
    const kycMap       = Object.fromEntries((data.kyc       || []).map(r => [r.status, r.c]));
    const payoutMap    = Object.fromEntries((data.payouts   || []).map(r => [r.status, r.c]));

    const pendingKYC     = (kycMap.under_review || 0) + (kycMap.pending || 0);
    const pendingPayouts = payoutMap.pending || 0;

    // Update sidebar badges
    const kycBadge    = document.getElementById('badge-kyc');
    const payoutBadge = document.getElementById('badge-payouts');
    kycBadge.textContent    = pendingKYC;
    payoutBadge.textContent = pendingPayouts;
    kycBadge.classList.toggle('visible',    pendingKYC > 0);
    payoutBadge.classList.toggle('visible', pendingPayouts > 0);

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total Traders</div>
        <div class="stat-value">${data.traders}</div>
        <div class="stat-sub">registered accounts</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Challenges</div>
        <div class="stat-value">${challengeMap.active || 0}</div>
        <div class="stat-sub">${challengeMap.funded || 0} funded · ${challengeMap.passed || 0} passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">KYC Pending</div>
        <div class="stat-value" style="color:${pendingKYC > 0 ? 'var(--yellow)' : 'var(--gold)'}">${pendingKYC}</div>
        <div class="stat-sub">${kycMap.approved || 0} approved · ${kycMap.rejected || 0} rejected</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Payouts Pending</div>
        <div class="stat-value" style="color:${pendingPayouts > 0 ? 'var(--yellow)' : 'var(--gold)'}">${pendingPayouts}</div>
        <div class="stat-sub">${payoutMap.paid || 0} paid · ${payoutMap.processing || 0} processing</div>
      </div>
    `;

    const signups = data.recentSignups || [];
    document.getElementById('recent-signups').innerHTML = signups.length ? `
      <ul class="signup-list">
        ${signups.map(t => `
          <li class="signup-item">
            <div class="signup-avatar">${(t.full_name || '?')[0].toUpperCase()}</div>
            <div>
              <div class="signup-name">${esc(t.full_name)}</div>
              <div class="signup-email">${esc(t.email)}</div>
            </div>
            <div class="signup-meta">${esc(t.country || '')} · ${fmtDate(t.created_at)}</div>
          </li>
        `).join('')}
      </ul>
    ` : `<div class="empty-state">No signups yet</div>`;

  } catch (err) {
    document.getElementById('stats-grid').innerHTML = `<div style="color:var(--red);padding:16px">${err.message}</div>`;
  }
}

/* ── KYC ───────────────────────────────────────────────────────────────── */
async function loadKYC() {
  const tbody = document.getElementById('kyc-tbody');
  tbody.innerHTML = `<tr><td colspan="5" class="loading-row"><div class="spinner"></div></td></tr>`;

  try {
    const { page, filter } = state.kyc;
    const q = new URLSearchParams({ page, limit: 20, ...(filter && { status: filter }) });
    const data = await api(`/kyc?${q}`);
    const docs = data.documents || [];

    if (!docs.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="loading-row empty-state">No documents found</td></tr>`;
      document.getElementById('kyc-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = docs.map(doc => `
      <tr>
        <td>
          <div style="font-weight:600">${esc(doc.trader_name)}</div>
          <div class="trader-email">${esc(doc.trader_email)}</div>
        </td>
        <td><span class="doc-type-label">${fmtDocType(doc.doc_type)}</span></td>
        <td>${fmtDate(doc.uploaded_at)}</td>
        <td><span class="badge badge-${doc.status}">${fmtStatus(doc.status)}</span></td>
        <td>
          <div class="actions-cell">
            <button class="btn-sm btn-view"    onclick="viewKYCFile('${doc.id}')">View Doc</button>
            <button class="btn-sm btn-approve" onclick="openKYCReview('${doc.id}','${esc(doc.trader_name)}','${doc.doc_type}','approve')">Approve</button>
            <button class="btn-sm btn-reject"  onclick="openKYCReview('${doc.id}','${esc(doc.trader_name)}','${doc.doc_type}','reject')">Reject</button>
          </div>
        </td>
      </tr>
    `).join('');

    renderPagination('kyc-pagination', data.page, Math.ceil(data.total / data.limit), p => {
      state.kyc.page = p;
      loadKYC();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red);padding:16px">${err.message}</td></tr>`;
  }
}

async function viewKYCFile(docId) {
  try {
    const res = await fetch(`${API}/kyc/file/${docId}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    if (!res.ok) { alert('File not found on disk'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch {
    alert('Could not load file');
  }
}

function openKYCReview(docId, traderName, docType, action) {
  const isApprove = action === 'approve';
  showModal(`
    <div class="modal-title">${isApprove ? 'Approve' : 'Reject'} Document</div>
    <div class="modal-sub">${esc(traderName)} — ${fmtDocType(docType)}</div>
    <div class="modal-field">
      <label>Notes (optional)</label>
      <textarea id="kyc-notes" rows="3" placeholder="${isApprove ? 'e.g. Documents verified successfully' : 'e.g. ID is blurry, please re-upload'}"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
      <button class="${isApprove ? 'btn-modal-confirm' : 'btn-modal-danger'}"
              onclick="submitKYCReview('${docId}','${isApprove ? 'approved' : 'rejected'}')">
        ${isApprove ? 'Approve' : 'Reject'}
      </button>
    </div>
  `);
}

async function submitKYCReview(docId, status) {
  const notes = document.getElementById('kyc-notes')?.value.trim() || '';
  try {
    await api(`/kyc/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes }),
    });
    closeModal();
    loadKYC();
    loadOverview();
  } catch (err) {
    alert(err.message);
  }
}

/* ── Traders ───────────────────────────────────────────────────────────── */
async function loadTraders() {
  const tbody = document.getElementById('traders-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="loading-row"><div class="spinner"></div></td></tr>`;

  try {
    const { page, search } = state.traders;
    const q = new URLSearchParams({ page, limit: 20, ...(search && { search }) });
    const data = await api(`/traders?${q}`);
    const traders = data.traders || [];

    if (!traders.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="loading-row empty-state">No traders found</td></tr>`;
      document.getElementById('traders-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = traders.map(t => `
      <tr>
        <td style="font-weight:600">${esc(t.full_name)}</td>
        <td class="trader-email">${esc(t.email)}</td>
        <td>${esc(t.country || '—')}</td>
        <td>${esc(t.preferred_plan || '—')}</td>
        <td>${fmtDate(t.created_at)}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-sm btn-view"   onclick="viewTrader('${t.id}')">Details</button>
            <button class="btn-sm btn-delete" onclick="confirmDeleteTrader('${t.id}','${esc(t.full_name)}')">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    renderPagination('traders-pagination', data.page, Math.ceil(data.total / data.limit), p => {
      state.traders.page = p;
      loadTraders();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:16px">${err.message}</td></tr>`;
  }
}

async function viewTrader(id) {
  showModal(`<div class="spinner" style="margin:40px auto"></div>`);
  try {
    const t = await api(`/traders/${id}`);
    showModal(`
      <div class="modal-title">${esc(t.full_name)}</div>
      <div class="modal-sub">${esc(t.email)}</div>
      <div class="trader-detail-grid">
        <div class="detail-row"><div class="label">Phone</div><div class="value">${esc(t.phone || '—')}</div></div>
        <div class="detail-row"><div class="label">Country</div><div class="value">${esc(t.country || '—')}</div></div>
        <div class="detail-row"><div class="label">Preferred Plan</div><div class="value">${esc(t.preferred_plan || '—')}</div></div>
        <div class="detail-row"><div class="label">Experience</div><div class="value">${esc(t.experience || '—')}</div></div>
        <div class="detail-row"><div class="label">Joined</div><div class="value">${fmtDate(t.created_at)}</div></div>
        <div class="detail-row"><div class="label">Challenges</div><div class="value">${(t.challenges || []).length}</div></div>
      </div>

      <div class="trader-section-title">KYC Documents (${(t.kyc || []).length})</div>
      ${(t.kyc || []).length ? `
        <ul class="mini-list">
          ${t.kyc.map(k => `
            <li class="mini-item">
              <span>${fmtDocType(k.doc_type)}</span>
              <div style="display:flex;gap:8px;align-items:center">
                <span class="badge badge-${k.status}">${fmtStatus(k.status)}</span>
                <button class="btn-sm btn-view" onclick="viewKYCFile('${k.id}')">View</button>
                <button class="btn-sm btn-approve" onclick="closeModal();openKYCReview('${k.id}','${esc(t.full_name)}','${k.doc_type}','approve')">Approve</button>
                <button class="btn-sm btn-reject"  onclick="closeModal();openKYCReview('${k.id}','${esc(t.full_name)}','${k.doc_type}','reject')">Reject</button>
              </div>
            </li>
          `).join('')}
        </ul>
      ` : '<div class="empty-state" style="padding:12px 0">No documents uploaded</div>'}

      <div class="trader-section-title">Challenges (${(t.challenges || []).length})</div>
      ${(t.challenges || []).length ? `
        <ul class="mini-list">
          ${t.challenges.map(c => `
            <li class="mini-item">
              <span>${esc(c.plan)} — Phase ${c.phase}</span>
              <div style="display:flex;gap:8px;align-items:center">
                <span class="badge badge-${c.status}">${fmtStatus(c.status)}</span>
                <button class="btn-sm btn-gold" onclick="closeModal();openChallengeEdit('${c.id}')">Edit</button>
              </div>
            </li>
          `).join('')}
        </ul>
      ` : '<div class="empty-state" style="padding:12px 0">No challenges purchased</div>'}

      <div class="modal-actions">
        <button class="btn-modal-danger" onclick="closeModal();confirmDeleteTrader('${t.id}','${esc(t.full_name)}')">Delete Trader</button>
        <button class="btn-modal-cancel" onclick="closeModal()">Close</button>
      </div>
    `);
  } catch (err) {
    showModal(`<div style="color:var(--red);padding:20px">${err.message}</div>`);
  }
}

function confirmDeleteTrader(id, name) {
  showModal(`
    <div class="modal-title">Delete Trader</div>
    <div class="modal-sub">This will permanently delete <strong>${esc(name)}</strong> and all their challenges, payouts, and KYC documents.</div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-modal-danger" onclick="deleteTrader('${id}')">Delete Permanently</button>
    </div>
  `);
}

async function deleteTrader(id) {
  try {
    await api(`/traders/${id}`, { method: 'DELETE' });
    closeModal();
    loadTraders();
    loadOverview();
  } catch (err) {
    alert(err.message);
  }
}

/* ── Challenges ────────────────────────────────────────────────────────── */
async function loadChallenges() {
  const tbody = document.getElementById('challenges-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="loading-row"><div class="spinner"></div></td></tr>`;

  try {
    const { page, filter } = state.challenges;
    const q = new URLSearchParams({ page, limit: 20, ...(filter && { status: filter }) });
    const data = await api(`/challenges?${q}`);
    const challenges = data.challenges || [];

    if (!challenges.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="loading-row empty-state">No challenges found</td></tr>`;
      document.getElementById('challenges-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = challenges.map(c => `
      <tr>
        <td>
          <div style="font-weight:600">${esc(c.trader_name)}</div>
          <div class="trader-email">${esc(c.trader_email)}</div>
        </td>
        <td>${esc(c.plan)}</td>
        <td>$${Number(c.account_size || 0).toLocaleString()}</td>
        <td>Phase ${c.phase || 1}</td>
        <td><span class="badge badge-${c.status}">${fmtStatus(c.status)}</span></td>
        <td>
          <div class="actions-cell">
            <button class="btn-sm btn-gold" onclick="openChallengeEdit('${c.id}')">Edit</button>
          </div>
        </td>
      </tr>
    `).join('');

    renderPagination('challenges-pagination', data.page, Math.ceil(data.total / data.limit), p => {
      state.challenges.page = p;
      loadChallenges();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:16px">${err.message}</td></tr>`;
  }
}

function openChallengeEdit(id) {
  showModal(`
    <div class="modal-title">Update Challenge</div>
    <div class="modal-sub">Change status, phase, and performance metrics</div>
    <div class="modal-field">
      <label>Status</label>
      <select id="ch-status">
        <option value="active">Active</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
        <option value="funded">Funded</option>
      </select>
    </div>
    <div class="modal-field">
      <label>Phase (1–3)</label>
      <input type="number" id="ch-phase" min="1" max="3" placeholder="e.g. 2">
    </div>
    <div class="modal-field">
      <label>Profit (USD)</label>
      <input type="number" id="ch-profit" min="0" step="0.01" placeholder="e.g. 4200">
    </div>
    <div class="modal-field">
      <label>Trading Days</label>
      <input type="number" id="ch-days" min="0" placeholder="e.g. 21">
    </div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-modal-confirm" onclick="submitChallengeEdit('${id}')">Save Changes</button>
    </div>
  `);
}

async function submitChallengeEdit(id) {
  const payload = {};
  const status  = document.getElementById('ch-status')?.value;
  const phase   = document.getElementById('ch-phase')?.value;
  const profit  = document.getElementById('ch-profit')?.value;
  const days    = document.getElementById('ch-days')?.value;

  if (status)              payload.status      = status;
  if (phase  !== '')       payload.phase       = Number(phase);
  if (profit !== '')       payload.profit_usd  = Number(profit);
  if (days   !== '')       payload.trading_days = Number(days);

  try {
    await api(`/challenges/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    closeModal();
    loadChallenges();
    loadOverview();
  } catch (err) {
    alert(err.message);
  }
}

/* ── Payouts ───────────────────────────────────────────────────────────── */
async function loadPayouts() {
  const tbody = document.getElementById('payouts-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="loading-row"><div class="spinner"></div></td></tr>`;

  try {
    const { page, filter } = state.payouts;
    const q = new URLSearchParams({ page, limit: 20, ...(filter && { status: filter }) });
    const data = await api(`/payouts?${q}`);
    const payouts = data.payouts || [];

    if (!payouts.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="loading-row empty-state">No payouts found</td></tr>`;
      document.getElementById('payouts-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = payouts.map(p => `
      <tr>
        <td>
          <div style="font-weight:600">${esc(p.trader_name)}</div>
          <div class="trader-email">${esc(p.trader_email)}</div>
        </td>
        <td>${esc(p.challenge_plan)} — $${Number(p.account_size || 0).toLocaleString()}</td>
        <td>$${Number(p.amount_usd || 0).toLocaleString()}</td>
        <td>${fmtDate(p.requested_at)}</td>
        <td><span class="badge badge-${p.status}">${fmtStatus(p.status)}</span></td>
        <td>
          <div class="actions-cell">
            <button class="btn-sm btn-approve" onclick="openPayoutAction('${p.id}','paid')">Mark Paid</button>
            <button class="btn-sm btn-view"    onclick="openPayoutAction('${p.id}','processing')">Processing</button>
            <button class="btn-sm btn-reject"  onclick="openPayoutAction('${p.id}','rejected')">Reject</button>
          </div>
        </td>
      </tr>
    `).join('');

    renderPagination('payouts-pagination', data.page, Math.ceil(data.total / data.limit), p => {
      state.payouts.page = p;
      loadPayouts();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:16px">${err.message}</td></tr>`;
  }
}

function openPayoutAction(id, targetStatus) {
  const labels = { paid: 'Mark as Paid', processing: 'Mark as Processing', rejected: 'Reject Payout' };
  const isDanger = targetStatus === 'rejected';
  showModal(`
    <div class="modal-title">${labels[targetStatus]}</div>
    <div class="modal-sub">Update this payout status to <strong>${fmtStatus(targetStatus)}</strong>.</div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
      <button class="${isDanger ? 'btn-modal-danger' : 'btn-modal-confirm'}"
              onclick="submitPayoutAction('${id}','${targetStatus}')">
        Confirm
      </button>
    </div>
  `);
}

async function submitPayoutAction(id, status) {
  try {
    await api(`/payouts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    closeModal();
    loadPayouts();
    loadOverview();
  } catch (err) {
    alert(err.message);
  }
}

/* ── Modal ─────────────────────────────────────────────────────────────── */
function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
}

/* ── Pagination ────────────────────────────────────────────────────────── */
function renderPagination(elId, current, total, onPage) {
  const el = document.getElementById(elId);
  if (total <= 1) { el.innerHTML = ''; return; }

  const pages = [];
  for (let i = 1; i <= total; i++) pages.push(i);

  el.innerHTML = `
    <button class="page-btn" ${current <= 1 ? 'disabled' : ''} onclick="(${onPage})(${current - 1})">‹ Prev</button>
    ${pages.slice(Math.max(0, current - 3), Math.min(total, current + 2)).map(p => `
      <button class="page-btn ${p === current ? 'active' : ''}" onclick="(${onPage})(${p})">${p}</button>
    `).join('')}
    <button class="page-btn" ${current >= total ? 'disabled' : ''} onclick="(${onPage})(${current + 1})">Next ›</button>
    <span class="page-info">Page ${current} of ${total}</span>
  `;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtStatus(s) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtDocType(s) {
  return (s || '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
