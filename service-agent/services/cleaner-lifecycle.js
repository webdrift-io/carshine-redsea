'use strict';

/**
 * M0-007 — Cleaner job status lifecycle service.
 *
 * Allowed transitions (uses actual schema status names):
 *   QUOTED | BOOKED | ASSIGNED  →  ON_THE_WAY   (EN_ROUTE in task spec)
 *   ON_THE_WAY                  →  IN_PROGRESS  (ON_SITE in task spec)
 *   IN_PROGRESS                 →  COMPLETED
 *
 * Rules:
 *   - Payment must be VERIFIED before ON_THE_WAY.
 *   - Booking must have an active assignment.
 *   - CLEANER can only act on their own assigned booking.
 *   - OWNER can override and act on any assigned booking.
 *   - DISPATCHER cannot perform lifecycle transitions.
 *   - Every transition appends a booking_status_history row.
 */

const database = require('../database');
const { db } = database;

const DEV_BYPASS_SUB = 'local-dev';

const ALLOWED_TRANSITIONS = {
  QUOTED:      'ON_THE_WAY',
  BOOKED:      'ON_THE_WAY',
  ASSIGNED:    'ON_THE_WAY',
  ON_THE_WAY:  'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
};

const BLOCKED_STATUSES = new Set(['NEW', 'COLLECTING_INFO', 'NEEDS_HUMAN', 'CANCELLED']);

function resolveActorUserId(userId) {
  if (userId && userId !== DEV_BYPASS_SUB) return userId;
  const owner = db.prepare(
    "SELECT id FROM users WHERE role = 'OWNER' AND active = 1 ORDER BY created_at ASC LIMIT 1"
  ).get();
  return owner ? owner.id : null;
}

/**
 * Pure validator — no DB access.
 *
 * @param {string} currentStatus
 * @param {string} targetStatus
 * @returns {{ valid: true } | { valid: false, code: string, error: string }}
 */
function validateCleanerTransition(currentStatus, targetStatus) {
  if (BLOCKED_STATUSES.has(currentStatus)) {
    return { valid: false, code: 'INVALID_FROM_STATUS', error: `Booking status ${currentStatus} cannot transition via cleaner lifecycle` };
  }
  if (currentStatus === 'COMPLETED') {
    return { valid: false, code: 'ALREADY_COMPLETED', error: 'Booking is already COMPLETED' };
  }
  const expected = ALLOWED_TRANSITIONS[currentStatus];
  if (!expected) {
    return { valid: false, code: 'INVALID_FROM_STATUS', error: `No lifecycle transition defined from ${currentStatus}` };
  }
  if (expected !== targetStatus) {
    return {
      valid: false,
      code: 'INVALID_TRANSITION',
      error: `Cannot go from ${currentStatus} to ${targetStatus}. Expected ${expected}`,
    };
  }
  return { valid: true };
}

/**
 * Return all bookings actively assigned to the given cleaner.
 *
 * @param {string} cleanerId
 * @returns {{ success: boolean, count: number, bookings: Array }}
 */
