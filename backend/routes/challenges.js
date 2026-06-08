import { Router } from 'express';
import crypto from 'crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const PLANS = {
  starter:  { account_size: 10000,  fee: 99,  profit_split: 80 },
  standard: { account_size: 25000,  fee: 199, profit_split: 80 },
  advanced: { account_size: 50000,  fee: 299, profit_split: 85 },
  elite:    { account_size: 100000, fee: 499, profit_split: 85 },
  pro:      { account_size: 200000, fee: 799, profit_split: 90 },
};

// GET /api/challenges
router.get('/', (req, res) => {
  const data = db.prepare('SELECT * FROM challenges WHERE trader_id = ? ORDER BY created_at DESC')
    .all(req.trader.id);
  res.json(data);
});

// GET /api/challenges/:id
router.get('/:id', (req, res) => {
  const data = db.prepare('SELECT * FROM challenges WHERE id = ? AND trader_id = ?')
    .get(req.params.id, req.trader.id);

  if (!data) return res.status(404).json({ error: 'Challenge not found' });
  res.json(data);
});

// POST /api/challenges  — create / purchase a challenge
router.post('/', (req, res) => {
  const planKey = req.body.plan?.toLowerCase();
  const planInfo = PLANS[planKey];

  if (!planInfo) {
    return res.status(400).json({
      error: `Invalid plan. Choose from: ${Object.keys(PLANS).join(', ')}`,
    });
  }

  const id = crypto.randomUUID();
  const created_at = now();
  const start_date = created_at.split('T')[0];

  try {
    db.prepare(`
      INSERT INTO challenges (id, trader_id, plan, account_size, fee, profit_split, phase, status,
                              profit_usd, daily_loss_usd, drawdown_usd, trading_days, start_date, created_at)
      VALUES (@id, @trader_id, @plan, @account_size, @fee, @profit_split, 1, 'active',
              0, 0, 0, 0, @start_date, @created_at)
    `).run({
      id,
      trader_id: req.trader.id,
      plan: planKey,
      account_size: planInfo.account_size,
      fee: planInfo.fee,
      profit_split: planInfo.profit_split,
      start_date,
      created_at,
    });
  } catch (err) {
    console.error('Challenge creation error:', err);
    return res.status(500).json({ error: 'Failed to create challenge' });
  }

  const data = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
  res.status(201).json(data);
});

export default router;
