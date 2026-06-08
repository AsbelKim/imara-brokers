import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import app from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const siteRoot = path.join(__dirname, '..');

// Serve the static frontend from the same origin as /api so relative
// fetch('/api/...') calls in the browser resolve correctly during local dev
// (mirrors what the Netlify redirect does in production).
app.use(express.static(siteRoot));
// admin.html is a real file — let express.static serve it directly.
// All other non-API routes fall back to the SPA (index.html).
app.get(/^(?!\/(api|admin\.html|admin\.css|admin\.js)).*/, (_req, res) =>
  res.sendFile(path.join(siteRoot, 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Imara Logic API + frontend → http://localhost:${PORT}`));
