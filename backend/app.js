import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import challengeRoutes from './routes/challenges.js';
import payoutRoutes from './routes/payouts.js';
import paymentsRoutes from './routes/payments.js';
import kycRoutes from './routes/kyc.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';

const app = express();

// Security headers (disable CSP for static file serving — handled by Netlify/CDN in prod)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — reflect exact origin when FRONTEND_URL is set; allow all in dev
app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true,
}));

app.use(express.json());

// Rate-limit all auth endpoints: 20 req / 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again in 15 minutes.' },
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', service: 'Imara Logic Funded API', ts: new Date().toISOString() })
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

export default app;