function getCleanerAssignedBookings(cleanerId) {
  if (!cleanerId || cleanerId === DEV_BYPASS_SUB) {
    return { success: false, code: 'MISSING_CLEANER_ID', error: 'cleanerId is required' };
  }
  const rows = db.prepare(`
    SELECT
      b.id, b.public_ref, b.status, b.payment_status,
      b.scheduled_start, b.scheduled_end, b.timezone,
      b.notes, b.created_at, b.updated_at,
      c.id AS customer_id, c.full_name, c.phone_raw, c.address, c.area,
      sp.code AS sp_code, sp.name_en,
      sp.duration_minutes, sp.price_amount, sp.price_currency,
      asgn.id AS asgn_id, asgn.assigned_at
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    JOIN service_packages sp ON sp.id = b.service_package_id
    JOIN assignments asgn ON asgn.booking_id = b.id
                         AND asgn.cleaner_id = ?
                         AND asgn.released_at IS NULL
    WHERE b.deleted_at IS NULL
    ORDER BY b.scheduled_start ASC
  `).all(cleanerId);

  const bookings = rows.map(row => ({
    bookingV2Id: row.id,
    publicRef: row.public_ref,
    status: row.status,
    paymentStatus: row.payment_status,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    timezone: row.timezone,
    notes: row.notes || '',
    customer: {
      id: row.customer_id,
      fullName: row.full_name,
      phoneRaw: row.phone_raw,
      address: row.address,
      area: row.area,
    },
    servicePackage: {
      code: row.sp_code,
      nameEn: row.name_en,
      durationMinutes: row.duration_minutes,
      pricePiasters: row.price_amount,
      priceCurrency: row.price_currency,
    },
    assignment: { id: row.asgn_id, assignedAt: row.asgn_assigned_at },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { success: true, count: bookings.length, bookings };
}

/**
 * Perform a cleaner job status lifecycle transition.
 *
 * @param {string} bookingId
 * @param {string} targetStatus  one of ON_THE_WAY | IN_PROGRESS | COMPLETED
 * @param {{ role: string, userId: string }} actor
 */
function transitionCleanerBookingStatus(bookingId, targetStatus, actor) {
  if (!bookingId || !targetStatus) {
    return { success: false, code: 'MISSING_PARAMS', error: 'bookingId and status are required' };
  }

  const actorRole = (actor && actor.role) || 'OWNER';
  const effectiveRole = actorRole === 'admin' ? 'OWNER' : actorRole;

  if (effectiveRole === 'DISPATCHER') {
    return { success: false, code: 'ROLE_NOT_ALLOWED', error: 'DISPATCHER cannot update cleaner job status' };
  }

  const actorUserId = resolveActorUserId(actor && actor.userId);

  const booking = db.prepare(
    'SELECT id, status, payment_status FROM bookings_v2 WHERE id = ? AND deleted_at IS NULL'
  ).get(bookingId);
  if (!booking) {
    return { success: false, code: 'NOT_FOUND', error: 'Booking not found' };
  }

  // Payment must be VERIFIED before the first lifecycle step
  if (targetStatus === 'ON_THE_WAY' && booking.payment_status !== 'VERIFIED') {
    return {
      success: false,
      code: 'PAYMENT_NOT_VERIFIED',
      error: 'Payment must be VERIFIED before starting the job lifecycle',
    };
  }

  const validation = validateCleanerTransition(booking.status, targetStatus);
  if (!validation.valid) {
    return { success: false, code: validation.code, error: validation.error };
  }

  const assignment = db.prepare(
    'SELECT id, cleaner_id FROM assignments WHERE booking_id = ? AND released_at IS NULL LIMIT 1'
  ).get(bookingId);
  if (!assignment) {
    return { success: false, code: 'NOT_ASSIGNED', error: 'Booking has no active assignment' };
  }

  // CLEANER ownership: can only act on their own booking
  if (effectiveRole === 'CLEANER' && actorUserId !== assignment.cleaner_id) {
    return { success: false, code: 'NOT_YOUR_BOOKING', error: 'You are not assigned to this booking' };
  }

  const now = new Date().toISOString();
  const historyId = 'bsh_' + Math.random().toString(36).slice(2, 12);
  const fromStatus = booking.status;

  db.transaction(() => {
    db.prepare('UPDATE bookings_v2 SET status = ?, updated_at = ? WHERE id = ?')
      .run(targetStatus, now, bookingId);

    db.prepare(`
      INSERT INTO booking_status_history
        (id, booking_id, from_status, to_status, actor_type, actor_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(historyId, bookingId, fromStatus, targetStatus, effectiveRole, actorUserId, 'CLEANER_LIFECYCLE', now);
  })();

  const updated = db.prepare(
    'SELECT id, status, payment_status, updated_at FROM bookings_v2 WHERE id = ?'
  ).get(bookingId);

  if (targetStatus === 'COMPLETED') {
    try {
      const notifications = require('./notifications');
      const fullRow = db.prepare(`
        SELECT b.*, c.phone_raw, c.phone_e164, c.full_name, c.language
        FROM bookings_v2 b
        JOIN customers c ON c.id = b.customer_id
        WHERE b.id = ?
      `).get(bookingId);
      if (fullRow) {
        notifications.notifyCompletion(fullRow, fullRow).catch(() => {});
      }
    } catch (_e) {
      // notifications are best-effort
    }
  }

  return {
    success: true,
    booking: {
      bookingV2Id: updated.id,
      status: updated.status,
      paymentStatus: updated.payment_status,
      updatedAt: updated.updated_at,
    },
  };
}

module.exports = { transitionCleanerBookingStatus, getCleanerAssignedBookings, validateCleanerTransition };
