import { Router } from 'express';
import crypto from 'crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES = ['mpesa', 'bank_transfer', 'crypto', 'skrill'];

// ── GET /api/payments ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM payment_methods WHERE trader_id = ? ORDER BY is_default DESC, created_at ASC'
  ).all(req.trader.id);

  res.json(rows.map(r => ({ ...r, details: tryParse(r.details) })));
});

// ── POST /api/payments ────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { type, label, details, is_default } = req.body;

  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${ALLOWED_TYPES.join(', ')}` });
  }
  if (!label?.trim()) return res.status(400).json({ error: 'label is required' });
  if (!details)       return res.status(400).json({ error: 'details is required' });

  const id = crypto.randomUUID();

  // If this will be the default, clear existing default first
  if (is_default) {
    db.prepare('UPDATE payment_methods SET is_default = 0 WHERE trader_id = ?').run(req.trader.id);
  }

  db.prepare(`
    INSERT INTO payment_methods (id, trader_id, type, label, details, is_default, created_at)
    VALUES (@id, @tid, @type, @label, @details, @def, @created)
  `).run({
    id, tid: req.trader.id, type, label: label.trim(),
    details: typeof details === 'object' ? JSON.stringify(details) : details,
    def:     is_default ? 1 : 0,
    created: now(),
  });

  const row = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  res.status(201).json({ ...row, details: tryParse(row.details) });
});

// ── PATCH /api/payments/:id ───────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const pm = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND trader_id = ?')
    .get(req.params.id, req.trader.id);
  if (!pm) return res.status(404).json({ error: 'Payment method not found' });

  const { label, details, is_default } = req.body;
  const updates = [];
  const params  = {};

  if (label !== undefined) { updates.push('label = @label');     params.label   = label.trim(); }
  if (details !== undefined) {
    updates.push('details = @details');
    params.details = typeof details === 'object' ? JSON.stringify(details) : details;
  }
  if (is_default !== undefined && is_default) {
    db.prepare('UPDATE payment_methods SET is_default = 0 WHERE trader_id = ?').run(req.trader.id);
    updates.push('is_default = 1');
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  db.prepare(`UPDATE payment_methods SET ${updates.join(', ')} WHERE id = @id`)
    .run({ ...params, id: pm.id });

  const row = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(pm.id);
  res.json({ ...row, details: tryParse(row.details) });
});

// ── DELETE /api/payments/:id ──────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const pm = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND trader_id = ?')
    .get(req.params.id, req.trader.id);
  if (!pm) return res.status(404).json({ error: 'Payment method not found' });

  db.prepare('DELETE FROM payment_methods WHERE id = ?').run(pm.id);
  res.json({ message: 'Payment method removed' });
});

function tryParse(val) {
  try { return JSON.parse(val); } catch { return val; }
}

export default router;
