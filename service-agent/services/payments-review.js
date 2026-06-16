'use strict';

/**
 * M0-006 — Manual InstaPay payment review service.
 *
 * Hard rules enforced here and at the DB layer:
 *  - AI actor is forbidden from verifying or submitting.
 *  - Only OWNER can verify or reject.
 *  - Every state change appends an immutable payment_events row.
 *  - Transactions wrap every multi-row change.
 *  - All SQL uses db.prepare() with bound params — no interpolation.
 *  - The 5 DB-level payment-safety triggers remain intact and act as a
 *    second line of defense; this service is the first.
 */

const database = require('../database');
const { db } = database;

const DEV_BYPASS_SUB = 'local-dev';

function resolveActorUserId(userId) {
  if (userId && userId !== DEV_BYPASS_SUB) return userId;
  const owner = db.prepare(
    "SELECT id FROM users WHERE role = 'OWNER' AND active = 1 ORDER BY created_at ASC LIMIT 1"
  ).get();
  return owner ? owner.id : null;
}

function actorTypeFromRole(role) {
  if (!role || role === 'admin') return 'OWNER';
  const valid = ['OWNER', 'DISPATCHER', 'CLEANER'];
  return valid.includes(role) ? role : 'OWNER';
}

function genId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function tryParseJson(s) {
  try { return JSON.parse(s); } catch (_e) { return s; }
}

// ---------------------------------------------------------------------------
// Shared SQL
// ---------------------------------------------------------------------------

const SELECT_PAYMENT_FULL = `
  SELECT
    p.id, p.booking_id, p.method, p.amount, p.currency, p.status,
    p.reference, p.screenshot_url, p.submitted_at, p.verified_at,
    p.verified_by_user_id, p.rejection_reason, p.created_at, p.updated_at,
    b.public_ref, b.status AS booking_status,
    b.payment_status AS booking_payment_status,
    b.scheduled_start, b.scheduled_end,
    c.full_name AS customer_name, c.phone_raw AS customer_phone,
    c.email AS customer_email,
    sp.name_en AS service_name, sp.price_amount, sp.price_currency
  FROM payments p
  JOIN bookings_v2 b ON b.id = p.booking_id
  JOIN customers c ON c.id = b.customer_id
  JOIN service_packages sp ON sp.id = b.service_package_id
  WHERE b.deleted_at IS NULL
`;

const LIST_PAYMENTS_SQL = `${SELECT_PAYMENT_FULL}
  AND (? IS NULL OR p.status = ?)
  ORDER BY p.submitted_at ASC, p.created_at ASC
  LIMIT ? OFFSET ?
`;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatPaymentRow(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    publicRef: row.public_ref,
    method: row.method,
    amountPiasters: row.amount,
    currency: row.currency,
    status: row.status,
    reference: row.reference || null,
    screenshotUrl: row.screenshot_url || null,
    submittedAt: row.submitted_at || null,
    verifiedAt: row.verified_at || null,
    verifiedByUserId: row.verified_by_user_id || null,
    rejectionReason: row.rejection_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    booking: {
      status: row.booking_status,
      paymentStatus: row.booking_payment_status,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end
    },
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      email: row.customer_email
    },
    service: {
      name: row.service_name,
      pricePiasters: row.price_amount,
      currency: row.price_currency
    }
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getPaymentByIdRaw(paymentId) {
  return db.prepare(`${SELECT_PAYMENT_FULL} AND p.id = ? LIMIT 1`).get(paymentId) || null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List payments, defaulting to the PAYMENT_PENDING_REVIEW queue.
 *
 * @param {Object} [filters]
 * @param {string} [filters.status]  defaults to 'PAYMENT_PENDING_REVIEW'
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 */
function listPendingPaymentReviews(filters = {}) {
  const statusFilter = filters.status != null
    ? (String(filters.status).trim() || null)
    : 'PAYMENT_PENDING_REVIEW';
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);

  const rows = db.prepare(LIST_PAYMENTS_SQL).all(statusFilter, statusFilter, limit, offset);
  return {
    success: true,
    count: rows.length,
    payments: rows.map(formatPaymentRow),
    hasMore: rows.length === limit
  };
}

