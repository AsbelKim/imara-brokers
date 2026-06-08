import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, now } from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { PLANS, PHASE_RULES } from './challenges.js';
import { sendEmail } from '../services/email.js';

// Recalculates and persists trader-level kyc_status after any document change
function syncKycStatus(traderId) {
  const docs    = db.prepare('SELECT * FROM kyc_documents WHERE trader_id = ?').all(traderId);
  const getDoc  = (type) => docs.find(d => d.doc_type === type);
  const idDoc   = getDoc('identity_document');
  const poaDoc  = getDoc('proof_of_address');
  const needsBack = idDoc?.doc_subtype === 'national_id';
  const backDoc   = getDoc('identity_document_back');
  const required  = [idDoc, poaDoc, ...(needsBack ? [backDoc] : [])];
  let status;
  if (!idDoc && !poaDoc)                              status = 'not_started';
  else if (required.some(d => !d))                    status = 'in_progress';
  else if (required.some(d => d?.status === 'rejected')) status = 'action_required';
  else if (required.every(d => d?.status === 'approved')) status = 'verified';
  else                                                status = 'pending_review';
  db.prepare('UPDATE traders SET kyc_status = ? WHERE id = ?').run(status, traderId);
  return status;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(__dirname, '..', 'uploads', 'kyc');

const router = Router();
router.use(requireAdmin);

// ─── STATS ───────────────────────────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const traders      = db.prepare('SELECT COUNT(*) c FROM traders').get().c;
  const challenges   = db.prepare('SELECT status, COUNT(*) c FROM challenges GROUP BY status').all();
  const payouts      = db.prepare('SELECT status, COUNT(*) c, SUM(amount_usd) total FROM payouts GROUP BY status').all();
  const kyc          = db.prepare('SELECT status, COUNT(*) c FROM kyc_documents GROUP BY status').all();
  const recentSignups = db.prepare(
    "SELECT id, full_name, email, country, created_at FROM traders ORDER BY created_at DESC LIMIT 5"
  ).all();

  res.json({ traders, challenges, payouts, kyc, recentSignups });
});

// ─── TRADERS ─────────────────────────────────────────────────────────────────

// GET /api/admin/traders?search=&page=1&limit=20
router.get('/traders', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search}%` : null;

  const where  = search ? 'WHERE email LIKE ? OR full_name LIKE ? OR country LIKE ?' : '';
  const params = search ? [search, search, search] : [];

  const total   = db.prepare(`SELECT COUNT(*) c FROM traders ${where}`).get(...params).c;
  const traders = db.prepare(
    `SELECT id, full_name, email, phone, country, preferred_plan, created_at
     FROM traders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ total, page, limit, traders });
});

// GET /api/admin/traders/:id  — full trader profile with related data
router.get('/traders/:id', (req, res) => {
  const trader = db.prepare(
    'SELECT id, full_name, email, phone, country, preferred_plan, experience, created_at FROM traders WHERE id = ?'
  ).get(req.params.id);
  if (!trader) return res.status(404).json({ error: 'Trader not found' });

  const challenges = db.prepare('SELECT * FROM challenges WHERE trader_id = ? ORDER BY created_at DESC').all(req.params.id);
  const payouts    = db.prepare('SELECT * FROM payouts WHERE trader_id = ? ORDER BY requested_at DESC').all(req.params.id);
  const kyc        = db.prepare('SELECT id, doc_type, doc_subtype, status, uploaded_at, reviewed_at, notes FROM kyc_documents WHERE trader_id = ?').all(req.params.id);

  res.json({ ...trader, challenges, payouts, kyc });
});

// DELETE /api/admin/traders/:id
router.delete('/traders/:id', (req, res) => {
  const trader = db.prepare('SELECT id FROM traders WHERE id = ?').get(req.params.id);
  if (!trader) return res.status(404).json({ error: 'Trader not found' });

  db.prepare('DELETE FROM traders WHERE id = ?').run(req.params.id);
  res.json({ message: 'Trader and all associated data deleted' });
});

// ─── CHALLENGES ──────────────────────────────────────────────────────────────

