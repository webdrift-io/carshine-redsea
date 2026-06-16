'use strict';

/**
 * M0-005a — Slot-overlap refinement.
 *
 * Replaces the M0-003b equality check (`scheduled_start = ?`) with a real
 * half-open window-overlap query against `bookings_v2`:
 *
 *   existing.scheduled_start < newEnd
 *   existing.scheduled_end   > newStart
 *
 * Rules enforced:
 *   - malformed `scheduledStart` is rejected as COLLECTING_INFO with
 *     `missingFields: ['scheduledStart']` (closes M0-003b N3)
 *   - past `scheduledStart` is rejected as COLLECTING_INFO (same shape)
 *   - overlapping active booking is rejected as NEEDS_HUMAN
 *   - CANCELLED_* and ABANDONED are ignored
 *   - back-to-back slots are allowed (open intervals on both sides)
 *
 * No schema change. No new index. Caller passes a `now` ISO string to keep
 * the helper testable and to avoid implicit `Date.now()` calls in business
 * logic.
 */

const database = require('../database');

const ACTIVE_STATUSES = ['QUOTED', 'CONFIRMED', 'IN_PROGRESS'];

const MALFORMED_RESULT = Object.freeze({
  success: false,
  status: 'COLLECTING_INFO',
  missingFields: ['scheduledStart'],
  message: 'The requested date or time is not a valid ISO timestamp. Please provide a future date and time.'
});

const PAST_RESULT = Object.freeze({
  success: false,
  status: 'COLLECTING_INFO',
  missingFields: ['scheduledStart'],
  message: 'The requested time slot is in the past. Please provide a future date and time.'
});

const CONFLICT_RESULT = Object.freeze({
  success: false,
  status: 'NEEDS_HUMAN',
  message: 'The requested time slot is unavailable. Please choose a different time or contact us for assistance.'
});

/**
 * Window-overlap query.
 *
 *   existing.start < newEnd  AND  existing.end > newStart
 *
 * Both predicates must be true for a real overlap. Back-to-back (existing
 * end == newStart, or newEnd == existing.start) is not an overlap.
 *
 * @param {Object} params
 * @param {string} params.scheduledStart ISO timestamp (new slot start)
 * @param {string} params.scheduledEnd   ISO timestamp (new slot end)
 * @param {string} [params.excludeBookingId] booking id to exclude (used for reschedule self-check)
 * @returns {Array<Object>} overlapping bookings
 */
function findOverlappingBookings({ scheduledStart, scheduledEnd, excludeBookingId } = {}) {
  if (!scheduledStart || !scheduledEnd) return [];
  // Use SQLite's `datetime()` to normalize stored ISO strings (which may be
  // `+02:00` Africa/Cairo offsets) to UTC for comparison. Without this,
  // lex comparison of `+02:00` vs `Z` strings gives wrong results because
  // the offset characters sort unpredictably relative to digits.
  return database.db.prepare(`
    SELECT id, public_ref, status, scheduled_start, scheduled_end
    FROM bookings_v2
    WHERE deleted_at IS NULL
      AND id != COALESCE(?, '')
      AND status IN ('QUOTED', 'CONFIRMED', 'IN_PROGRESS')
      AND datetime(scheduled_start) < datetime(?)
      AND datetime(scheduled_end)   > datetime(?)
    ORDER BY scheduled_start ASC
    LIMIT 5
  `).all(excludeBookingId || null, scheduledEnd, scheduledStart);
}

/**
 * High-level precondition used by the public booking service.
 *
 * Returns `null` when the slot is free; otherwise returns the same
 * `{ success:false, status, missingFields?, message }` shape the M0-003b
 * `checkSlotConflict` used. Caller decides how to translate to the public
 * API response.
 *
 * The new signature adds `servicePackage` (so the helper can compute the
 * booking end) and `now` (so tests can pin time).
 *
 * @param {Object} normalized   the normalized public-booking input
 * @param {Object} servicePackage  resolved service package (uses durationMinutes)
 * @param {string} now          ISO timestamp
 * @returns {null | { success:false, status:string, missingFields?:string[], message:string }}
 */
function assertNoSlotConflict(normalized, servicePackage, now) {
  if (!normalized || !normalized.scheduledStart) {
    // No scheduledStart is not the slot-overlap layer's job; the public
    // service handles missing-field intake elsewhere. Return null so the
    // caller does not double-report.
    return null;
  }

  const startDate = new Date(normalized.scheduledStart);
  if (Number.isNaN(startDate.getTime())) {
    return { ...MALFORMED_RESULT };
  }

  if (startDate.getTime() < new Date(now).getTime()) {
    return { ...PAST_RESULT };
  }

  const durationMinutes = (servicePackage && Number(servicePackage.durationMinutes)) || 60;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  if (Number.isNaN(endDate.getTime())) {
    return { ...MALFORMED_RESULT };
  }

  // Normalize both timestamps to UTC `Z` format so the lexicographic
  // comparison SQLite performs on ISO strings is timezone-agnostic. The
  // input may be `+02:00` (Africa/Cairo) and the stored `scheduled_end`
  // (written by public-bookings.js) is `Z`; mixing offsets in a string
  // compare gives wrong results.
  const overlaps = findOverlappingBookings({
    scheduledStart: startDate.toISOString(),
    scheduledEnd: endDate.toISOString()
  });

  if (overlaps.length > 0) {
    return { ...CONFLICT_RESULT, conflictingBookings: overlaps.map(toConflictShape) };
  }

  return null;
}

function toConflictShape(row) {
  return {
    id: row.id,
    publicRef: row.public_ref,
    status: row.status,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end
  };
}

module.exports = {
  findOverlappingBookings,
  assertNoSlotConflict,
  ACTIVE_STATUSES
};