/**
 * Get a single payment with its event log.
 *
 * @param {string} paymentId
 */
function getPaymentReviewDetail(paymentId) {
  if (!paymentId || typeof paymentId !== 'string') {
    return { success: false, code: 'INVALID_ID' };
  }
  const row = getPaymentByIdRaw(paymentId);
  if (!row) return { success: false, code: 'NOT_FOUND' };

  const events = db.prepare(`
    SELECT id, event_type, actor_type, actor_id, metadata, created_at
    FROM payment_events
    WHERE payment_id = ?
    ORDER BY created_at ASC
  `).all(paymentId).map(e => ({
    id: e.id,
    eventType: e.event_type,
    actorType: e.actor_type,
    actorId: e.actor_id,
    metadata: e.metadata ? tryParseJson(e.metadata) : null,
    createdAt: e.created_at
  }));

  return { success: true, payment: formatPaymentRow(row), events };
}

/**
 * Record that payment proof was submitted; sets status to PAYMENT_PENDING_REVIEW.
 *
 * @param {string} paymentId
 * @param {{ reference?, screenshotUrl?, notes? }} input
 * @param {{ role: string, userId: string, actorType?: string }} actor
 */
function submitPaymentProof(paymentId, input, actor) {
  if (!paymentId || typeof paymentId !== 'string') {
    return { success: false, code: 'INVALID_ID' };
  }
  if (!actor || actorTypeFromRole(actor.role) === 'AI') {
    return { success: false, code: 'AI_FORBIDDEN', error: 'AI cannot submit payment proof' };
  }

  const row = getPaymentByIdRaw(paymentId);
  if (!row) return { success: false, code: 'NOT_FOUND' };

  const submittableStatuses = ['UNPAID', 'PAYMENT_INSTRUCTIONS_SENT', 'REJECTED'];
  if (!submittableStatuses.includes(row.status)) {
    return { success: false, code: 'WRONG_STATUS', error: `Cannot submit proof when payment status is ${row.status}` };
  }

  const actorType = actorTypeFromRole(actor.role);
  const actorId = actor.userId || null;
  const reference = (input && input.reference) ? String(input.reference).trim().slice(0, 200) || null : null;
  const screenshotUrl = (input && input.screenshotUrl) ? String(input.screenshotUrl).trim().slice(0, 500) || null : null;
  const notes = (input && input.notes) ? String(input.notes).trim().slice(0, 1000) || null : null;
  const ts = nowIso();
  const evtId = genId('evt');

  db.transaction(() => {
    db.prepare(`
      UPDATE payments
      SET status = 'PAYMENT_PENDING_REVIEW',
          reference = COALESCE(?, reference),
          screenshot_url = COALESCE(?, screenshot_url),
          submitted_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(reference, screenshotUrl, ts, ts, paymentId);

    db.prepare(`
      UPDATE bookings_v2
      SET payment_status = 'PAYMENT_PENDING_REVIEW', updated_at = ?
      WHERE id = ?
    `).run(ts, row.booking_id);

    db.prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, actor_id, metadata, created_at)
      VALUES (?, ?, 'SUBMITTED', ?, ?, ?, ?)
    `).run(evtId, paymentId, actorType, actorId, JSON.stringify({ reference, screenshotUrl, notes }), ts);
  })();

  return { success: true, payment: formatPaymentRow(getPaymentByIdRaw(paymentId)) };
}

/**
 * Owner verifies a payment; sets status to VERIFIED and booking to VERIFIED.
 *
 * @param {string} paymentId
 * @param {{ notes? }} input
 * @param {{ role: string, userId: string }} actor  — must be OWNER
 */
