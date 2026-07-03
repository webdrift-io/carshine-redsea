'use strict';

/**
 * M0-005a — Admin bookings read model.
 *
 * Read-only query layer over the M0 schema. Joins `bookings_v2` with
 * `customers`, `vehicles`, `service_packages`, and `payments`, plus
 * `booking_status_history` and `payment_events` for the detail endpoint.
 *
 * Hard rules:
 *   - read-only (no INSERT/UPDATE/DELETE)
 *   - no schema changes
 *   - no raw SQL string interpolation (all `db.prepare` with bound params)
 *   - missingFields is parsed from `bookings_v2.notes` if status is
 *     `COLLECTING_INFO` (temporary shim; a dedicated column lands in M0-005b)
 *   - assignment is always `null` in M0-005a (M0-007 populates this)
 */

const database = require('../database');
const { db } = database;

const LIST_SQL = `
  SELECT
    b.id, b.public_ref, b.status, b.payment_status, b.scheduled_start, b.scheduled_end,
    b.timezone, b.source, b.language, b.notes, b.missing_fields,
    b.washes_needed, b.washes_completed, b.operational_cost, b.owner_notes, b.last_wash_at, b.next_wash_at,
    b.created_at, b.updated_at,
    c.id AS customer_id, c.full_name, c.phone_e164, c.phone_raw, c.email,
    c.address AS customer_address, c.area AS customer_area,
    v.id AS vehicle_id, v.car_type, v.make AS v_make, v.model AS v_model, v.plate AS v_plate,
    sp.id AS sp_id, sp.code AS sp_code, sp.name_en, sp.name_ar, sp.name_de,
    sp.duration_minutes, sp.price_amount, sp.price_currency,
    p.id AS payment_id, p.status AS payment_row_status, p.method AS payment_method,
    p.amount AS payment_amount, p.currency AS payment_currency,
    p.submitted_at AS payment_submitted_at, p.verified_at AS payment_verified_at,
    asgn.id AS asgn_id, asgn.assigned_at AS asgn_assigned_at,
    asgn_u.id AS asgn_cleaner_id, asgn_u.display_name AS asgn_cleaner_name,
    asgn_u.phone AS asgn_cleaner_phone
  FROM bookings_v2 b
  JOIN customers c ON c.id = b.customer_id
  LEFT JOIN vehicles v ON v.id = b.vehicle_id
  JOIN service_packages sp ON sp.id = b.service_package_id
  LEFT JOIN payments p ON p.booking_id = b.id
  LEFT JOIN assignments asgn ON asgn.booking_id = b.id AND asgn.released_at IS NULL
  LEFT JOIN users asgn_u ON asgn_u.id = asgn.cleaner_id
  WHERE b.deleted_at IS NULL
    AND (? IS NULL OR b.scheduled_start >= ?)
    AND (? IS NULL OR b.scheduled_start <  ?)
    AND (? IS NULL OR b.status = ?)
    AND (? IS NULL OR b.payment_status = ?)
    AND (? IS NULL OR b.source = ?)
    AND (? IS NULL OR b.language = ?)
  ORDER BY b.scheduled_start ASC, b.created_at ASC
  LIMIT ? OFFSET ?
`;

const DETAIL_SQL = LIST_SQL; // kept for documentation; the function uses its own SQL string

const CALENDAR_SQL = `
  SELECT id, public_ref, status, payment_status, scheduled_start, scheduled_end,
         customer_id, vehicle_id, service_package_id
  FROM bookings_v2
  WHERE deleted_at IS NULL
    AND scheduled_start >= ?
    AND scheduled_start <  ?
  ORDER BY scheduled_start ASC
`;

const HISTORY_SQL = `
  SELECT id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at
  FROM booking_status_history
  WHERE booking_id = ?
  ORDER BY created_at DESC
  LIMIT 50
`;

const PAYMENT_EVENTS_SQL = `
  SELECT pe.id, pe.event_type, pe.actor_type, pe.actor_id, pe.metadata, pe.created_at
  FROM payment_events pe
  JOIN payments p ON p.id = pe.payment_id
  WHERE p.booking_id = ?
  ORDER BY pe.created_at DESC
  LIMIT 20
`;

