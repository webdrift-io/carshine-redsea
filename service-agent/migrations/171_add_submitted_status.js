'use strict';

/**
 * Migration 171 — add 'SUBMITTED' to payments.status allowed values
 *
 * Migration 170 added the wider method set but used the original status
 * enum which doesn't include 'SUBMITTED'. We add SUBMITTED now to allow
 * the existing service to mark fresh submissions.
 */

const path = require('path');
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite');

function up(db) {
  // Idempotent: skip if 'SUBMITTED' is already in the constraint.
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get();
  if (sql && sql.sql.includes("'SUBMITTED'")) return; // already applied

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
          'SUBMITTED', 'UNPAID', 'PAYMENT_INSTRUCTIONS_SENT', 'PAYMENT_PENDING_REVIEW',
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
    db.exec(`
      INSERT INTO payments_new
        (id, booking_id, method, amount, currency, status, reference, screenshot_url,
         submitted_at, verified_by_user_id, verified_at, rejection_reason, created_at, updated_at)
      SELECT
        id, booking_id, method, amount, currency, status, reference, screenshot_url,
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

if (require.main === module) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  try {
    up(db);
    console.log('Migration 171 applied: payments.status now accepts SUBMITTED');
  } finally {
    db.close();
  }
}

module.exports = { up, DB_PATH };
