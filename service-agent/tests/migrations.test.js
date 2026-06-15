import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const { runMigrations } = require('../migrations/000_migration_runner');

const REQUIRED_TABLES = [
  'schema_migrations',
  'users',
  'customers',
  'vehicles',
  'service_packages',
  'bookings_v2',
  'booking_status_history',
  'assignments',
  'payments',
  'payment_events',
  'conversations_v2',
  'messages_v2',
  'agent_actions'
];

describe('M0 migrations', () => {
  let db;
  let previousNodeEnv;

  beforeEach(() => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('runs on an empty database and creates required M0 tables', () => {
    const result = runMigrations(db);

    expect(result.applied).toContain('001_create_handoff_tickets');
    expect(result.applied).toContain('010_m0_schema_foundation');
    expect(result.applied).toContain('090_seed_m0_dev_data');

    for (const table of REQUIRED_TABLES) {
      expect(tableExists(table)).toBe(true);
    }
  });

  it('can run twice without applying duplicate migrations', () => {
    const first = runMigrations(db);
    const second = runMigrations(db);

    expect(first.applied.length).toBeGreaterThan(0);
    expect(second.applied).toEqual([]);

    const migrationRows = db.prepare('SELECT id FROM schema_migrations').all();
    const uniqueIds = new Set(migrationRows.map((row) => row.id));
    expect(uniqueIds.size).toBe(migrationRows.length);
  });

  it('preserves legacy tables and rows', () => {
    db.exec(`
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        customerName TEXT NOT NULL
      );
      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY,
        bookingId TEXT NOT NULL
      );
      INSERT INTO bookings (id, customerName) VALUES ('legacy-booking-1', 'Legacy Customer');
      INSERT INTO calendar_events (id, bookingId) VALUES ('legacy-calendar-1', 'legacy-booking-1');
    `);

    runMigrations(db);

    expect(tableExists('bookings')).toBe(true);
    expect(tableExists('calendar_events')).toBe(true);
    expect(db.prepare('SELECT customerName FROM bookings WHERE id = ?').get('legacy-booking-1').customerName)
      .toBe('Legacy Customer');
    expect(db.prepare('SELECT bookingId FROM calendar_events WHERE id = ?').get('legacy-calendar-1').bookingId)
      .toBe('legacy-booking-1');
  });

  it('seeds one owner, one cleaner, and service packages outside production', () => {
    runMigrations(db);

    expect(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'OWNER'").get().count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'CLEANER'").get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM service_packages').get().count).toBeGreaterThanOrEqual(4);
  });

  it('enforces payment audit safety rules', () => {
    runMigrations(db);
    insertPaymentFixture();

    expect(() => {
      db.prepare(`
        INSERT INTO payment_events (id, payment_id, event_type, actor_type, created_at)
        VALUES ('evt_ai_verify', 'pay_1', 'VERIFIED', 'AI', ?)
      `).run(new Date().toISOString());
    }).toThrow(/AI cannot verify payments/);

    expect(() => {
      db.prepare("UPDATE payments SET status = 'VERIFIED', updated_at = ? WHERE id = 'pay_1'")
        .run(new Date().toISOString());
    }).toThrow(/manual owner user id/);

    db.prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, created_at)
      VALUES ('evt_submitted', 'pay_1', 'SUBMITTED', 'CUSTOMER', ?)
    `).run(new Date().toISOString());

    expect(() => {
      db.prepare("UPDATE payment_events SET metadata = '{}' WHERE id = 'evt_submitted'").run();
    }).toThrow(/append-only/);

    expect(() => {
      db.prepare("DELETE FROM payment_events WHERE id = 'evt_submitted'").run();
    }).toThrow(/append-only/);
  });

  function tableExists(table) {
    return Boolean(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
    );
  }

  function insertPaymentFixture() {
    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO customers (id, full_name, phone_raw, created_at, updated_at)
      VALUES ('cust_1', 'Test Customer', '+201000000002', ?, ?)
    `).run(timestamp, timestamp);

    db.prepare(`
      INSERT INTO bookings_v2 (
        id, public_ref, customer_id, service_package_id, scheduled_start, scheduled_end,
        status, payment_status, source, created_at, updated_at
      )
      VALUES (
        'book_1', 'CR-TEST-001', 'cust_1', 'svc_exterior_sedan',
        '2026-07-01T10:00:00+02:00', '2026-07-01T11:00:00+02:00',
        'BOOKED', 'PAYMENT_PENDING_REVIEW', 'WEB_FORM', ?, ?
      )
    `).run(timestamp, timestamp);

    db.prepare(`
      INSERT INTO payments (
        id, booking_id, method, amount, currency, status, created_at, updated_at
      )
      VALUES ('pay_1', 'book_1', 'INSTAPAY', 35000, 'EGP', 'PAYMENT_PENDING_REVIEW', ?, ?)
    `).run(timestamp, timestamp);
  }
});
