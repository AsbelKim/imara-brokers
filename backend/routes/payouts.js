import { Router } from 'express';
import crypto from 'crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/payouts
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
           c.plan AS challenge_plan,
           c.account_size AS challenge_account_size,
           c.profit_split AS challenge_profit_split
    FROM payouts p
    JOIN challenges c ON c.id = p.challenge_id
    WHERE p.trader_id = ?
    ORDER BY p.requested_at DESC
  `).all(req.trader.id);

  const data = rows.map(({ challenge_plan, challenge_account_size, challenge_profit_split, ...payout }) => ({
    ...payout,
    challenges: {
      plan: challenge_plan,
      account_size: challenge_account_size,
      profit_split: challenge_profit_split,
    },
  }));

  res.json(data);
});

// POST /api/payouts
router.post('/', (req, res) => {
  const { challenge_id, amount_usd, method, account_details, account_name } = req.body;

  if (!challenge_id || !amount_usd || !method || !account_details || !account_name) {
    return res.status(400).json({ error: 'All payout fields are required' });
  }

  if (!['mpesa', 'bank'].includes(method)) {
    return res.status(400).json({ error: 'Method must be "mpesa" or "bank"' });
  }

  const minAmount = method === 'mpesa' ? 10 : 50;
  if (Number(amount_usd) < minAmount) {
    return res.status(400).json({ error: `Minimum payout via ${method} is $${minAmount}` });
  }

  // Verify challenge belongs to this trader
  const challenge = db.prepare(`
    SELECT id, status, profit_usd, profit_split, start_date, trading_days
    FROM challenges WHERE id = ? AND trader_id = ?
  `).get(challenge_id, req.trader.id);

  if (!challenge) {
    return res.status(404).json({ error: 'Challenge not found' });
  }

  if (challenge.status !== 'funded') {
    return res.status(400).json({ error: 'Payouts are only available on funded accounts' });
  }

  const daysSinceStart = Math.floor(
    (Date.now() - new Date(challenge.start_date).getTime()) / 86_400_000
  );
  if (daysSinceStart < 14) {
    const remaining = 14 - daysSinceStart;
    return res.status(400).json({
      error: `First payout unlocks after 14 days. ${remaining} day${remaining !== 1 ? 's' : ''} remaining.`,
    });
  }

  const maxPayout = (challenge.profit_usd * challenge.profit_split) / 100;
  if (Number(amount_usd) > maxPayout) {
    return res.status(400).json({
      error: `Amount exceeds available profit share. Maximum available: $${maxPayout.toFixed(2)}`,
    });
  }

  const id = crypto.randomUUID();
  const requested_at = now();

  try {
    db.prepare(`
      INSERT INTO payouts (id, trader_id, challenge_id, amount_usd, method, account_details, account_name, status, requested_at)
      VALUES (@id, @trader_id, @challenge_id, @amount_usd, @method, @account_details, @account_name, 'pending', @requested_at)
    `).run({
      id,
      trader_id: req.trader.id,
      challenge_id,
      amount_usd: Number(amount_usd),
      method,
      account_details,
      account_name,
      requested_at,
    });
  } catch (err) {
    console.error('Payout insert error:', err);
    return res.status(500).json({ error: 'Failed to submit payout request' });
  }

  const data = db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
  res.status(201).json(data);
});

export default router;
