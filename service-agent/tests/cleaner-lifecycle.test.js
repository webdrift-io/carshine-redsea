'use strict';

/**
 * M0-007 — Vitest tests for the cleaner-lifecycle service.
 *
 * 13 test cases:
 *  1. cleaner can list own assigned bookings
 *  2. cleaner cannot see another cleaner's bookings (returns empty list)
 *  3. cleaner cannot update another cleaner's booking (NOT_YOUR_BOOKING)
 *  4. cannot go ON_THE_WAY before payment VERIFIED (PAYMENT_NOT_VERIFIED)
 *  5. assigned + VERIFIED booking can go ON_THE_WAY
 *  6. ON_THE_WAY can go IN_PROGRESS
 *  7. IN_PROGRESS can go COMPLETED
 *  8. invalid transition rejected (COMPLETED → ON_THE_WAY = ALREADY_COMPLETED)
 *  9. CANCELLED booking cannot transition (INVALID_FROM_STATUS)
 * 10. every transition writes booking_status_history
 * 11. OWNER override works (OWNER can act on a CLEANER's booking)
 * 12. DISPATCHER cannot perform cleaner lifecycle (ROLE_NOT_ALLOWED)
 * 13. validateCleanerTransition pure function: allowed and blocked paths
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('M0-007 cleaner-lifecycle service', () => {
  let database;
  let lifecycle;
  let tmpPath;
  let previousDatabasePath;
  let previousNodeEnv;
  let testCounter = 0;

  beforeEach(() => {
    previousDatabasePath = process.env.DATABASE_PATH;
    previousNodeEnv = process.env.NODE_ENV;
    testCounter += 1;
    tmpPath = path.join(
      process.env.TEMP || '/tmp',
      `m0_007_lc_${process.pid}_${testCounter}_${Date.now()}.sqlite`
    );
    process.env.DATABASE_PATH = tmpPath;
    process.env.NODE_ENV = 'development';

    delete require.cache[require.resolve('../services/cleaner-lifecycle')];
    delete require.cache[require.resolve('../database')];
    database = require('../database');
    lifecycle = require('../services/cleaner-lifecycle');

    seedLifecycle(database.db);
  });

  afterEach(() => {
    database.db.close();
    try { fs.unlinkSync(tmpPath); } catch (e) { void e; }
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    delete require.cache[require.resolve('../services/cleaner-lifecycle')];
    delete require.cache[require.resolve('../database')];
  });

  // 1. cleaner can list own assigned bookings
  it('getCleanerAssignedBookings returns own bookings', () => {
    const result = lifecycle.getCleanerAssignedBookings('usr_cleaner_dev');
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.bookings[0].bookingV2Id).toBe('book_lc_test');
    expect(result.bookings[0].status).toBe('QUOTED');
    expect(result.bookings[0].paymentStatus).toBe('VERIFIED');
    expect(result.bookings[0].customer.fullName).toBe('Lifecycle Test Customer');
  });

  // 2. cleaner cannot see another cleaner's bookings
  it('getCleanerAssignedBookings returns empty list for cleaner with no assignments', () => {
    const result = lifecycle.getCleanerAssignedBookings('usr_cleaner_other');
    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.bookings).toHaveLength(0);
  });

  // 3. cleaner cannot update another cleaner's booking
  it('transitionCleanerBookingStatus rejects wrong cleaner with NOT_YOUR_BOOKING', () => {
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_other' };
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_YOUR_BOOKING');
  });

  // 4. cannot go ON_THE_WAY before payment VERIFIED
  it('transitionCleanerBookingStatus rejects ON_THE_WAY when payment is not VERIFIED', () => {
    const db = database.db;
    db.prepare("UPDATE payments SET status = 'PAYMENT_INSTRUCTIONS_SENT' WHERE id = 'pay_lc_test'").run();
    db.prepare("UPDATE bookings_v2 SET payment_status = 'PAYMENT_INSTRUCTIONS_SENT' WHERE id = 'book_lc_test'").run();
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_dev' };
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    expect(result.success).toBe(false);
    expect(result.code).toBe('PAYMENT_NOT_VERIFIED');
  });

  // 5. assigned + VERIFIED booking can go ON_THE_WAY
  it('cleaner can transition QUOTED+VERIFIED booking to ON_THE_WAY', () => {
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_dev' };
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    expect(result.success).toBe(true);
    expect(result.booking.status).toBe('ON_THE_WAY');
  });

  // 6. ON_THE_WAY can go IN_PROGRESS
  it('ON_THE_WAY can transition to IN_PROGRESS', () => {
    const db = database.db;
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_dev' };
    db.prepare("UPDATE bookings_v2 SET status = 'ON_THE_WAY' WHERE id = 'book_lc_test'").run();
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'IN_PROGRESS', actor);
    expect(result.success).toBe(true);
    expect(result.booking.status).toBe('IN_PROGRESS');
  });

  // 7. IN_PROGRESS can go COMPLETED
  it('IN_PROGRESS can transition to COMPLETED', () => {
    const db = database.db;
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_dev' };
    db.prepare("UPDATE bookings_v2 SET status = 'IN_PROGRESS' WHERE id = 'book_lc_test'").run();
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'COMPLETED', actor);
    expect(result.success).toBe(true);
    expect(result.booking.status).toBe('COMPLETED');
  });

  // 8. invalid transition rejected (COMPLETED → ON_THE_WAY)
  it('COMPLETED booking cannot transition to ON_THE_WAY (ALREADY_COMPLETED)', () => {
    const db = database.db;
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_dev' };
    db.prepare("UPDATE bookings_v2 SET status = 'COMPLETED' WHERE id = 'book_lc_test'").run();
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    expect(result.success).toBe(false);
    expect(result.code).toBe('ALREADY_COMPLETED');
  });

  // 9. CANCELLED booking cannot transition
  it('CANCELLED booking cannot transition (INVALID_FROM_STATUS)', () => {
    const db = database.db;
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_dev' };
    db.prepare("UPDATE bookings_v2 SET status = 'CANCELLED' WHERE id = 'book_lc_test'").run();
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_FROM_STATUS');
  });

  // 10. every transition writes booking_status_history
  it('each transition appends a booking_status_history row', () => {
    const db = database.db;
    const actor = { role: 'CLEANER', userId: 'usr_cleaner_dev' };

    lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    lifecycle.transitionCleanerBookingStatus('book_lc_test', 'IN_PROGRESS', actor);
    lifecycle.transitionCleanerBookingStatus('book_lc_test', 'COMPLETED', actor);

    const history = db.prepare(
      "SELECT * FROM booking_status_history WHERE booking_id = 'book_lc_test' AND reason = 'CLEANER_LIFECYCLE' ORDER BY created_at ASC"
    ).all();
    expect(history).toHaveLength(3);
    expect(history[0].from_status).toBe('QUOTED');
    expect(history[0].to_status).toBe('ON_THE_WAY');
    expect(history[1].from_status).toBe('ON_THE_WAY');
    expect(history[1].to_status).toBe('IN_PROGRESS');
    expect(history[2].from_status).toBe('IN_PROGRESS');
    expect(history[2].to_status).toBe('COMPLETED');
    history.forEach(h => {
      expect(h.actor_type).toBe('CLEANER');
      expect(h.actor_id).toBe('usr_cleaner_dev');
    });
  });

  // 11. OWNER override works
  it('OWNER can transition a cleaner booking (override)', () => {
    const actor = { role: 'OWNER', userId: 'usr_owner_dev' };
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    expect(result.success).toBe(true);
    expect(result.booking.status).toBe('ON_THE_WAY');
    const db = database.db;
    const histRow = db.prepare(
      "SELECT actor_type FROM booking_status_history WHERE booking_id = 'book_lc_test' AND reason = 'CLEANER_LIFECYCLE' LIMIT 1"
    ).get();
    expect(histRow.actor_type).toBe('OWNER');
  });

  // 12. DISPATCHER cannot perform cleaner lifecycle
  it('DISPATCHER cannot perform lifecycle transition (ROLE_NOT_ALLOWED)', () => {
    const actor = { role: 'DISPATCHER', userId: 'usr_dispatcher_dev' };
    const result = lifecycle.transitionCleanerBookingStatus('book_lc_test', 'ON_THE_WAY', actor);
    expect(result.success).toBe(false);
    expect(result.code).toBe('ROLE_NOT_ALLOWED');
  });

  // 13. validateCleanerTransition pure function
  it('validateCleanerTransition covers allowed and blocked paths', () => {
    const { validateCleanerTransition: validate } = lifecycle;

    expect(validate('QUOTED',      'ON_THE_WAY').valid).toBe(true);
    expect(validate('ASSIGNED',    'ON_THE_WAY').valid).toBe(true);
    expect(validate('ON_THE_WAY',  'IN_PROGRESS').valid).toBe(true);
    expect(validate('IN_PROGRESS', 'COMPLETED').valid).toBe(true);

    expect(validate('COMPLETED',    'ON_THE_WAY').valid).toBe(false);
    expect(validate('COMPLETED',    'ON_THE_WAY').code).toBe('ALREADY_COMPLETED');
    expect(validate('CANCELLED',    'ON_THE_WAY').valid).toBe(false);
    expect(validate('CANCELLED',    'ON_THE_WAY').code).toBe('INVALID_FROM_STATUS');
    expect(validate('ON_THE_WAY',   'COMPLETED').valid).toBe(false);
    expect(validate('ON_THE_WAY',   'COMPLETED').code).toBe('INVALID_TRANSITION');
    expect(validate('NEW',          'ON_THE_WAY').valid).toBe(false);
    expect(validate('COLLECTING_INFO', 'ON_THE_WAY').valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedLifecycle(db) {
  const now = new Date().toISOString();

  // Primary cleaner (dev seed provides usr_cleaner_dev; use OR IGNORE)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, phone, password_hash, role, display_name, language, active, created_at, updated_at)
    VALUES ('usr_cleaner_other', 'cleaner2@example.com', '+201000000099', 'hash', 'CLEANER', 'Other Cleaner', 'en', 1, ?, ?)
  `).run(now, now);

  // Customer
  db.prepare(`
    INSERT OR IGNORE INTO customers (id, full_name, phone_e164, phone_raw, language, created_at, updated_at)
    VALUES ('cust_lc_test', 'Lifecycle Test Customer', '+201550000099', '01550000099', 'en', ?, ?)
  `).run(now, now);

  // Service package (prefer existing EXTERIOR_SEDAN seed)
  const pkgRow = db.prepare("SELECT id FROM service_packages WHERE code = 'EXTERIOR_SEDAN' LIMIT 1").get();
  const pkgId = pkgRow ? pkgRow.id : 'svc_lc_seed';
  if (!pkgRow) {
    db.prepare(`
      INSERT OR IGNORE INTO service_packages
        (id, code, name_en, name_ar, name_de, duration_minutes, price_amount, price_currency, active, created_at, updated_at)
      VALUES (?, 'EXTERIOR_SEDAN', 'Exterior Sedan', 'خارجي', 'Aussen', 60, 35000, 'EGP', 1, ?, ?)
    `).run('svc_lc_seed', now, now);
  }

  // Booking — QUOTED + payment_status VERIFIED
  db.prepare(`
    INSERT OR IGNORE INTO bookings_v2
      (id, public_ref, customer_id, vehicle_id, service_package_id,
       scheduled_start, scheduled_end, timezone, status, payment_status,
       source, language, notes, created_at, updated_at)
    VALUES ('book_lc_test', 'CR-LC-TEST-001', 'cust_lc_test', NULL, ?,
            '2027-11-20T10:00:00.000Z', '2027-11-20T11:00:00.000Z',
            'Africa/Cairo', 'QUOTED', 'VERIFIED',
            'WEB_FORM', 'en', '', ?, ?)
  `).run(pkgId, now, now);

  // Payment — VERIFIED (needs verified_by_user_id due to DB trigger)
  db.prepare(`
    INSERT OR IGNORE INTO payments
      (id, booking_id, method, amount, currency, status,
       verified_by_user_id, verified_at, created_at, updated_at)
    VALUES ('pay_lc_test', 'book_lc_test', 'INSTAPAY', 35000, 'EGP', 'VERIFIED',
            'usr_owner_dev', ?, ?, ?)
  `).run(now, now, now);

  // Assignment for primary cleaner
  db.prepare(`
    INSERT OR IGNORE INTO assignments
      (id, booking_id, cleaner_id, assigned_by, assigned_at, created_at)
    VALUES ('asgn_lc_test', 'book_lc_test', 'usr_cleaner_dev', 'usr_owner_dev', ?, ?)
  `).run(now, now);
}

function restoreEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
