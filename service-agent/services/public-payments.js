'use strict';

/**
 * Public Payment Service
 * ----------------------
 * Customer-facing payment proof submission + admin verify/reject.
 *
 * Customer path (no auth, token-scoped or admin-issued):
 *   POST /api/portal/payments
 *     { token, bookingId, method, amount, reference, screenshotDataUrl? }
 *
 * Admin path (OWNER only):
 *   POST /api/admin/payments/:id/verify  → marks VERIFIED + advances booking
 *   POST /api/admin/payments/:id/reject  → marks REJECTED + reason
 *   GET  /api/admin/payments?status=SUBMITTED  → review queue
 *
 * State machine:
 *   (none) → SUBMITTED → VERIFIED → booking payment_status = VERIFIED, booking moves QUOTED → BOOKED
 *                    ↘ REJECTED → booking payment_status = REJECTED, customer can resubmit
 *
 * All transitions append to payment_events (immutable audit log).
 */

const database = require('../database');
const portalSvc = require('./customer-portal');

function getDb() { return database.db || require('better-sqlite3')('database.sqlite'); }
function nowIso() { return new Date().toISOString(); }
function genId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 12)}`; }

const DEV_BYPASS_SUB = 'local-dev';

/**
 * In dev mode the JWT-less localhost bypass sets req.user.sub = 'local-dev'.
 * That string doesn't exist in `users` and would violate the FK on
 * payments.verified_by_user_id. Resolve it to the real OWNER row.
 */
function resolveActorUserId(userId) {
  if (userId && userId !== DEV_BYPASS_SUB) return userId;
  try {
    const owner = getDb().prepare(
      "SELECT id FROM users WHERE role = 'OWNER' AND active = 1 ORDER BY created_at ASC LIMIT 1"
    ).get();
    return owner ? owner.id : null;
  } catch (_e) { return null; }
}

function ensurePaymentsTable() {
  // The migration 100 already created `payments` and `payment_events`. This
  // is a no-op safety net in case the table was dropped.
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP',
      status TEXT NOT NULL,
      reference TEXT,
      screenshot_url TEXT,
      submitted_at TEXT NOT NULL,
      verified_by_user_id TEXT,
      verified_at TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  `);
}

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([\w/+\-.]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64'), bytes: Math.floor(m[2].length * 3 / 4) };
}

function saveScreenshot(paymentId, dataUrl) {
  const parsed = dataUrlToBuffer(dataUrl);
  if (!parsed) return null;
  if (parsed.bytes > 5 * 1024 * 1024) return null; // 5MB cap
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'data', 'payment-screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const ext = parsed.mime.split('/')[1] || 'png';
  const filename = `${paymentId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), parsed.buffer);
  return `/api/admin/payments/screenshot/${filename}`;
}

function submitPayment({ bookingId, customerId, method, amount, reference, screenshotDataUrl }) {
  ensurePaymentsTable();
  if (!bookingId) return { success: false, error: 'MISSING_BOOKING' };
  if (!method) return { success: false, error: 'MISSING_METHOD' };
  if (!amount || amount < 50) return { success: false, error: 'INVALID_AMOUNT' };
  if (!reference || reference.length < 3) return { success: false, error: 'MISSING_REFERENCE' };

  // Normalize method: accept lowercase, kebab-case, or friendly names.
  const METHOD_MAP = {
    'instapay': 'INSTAPAY', 'instapay_payment': 'INSTAPAY',
    'vodafone_cash': 'VODAFONE_CASH', 'vodafone': 'VODAFONE_CASH', 'vodafonecash': 'VODAFONE_CASH',
    'orange_cash': 'ORANGE_CASH', 'orange': 'ORANGE_CASH', 'orangecash': 'ORANGE_CASH',
    'fawry': 'FAWRY', 'fawry_pay': 'FAWRY',
    'bank_transfer': 'BANK_TRANSFER', 'bank': 'BANK_TRANSFER', 'wire': 'BANK_TRANSFER',
    'cash': 'CASH', 'cod': 'CASH',
    'other': 'OTHER'
  };
  const methodUpper = METHOD_MAP[String(method).toLowerCase()] || String(method).toUpperCase();

  const booking = getDb().prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(bookingId);
  if (!booking) return { success: false, error: 'BOOKING_NOT_FOUND' };
  if (customerId && booking.customer_id !== customerId) {
    return { success: false, error: 'BOOKING_NOT_YOURS' };
  }

  const paymentId = genId('pay');
  const screenshotUrl = saveScreenshot(paymentId, screenshotDataUrl);
  const ts = nowIso();

  const txn = getDb().transaction(() => {
    getDb().prepare(`
      INSERT INTO payments (id, booking_id, method, amount, currency, status, reference, screenshot_url, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'EGP', 'SUBMITTED', ?, ?, ?, ?, ?)
    `).run(paymentId, bookingId, methodUpper, amount, reference, screenshotUrl || null, ts, ts, ts);
    getDb().prepare(`
      UPDATE bookings_v2 SET payment_status = 'PAYMENT_PENDING_REVIEW', updated_at = ? WHERE id = ?
    `).run(ts, bookingId);
    getDb().prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, actor_id, metadata, created_at)
      VALUES (?, ?, 'SUBMITTED', 'CUSTOMER', ?, ?, ?)
    `).run(genId('pe'), paymentId, customerId, JSON.stringify({ method, amount, reference }), ts);
  });
  txn();
  return { success: true, paymentId, status: 'SUBMITTED', screenshotStored: Boolean(screenshotUrl) };
}

