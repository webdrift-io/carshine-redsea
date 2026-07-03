'use strict';

/**
 * Migration 170 — relax payments.method CHECK constraint
 *
 * The original constraint only allowed ('INSTAPAY', 'CASH', 'OTHER') but the
 * landing page advertises InstaPay, Vodafone Cash, Orange Cash, Fawry, and
 * bank transfer. We rebuild the table with the full set of methods plus
 * uppercase normalization on the way in (handled in public-payments.js).
 *
 * Idempotent: safe to re-run.
 */

const path = require('path');
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite');

function up(db) {
  // Idempotent: skip if INSTAPAY already in the constraint (means migration already ran).
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get();
  if (sql && sql.sql.includes("'INSTAPAY'") && sql.sql.includes("'VODAFONE_CASH'")) return;

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS payments_new (
        id TEXT PRIMARY KEY,
        booking_id TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN (
          'INSTAPAY', 'VODAFONE_CASH', 'ORANGE_CASH', 'FAWRY',
          'BANK_TRANSFER', 'CASH', 'OTHER'
        )),
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EGP',
        status TEXT NOT NULL CHECK (status IN (
          'UNPAID', 'PAYMENT_INSTRUCTIONS_SENT', 'PAYMENT_PENDING_REVIEW',
          'VERIFIED', 'REJECTED', 'REFUNDED'
        )),
        reference TEXT,
        screenshot_url TEXT,
        submitted_at TEXT,
        verified_by_user_id TEXT,
        verified_at TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (booking_id) REFERENCES bookings_v2(id),
        FOREIGN KEY (verified_by_user_id) REFERENCES users(id)
      );
    `);

    // Copy existing rows (uppercase the method so old lowercase values still pass)
    db.exec(`
      INSERT INTO payments_new
        (id, booking_id, method, amount, currency, status, reference, screenshot_url,
         submitted_at, verified_by_user_id, verified_at, rejection_reason, created_at, updated_at)
      SELECT
        id, booking_id, UPPER(method), amount, currency, status, reference, screenshot_url,
        submitted_at, verified_by_user_id, verified_at, rejection_reason, created_at, updated_at
      FROM payments;
    `);

    db.exec(`DROP TABLE payments;`);
    db.exec(`ALTER TABLE payments_new RENAME TO payments;`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status);`);
  });
  tx();
}

function down(_db) {
  // No-op: rolling back the constraint relaxation isn't worth the risk.
  // If you need to revert, restore from backup.
}

module.exports = { up, down, DB_PATH };

if (require.main === module) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  try {
    up(db);
    console.log('Migration 170 applied: payments.method now accepts INSTAPAY, VODAFONE_CASH, ORANGE_CASH, FAWRY, BANK_TRANSFER, CASH, OTHER');
  } finally {
    db.close();
  }
}
