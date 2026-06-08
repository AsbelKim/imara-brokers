import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import challengeRoutes from './routes/challenges.js';
import payoutRoutes from './routes/payouts.js';
import paymentsRoutes from './routes/payments.js';
import kycRoutes from './routes/kyc.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
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
