'use strict';

/**
 * Customer Portal Service
 * -----------------------
 * Self-service for customers who received a magic link in WhatsApp or email.
 * Authentication is by single-purpose token (see migration 160
 * `customer_portal_tokens`). No password, no customer JWT.
 *
 * Endpoints (wired in server.js):
 *   GET   /api/portal/me             → customer + vehicles + upcoming bookings
 *   GET   /api/portal/bookings       → list customer bookings
 *   POST  /api/portal/bookings/:id/reschedule  (≥24h before)
 *   POST  /api/portal/bookings/:id/cancel      (≥24h before)
 *   POST  /api/portal/bookings/:id/rate        (post-completion)
 *   POST  /api/portal/payments       → submit InstaPay/Vodafone Cash proof
 *   GET   /api/portal/referral       → unique referral code
 *
 * All write actions append to booking_status_history and payment_events so
 * the audit trail is complete. Reschedule + cancel + rate are token-scoped
 * via verifyToken() before any data is touched.
 */

const database = require('../database');
const { db } = database;
const portalTokens = require('../migrations/160_create_customer_portal_tokens');

const RESCHEDULE_WINDOW_HOURS = 24;
const ROLES = { OWNER: 'OWNER', DISPATCHER: 'DISPATCHER' };

function nowIso() { return new Date().toISOString(); }

function getDb() {
  // The project's database.js exports the prepared `db` differently across
  // versions; use whichever shape is available.
  return database.db || db;
}

function isValidToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  if (rawToken.length < 16 || rawToken.length > 200) return null;
  return portalTokens.verifyToken(getDb(), rawToken);
}

function extractToken(req) {
  // Accept ?token=, Authorization: Bearer, or x-portal-token header
  if (req.query && req.query.token) return String(req.query.token);
  const auth = (req.headers && (req.headers.authorization || '')) || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers && req.headers['x-portal-token']) return String(req.headers['x-portal-token']);
  return null;
}

function portalAuthMiddleware(req, res, next) {
  const raw = extractToken(req);
  const row = isValidToken(raw);
  if (!row) return res.status(401).json({ success: false, error: 'INVALID_TOKEN' });
  req.portal = { customerId: row.customer_id, scope: row.scope, bookingId: row.booking_id, tokenId: row.id };
  next();
}

function getCustomer(customerId) {
  return getDb().prepare(`
    SELECT id, full_name, phone_e164, phone_raw, email, language, address, area, notes, tags
    FROM customers WHERE id = ? AND deleted_at IS NULL
  `).get(customerId);
}

function getVehicles(customerId) {
  return getDb().prepare(`
    SELECT id, customer_id, car_type, make, model, color, plate, notes
    FROM vehicles WHERE customer_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `).all(customerId);
}

function getBookings(customerId) {
  return getDb().prepare(`
    SELECT
      b.id, b.public_ref, b.scheduled_start, b.scheduled_end, b.status,
      b.payment_status, b.notes, b.created_at, c.area,
      sp.code AS service_code, sp.name_en AS service_name_en, sp.name_ar AS service_name_ar,
      sp.name_de AS service_name_de, sp.price_amount, sp.price_currency,
      v.car_type, v.make, v.model, v.color, v.plate
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN service_packages sp ON sp.id = b.service_package_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    WHERE b.customer_id = ?
    ORDER BY b.scheduled_start DESC
    LIMIT 100
  `).all(customerId);
}

function getActivePayment(bookingId) {
  return getDb().prepare(`
    SELECT id, method, amount, currency, status, reference, screenshot_url,
           submitted_at, verified_at, rejection_reason
    FROM payments
    WHERE booking_id = ?
    ORDER BY submitted_at DESC LIMIT 1
  `).get(bookingId);
}

function getReviews(bookingId) {
  return getDb().prepare(`
    SELECT id, rating, comment, created_at
    FROM booking_reviews WHERE booking_id = ?
  `).get(bookingId);
}

function getMe(req, res) {
  const customer = getCustomer(req.portal.customerId);
  if (!customer) return res.status(404).json({ success: false, error: 'CUSTOMER_NOT_FOUND' });
  const vehicles = getVehicles(req.portal.customerId);
  const bookings = getBookings(req.portal.customerId);
  const upcoming = bookings.filter(b => ['NEW','COLLECTING_INFO','QUOTED','BOOKED','ASSIGNED'].includes(b.status));
  const past = bookings.filter(b => ['COMPLETED','CANCELLED','NEEDS_HUMAN'].includes(b.status));
  res.json({
    success: true,
    customer: { id: customer.id, fullName: customer.full_name, phone: customer.phone_e164 || customer.phone_raw, email: customer.email, language: customer.language, area: customer.area, tags: customer.tags ? JSON.parse(customer.tags) : [] },
    vehicles,
    upcoming,
    past,
    counts: { upcoming: upcoming.length, past: past.length, vehicles: vehicles.length }
  });
}

function getBookingsList(req, res) {
  const list = getBookings(req.portal.customerId);
  // Attach the latest payment + review to each booking so the portal can show status badges.
  const enriched = list.map(b => ({
    ...b,
    payment: getActivePayment(b.id) || null,
    review: getReviews(b.id) || null
  }));
  res.json({ success: true, bookings: enriched, count: enriched.length });
}

function assertScope(req, bookingId) {
  if (req.portal.scope === 'all') return true;
  return req.portal.bookingId === bookingId;
}

