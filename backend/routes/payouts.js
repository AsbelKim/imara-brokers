import { Router } from 'express';
import crypto from 'crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';

const router = Router();
router.use(requireAuth);

// Payment method minimums (USD)
const METHOD_MINIMUMS = {
  mpesa:         10,
  bank_transfer: 50,
  crypto:        20,
  skrill:        20,
};

// ── GET /api/payouts ──────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
           c.plan             AS challenge_plan,
           c.account_size     AS challenge_account_size,
           c.profit_split     AS challenge_profit_split
    FROM payouts p
    JOIN challenges c ON c.id = p.challenge_id
    WHERE p.trader_id = ?
    ORDER BY p.requested_at DESC
  `).all(req.trader.id);

  res.json(rows.map(({ challenge_plan, challenge_account_size, challenge_profit_split, ...p }) => ({
    ...p,
    challenges: { plan: challenge_plan, account_size: challenge_account_size, profit_split: challenge_profit_split },
  })));
});

// ── GET /api/payouts/eligibility/:challenge_id ────────────────────────────
// Returns whether the trader can request a payout and why/why not
router.get('/eligibility/:challenge_id', (req, res) => {
  const ch = db.prepare('SELECT * FROM challenges WHERE id = ? AND trader_id = ?')
    .get(req.params.challenge_id, req.trader.id);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });

  const checks = [];

  // 1. Must be funded
  const isFunded = ch.status === 'funded';
  checks.push({ label: 'Account is funded', pass: isFunded });

  // 2. KYC must be verified
  const trader    = db.prepare('SELECT kyc_status FROM traders WHERE id = ?').get(req.trader.id);
  const kycOk     = trader.kyc_status === 'verified';
  checks.push({ label: 'KYC verified', pass: kycOk });

  // 3. Minimum 14 trading days on funded account
  const daysSinceFunded = ch.funded_at
    ? Math.floor((Date.now() - new Date(ch.funded_at).getTime()) / 86_400_000)
    : 0;
  const minDaysOk = daysSinceFunded >= 14;
  checks.push({
    label:      `14 days of funded trading (${daysSinceFunded} of 14)`,
    pass:       minDaysOk,
    detail:     minDaysOk ? null : `${14 - daysSinceFunded} day(s) remaining`,
  });

  // 4. Has profit to pay out
  const maxPayout = Number(((ch.profit_usd ?? 0) * ch.profit_split) / 100);
  checks.push({ label: `Available profit share: $${maxPayout.toFixed(2)}`, pass: maxPayout > 0 });

  const eligible = checks.every(c => c.pass);
  res.json({ eligible, checks, max_payout: maxPayout });
});

// ── POST /api/payouts ─────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { challenge_id, amount_usd, method, account_details, account_name, payment_method_id } = req.body;

  if (!challenge_id) return res.status(400).json({ error: 'challenge_id is required' });
  if (!amount_usd)   return res.status(400).json({ error: 'amount_usd is required' });

  // Resolve payment method
  let resolvedMethod = method;
  let resolvedDetails = account_details;
  let resolvedName = account_name;

  if (payment_method_id) {
    const pm = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND trader_id = ?')
      .get(payment_method_id, req.trader.id);
    if (!pm) return res.status(404).json({ error: 'Payment method not found' });
    resolvedMethod  = pm.type;
    resolvedDetails = pm.details;
    resolvedName    = pm.label;
  }

  if (!resolvedMethod)  return res.status(400).json({ error: 'Payment method is required' });
  if (!resolvedDetails) return res.status(400).json({ error: 'Account details are required' });

  const minAmount = METHOD_MINIMUMS[resolvedMethod];
  if (minAmount && Number(amount_usd) < minAmount) {
    return res.status(400).json({ error: `Minimum payout via ${resolvedMethod} is $${minAmount}` });
  }

  // Verify challenge
  const ch = db.prepare('SELECT * FROM challenges WHERE id = ? AND trader_id = ?')
    .get(challenge_id, req.trader.id);
  if (!ch) return res.status(404).json({ error: 'Challenge not found' });

  if (ch.plan === 'free_trial') {
    return res.status(400).json({ error: 'Payouts are not available on free trial accounts. Purchase a paid challenge to get funded.' });
  }

  if (ch.status !== 'funded') {
    return res.status(400).json({ error: 'Payouts are only available on funded accounts' });
  }

  // KYC check
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(req.trader.id);
  if (trader.kyc_status !== 'verified') {
    return res.status(400).json({ error: 'KYC verification must be complete before requesting a payout' });
  }

  // 14-day lock on funded account
  const daysSinceFunded = ch.funded_at
    ? Math.floor((Date.now() - new Date(ch.funded_at).getTime()) / 86_400_000)
    : 0;
  if (daysSinceFunded < 14) {
    const remaining = 14 - daysSinceFunded;
    return res.status(400).json({
      error: `First payout unlocks after 14 days of funded trading. ${remaining} day(s) remaining.`,
    });
  }

  // Max payout = profit * split%
  const maxPayout = Number(((ch.profit_usd ?? 0) * ch.profit_split) / 100);
  if (Number(amount_usd) > maxPayout) {
    return res.status(400).json({
      error: `Amount exceeds available profit share. Maximum: $${maxPayout.toFixed(2)}`,
    });
  }

  // First payout? Include challenge fee refund
  const prevPaid = db.prepare(
    "SELECT id FROM payouts WHERE trader_id = ? AND status = 'paid' LIMIT 1"
  ).get(req.trader.id);
  const fee_refunded = !prevPaid ? 1 : 0;

  const id = crypto.randomUUID();
  const requested_at = now();

  try {
    db.prepare(`
      INSERT INTO payouts (id, trader_id, challenge_id, amount_usd, method,
                           account_details, account_name, payment_method_id,
                           fee_refunded, status, requested_at)
      VALUES (@id, @tid, @cid, @amt, @mth, @det, @nm, @pmid, @fr, 'pending', @ra)
    `).run({
      id, tid: req.trader.id, cid: challenge_id,
      amt: Number(amount_usd),
      mth: resolvedMethod,
      det: typeof resolvedDetails === 'object' ? JSON.stringify(resolvedDetails) : resolvedDetails,
      nm:  resolvedName ?? null,
      pmid: payment_method_id ?? null,
      fr:  fee_refunded,
      ra:  requested_at,
    });
  } catch (err) {
    console.error('Payout insert error:', err);
    return res.status(500).json({ error: 'Failed to submit payout request' });
  }

  // Email confirmation
  sendEmail({
    to:      trader.email,
    subject: `Payout Request Received — $${Number(amount_usd).toFixed(2)}`,
    html: `
      <h2>Payout Request Received</h2>
      <p>Hi ${trader.full_name.split(' ')[0]},</p>
      <p>We received your payout request for <strong>$${Number(amount_usd).toFixed(2)}</strong> via <strong>${resolvedMethod}</strong>.</p>
      ${fee_refunded ? `<p>Your <strong>challenge fee has been included</strong> in this payout as per our refund policy.</p>` : ''}
      <p>Processing time: 1–2 business days.</p>
      <p>Imara Logic Team</p>
    `,
  });

  const data = db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
  res.status(201).json(data);
});

export default router;