const MISSING_FIELDS_REGEX = /Missing fields:\s*([^\n]+)/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function normalizeDateParam(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeLimit(limit) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function normalizeOffset(offset) {
  const n = parseInt(offset, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function normalizeStatusFilter(value) {
  if (!value) return null;
  const s = String(value).trim();
  return s || null;
}

/**
 * List bookings for the admin dashboard.
 *
 * @param {Object} [opts]
 * @param {string} [opts.dateFrom]   ISO timestamp; null = no lower bound
 * @param {string} [opts.dateTo]     ISO timestamp; null = no upper bound
 * @param {string} [opts.status]     bookings_v2.status
 * @param {string} [opts.paymentStatus] bookings_v2.payment_status
 * @param {string} [opts.source]     bookings_v2.source
 * @param {string} [opts.language]   bookings_v2.language
 * @param {number} [opts.limit]      default 50, max 500
 * @param {number} [opts.offset]     default 0
 * @returns {{success:boolean, count:number, bookings:Array, hasMore:boolean}}
 */
function listBookingsForAdmin(opts = {}) {
  const dateFrom = normalizeDateParam(opts.dateFrom);
  const dateTo = normalizeDateParam(opts.dateTo);
  const status = normalizeStatusFilter(opts.status);
  const paymentStatus = normalizeStatusFilter(opts.paymentStatus);
  const source = normalizeStatusFilter(opts.source);
  const language = normalizeStatusFilter(opts.language);
  const limit = normalizeLimit(opts.limit);
  const offset = normalizeOffset(opts.offset);

  const rows = db.prepare(LIST_SQL).all(
    dateFrom, dateFrom,
    dateTo, dateTo,
    status, status,
    paymentStatus, paymentStatus,
    source, source,
    language, language,
    limit, offset
  );
  const bookings = rows.map(formatBookingForAdmin);
  return {
    success: true,
    count: bookings.length,
    bookings,
    hasMore: bookings.length === limit
  };
}

/**
 * Get a single booking with status history and payment events.
 *
 * @param {string} bookingV2Id
 * @returns {{success:boolean, booking:Object, statusHistory:Array, paymentEvents:Array} | {success:false, code:string}}
 */
function getBookingDetailForAdmin(bookingV2Id) {
  if (!bookingV2Id || typeof bookingV2Id !== 'string') {
    return { success: false, code: 'INVALID_ID' };
  }
  // DETAIL_SQL keeps the 6 filter placeholders from LIST_SQL (dateFrom,
  // dateTo, status, paymentStatus, source, language) and ignores the
  // LIMIT/OFFSET placeholders (replaced with hardcoded `LIMIT 1 OFFSET 0`).
  // Pass NULLs for all filters so the WHERE clause matches every row,
  // then narrow by id with an extra predicate below.
  const rows = db.prepare(`
    SELECT
      b.id, b.public_ref, b.status, b.payment_status, b.scheduled_start, b.scheduled_end,
      b.timezone, b.source, b.language, b.notes, b.missing_fields,
      b.washes_needed, b.washes_completed, b.operational_cost, b.owner_notes, b.last_wash_at, b.next_wash_at,
      b.created_at, b.updated_at,
      c.id AS customer_id, c.full_name, c.phone_e164, c.phone_raw, c.email,
      c.address AS customer_address, c.area AS customer_area,
      v.id AS vehicle_id, v.car_type, v.make AS v_make, v.model AS v_model, v.plate AS v_plate,
      sp.id AS sp_id, sp.code AS sp_code, sp.name_en, sp.name_ar, sp.name_de,
      sp.duration_minutes, sp.price_amount, sp.price_currency,
      p.id AS payment_id, p.status AS payment_row_status, p.method AS payment_method,
      p.amount AS payment_amount, p.currency AS payment_currency,
      p.submitted_at AS payment_submitted_at, p.verified_at AS payment_verified_at,
      asgn.id AS asgn_id, asgn.assigned_at AS asgn_assigned_at,
      asgn_u.id AS asgn_cleaner_id, asgn_u.display_name AS asgn_cleaner_name,
      asgn_u.phone AS asgn_cleaner_phone
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    JOIN service_packages sp ON sp.id = b.service_package_id
    LEFT JOIN payments p ON p.booking_id = b.id
    LEFT JOIN assignments asgn ON asgn.booking_id = b.id AND asgn.released_at IS NULL
    LEFT JOIN users asgn_u ON asgn_u.id = asgn.cleaner_id
    WHERE b.deleted_at IS NULL AND b.id = ?
    LIMIT 1
  `).all(bookingV2Id);
  const row = rows[0];
  if (!row) return { success: false, code: 'NOT_FOUND' };

  const booking = formatBookingForAdmin(row);
  const statusHistory = db.prepare(HISTORY_SQL).all(bookingV2Id).map(formatStatusHistory);
  const paymentEvents = row.payment_id
    ? db.prepare(PAYMENT_EVENTS_SQL).all(bookingV2Id).map(formatPaymentEvent)
    : [];

  return { success: true, booking, statusHistory, paymentEvents };
}

/**
 * Narrower calendar projection.
 *
 * @param {Object} opts
 * @param {string} opts.dateFrom  ISO timestamp (required)
 * @param {string} opts.dateTo    ISO timestamp (required)
 * @returns {{success:boolean, count:number, events:Array}}
 */
function getCalendarForAdmin(opts = {}) {
  const dateFrom = normalizeDateParam(opts.dateFrom);
  const dateTo = normalizeDateParam(opts.dateTo);
  if (!dateFrom || !dateTo) {
    return { success: false, code: 'DATE_RANGE_REQUIRED', events: [] };
  }

  const rows = db.prepare(CALENDAR_SQL).all(dateFrom, dateTo);
  const events = rows.map(formatCalendarEvent);
  return { success: true, count: events.length, events };
}

/**
 * Pure formatter: one M0 row -> the admin-shape object.
 *
 * Exported for reuse (e.g. the reschedule endpoint returns one).
 *
 * @param {Object} row joined row from LIST_SQL
 * @returns {Object} admin shape
 */
function formatBookingForAdmin(row) {
  const missingFields = parseMissingFields(row.missing_fields, row.notes, row.status);
  const needsHuman = row.status === 'NEEDS_HUMAN';
  return {
    bookingV2Id: row.id,
    publicRef: row.public_ref,
    status: row.status,
    paymentStatus: row.status === 'COLLECTING_INFO' || row.status === 'NEEDS_HUMAN'
      ? null
      : row.payment_status,
    source: row.source,
    language: row.language,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    timezone: row.timezone || 'Africa/Cairo',
    area: row.customer_area || null,
    address: row.customer_address || null,
    notes: row.notes || '',
    ops: {
      washesNeeded: Number(row.washes_needed || 1),
      washesCompleted: Number(row.washes_completed || 0),
      operationalCost: Number(row.operational_cost || 0),
      ownerNotes: row.owner_notes || '',
      lastWashAt: row.last_wash_at || null,
      nextWashAt: row.next_wash_at || row.scheduled_start || null
    },
    customer: row.customer_id ? {
      id: row.customer_id,
      fullName: row.full_name,
      phoneE164: row.phone_e164,
      phoneRaw: row.phone_raw,
      email: row.email
    } : null,
    vehicle: row.vehicle_id ? {
      id: row.vehicle_id,
      carType: row.car_type,
      make: row.v_make,
      model: row.v_model,
      plate: row.v_plate
    } : null,
    servicePackage: row.sp_id ? {
      id: row.sp_id,
      code: row.sp_code,
      nameEn: row.name_en,
      nameAr: row.name_ar,
      nameDe: row.name_de,
      pricePiasters: row.price_amount,
      priceCurrency: row.price_currency,
      durationMinutes: row.duration_minutes
    } : null,
    payment: row.payment_id ? {
      id: row.payment_id,
      status: row.payment_row_status,
      method: row.payment_method,
      amountPiasters: row.payment_amount,
      currency: row.payment_currency,
      submittedAt: row.payment_submitted_at,
      verifiedAt: row.payment_verified_at
    } : null,
    assignment: row.asgn_id ? {
      id: row.asgn_id,
      assignedAt: row.asgn_assigned_at,
      cleaner: {
        id: row.asgn_cleaner_id,
        displayName: row.asgn_cleaner_name,
        phone: row.asgn_cleaner_phone
      }
    } : null,
    missingFields,
    needsHuman,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatCalendarEvent(row) {
  return {
    bookingV2Id: row.id,
    publicRef: row.public_ref,
    status: row.status,
    paymentStatus: row.payment_status,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    servicePackageId: row.service_package_id
  };
}

function formatStatusHistory(row) {
  let metadata = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch (e) {
      metadata = row.metadata;
    }
  }
  return {
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorType: row.actor_type,
    actorId: row.actor_id,
    reason: row.reason,
    metadata,
    createdAt: row.created_at
  };
}

function formatPaymentEvent(row) {
  let metadata = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch (e) {
      metadata = row.metadata;
    }
  }
  return {
    id: row.id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    metadata,
    createdAt: row.created_at
  };
}

function parseMissingFields(missingFieldsCol, notes, status) {
  if (status !== 'COLLECTING_INFO') return [];
  // Prefer the dedicated column (migration 091) — JSON array string
  if (missingFieldsCol) {
    try {
      const parsed = JSON.parse(missingFieldsCol);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { /* fall through to legacy notes parsing */ }
  }
  // Legacy fallback: parse from "Missing fields: a, b, c" in notes
  if (!notes) return [];
  const match = MISSING_FIELDS_REGEX.exec(notes);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = {
  listBookingsForAdmin,
  getBookingDetailForAdmin,
  getCalendarForAdmin,
  formatBookingForAdmin,
  ACTIVE_STATUSES: ['QUOTED', 'CONFIRMED', 'IN_PROGRESS']
};
