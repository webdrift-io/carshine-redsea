'use strict';

/**
 * M0-007 — Cleaner assignment service.
 *
 * Business rules:
 *   - One active assignment per booking (released_at IS NULL); assigning
 *     auto-releases any existing active assignment with reason REASSIGNED.
 *   - Booking must be QUOTED | CONFIRMED | IN_PROGRESS to be assignable.
 *   - Cleaner must be an active user with role = 'CLEANER'.
 *   - No schema changes; no new tables; all db.prepare with bound params.
 */

const database = require('../database');
const { db } = database;

const ASSIGNABLE_STATUSES = ['QUOTED', 'CONFIRMED', 'IN_PROGRESS'];

function getActiveAssignmentForBooking(bookingId) {
  if (!bookingId) return null;
  return db.prepare(`
    SELECT a.id, a.booking_id, a.cleaner_id, a.assigned_by, a.assigned_at, a.created_at,
           u.display_name AS cleaner_name, u.phone AS cleaner_phone, u.email AS cleaner_email
    FROM assignments a
    JOIN users u ON u.id = a.cleaner_id
    WHERE a.booking_id = ? AND a.released_at IS NULL
    LIMIT 1
  `).get(bookingId) || null;
}

function assignCleaner({ bookingId, cleanerId, assignedById }) {
  if (!bookingId || !cleanerId) {
    return { success: false, code: 'MISSING_PARAMS', error: 'bookingId and cleanerId are required' };
  }

  const booking = db.prepare(
    'SELECT id, status FROM bookings_v2 WHERE id = ? AND deleted_at IS NULL'
  ).get(bookingId);
  if (!booking) {
    return { success: false, code: 'BOOKING_NOT_FOUND', error: 'Booking not found' };
  }
  if (!ASSIGNABLE_STATUSES.includes(booking.status)) {
    return { success: false, code: 'WRONG_STATUS', error: `Cannot assign cleaner to a booking with status ${booking.status}` };
  }

  const cleaner = db.prepare(
    'SELECT id, role, active FROM users WHERE id = ? AND deleted_at IS NULL'
  ).get(cleanerId);
  if (!cleaner) {
    return { success: false, code: 'CLEANER_NOT_FOUND', error: 'Cleaner user not found' };
  }
  if (cleaner.role !== 'CLEANER') {
    return { success: false, code: 'NOT_A_CLEANER', error: 'User does not have CLEANER role' };
  }
  if (!cleaner.active) {
    return { success: false, code: 'CLEANER_INACTIVE', error: 'Cleaner is not active' };
  }

  const now = new Date().toISOString();
  const assignmentId = 'asgn_' + Math.random().toString(36).slice(2, 12);

  db.transaction(() => {
    db.prepare(
      "UPDATE assignments SET released_at = ?, release_reason = 'REASSIGNED' WHERE booking_id = ? AND released_at IS NULL"
    ).run(now, bookingId);

    db.prepare(`
      INSERT INTO assignments (id, booking_id, cleaner_id, assigned_by, assigned_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(assignmentId, bookingId, cleanerId, assignedById || null, now, now);
  })();

  const assignment = getActiveAssignmentForBooking(bookingId);
  return { success: true, assignment };
}

function releaseAssignment({ bookingId, releaseReason }) {
  if (!bookingId) {
    return { success: false, code: 'MISSING_PARAMS', error: 'bookingId is required' };
  }
  const active = db.prepare(
    'SELECT id FROM assignments WHERE booking_id = ? AND released_at IS NULL'
  ).get(bookingId);
  if (!active) {
    return { success: false, code: 'NO_ACTIVE_ASSIGNMENT', error: 'No active assignment found for this booking' };
  }

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE assignments SET released_at = ?, release_reason = ? WHERE id = ?'
  ).run(now, releaseReason || 'RELEASED', active.id);

  return { success: true, releasedAt: now };
}

module.exports = { assignCleaner, releaseAssignment, getActiveAssignmentForBooking, ASSIGNABLE_STATUSES };
