'use strict';

const database = require('../database');
const crypto = require('crypto');

const { db } = database;

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function getRevenueSummary({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const bookings = db.prepare(`
    SELECT COUNT(*) AS count, SUM(CASE WHEN payment_status = 'VERIFIED' THEN 1 ELSE 0 END) AS paid
    FROM bookings_v2
    WHERE deleted_at IS NULL AND created_at >= ?
  `).get(since);

  const gmv = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS total
    FROM payments p
    JOIN bookings_v2 b ON b.id = p.booking_id
    WHERE p.status = 'VERIFIED' AND b.created_at >= ?
  `).get(since);

  const byChannel = db.prepare(`
    SELECT source, COUNT(*) AS count
    FROM bookings_v2
    WHERE deleted_at IS NULL AND created_at >= ?
    GROUP BY source
  `).all(since);

  return {
    days,
    totalBookings: bookings.count,
    verifiedPayments: bookings.paid,
    gmvMinorUnits: gmv.total,
    byChannel
  };
}

function suggestCleaner(bookingId) {
  const booking = db.prepare(`
    SELECT b.*, c.area FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.id = ? AND b.deleted_at IS NULL
  `).get(bookingId);
  if (!booking) return { suggestions: [] };

  const cleaners = db.prepare(`
    SELECT id, display_name, email, shift_start, shift_end
    FROM users
    WHERE role = 'CLEANER' AND active = 1
  `).all();

  const activeAssignments = db.prepare(`
    SELECT cleaner_id, COUNT(*) AS load
    FROM assignments
    WHERE released_at IS NULL
    GROUP BY cleaner_id
  `).all();
  const loadMap = new Map(activeAssignments.map((r) => [r.cleaner_id, r.load]));

  const suggestions = cleaners
    .map((c) => ({
      cleanerId: c.id,
      name: c.display_name,
      currentLoad: loadMap.get(c.id) || 0,
      score: 100 - (loadMap.get(c.id) || 0) * 20
    }))
    .sort((a, b) => b.score - a.score);

  return { bookingId, area: booking.area, suggestions };
}

function listMarketingDrafts() {
  return db.prepare(`
    SELECT id, title, caption, image_path, platform, status, created_at, approved_at
    FROM marketing_drafts
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
}

function queueMarketingDraft({ title, caption, imagePath, createdBy }) {
  const now = new Date().toISOString();
  const id = createId('mkt');
  db.prepare(`
    INSERT INTO marketing_drafts (id, title, caption, image_path, platform, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'POSTIZ', 'DRAFT', ?, ?, ?)
  `).run(id, title, caption || '', imagePath || null, createdBy || null, now, now);
  return { id, status: 'DRAFT' };
}

function approveMarketingDraft(id) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE marketing_drafts SET status = 'APPROVED', approved_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, id);
  return { id, status: 'APPROVED', note: 'Human approved — Postiz publish still manual per policy' };
}

module.exports = {
  getRevenueSummary,
  suggestCleaner,
  listMarketingDrafts,
  queueMarketingDraft,
  approveMarketingDraft
};
