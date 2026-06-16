import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('M0-007 assignments service', () => {
  let database;
  let assignments;
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
      `m0_007_asgn_${process.pid}_${testCounter}_${Date.now()}.sqlite`
    );
    process.env.DATABASE_PATH = tmpPath;
    process.env.NODE_ENV = 'development';

    delete require.cache[require.resolve('../services/assignments')];
    delete require.cache[require.resolve('../database')];
    database = require('../database');
    assignments = require('../services/assignments');
  });

  afterEach(() => {
    database.db.close();
    try { fs.unlinkSync(tmpPath); } catch (e) { void e; }
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    delete require.cache[require.resolve('../services/assignments')];
    delete require.cache[require.resolve('../database')];
  });

  it('getActiveAssignmentForBooking returns null when no assignment exists', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    const result = assignments.getActiveAssignmentForBooking(bookingId);
    expect(result).toBeNull();
  });

  it('assignCleaner creates an active assignment and returns it', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    const result = assignments.assignCleaner({ bookingId, cleanerId: 'usr_cleaner_dev' });
    expect(result.success).toBe(true);
    expect(result.assignment).not.toBeNull();
    expect(result.assignment.cleaner_id).toBe('usr_cleaner_dev');
    expect(result.assignment.cleaner_name).toBe('Mahmoud');
  });

  it('getActiveAssignmentForBooking returns assignment after assign', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    assignments.assignCleaner({ bookingId, cleanerId: 'usr_cleaner_dev' });
    const active = assignments.getActiveAssignmentForBooking(bookingId);
    expect(active).not.toBeNull();
    expect(active.cleaner_id).toBe('usr_cleaner_dev');
  });

  it('assignCleaner auto-releases the old assignment on reassign', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    assignments.assignCleaner({ bookingId, cleanerId: 'usr_cleaner_dev' });

    // Create a second cleaner to reassign to
    const db = require('../database').db;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, phone, password_hash, role, display_name, language, active, shift_start, shift_end, created_at, updated_at)
      VALUES ('usr_cleaner2_test', 'cleaner2@test.com', null, 'hash', 'CLEANER', 'Cleaner Two', 'en', 1, null, null, ?, ?)
    `).run(now, now);

    const result = assignments.assignCleaner({ bookingId, cleanerId: 'usr_cleaner2_test' });
    expect(result.success).toBe(true);
    expect(result.assignment.cleaner_id).toBe('usr_cleaner2_test');

    // Old assignment should now have released_at set
    const releasedCount = db.prepare(
      "SELECT COUNT(*) AS n FROM assignments WHERE booking_id = ? AND released_at IS NOT NULL AND release_reason = 'REASSIGNED'"
    ).get(bookingId).n;
    expect(releasedCount).toBe(1);

    // Only one active assignment
    const activeCount = db.prepare(
      'SELECT COUNT(*) AS n FROM assignments WHERE booking_id = ? AND released_at IS NULL'
    ).get(bookingId).n;
    expect(activeCount).toBe(1);
  });

  it('releaseAssignment marks released_at and returns success', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    assignments.assignCleaner({ bookingId, cleanerId: 'usr_cleaner_dev' });

    const result = assignments.releaseAssignment({ bookingId, releaseReason: 'DONE' });
    expect(result.success).toBe(true);
    expect(result.releasedAt).toBeTruthy();
  });

  it('getActiveAssignmentForBooking returns null after release', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    assignments.assignCleaner({ bookingId, cleanerId: 'usr_cleaner_dev' });
    assignments.releaseAssignment({ bookingId });
    expect(assignments.getActiveAssignmentForBooking(bookingId)).toBeNull();
  });

  it('assignCleaner returns BOOKING_NOT_FOUND for unknown bookingId', () => {
    const result = assignments.assignCleaner({ bookingId: 'nonexistent', cleanerId: 'usr_cleaner_dev' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('BOOKING_NOT_FOUND');
  });

  it('assignCleaner returns NOT_A_CLEANER when assigning an OWNER user', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    const result = assignments.assignCleaner({ bookingId, cleanerId: 'usr_owner_dev' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_A_CLEANER');
  });

  it('releaseAssignment returns NO_ACTIVE_ASSIGNMENT when none exists', () => {
    const bookingId = seedBooking({ status: 'QUOTED' });
    const result = assignments.releaseAssignment({ bookingId });
    expect(result.success).toBe(false);
    expect(result.code).toBe('NO_ACTIVE_ASSIGNMENT');
  });
});

let bookingCounter = 0;
function seedBooking({ status }) {
  const db = require('../database').db;
  const now = new Date().toISOString();
  const id = `book_asgn_${process.pid}_${++bookingCounter}`;

  const customerId = 'cust_asgn_seed';
  db.prepare(`INSERT OR IGNORE INTO customers (id, full_name, phone_e164, phone_raw, language, created_at, updated_at) VALUES (?, 'Test', '+201000000099', '01000000099', 'en', ?, ?)`).run(customerId, now, now);

  const pkgRow = db.prepare(`SELECT id FROM service_packages WHERE code = 'EXTERIOR_SEDAN' LIMIT 1`).get();
  const pkgId = pkgRow ? pkgRow.id : 'svc_seed';
  if (!pkgRow) {
    db.prepare(`INSERT OR IGNORE INTO service_packages (id, code, name_en, name_ar, name_de, duration_minutes, price_amount, price_currency, active, created_at, updated_at) VALUES (?, 'EXTERIOR_SEDAN', 'Exterior Sedan', 'غسيل', 'Waesche', 60, 35000, 'EGP', 1, ?, ?)`).run('svc_seed', now, now);
  }

  db.prepare(`
    INSERT INTO bookings_v2 (id, public_ref, customer_id, vehicle_id, service_package_id, scheduled_start, scheduled_end, timezone, status, payment_status, source, language, notes, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, 'Africa/Cairo', ?, 'UNPAID', 'WEB_FORM', 'en', '', ?, ?)
  `).run(id, `CR-A-${id.slice(-6)}`, customerId, pkgId, '2026-09-10T10:00:00+02:00', '2026-09-10T11:00:00+02:00', status, now, now);

  return id;
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
