import OpenAI from 'openai';

// ── Document descriptions keyed by [doc_type][doc_subtype] ───────────────
const DOC_DESC = {
  identity_document: {
    passport:   "the photo/data page of an international passport — must clearly show the holder's photo, full name, date of birth, passport number, nationality, and expiry date",
    national_id: "the FRONT side of a government-issued national identity card — must show the holder's photo, full name, ID number, and date of birth",
    _default:    "a valid government-issued identity document (passport or national ID card) showing the holder's photo and personal details",
  },
  identity_document_back: {
    national_id: "the BACK side of a national identity card — should show a barcode, MRZ (machine-readable zone), or additional identity information",
    _default:    "the back side of an identity document",
  },
  proof_of_address: {
    utility_bill:       "a utility bill (electricity, water, gas, internet, or phone) addressed to the trader — must clearly show the holder's full name, full residential address, and an issue/billing date that appears to be within the last 6 months",
    bank_statement:     "a bank statement — must show the account holder's full name, full residential address, bank name, and transaction dates appearing within the last 6 months",
    lease_agreement:    "a signed lease or tenancy agreement — must show both parties' names, the full property address, and contract dates",
    government_letter:  "an official government letter or document — must show the recipient's full name and current residential address, and appear to be dated within the last 6 months",
    _default:           "a proof of address document — must show the holder's full name, full residential address, and appear to be dated within the last 6 months",
  },
};

// ── Document-specific rejection rules ────────────────────────────────────
const EXTRA_RULES = {
  identity_document: `
IMPORTANT FTMO-STYLE RULES:
- Accepted: Passport data page, National Identity Card (front)
- NOT accepted: Driver's licenses, residence permits, student IDs, credit/debit cards
- Reject any document that is not a government-issued photo ID`,

  identity_document_back: `
RULES:
- This must be the back/reverse side of a national ID card
- Accept if it shows a barcode, MRZ strip, address, or other card details on the reverse
- Reject if it appears to be the FRONT of an ID, a different document, or a random image`,

  proof_of_address: `
RULES:
- Must NOT be older than 6 months — if you can see a date and it looks more than 6 months old, reject it
- Must show both a name and a physical address — P.O. Box alone is not acceptable
- Utility bills, bank statements, government letters, and lease agreements are accepted
- Reject bank cards, invoices from unknown companies, handwritten notes, or screenshots`,
};

// ── Main export ───────────────────────────────────────────────────────────
export async function autoVerifyDocument(fileBuffer, mimeType, docType, docSubtype) {
  // ── PDF: validate header, queue for manual review ──────────────────────
  if (mimeType === 'application/pdf') {
    const header = fileBuffer.slice(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      return {
        status: 'rejected',
        notes:  'The uploaded file is not a valid PDF. Please export a genuine PDF document and try again.',
      };
    }
    return {
      status: 'under_review',
      notes:  'PDF received — our compliance team will review this document within 1 business day.',
    };
  }

  // ── Image: OpenAI Vision check ─────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('your-openai')) {
    return { status: 'under_review', notes: null };
  }

  const typeDescs = DOC_DESC[docType] ?? {};
  const docDesc   = typeDescs[docSubtype] ?? typeDescs._default ?? docType;
  const extraRules = EXTRA_RULES[docType] ?? '';

  const prompt = `You are an automated KYC compliance checker for a regulated African prop trading firm (similar to FTMO).

The trader uploaded this image claiming it is: ${docDesc}
${extraRules}

EVALUATE against ALL criteria:
1. CORRECT DOCUMENT TYPE — Is it actually ${docDesc}?
2. LEGIBILITY — Can key fields (name, number, date) be clearly read?
3. COMPLETENESS — Is the full document visible without important areas cut off?
4. NOT EXPIRED — If an expiry date is visible, does the document appear valid?
5. AUTHENTICITY — Does it look like a genuine document (not a heavily edited or obvious fake)?

ALWAYS REJECT if:
- It is a random photo, screenshot, meme, blank page, or clearly wrong document type
- The image is completely black, white, or too corrupted to evaluate
- Critical information is obscured by stickers, fingers, or heavy shadows

Respond ONLY with valid JSON (no markdown, no extra text):
{"approved": true, "reason": "Document verified successfully."}
OR
{"approved": false, "reason": "One specific sentence explaining the rejection reason, actionable so the user knows what to fix."}`;

  try {
    const client   = new OpenAI({ apiKey });
    const base64   = fileBuffer.toString('base64');

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' } },
        ],
      }],
      max_tokens: 150,
      temperature: 0,
    });

    const raw   = response.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in AI response');

    const result = JSON.parse(match[0]);
    return {
      status: result.approved ? 'approved' : 'rejected',
      notes:  result.reason ?? null,
    };

  } catch (err) {
    if (err?.status === 429 || err?.message?.includes('quota') || err?.message?.includes('billing')) {
      console.warn('[autoVerify] OpenAI quota exceeded — manual review fallback');
      return {
        status: 'under_review',
        notes:  'Automatic verification is temporarily unavailable. A compliance officer will review your document within 1 business day.',
      };
    }
    console.error('[autoVerify] Error:', err.message);
    return { status: 'under_review', notes: null };
  }
}
