import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';

const router = Router();

const PUBLIC_FIELDS = 'id, full_name, email, phone, country, preferred_plan, experience, created_at';

function signToken(trader) {
  return jwt.sign(
    { id: trader.id, email: trader.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { full_name, email, phone, country, plan, experience, password } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'full_name, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = db.prepare('SELECT id FROM traders WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  const created_at = now();

  try {
    db.prepare(`
      INSERT INTO traders (id, full_name, email, phone, country, preferred_plan, experience, password_hash, created_at, updated_at)
      VALUES (@id, @full_name, @email, @phone, @country, @preferred_plan, @experience, @password_hash, @created_at, @created_at)
    `).run({
      id,
      full_name,
      email: normalizedEmail,
      phone: phone || null,
      country: country || null,
      preferred_plan: plan || null,
      experience: experience || null,
      password_hash,
      created_at,
    });
  } catch (err) {
    console.error('Signup DB error:', err);
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }

  const trader = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM traders WHERE id = ?`).get(id);
  res.status(201).json({ token: signToken(trader), trader });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const trader = db.prepare('SELECT * FROM traders WHERE email = ?').get(email.toLowerCase());
  if (!trader) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, trader.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const { password_hash, ...safeTrader } = trader;
  res.json({ token: signToken(trader), trader: safeTrader });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const trader = db.prepare('SELECT id, email FROM traders WHERE email = ?').get(email.toLowerCase());

  if (trader) {
    const resetToken = jwt.sign(
      { id: trader.id, type: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login.html?reset=${resetToken}`;
    await sendEmail({
      to:      trader.email,
      subject: 'Reset your Imara Logic password',
      html: `
        <h2>Password Reset Request</h2>
        <p>We received a request to reset the password for your Imara Logic account.</p>
        <p><a href="${resetUrl}" style="background:#c9a84c;color:#000;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;">Reset Password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        <p>Imara Logic Team</p>
      `,
    });
  }

  // Always respond the same — don't reveal whether the email exists
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  }

  if (payload.type !== 'password_reset') {
    return res.status(400).json({ error: 'Invalid token type' });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const result = db.prepare('UPDATE traders SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(password_hash, now(), payload.id);

  if (result.changes === 0) return res.status(500).json({ error: 'Failed to update password' });
  res.json({ message: 'Password updated successfully. You can now log in.' });
});

// GET /api/auth/me  (protected)
router.get('/me', requireAuth, (req, res) => {
  const data = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM traders WHERE id = ?`).get(req.trader.id);
  if (!data) return res.status(404).json({ error: 'Trader not found' });
  res.json(data);
});

// PATCH /api/auth/me  (protected)
router.patch('/me', requireAuth, (req, res) => {
  const allowed = ['full_name', 'phone', 'country'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  if (Object.keys(updates).length === 0) {
    const data = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM traders WHERE id = ?`).get(req.trader.id);
    return res.json(data);
  }

  const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  try {
    db.prepare(`UPDATE traders SET ${setClause}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...updates, updated_at: now(), id: req.trader.id });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }

  const data = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM traders WHERE id = ?`).get(req.trader.id);
  res.json(data);
});

export default router;
