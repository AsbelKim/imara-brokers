import { Router } from 'express';
import crypto from 'crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';

const router = Router();
router.use(requireAuth);

// ── Challenge plans ───────────────────────────────────────────────────────
export const PLANS = {
  free_trial: { label: 'Free Trial', account_size: 5000,   fee: 0,   profit_split: 0,  is_trial: true },
  starter:    { label: 'Starter',    account_size: 10000,  fee: 99,  profit_split: 80 },
  standard:   { label: 'Standard',   account_size: 25000,  fee: 199, profit_split: 80 },
  advanced:   { label: 'Advanced',   account_size: 50000,  fee: 299, profit_split: 85 },
  elite:      { label: 'Elite',      account_size: 100000, fee: 499, profit_split: 85 },
  pro:        { label: 'Pro',        account_size: 200000, fee: 799, profit_split: 90 },
};

// ── FTMO-exact phase rules ────────────────────────────────────────────────
export const PHASE_RULES = {
  1: {
    label:              'Phase 1 — Challenge',
    profit_target_pct:  0.10,   // 10%
    daily_loss_pct:     0.05,   // 5%
    max_drawdown_pct:   0.10,   // 10%
    min_trading_days:   4,
    max_calendar_days:  30,
    mt5_server:         'eval.imaralogic.co.ke:443',
    leverage:           '1:100',
  },
  2: {
    label:              'Phase 2 — Verification',
    profit_target_pct:  0.05,   // 5%
    daily_loss_pct:     0.05,
    max_drawdown_pct:   0.10,
    min_trading_days:   4,
    max_calendar_days:  60,
    mt5_server:         'eval.imaralogic.co.ke:443',
    leverage:           '1:100',
  },
  3: {
    label:              'Funded Account',
    profit_target_pct:  null,   // no target
    daily_loss_pct:     0.05,
    max_drawdown_pct:   0.10,
    min_trading_days:   null,
    max_calendar_days:  null,
    mt5_server:         'trade.imaralogic.co.ke:443',
    leverage:           '1:100',
  },
};

// Compute all dollar limits from account size + phase
function buildRules(account_size, phase) {
  const r = PHASE_RULES[phase];
  return {
    profit_target_usd:    r.profit_target_pct ? Math.round(account_size * r.profit_target_pct) : null,
    daily_loss_limit_usd: Math.round(account_size * r.daily_loss_pct),
    max_drawdown_usd:     Math.round(account_size * r.max_drawdown_pct),
    min_trading_days:     r.min_trading_days,
    max_calendar_days:    r.max_calendar_days,
  };
}

function calcDeadline(maxCalendarDays) {
  if (!maxCalendarDays) return null;
  const d = new Date();
  d.setDate(d.getDate() + maxCalendarDays);
  return d.toISOString().split('T')[0];
}

// ── GET /api/challenges/trial-status ─────────────────────────────────────
router.get('/trial-status', (req, res) => {
  const trial = db.prepare(
    "SELECT id, status, phase, trading_days, profit_usd, created_at FROM challenges WHERE trader_id = ? AND plan = 'free_trial' LIMIT 1"
  ).get(req.trader.id);
  res.json({ has_trial: !!trial, trial });
});