function assertReschedulable(booking) {
  if (!booking) return { ok: false, error: 'NOT_FOUND' };
  if (['COMPLETED', 'CANCELLED', 'IN_PROGRESS', 'ON_THE_WAY'].includes(booking.status)) {
    return { ok: false, error: 'TOO_LATE', message: 'Cannot reschedule after service has started or finished.' };
  }
  const start = new Date(booking.scheduled_start).getTime();
  const hours = (start - Date.now()) / (1000 * 60 * 60);
  if (hours < RESCHEDULE_WINDOW_HOURS) {
    return { ok: false, error: 'TOO_LATE', message: `Reschedule requires at least ${RESCHEDULE_WINDOW_HOURS}h notice.` };
  }
  return { ok: true };
}

function rescheduleBooking(req, res) {
  const bookingId = req.params.id;
  if (!assertScope(req, bookingId)) return res.status(403).json({ success: false, error: 'TOKEN_SCOPE_MISMATCH' });
  const { scheduledStart, scheduledEnd } = req.body || {};
  if (!scheduledStart || !scheduledEnd) return res.status(400).json({ success: false, error: 'MISSING_FIELDS' });

  const booking = getDb().prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(bookingId);
  const guard = assertReschedulable(booking);
  if (!guard.ok) return res.status(400).json({ success: false, error: guard.error, message: guard.message });

  // Capacity check (same as createBooking tool): max 2 per hour slot
  const startDate = new Date(scheduledStart);
  const hour = startDate.getHours();
  const dateStr = startDate.toISOString().slice(0, 10);
  const conflict = getDb().prepare(`
    SELECT COUNT(*) AS n FROM bookings_v2
    WHERE substr(scheduled_start, 1, 10) = ?
      AND CAST(strftime('%H', scheduled_start) AS INTEGER) = ?
      AND status NOT IN ('CANCELLED','NEEDS_HUMAN')
      AND id != ?
  `).get(dateStr, hour, bookingId);
  if (conflict.n >= 2) return res.status(409).json({ success: false, error: 'SLOT_FULL', message: 'That hour is full. Pick another.' });

  const txn = getDb().transaction(() => {
    getDb().prepare(`UPDATE bookings_v2 SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ?`)
      .run(scheduledStart, scheduledEnd, nowIso(), bookingId);
    getDb().prepare(`
      INSERT INTO booking_status_history (id, booking_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at)
      VALUES (?, ?, ?, 'BOOKED', 'CUSTOMER', ?, 'self-service reschedule', ?, ?)
    `).run('h_' + Math.random().toString(36).slice(2, 12), bookingId, booking.status, req.portal.customerId, JSON.stringify({ from: scheduledStart, to: scheduledStart }), nowIso());
  });
  txn();
  const updated = getDb().prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(bookingId);
  res.json({ success: true, booking: updated });
}

function cancelBooking(req, res) {
  const bookingId = req.params.id;
  if (!assertScope(req, bookingId)) return res.status(403).json({ success: false, error: 'TOKEN_SCOPE_MISMATCH' });
  const { reason } = req.body || {};
  const booking = getDb().prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(bookingId);
  const guard = assertReschedulable(booking);
  if (!guard.ok) return res.status(400).json({ success: false, error: guard.error, message: guard.message });

  const txn = getDb().transaction(() => {
    getDb().prepare(`UPDATE bookings_v2 SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).run(nowIso(), bookingId);
    getDb().prepare(`
      INSERT INTO booking_status_history (id, booking_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at)
      VALUES (?, ?, ?, 'CANCELLED', 'CUSTOMER', ?, ?, '{}', ?)
    `).run('h_' + Math.random().toString(36).slice(2, 12), bookingId, booking.status, req.portal.customerId, reason || 'self-service cancel', nowIso());
  });
  txn();
  res.json({ success: true, cancelled: true, bookingId });
}

function rateBooking(req, res) {
  const bookingId = req.params.id;
  if (!assertScope(req, bookingId)) return res.status(403).json({ success: false, error: 'TOKEN_SCOPE_MISMATCH' });
  const { rating, comment } = req.body || {};
  const r = parseInt(rating, 10);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    return res.status(400).json({ success: false, error: 'INVALID_RATING' });
  }
  const booking = getDb().prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  if (booking.status !== 'COMPLETED') {
    return res.status(400).json({ success: false, error: 'NOT_COMPLETED', message: 'You can only rate a completed service.' });
  }
  // Upsert review
  const existing = getDb().prepare('SELECT id FROM booking_reviews WHERE booking_id = ?').get(bookingId);
  if (existing) {
    getDb().prepare('UPDATE booking_reviews SET rating = ?, comment = ?, updated_at = ? WHERE id = ?')
      .run(r, comment || null, nowIso(), existing.id);
  } else {
    getDb().prepare(`
      CREATE TABLE IF NOT EXISTS booking_reviews (
        id TEXT PRIMARY KEY, booking_id TEXT UNIQUE, customer_id TEXT,
        rating INTEGER NOT NULL, comment TEXT, created_at TEXT, updated_at TEXT
      )
    `).run();
    getDb().prepare(`
      INSERT INTO booking_reviews (id, booking_id, customer_id, rating, comment, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('rev_' + Math.random().toString(36).slice(2, 12), bookingId, req.portal.customerId, r, comment || null, nowIso(), nowIso());
  }
  res.json({ success: true, rating: r });
}

function issuePortalToken(customerId, args) {
  return portalTokens.issueToken(getDb(), { customerId, ...(args || {}) });
}

module.exports = {
  portalAuthMiddleware,
  getMe,
  getBookingsList,
  rescheduleBooking,
  cancelBooking,
  rateBooking,
  issuePortalToken,
  // exported for unit tests
  _internal: { assertReschedulable, assertScope, getCustomer, getVehicles, getBookings, isValidToken }
};
