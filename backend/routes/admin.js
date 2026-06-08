import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';

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
  const kyc        = db.prepare('SELECT id, doc_type, status, uploaded_at, reviewed_at, notes FROM kyc_documents WHERE trader_id = ?').all(req.params.id);

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

// PATCH /api/admin/challenges/:id  — update status, phase, profit, days
router.patch('/challenges/:id', (req, res) => {
  const ch = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });

  const allowed = ['status', 'phase', 'profit_usd', 'daily_loss_usd', 'drawdown_usd', 'trading_days'];
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
  if (Object.keys(updates).length === 0) {
    return res.json(ch);
  }

  const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE challenges SET ${setClause} WHERE id = @id`).run({ ...updates, id: req.params.id });

  res.json(db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id));
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
    SELECT k.id, k.doc_type, k.status, k.uploaded_at, k.reviewed_at, k.notes,
           t.id AS trader_id, t.full_name AS trader_name, t.email AS trader_email
    FROM kyc_documents k
    JOIN traders t ON t.id = k.trader_id
    ${where}
    ORDER BY k.uploaded_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, page, limit, documents: rows });
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

  res.json(db.prepare(
    'SELECT id, doc_type, status, uploaded_at, reviewed_at, notes FROM kyc_documents WHERE id = ?'
  ).get(req.params.id));
});

export default router;