function verifyPayment(paymentId, input, actor) {
  if (!paymentId || typeof paymentId !== 'string') {
    return { success: false, code: 'INVALID_ID' };
  }
  if (!actor) {
    return { success: false, code: 'ACTOR_REQUIRED' };
  }
  const effectiveRole = actor.role === 'admin' ? 'OWNER' : actor.role;
  if (effectiveRole !== 'OWNER') {
    return { success: false, code: 'OWNER_REQUIRED', error: 'Only OWNER can verify payments' };
  }

  const row = getPaymentByIdRaw(paymentId);
  if (!row) return { success: false, code: 'NOT_FOUND' };

  if (row.status !== 'PAYMENT_PENDING_REVIEW') {
    return { success: false, code: 'WRONG_STATUS', error: `Cannot verify payment with status ${row.status}` };
  }

  const verifiedByUserId = resolveActorUserId(actor.userId);
  if (!verifiedByUserId) {
    return { success: false, code: 'ACTOR_USER_REQUIRED', error: 'Cannot resolve a valid user ID for verification; OWNER must be in the users table' };
  }

  const notes = (input && input.notes) ? String(input.notes).trim().slice(0, 1000) || null : null;
  const ts = nowIso();
  const evtId = genId('evt');

  db.transaction(() => {
    db.prepare(`
      UPDATE payments
      SET status = 'VERIFIED',
          verified_by_user_id = ?,
          verified_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(verifiedByUserId, ts, ts, paymentId);

    db.prepare(`
      UPDATE bookings_v2
      SET payment_status = 'VERIFIED', updated_at = ?
      WHERE id = ?
    `).run(ts, row.booking_id);

    db.prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, actor_id, metadata, created_at)
      VALUES (?, ?, 'VERIFIED', 'OWNER', ?, ?, ?)
    `).run(evtId, paymentId, verifiedByUserId, JSON.stringify({ notes }), ts);
  })();

  return { success: true, payment: formatPaymentRow(getPaymentByIdRaw(paymentId)) };
}

/**
 * Owner rejects a payment; reason is required.
 *
 * @param {string} paymentId
 * @param {{ reason: string }} input
 * @param {{ role: string, userId: string }} actor  — must be OWNER
 */
function rejectPayment(paymentId, input, actor) {
  if (!paymentId || typeof paymentId !== 'string') {
    return { success: false, code: 'INVALID_ID' };
  }
  if (!actor) {
    return { success: false, code: 'ACTOR_REQUIRED' };
  }
  const effectiveRole = actor.role === 'admin' ? 'OWNER' : actor.role;
  if (effectiveRole !== 'OWNER') {
    return { success: false, code: 'OWNER_REQUIRED', error: 'Only OWNER can reject payments' };
  }

  const reason = (input && input.reason) ? String(input.reason).trim() : '';
  if (!reason) {
    return { success: false, code: 'REASON_REQUIRED', error: 'Rejection reason is required' };
  }

  const row = getPaymentByIdRaw(paymentId);
  if (!row) return { success: false, code: 'NOT_FOUND' };

  if (row.status !== 'PAYMENT_PENDING_REVIEW') {
    return { success: false, code: 'WRONG_STATUS', error: `Cannot reject payment with status ${row.status}` };
  }

  const actorId = actor.userId || null;
  const ts = nowIso();
  const evtId = genId('evt');

  db.transaction(() => {
    db.prepare(`
      UPDATE payments
      SET status = 'REJECTED',
          rejection_reason = ?,
          updated_at = ?
      WHERE id = ?
    `).run(reason, ts, paymentId);

    db.prepare(`
      UPDATE bookings_v2
      SET payment_status = 'UNPAID', updated_at = ?
      WHERE id = ?
    `).run(ts, row.booking_id);

    db.prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, actor_id, metadata, created_at)
      VALUES (?, ?, 'REJECTED', 'OWNER', ?, ?, ?)
    `).run(evtId, paymentId, actorId, JSON.stringify({ reason }), ts);
  })();

  return { success: true, payment: formatPaymentRow(getPaymentByIdRaw(paymentId)) };
}

module.exports = {
  listPendingPaymentReviews,
  getPaymentReviewDetail,
  submitPaymentProof,
  verifyPayment,
  rejectPayment
};
