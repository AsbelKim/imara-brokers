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

// POST /api/auth/social-verify — verify a social provider token server-side
router.post('/social-verify', async (req, res) => {
  const { provider, access_token, id_token, name: nameHint } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider is required' });

  let email, name;

  try {
    if (provider === 'google') {
      if (!access_token) return res.status(400).json({ error: 'access_token required for Google' });
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const info = await r.json();
      if (!r.ok || info.error) return res.status(401).json({ error: 'Invalid Google token' });
      if (!info.email) return res.status(401).json({ error: 'Google did not return an email address' });
      email = info.email;
      name  = info.name || '';

    } else if (provider === 'facebook') {
      if (!access_token) return res.status(400).json({ error: 'access_token required for Facebook' });
      const r = await fetch(`https://graph.facebook.com/me?fields=email,name&access_token=${encodeURIComponent(access_token)}`);
      const info = await r.json();
      if (!r.ok || info.error) return res.status(401).json({ error: info.error?.message || 'Invalid Facebook token' });
      if (!info.email) return res.status(400).json({ error: 'Your Facebook account has no email address. Please sign up with email instead.' });
      email = info.email;
      name  = info.name || '';

    } else if (provider === 'apple') {
      if (!id_token) return res.status(400).json({ error: 'id_token required for Apple' });
      // Decode Apple JWT payload (base64url → base64 → JSON)
      const b64 = id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      if (!payload.email) return res.status(400).json({ error: 'Apple token did not include an email address' });
      email = payload.email;
      name  = nameHint || '';

    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
  } catch (err) {
    console.error(`social-verify error (${provider}):`, err.message);
    return res.status(401).json({ error: 'Social verification failed. Please try again.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT * FROM traders WHERE email = ?').get(normalizedEmail);

  if (existing) {
    const trader = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM traders WHERE id = ?`).get(existing.id);
    return res.json({ is_new: false, token: signToken(trader), trader });
  }

  // New user — issue a 15-minute pending token so social-complete can trust the verified email
  const pendingToken = jwt.sign(
    { email: normalizedEmail, type: 'social_pending' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  res.json({ is_new: true, email: normalizedEmail, name, pending_token: pendingToken });
});

// POST /api/auth/social-complete  — create or update account after OAuth onboarding
router.post('/social-complete', async (req, res) => {
  const { email, full_name, phone, country, pending_token } = req.body;

  if (!email || !full_name) {
    return res.status(400).json({ error: 'email and full_name are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // For new social accounts a valid pending_token is required to prevent
  // arbitrary account creation with any email address
  const existing = db.prepare('SELECT * FROM traders WHERE email = ?').get(normalizedEmail);
  if (!existing) {
    if (!pending_token) return res.status(401).json({ error: 'Social session token is required for new accounts' });
    let payload;
    try { payload = jwt.verify(pending_token, process.env.JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Social session expired. Please sign in again.' }); }
    if (payload.type !== 'social_pending' || payload.email !== normalizedEmail) {
      return res.status(401).json({ error: 'Social session mismatch. Please sign in again.' });
    }
  }

  if (existing) {
    db.prepare('UPDATE traders SET full_name = ?, phone = ?, country = ?, updated_at = ? WHERE id = ?')
      .run(full_name, phone || existing.phone, country || existing.country, now(), existing.id);
    const trader = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM traders WHERE id = ?`).get(existing.id);
    return res.json({ token: signToken(trader), trader });
  }

  // New OAuth account — random unguessable password (they use OAuth to sign in)
  const password_hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const id = crypto.randomUUID();
  const created_at = now();

  try {
    db.prepare(`
      INSERT INTO traders (id, full_name, email, password_hash, phone, country, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, full_name, normalizedEmail, password_hash, phone || null, country || null, created_at, created_at);
  } catch (err) {
    console.error('Social complete DB error:', err);
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }

  const trader = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM traders WHERE id = ?`).get(id);
  res.status(201).json({ token: signToken(trader), trader });
});

export default router;
