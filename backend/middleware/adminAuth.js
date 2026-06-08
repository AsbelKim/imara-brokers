export function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  const key = process.env.ADMIN_API_KEY;

  if (!key) {
    return res.status(503).json({ error: 'Admin access is not configured on this server' });
  }
  if (!header?.startsWith('Bearer ') || header.slice(7) !== key) {
    return res.status(401).json({ error: 'Invalid or missing admin API key' });
  }
  next();
}