// GET /api/admin/challenges?status=&page=1&limit=20
router.get('/challenges', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const status = req.query.status;

  const where  = status ? 'WHERE c.status = ?' : '';
  const params = status ? [status] : [];

  const total = db.prepare(`SELECT COUNT(*) c FROM challenges c ${where}`).get(...params).c;
  const rows  = db.prepare(`
    SELECT c.*, t.full_name AS trader_name, t.email AS trader_email
    FROM challenges c
    JOIN traders t ON t.id = c.trader_id
    ${where}
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, page, limit, challenges: rows });
});

// PATCH /api/admin/challenges/:id  — update status, phase, profit, days, violated_rule
router.patch('/challenges/:id', (req, res) => {
  const ch = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });

  const allowed = ['status', 'phase', 'profit_usd', 'daily_loss_usd', 'drawdown_usd',
                   'trading_days', 'current_balance', 'violated_rule'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  const STATUS_VALUES = ['active', 'passed', 'failed', 'funded'];
  if (updates.status && !STATUS_VALUES.includes(updates.status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_VALUES.join(', ')}` });
  }
  if (updates.phase && ![1, 2, 3].includes(Number(updates.phase))) {
    return res.status(400).json({ error: 'phase must be 1, 2 or 3' });
  }

  // Auto-fail with violated_rule
  if (updates.violated_rule && !updates.status) {
    updates.status = 'failed';
  }
  if (updates.status === 'funded' && !updates.funded_at) {
    updates.funded_at = now();
  }

  if (Object.keys(updates).length === 0) return res.json(ch);

  const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE challenges SET ${setClause} WHERE id = @id`).run({ ...updates, id: req.params.id });

  res.json(db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id));
});

// POST /api/admin/challenges/:id/provision-mt5  — set MT5 credentials
router.post('/challenges/:id/provision-mt5', (req, res) => {
  const ch = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });

  const { mt5_login, mt5_password, mt5_server } = req.body;
  if (!mt5_login || !mt5_password) {
    return res.status(400).json({ error: 'mt5_login and mt5_password are required' });
  }

  const server = mt5_server ?? PHASE_RULES[ch.phase]?.mt5_server ?? 'eval.imaralogic.co.ke:443';

  db.prepare(`
    UPDATE challenges SET mt5_login = ?, mt5_password = ?, mt5_server = ?
    WHERE id = ?
  `).run(mt5_login, mt5_password, server, ch.id);

  // Email trader with credentials
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(ch.trader_id);
  const phase  = PHASE_RULES[ch.phase];
  sendEmail({
    to:      trader.email,
    subject: `Your MT5 Account is Ready — ${phase?.label ?? 'Challenge'}`,
    html: `
      <h2>Your MT5 Credentials</h2>
      <p>Hi ${trader.full_name.split(' ')[0]},</p>
      <p>Your trading account is ready. Log in to MetaTrader 5 with the following credentials:</p>
      <table cellpadding="8" style="border-collapse:collapse">
        <tr><td><strong>Login:</strong></td><td>${mt5_login}</td></tr>
        <tr><td><strong>Password:</strong></td><td>${mt5_password}</td></tr>
        <tr><td><strong>Server:</strong></td><td>${server}</td></tr>
        <tr><td><strong>Leverage:</strong></td><td>${phase?.leverage ?? '1:100'}</td></tr>
      </table>
      <p><em>Please change your password after first login.</em></p>
      <p>Imara Logic Team</p>
    `,
  });

  res.json({ message: 'MT5 credentials set and emailed to trader', mt5_login, mt5_server: server });
});

// POST /api/admin/challenges/:id/advance  — advance trader to next phase
router.post('/challenges/:id/advance', (req, res) => {
  const ch = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });

  if (ch.status !== 'active') {
    return res.status(400).json({ error: 'Only active challenges can be advanced' });
  }
  if (ch.phase >= 3) {
    return res.status(400).json({ error: 'Challenge is already at funded phase' });
  }

  const nextPhase = ch.phase + 1;
  const rules     = PHASE_RULES[nextPhase];
  const planInfo  = PLANS[ch.plan];

  // Mark current challenge as passed
  db.prepare("UPDATE challenges SET status = 'passed' WHERE id = ?").run(ch.id);

  const newId = crypto.randomUUID();
  const created_at = now();
  const start_date = created_at.split('T')[0];
  const acctSize   = ch.account_size;
  const deadline   = rules.max_calendar_days
    ? (() => { const d = new Date(); d.setDate(d.getDate() + rules.max_calendar_days); return d.toISOString().split('T')[0]; })()
    : null;

  db.prepare(`
    INSERT INTO challenges (
      id, trader_id, plan, account_size, fee, profit_split, phase, status,
      profit_usd, daily_loss_usd, drawdown_usd, trading_days,
      profit_target_usd, daily_loss_limit_usd, max_drawdown_usd,
      min_trading_days, max_calendar_days, deadline,
      initial_balance, current_balance,
      parent_challenge_id, start_date, created_at, scale_count
    ) VALUES (
      @id, @tid, @plan, @acct, 0, @split, @phase, 'active',
      0, 0, 0, 0,
      @pt, @dll, @mdd,
      @mtd, @mcd, @dl,
      @acct, @acct,
      @parent, @start, @created, 0
    )
  `).run({
    id:      newId,
    tid:     ch.trader_id,
    plan:    ch.plan,
    acct:    acctSize,
    split:   ch.profit_split,
    phase:   nextPhase,
    pt:      rules.profit_target_pct ? Math.round(acctSize * rules.profit_target_pct) : null,
    dll:     Math.round(acctSize * rules.daily_loss_pct),
    mdd:     Math.round(acctSize * rules.max_drawdown_pct),
    mtd:     rules.min_trading_days,
    mcd:     rules.max_calendar_days,
    dl:      deadline,
    parent:  ch.id,
    start:   start_date,
    created: created_at,
  });

  // Email trader
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(ch.trader_id);
  const isFunded = nextPhase === 3;

  if (isFunded) {
    db.prepare("UPDATE challenges SET status = 'funded', funded_at = ? WHERE id = ?")
      .run(now(), newId);
    // Update trader agreement_signed_at if already signed
    db.prepare('UPDATE traders SET kyc_status = kyc_status WHERE id = ?').run(ch.trader_id); // no-op touch
  }

  sendEmail({
    to:      trader.email,
    subject: isFunded
      ? `Congratulations — You Passed! Your Funded Account is Ready`
      : `Phase ${ch.phase} Passed — Phase ${nextPhase} Challenge Ready`,
    html: isFunded ? `
      <h2>You Passed the Verification! 🎉</h2>
      <p>Hi ${trader.full_name.split(' ')[0]},</p>
      <p>Congratulations — you have successfully completed both phases and have been promoted to a <strong>Funded Account</strong>.</p>
      <p>Your new MT5 credentials will be sent separately. Please complete your KYC and sign the account agreement to begin trading your funded account.</p>
      <p>Imara Logic Team</p>
    ` : `
      <h2>Phase ${ch.phase} Complete!</h2>
      <p>Hi ${trader.full_name.split(' ')[0]},</p>
      <p>You have successfully passed <strong>${PHASE_RULES[ch.phase].label}</strong>.</p>
      <p>Your <strong>${rules.label}</strong> challenge is now active. New MT5 credentials will follow shortly.</p>
      <ul>
        <li>Profit Target: <strong>${rules.profit_target_pct ? (rules.profit_target_pct * 100) + '%' : 'No target'}</strong></li>
        <li>Daily Loss Limit: <strong>${(rules.daily_loss_pct * 100)}%</strong></li>
        <li>Max Drawdown: <strong>${(rules.max_drawdown_pct * 100)}%</strong></li>
        ${rules.max_calendar_days ? `<li>Calendar Days: <strong>${rules.max_calendar_days} (deadline: ${deadline})</strong></li>` : ''}
      </ul>
      <p>Imara Logic Team</p>
    `,
  });

  const newChallenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(newId);
  const { mt5_password, ...safe } = newChallenge;
  res.status(201).json({ message: `Advanced to ${rules.label}`, challenge: safe });
});

// ─── PAYOUTS ─────────────────────────────────────────────────────────────────

// GET /api/admin/payouts?status=&page=1&limit=20
router.get('/payouts', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const status = req.query.status;

  const where  = status ? 'WHERE p.status = ?' : '';
  const params = status ? [status] : [];

  const total = db.prepare(`SELECT COUNT(*) c FROM payouts p ${where}`).get(...params).c;
  const rows  = db.prepare(`
    SELECT p.*, t.full_name AS trader_name, t.email AS trader_email,
           c.plan AS challenge_plan, c.account_size
    FROM payouts p
    JOIN traders t ON t.id = p.trader_id
    JOIN challenges c ON c.id = p.challenge_id
    ${where}
    ORDER BY p.requested_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, page, limit, payouts: rows });
});

