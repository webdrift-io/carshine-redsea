'use strict';

const database = require('../database');

const { db } = database;

function getPublicBookingStatus(publicRef, phoneLast4) {
  const row = db.prepare(`
    SELECT
      b.id,
      b.public_ref,
      b.status,
      b.payment_status,
      b.scheduled_start,
      b.scheduled_end,
      b.source,
      b.notes,
      c.full_name,
      c.phone_raw,
      c.phone_e164,
      sp.name_en AS service_name
  FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN service_packages sp ON sp.id = b.service_package_id
    WHERE b.deleted_at IS NULL AND b.public_ref = ?
    LIMIT 1
  `).get(publicRef);

  if (!row) return { found: false };

  const digits = String(row.phone_e164 || row.phone_raw || '').replace(/\D/g, '');
  const last4 = digits.slice(-4);
  if (phoneLast4 && last4 !== String(phoneLast4).replace(/\D/g, '')) {
    return { found: false, error: 'PHONE_MISMATCH' };
  }

  const history = db.prepare(`
    SELECT to_status, actor_type, reason, created_at
    FROM booking_status_history
    WHERE booking_id = ?
    ORDER BY created_at ASC
  `).all(row.id);

  return {
    found: true,
    publicRef: row.public_ref,
    status: row.status,
    paymentStatus: row.payment_status,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    customerName: row.full_name,
    serviceName: row.service_name,
    source: row.source,
    timeline: history
  };
}

module.exports = { getPublicBookingStatus };