function listQueue({ status = 'SUBMITTED', limit = 50 } = {}) {
  ensurePaymentsTable();
  return getDb().prepare(`
    SELECT p.*, b.public_ref, b.status AS booking_status, c.full_name AS customer_name,
           c.phone_e164 AS customer_phone, c.language AS customer_language
    FROM payments p
    JOIN bookings_v2 b ON b.id = p.booking_id
    JOIN customers c ON c.id = b.customer_id
    WHERE p.status = ?
    ORDER BY p.submitted_at DESC
    LIMIT ?
  `).all(status, limit);
}

function getPayment(paymentId) {
  ensurePaymentsTable();
  return getDb().prepare(`
    SELECT p.*, b.public_ref, b.status AS booking_status, b.scheduled_start,
           c.full_name AS customer_name, c.phone_e164 AS customer_phone, c.language AS customer_language
    FROM payments p
    JOIN bookings_v2 b ON b.id = p.booking_id
    JOIN customers c ON c.id = b.customer_id
    WHERE p.id = ?
  `).get(paymentId);
}

function verifyPayment({ paymentId, actorUserId, actorRole }) {
  ensurePaymentsTable();
  if (actorRole !== 'OWNER') return { success: false, error: 'NOT_AUTHORIZED', message: 'Only OWNER can verify payments.' };
  const payment = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) return { success: false, error: 'NOT_FOUND' };
  if (payment.status === 'VERIFIED') return { success: false, error: 'ALREADY_VERIFIED' };
  if (payment.status === 'REJECTED') return { success: false, error: 'WAS_REJECTED' };

  const realUserId = resolveActorUserId(actorUserId) || actorUserId;
  const ts = nowIso();
  const txn = getDb().transaction(() => {
    getDb().prepare(`
      UPDATE payments SET status = 'VERIFIED', verified_by_user_id = ?, verified_at = ?, updated_at = ? WHERE id = ?
    `).run(realUserId, ts, ts, paymentId);
    getDb().prepare(`
      UPDATE bookings_v2 SET payment_status = 'VERIFIED', status = 'BOOKED', updated_at = ? WHERE id = ?
    `).run(ts, payment.booking_id);
    getDb().prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, actor_id, metadata, created_at)
      VALUES (?, ?, 'VERIFIED', ?, ?, ?, ?)
    `).run(genId('pe'), paymentId, actorRole, realUserId, JSON.stringify({ verifiedAt: ts }), ts);
    getDb().prepare(`
      INSERT INTO booking_status_history (id, booking_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at)
      VALUES (?, ?, ?, 'BOOKED', 'OWNER', ?, 'payment verified', ?, ?)
    `).run(genId('h'), payment.booking_id, payment.booking_status || 'QUOTED', realUserId, JSON.stringify({ paymentId }), ts);
  });
  txn();
  return { success: true, paymentId, status: 'VERIFIED', bookingId: payment.booking_id };
}

function rejectPayment({ paymentId, actorUserId, actorRole, reason }) {
  ensurePaymentsTable();
  if (actorRole !== 'OWNER') return { success: false, error: 'NOT_AUTHORIZED' };
  if (!reason || reason.length < 3) return { success: false, error: 'MISSING_REASON' };
  const payment = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) return { success: false, error: 'NOT_FOUND' };
  if (payment.status === 'VERIFIED') return { success: false, error: 'ALREADY_VERIFIED' };

  const realUserId = resolveActorUserId(actorUserId) || actorUserId;
  const ts = nowIso();
  const txn = getDb().transaction(() => {
    getDb().prepare(`
      UPDATE payments SET status = 'REJECTED', rejection_reason = ?, updated_at = ? WHERE id = ?
    `).run(reason, ts, paymentId);
    getDb().prepare(`
      UPDATE bookings_v2 SET payment_status = 'REJECTED', updated_at = ? WHERE id = ?
    `).run(ts, payment.booking_id);
    getDb().prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, actor_id, metadata, created_at)
      VALUES (?, ?, 'REJECTED', 'OWNER', ?, ?, ?)
    `).run(genId('pe'), paymentId, realUserId, JSON.stringify({ reason }), ts);
  });
  txn();
  return { success: true, paymentId, status: 'REJECTED' };
}

module.exports = {
  ensurePaymentsTable, submitPayment, listQueue, getPayment,
  verifyPayment, rejectPayment,
  // for tests
  _internal: { dataUrlToBuffer, saveScreenshot, nowIso, genId }
};