// PATCH /api/admin/payouts/:id  — update status + optional processed_at
router.patch('/payouts/:id', (req, res) => {
  const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(req.params.id);
  if (!payout) return res.status(404).json({ error: 'Payout not found' });

  const STATUS_VALUES = ['pending', 'processing', 'paid', 'rejected'];
  const { status, notes } = req.body;

  if (!status) return res.status(400).json({ error: 'status is required' });
  if (!STATUS_VALUES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_VALUES.join(', ')}` });
  }

  const processed_at = ['paid', 'rejected'].includes(status) ? now() : null;
  db.prepare('UPDATE payouts SET status = ?, processed_at = ? WHERE id = ?')
    .run(status, processed_at, req.params.id);

  // Email trader when payout is finalised
  if (['paid', 'rejected'].includes(status)) {
    const trader = db.prepare('SELECT email, full_name FROM traders WHERE id = ?').get(payout.trader_id);
    const amt = Number(payout.amount_usd).toFixed(2);
    sendEmail({
      to:      trader.email,
      subject: status === 'paid'
        ? `Your $${amt} Payout Has Been Sent`
        : `Payout Request Update — Action Required`,
      html: status === 'paid' ? `
        <h2>Payout Processed</h2>
        <p>Hi ${trader.full_name.split(' ')[0]},</p>
        <p>Your payout of <strong>$${amt}</strong> via <strong>${payout.method}</strong> has been sent.</p>
        <p>Allow 1–2 business days for funds to arrive.</p>
        <p>Imara Logic Team</p>
      ` : `
        <h2>Payout Request Rejected</h2>
        <p>Hi ${trader.full_name.split(' ')[0]},</p>
        <p>Unfortunately your payout request of <strong>$${amt}</strong> was not approved.</p>
        ${notes ? `<p><strong>Reason:</strong> ${notes}</p>` : ''}
        <p>Please log in to your dashboard or contact support if you have questions.</p>
        <p>Imara Logic Team</p>
      `,
    });
  }

  res.json(db.prepare('SELECT * FROM payouts WHERE id = ?').get(req.params.id));
});

// ─── KYC DOCUMENTS ───────────────────────────────────────────────────────────

// GET /api/admin/kyc?status=under_review&page=1&limit=20
router.get('/kyc', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const status = req.query.status;

  const where  = status ? 'WHERE k.status = ?' : '';
  const params = status ? [status] : [];

  const total = db.prepare(`SELECT COUNT(*) c FROM kyc_documents k ${where}`).get(...params).c;
  const rows  = db.prepare(`
    SELECT k.id, k.doc_type, k.doc_subtype, k.status, k.uploaded_at, k.reviewed_at, k.notes,
           t.id AS trader_id, t.full_name AS trader_name, t.email AS trader_email
    FROM kyc_documents k
    JOIN traders t ON t.id = k.trader_id
    ${where}
    ORDER BY k.uploaded_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, page, limit, documents: rows });
});

