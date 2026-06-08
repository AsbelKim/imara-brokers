import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { autoVerifyDocument } from '../services/autoVerify.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, '..', 'uploads', 'kyc');
fs.mkdirSync(uploadsRoot, { recursive: true });

const router = Router();
router.use(requireAuth);

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// FTMO-aligned document types
const DOC_TYPES = ['identity_document', 'identity_document_back', 'proof_of_address'];

const DOC_SUBTYPES = {
  identity_document:      ['passport', 'national_id'],
  identity_document_back: ['national_id'],
  proof_of_address:       ['utility_bill', 'bank_statement', 'lease_agreement', 'government_letter'],
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    ALLOWED_MIME.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG, WebP or PDF files are allowed'));
  },
});

// ── Calculate overall KYC status for a trader ────────────────────────────
function calcKycStatus(traderId) {
  const docs   = db.prepare('SELECT * FROM kyc_documents WHERE trader_id = ?').all(traderId);
  const getDoc = (type) => docs.find(d => d.doc_type === type);

  const idDoc  = getDoc('identity_document');
  const poaDoc = getDoc('proof_of_address');

  // Back of ID required only for national_id
  const needsBack = idDoc?.doc_subtype === 'national_id';
  const backDoc   = getDoc('identity_document_back');

  const required = [idDoc, poaDoc, ...(needsBack ? [backDoc] : [])];

  if (!idDoc && !poaDoc) return 'not_started';
  if (required.some(d => !d)) return 'in_progress';
  if (required.some(d => d?.status === 'rejected')) return 'action_required';
  if (required.every(d => d?.status === 'approved')) return 'verified';
  return 'pending_review'; // all submitted, waiting
}

// ── GET /api/kyc ── trader's own documents + overall status ──────────────
router.get('/', (req, res) => {
  const docs = db.prepare(`
    SELECT id, doc_type, doc_subtype, status, uploaded_at, reviewed_at, notes
    FROM kyc_documents WHERE trader_id = ?
  `).all(req.trader.id);

  const kyc_status = calcKycStatus(req.trader.id);
  res.json({ kyc_status, documents: docs });
});

// ── GET /api/kyc/file/:id ── stream trader's own uploaded file ───────────
router.get('/file/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM kyc_documents WHERE id = ? AND trader_id = ?')
    .get(req.params.id, req.trader.id);
  if (!doc?.file_path) return res.status(404).json({ error: 'Document not found' });

  const absPath = path.join(uploadsRoot, doc.file_path);
  if (!absPath.startsWith(uploadsRoot) || !fs.existsSync(absPath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }
  res.sendFile(absPath);
});

// ── POST /api/kyc/upload ─────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { doc_type, doc_subtype } = req.body;

  if (!DOC_TYPES.includes(doc_type)) {
    return res.status(400).json({ error: `doc_type must be one of: ${DOC_TYPES.join(', ')}` });
  }

  const allowedSubtypes = DOC_SUBTYPES[doc_type];
  if (allowedSubtypes.length > 0 && !allowedSubtypes.includes(doc_subtype)) {
    return res.status(400).json({
      error: `doc_subtype for ${doc_type} must be one of: ${allowedSubtypes.join(', ')}`,
    });
  }

  // Validate: back of ID only allowed when the front is already uploaded as national_id
  if (doc_type === 'identity_document_back') {
    const front = db.prepare(
      "SELECT doc_subtype FROM kyc_documents WHERE trader_id = ? AND doc_type = 'identity_document'"
    ).get(req.trader.id);
    if (!front) {
      return res.status(400).json({ error: 'Upload your identity document front first' });
    }
    if (front.doc_subtype !== 'national_id') {
      return res.status(400).json({ error: 'Back of ID is only required for national ID cards, not passports' });
    }
  }

  // Store file on disk
  const ext     = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const relPath = `${req.trader.id}/${doc_type}.${ext}`;
  const absPath = path.join(uploadsRoot, relPath);

  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, req.file.buffer);
  } catch (err) {
    console.error('KYC file write error:', err);
    return res.status(500).json({ error: 'Failed to store uploaded file' });
  }

  // AI auto-verification
  let verification = { status: 'under_review', notes: null };
  try {
    verification = await autoVerifyDocument(req.file.buffer, req.file.mimetype, doc_type, doc_subtype);
  } catch (err) {
    console.error('autoVerify failed:', err.message);
  }

  // Upsert DB record
  const existing    = db.prepare(
    'SELECT id FROM kyc_documents WHERE trader_id = ? AND doc_type = ?'
  ).get(req.trader.id, doc_type);
  const uploaded_at = now();
  const reviewed_at = ['approved', 'rejected'].includes(verification.status) ? uploaded_at : null;
  const id          = existing?.id ?? crypto.randomUUID();

  try {
    if (existing) {
      db.prepare(`
        UPDATE kyc_documents
        SET file_path=@fp, doc_subtype=@ds, status=@st,
            uploaded_at=@ua, reviewed_at=@ra, notes=@no
        WHERE id=@id
      `).run({ fp: relPath, ds: doc_subtype || null, st: verification.status,
               ua: uploaded_at, ra: reviewed_at, no: verification.notes, id });
    } else {
      db.prepare(`
        INSERT INTO kyc_documents
          (id, trader_id, doc_type, doc_subtype, file_path, status, uploaded_at, reviewed_at, notes)
        VALUES (@id,@tid,@dt,@ds,@fp,@st,@ua,@ra,@no)
      `).run({ id, tid: req.trader.id, dt: doc_type, ds: doc_subtype || null,
               fp: relPath, st: verification.status, ua: uploaded_at,
               ra: reviewed_at, no: verification.notes });
    }
  } catch (err) {
    console.error('KYC record error:', err);
    return res.status(500).json({ error: 'Failed to save KYC record' });
  }

  // Update trader-level kyc_status
  const newKycStatus = calcKycStatus(req.trader.id);
  db.prepare('UPDATE traders SET kyc_status = ? WHERE id = ?').run(newKycStatus, req.trader.id);

  const data = db.prepare(`
    SELECT id, doc_type, doc_subtype, status, uploaded_at, reviewed_at, notes
    FROM kyc_documents WHERE id = ?
  `).get(id);

  res.status(201).json({ ...data, kyc_status: newKycStatus });
});

export default router;
