'use strict';

/**
 * M0-006 — Vitest tests for the payments-review service.
 *
 * 12 test cases:
 *  1. submit proof → PAYMENT_PENDING_REVIEW
 *  2. list pending review queue
 *  3. owner verify → payment VERIFIED
 *  4. owner verify → booking payment_status VERIFIED
 *  5. verify writes payment_events VERIFIED row
 *  6. AI actor verify rejected by service
 *  7. DISPATCHER cannot verify
 *  8. reject without reason → REASON_REQUIRED
 *  9. owner reject with reason → REJECTED + booking UNPAID + event
 * 10. payment_events UPDATE blocked by DB trigger
 * 11. payment_events DELETE blocked by DB trigger
 * 12. AI payment_events VERIFIED INSERT blocked by DB trigger
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('M0-006 payments-review service', () => {
  let database;
  let paymentsReview;
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
      `m0_006_pr_${process.pid}_${testCounter}_${Date.now()}.sqlite`
    );
    process.env.DATABASE_PATH = tmpPath;
    process.env.NODE_ENV = 'development';

    delete require.cache[require.resolve('../services/payments-review')];
    delete require.cache[require.resolve('../database')];
    database = require('../database');
    paymentsReview = require('../services/payments-review');

    seedPayment(database.db);
  });

  afterEach(() => {
    database.db.close();
    try { fs.unlinkSync(tmpPath); } catch (e) { void e; }
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    delete require.cache[require.resolve('../services/payments-review')];
    delete require.cache[require.resolve('../database')];
  });

  // 1. submit proof → PAYMENT_PENDING_REVIEW
  it('submitPaymentProof sets payment status to PAYMENT_PENDING_REVIEW', () => {
    const actor = { role: 'DISPATCHER', userId: 'usr_dispatcher_dev' };
    const result = paymentsReview.submitPaymentProof('pay_pr_test', { reference: 'REF-001' }, actor);
    expect(result.success).toBe(true);
    expect(result.payment.status).toBe('PAYMENT_PENDING_REVIEW');
    expect(result.payment.reference).toBe('REF-001');
  });

  // 2. list pending review queue
  it('listPendingPaymentReviews returns submitted payment in queue', () => {
    const actor = { role: 'DISPATCHER', userId: 'usr_dispatcher_dev' };
    paymentsReview.submitPaymentProof('pay_pr_test', { reference: 'REF-002' }, actor);
    const list = paymentsReview.listPendingPaymentReviews();
    expect(list.success).toBe(true);
    const found = list.payments.find(p => p.id === 'pay_pr_test');
    expect(found).toBeTruthy();
    expect(found.status).toBe('PAYMENT_PENDING_REVIEW');
  });

  // 3. owner verify → payment VERIFIED
  it('verifyPayment sets payment status to VERIFIED', () => {
    paymentsReview.submitPaymentProof('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    const result = paymentsReview.verifyPayment('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    expect(result.success).toBe(true);
    expect(result.payment.status).toBe('VERIFIED');
    expect(result.payment.verifiedByUserId).toBe('usr_owner_dev');
    expect(result.payment.verifiedAt).toBeTruthy();
  });

  // 4. owner verify → booking payment_status VERIFIED
  it('verifyPayment updates booking payment_status to VERIFIED', () => {
    const db = database.db;
    paymentsReview.submitPaymentProof('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    paymentsReview.verifyPayment('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    const row = db.prepare("SELECT payment_status FROM bookings_v2 WHERE id = 'book_pr_test'").get();
    expect(row.payment_status).toBe('VERIFIED');
  });

  // 5. verify writes payment_events VERIFIED row
  it('verifyPayment appends a VERIFIED payment_events row', () => {
    const db = database.db;
    paymentsReview.submitPaymentProof('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    paymentsReview.verifyPayment('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    const events = db.prepare(
      "SELECT * FROM payment_events WHERE payment_id = 'pay_pr_test' AND event_type = 'VERIFIED'"
    ).all();
    expect(events.length).toBe(1);
    expect(events[0].actor_type).toBe('OWNER');
    expect(events[0].actor_id).toBe('usr_owner_dev');
  });

  // 6. AI actor verify rejected by service
  it('verifyPayment returns OWNER_REQUIRED for AI role', () => {
    paymentsReview.submitPaymentProof('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    const result = paymentsReview.verifyPayment('pay_pr_test', {}, { role: 'AI', userId: 'ai-agent' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('OWNER_REQUIRED');
  });

  // 7. DISPATCHER cannot verify
  it('verifyPayment returns OWNER_REQUIRED for DISPATCHER role', () => {
    paymentsReview.submitPaymentProof('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    const result = paymentsReview.verifyPayment('pay_pr_test', {}, { role: 'DISPATCHER', userId: 'usr_dispatcher_dev' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('OWNER_REQUIRED');
  });

  // 8. reject without reason → REASON_REQUIRED
  it('rejectPayment returns REASON_REQUIRED when reason is empty', () => {
    paymentsReview.submitPaymentProof('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    const result = paymentsReview.rejectPayment('pay_pr_test', { reason: '' }, { role: 'OWNER', userId: 'usr_owner_dev' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('REASON_REQUIRED');
  });

  // 9. owner reject with reason → REJECTED + booking UNPAID + event
  it('rejectPayment sets REJECTED, booking UNPAID, writes event', () => {
    const db = database.db;
    paymentsReview.submitPaymentProof('pay_pr_test', {}, { role: 'OWNER', userId: 'usr_owner_dev' });
    const result = paymentsReview.rejectPayment(
      'pay_pr_test',
      { reason: 'Amount does not match' },
      { role: 'OWNER', userId: 'usr_owner_dev' }
    );
    expect(result.success).toBe(true);
    expect(result.payment.status).toBe('REJECTED');
    expect(result.payment.rejectionReason).toBe('Amount does not match');
    const booking = db.prepare("SELECT payment_status FROM bookings_v2 WHERE id = 'book_pr_test'").get();
    expect(booking.payment_status).toBe('UNPAID');
    const events = db.prepare(
      "SELECT * FROM payment_events WHERE payment_id = 'pay_pr_test' AND event_type = 'REJECTED'"
    ).all();
    expect(events.length).toBe(1);
  });

  // 10. payment_events UPDATE blocked by DB trigger
  it('payment_events UPDATE is blocked by the append-only trigger', () => {
    const db = database.db;
    paymentsReview.submitPaymentProof('pay_pr_test', { reference: 'R1' }, { role: 'OWNER', userId: 'usr_owner_dev' });
    const evt = db.prepare("SELECT id FROM payment_events WHERE payment_id = 'pay_pr_test' LIMIT 1").get();
    expect(evt).toBeTruthy();
    expect(() => {
      db.prepare("UPDATE payment_events SET metadata = '{}' WHERE id = ?").run(evt.id);
    }).toThrow(/append-only/);
  });

  // 11. payment_events DELETE blocked by DB trigger
  it('payment_events DELETE is blocked by the append-only trigger', () => {
    const db = database.db;
    paymentsReview.submitPaymentProof('pay_pr_test', { reference: 'R1' }, { role: 'OWNER', userId: 'usr_owner_dev' });
    const evt = db.prepare("SELECT id FROM payment_events WHERE payment_id = 'pay_pr_test' LIMIT 1").get();
    expect(evt).toBeTruthy();
    expect(() => {
      db.prepare("DELETE FROM payment_events WHERE id = ?").run(evt.id);
    }).toThrow(/append-only/);
  });

  // 12. AI payment_events VERIFIED INSERT blocked by DB trigger
  it('payment_events INSERT with AI actor_type + VERIFIED event_type is blocked by trigger', () => {
    const db = database.db;
    const ts = new Date().toISOString();
    expect(() => {
      db.prepare(`
        INSERT INTO payment_events (id, payment_id, event_type, actor_type, created_at)
        VALUES ('evt_ai_vrf_test', 'pay_pr_test', 'VERIFIED', 'AI', ?)
      `).run(ts);
    }).toThrow(/AI cannot verify payments/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedPayment(db) {
  const now = new Date().toISOString();
  const id = `book_pr_test`;

  // customer
  db.prepare(
    `INSERT OR IGNORE INTO customers (id, full_name, phone_e164, phone_raw, language, created_at, updated_at)
     VALUES ('cust_pr_test', 'Test Customer', '+201550000011', '01550000011', 'en', ?, ?)`
  ).run(now, now);

  // service package (use existing seeded one if available)
  const pkgRow = db.prepare("SELECT id FROM service_packages WHERE code = 'EXTERIOR_SEDAN' LIMIT 1").get();
  const pkgId = pkgRow ? pkgRow.id : 'svc_pr_seed';
  if (!pkgRow) {
    db.prepare(
      `INSERT OR IGNORE INTO service_packages (id, code, name_en, name_ar, name_de, duration_minutes, price_amount, price_currency, active, created_at, updated_at)
       VALUES ('svc_pr_seed', 'EXTERIOR_SEDAN', 'Exterior Sedan', 'خارجي', 'Aussen', 60, 35000, 'EGP', 1, ?, ?)`
    ).run(now, now);
  }

  // booking_v2
  db.prepare(
    `INSERT OR IGNORE INTO bookings_v2
       (id, public_ref, customer_id, vehicle_id, service_package_id, scheduled_start, scheduled_end,
        timezone, status, payment_status, source, language, notes, created_at, updated_at)
     VALUES (?, 'CR-PR-TEST-001', 'cust_pr_test', NULL, ?, '2027-11-05T10:00:00.000Z', '2027-11-05T11:00:00.000Z',
             'Africa/Cairo', 'QUOTED', 'PAYMENT_INSTRUCTIONS_SENT', 'WEB_FORM', 'en', '', ?, ?)`
  ).run(id, pkgId, now, now);

  // payment row
  db.prepare(
    `INSERT OR IGNORE INTO payments (id, booking_id, method, amount, currency, status, created_at, updated_at)
     VALUES ('pay_pr_test', 'book_pr_test', 'INSTAPAY', 35000, 'EGP', 'PAYMENT_INSTRUCTIONS_SENT', ?, ?)`
  ).run(now, now);
}

function restoreEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