// ── GET /api/challenges ───────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
           CASE WHEN c.mt5_password IS NOT NULL THEN c.mt5_login  ELSE NULL END AS mt5_login,
           CASE WHEN c.mt5_password IS NOT NULL THEN c.mt5_server ELSE NULL END AS mt5_server_display
    FROM challenges c
    WHERE c.trader_id = ?
    ORDER BY c.created_at DESC
  `).all(req.trader.id);
  // Never expose mt5_password to client
  res.json(rows.map(r => { const { mt5_password, ...safe } = r; return safe; }));
});

// ── GET /api/challenges/:id ───────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM challenges WHERE id = ? AND trader_id = ?')
    .get(req.params.id, req.trader.id);
  if (!row) return res.status(404).json({ error: 'Challenge not found' });
  const { mt5_password, ...safe } = row;
  res.json(safe);
});

// ── POST /api/challenges — purchase a challenge ───────────────────────────
router.post('/', (req, res) => {
  const planKey  = req.body.plan?.toLowerCase();
  const planInfo = PLANS[planKey];

  if (!planInfo) {
    return res.status(400).json({
      error: `Invalid plan. Choose from: ${Object.keys(PLANS).join(', ')}`,
    });
  }

  // Free trial: one per trader, ever
  if (planInfo.is_trial) {
    const existingTrial = db.prepare(
      "SELECT id FROM challenges WHERE trader_id = ? AND plan = 'free_trial' LIMIT 1"
    ).get(req.trader.id);
    if (existingTrial) {
      return res.status(409).json({
        error: 'You have already used your free trial. Purchase a paid challenge to get funded.',
      });
    }
  }

  // Check for 20% retry discount (previous failed challenge of same paid plan)
  const prevFailed = !planInfo.is_trial ? db.prepare(`
    SELECT id FROM challenges
    WHERE trader_id = ? AND plan = ? AND status = 'failed'
    ORDER BY created_at DESC LIMIT 1
  `).get(req.trader.id, planKey) : null;

  const discount   = prevFailed ? 0.20 : 0;
  const fee        = Math.round(planInfo.fee * (1 - discount));
  const rules      = buildRules(planInfo.account_size, 1);
  const id         = crypto.randomUUID();
  const created_at = now();
  const start_date = created_at.split('T')[0];
  const deadline   = calcDeadline(rules.max_calendar_days);

  try {
    db.prepare(`
      INSERT INTO challenges (
        id, trader_id, plan, account_size, fee, profit_split, phase, status,
        profit_usd, daily_loss_usd, drawdown_usd, trading_days,
        profit_target_usd, daily_loss_limit_usd, max_drawdown_usd,
        min_trading_days, max_calendar_days, deadline,
        initial_balance, current_balance,
        start_date, created_at, scale_count
      ) VALUES (
        @id, @tid, @plan, @acct, @fee, @split, 1, 'active',
        0, 0, 0, 0,
        @pt, @dll, @mdd,
        @mtd, @mcd, @dl,
        @acct, @acct,
        @start, @created, 0
      )
    `).run({
      id, tid: req.trader.id, plan: planKey,
      acct:  planInfo.account_size,
      fee,
      split: planInfo.profit_split,
      pt:    rules.profit_target_usd,
      dll:   rules.daily_loss_limit_usd,
      mdd:   rules.max_drawdown_usd,
      mtd:   rules.min_trading_days,
      mcd:   rules.max_calendar_days,
      dl:    deadline,
      start: start_date,
      created: created_at,
    });
  } catch (err) {
    console.error('Challenge creation error:', err);
    return res.status(500).json({ error: 'Failed to create challenge' });
  }

  // Send welcome email
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(req.trader.id);
  sendEmail({
    to:      trader.email,
    subject: `Your Imara Logic ${PLANS[planKey].label} Challenge is Ready`,
    html: `
      <h2>Welcome to Your ${PLANS[planKey].label} Challenge</h2>
      <p>Hi ${trader.full_name.split(' ')[0]},</p>
      <p>Your <strong>$${planInfo.account_size.toLocaleString()} ${PLANS[planKey].label}</strong> challenge is now active.</p>
      <h3>Challenge Rules</h3>
      <ul>
        <li>Profit Target (Phase 1): <strong>10% ($${rules.profit_target_usd?.toLocaleString()})</strong></li>
        <li>Daily Loss Limit: <strong>5% ($${rules.daily_loss_limit_usd.toLocaleString()})</strong></li>
        <li>Maximum Drawdown: <strong>10% ($${rules.max_drawdown_usd.toLocaleString()})</strong></li>
        <li>Minimum Trading Days: <strong>${rules.min_trading_days}</strong></li>
        <li>Calendar Days: <strong>${rules.max_calendar_days} days (deadline: ${deadline})</strong></li>
        <li>Leverage: <strong>${PHASE_RULES[1].leverage}</strong></li>
      </ul>
      <p>Your MT5 credentials will be sent separately once your account is provisioned.</p>
      <p>Trade well,<br>Imara Logic Team</p>
    `,
  });

  const data = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
  const { mt5_password, ...safe } = data;

  res.status(201).json({
    ...safe,
    discount_applied: discount > 0,
    original_fee: planInfo.fee,
    fee_paid: fee,
  });
});

// ── POST /api/challenges/:id/sign-agreement ───────────────────────────────
// Trader signs the FTMO Account Agreement (required before funded account)
router.post('/:id/sign-agreement', (req, res) => {
  const ch = db.prepare('SELECT * FROM challenges WHERE id = ? AND trader_id = ?')
    .get(req.params.id, req.trader.id);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });

  if (ch.phase !== 3 && ch.status !== 'passed') {
    return res.status(400).json({
      error: 'Agreement signing is only available after passing Phase 2',
    });
  }

  const trader = db.prepare('SELECT kyc_status FROM traders WHERE id = ?').get(req.trader.id);
  if (trader.kyc_status !== 'verified') {
    return res.status(400).json({
      error: 'KYC verification must be completed before signing the account agreement',
    });
  }

  const signed_at = now();
  db.prepare('UPDATE challenges SET agreement_signed_at = ? WHERE id = ?').run(signed_at, ch.id);
  db.prepare('UPDATE traders SET agreement_signed_at = ? WHERE id = ?').run(signed_at, req.trader.id);

  res.json({ message: 'Account agreement signed', signed_at });
});

export default router;