// GET /api/admin/kyc/file/:id  — admin views any trader's document
router.get('/kyc/file/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(req.params.id);
  if (!doc || !doc.file_path) return res.status(404).json({ error: 'Document not found' });

  const absPath = path.resolve(uploadsRoot, doc.file_path);
  if (!absPath.startsWith(uploadsRoot) || !fs.existsSync(absPath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }
  res.sendFile(absPath);
});

// PATCH /api/admin/kyc/:id  — approve or reject, optionally add notes
router.patch('/kyc/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'KYC document not found' });

  const STATUS_VALUES = ['pending', 'under_review', 'approved', 'rejected'];
  const { status, notes } = req.body;

  if (!status) return res.status(400).json({ error: 'status is required' });
  if (!STATUS_VALUES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUS_VALUES.join(', ')}` });
  }

  const reviewed_at = ['approved', 'rejected'].includes(status) ? now() : doc.reviewed_at;
  db.prepare('UPDATE kyc_documents SET status = ?, reviewed_at = ?, notes = ? WHERE id = ?')
    .run(status, reviewed_at, notes ?? doc.notes, req.params.id);

  // Sync trader-level kyc_status so payouts/agreements unlock correctly
  const newKycStatus = syncKycStatus(doc.trader_id);

  const updatedDoc = db.prepare(
    'SELECT id, doc_type, status, uploaded_at, reviewed_at, notes FROM kyc_documents WHERE id = ?'
  ).get(req.params.id);

  res.json({ ...updatedDoc, trader_kyc_status: newKycStatus });
});

export default router;
