import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, '..', 'uploads', 'kyc');
fs.mkdirSync(uploadsRoot, { recursive: true });

const router = Router();
router.use(requireAuth);

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const DOC_TYPES = ['national_id_front', 'national_id_back', 'selfie', 'bank_statement', 'utility_bill'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP or PDF files are allowed'));
  },
});

// GET /api/kyc
router.get('/', (req, res) => {
  const data = db.prepare(`
    SELECT id, doc_type, status, uploaded_at, reviewed_at, notes
    FROM kyc_documents WHERE trader_id = ?
  `).all(req.trader.id);
  res.json(data);
});

// GET /api/kyc/file/:id  — stream a trader's own uploaded document
router.get('/file/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM kyc_documents WHERE id = ? AND trader_id = ?')
    .get(req.params.id, req.trader.id);

  if (!doc || !doc.file_path) return res.status(404).json({ error: 'Document not found' });

  const absPath = path.join(uploadsRoot, doc.file_path);
  if (!absPath.startsWith(uploadsRoot) || !fs.existsSync(absPath)) {
    return res.status(404).json({ error: 'Document not found' });
  }
  res.sendFile(absPath);
});

// POST /api/kyc/upload
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { doc_type } = req.body;
  if (!DOC_TYPES.includes(doc_type)) {
    return res.status(400).json({
      error: `Invalid doc_type. Choose from: ${DOC_TYPES.join(', ')}`,
    });
  }

  const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const relPath = `${req.trader.id}/${doc_type}.${ext}`;
  const absPath = path.join(uploadsRoot, relPath);

  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, req.file.buffer);
  } catch (err) {
    console.error('KYC file write error:', err);
    return res.status(500).json({ error: 'Failed to store uploaded file' });
  }

  const existing = db.prepare('SELECT id FROM kyc_documents WHERE trader_id = ? AND doc_type = ?')
    .get(req.trader.id, doc_type);

  const uploaded_at = now();
  const id = existing ? existing.id : crypto.randomUUID();

  try {
    if (existing) {
      db.prepare(`
        UPDATE kyc_documents
        SET file_path = @file_path, status = 'under_review', uploaded_at = @uploaded_at, reviewed_at = NULL, notes = NULL
        WHERE id = @id
      `).run({ id, file_path: relPath, uploaded_at });
    } else {
      db.prepare(`
        INSERT INTO kyc_documents (id, trader_id, doc_type, file_path, status, uploaded_at, reviewed_at, notes)
        VALUES (@id, @trader_id, @doc_type, @file_path, 'under_review', @uploaded_at, NULL, NULL)
      `).run({ id, trader_id: req.trader.id, doc_type, file_path: relPath, uploaded_at });
    }
  } catch (err) {
    console.error('KYC record error:', err);
    return res.status(500).json({ error: 'Failed to save KYC record' });
  }

  const data = db.prepare(`
    SELECT id, doc_type, status, uploaded_at, reviewed_at, notes
    FROM kyc_documents WHERE id = ?
  `).get(id);
  res.status(201).json(data);
});

export default router;
