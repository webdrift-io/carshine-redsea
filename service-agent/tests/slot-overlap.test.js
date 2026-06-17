import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('M0-005a slot-overlap refinement', () => {
  let database;
  let slotOverlap;
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
      `m0_005a_slot_${process.pid}_${testCounter}_${Date.now()}.sqlite`
    );
    process.env.DATABASE_PATH = tmpPath;
    process.env.NODE_ENV = 'development';

    delete require.cache[require.resolve('../services/slot-overlap')];
    delete require.cache[require.resolve('../database')];
    database = require('../database');
    slotOverlap = require('../services/slot-overlap');
  });

  afterEach(() => {
    database.db.close();
    try { fs.unlinkSync(tmpPath); } catch (error) { void error; }
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    delete require.cache[require.resolve('../services/slot-overlap')];
    delete require.cache[require.resolve('../database')];
  });

  it('detects a 60-min overlap when a 60-min booking starts 30 min after another', () => {
    const existing = seedBooking({
      status: 'QUOTED',
      scheduledStart: '2026-09-10T10:00:00+02:00',
      scheduledEnd: '2026-09-10T11:00:00+02:00'
    });
    seedBooking({
      status: 'QUOTED',
      scheduledStart: '2026-09-10T12:00:00+02:00',
      scheduledEnd: '2026-09-10T13:00:00+02:00'
    });

    const overlaps = slotOverlap.findOverlappingBookings({
      scheduledStart: '2026-09-10T10:30:00+02:00',
      scheduledEnd: '2026-09-10T11:30:00+02:00'
    });

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe(existing.id);
  });

  it('detects a 75-min vs 60-min late-overlap collision', () => {
    const suv = seedBooking({
      status: 'QUOTED',
      scheduledStart: '2026-09-10T10:00:00+02:00',
      scheduledEnd: '2026-09-10T11:15:00+02:00'
    });
    const sedan = seedBooking({
      status: 'QUOTED',
      scheduledStart: '2026-09-10T11:30:00+02:00',
      scheduledEnd: '2026-09-10T12:30:00+02:00'
    });

    const overlaps = slotOverlap.findOverlappingBookings({
      scheduledStart: '2026-09-10T10:45:00+02:00',
      scheduledEnd: '2026-09-10T11:45:00+02:00'
    });

    expect(overlaps.map(o => o.id).sort()).toEqual([suv.id, sedan.id].sort());
  });

  it('does NOT flag back-to-back bookings (open interval on the right)', () => {
    seedBooking({
      status: 'QUOTED',
      scheduledStart: '2026-09-10T10:00:00+02:00',
      scheduledEnd: '2026-09-10T11:00:00+02:00'
    });

    const overlaps = slotOverlap.findOverlappingBookings({
      scheduledStart: '2026-09-10T11:00:00+02:00',
      scheduledEnd: '2026-09-10T12:00:00+02:00'
    });

    expect(overlaps).toEqual([]);
  });

  it('does NOT flag back-to-back bookings (open interval on the left)', () => {
    seedBooking({
      status: 'QUOTED',
      scheduledStart: '2026-09-10T11:00:00+02:00',
      scheduledEnd: '2026-09-10T12:00:00+02:00'
    });

    const overlaps = slotOverlap.findOverlappingBookings({
      scheduledStart: '2026-09-10T10:00:00+02:00',
      scheduledEnd: '2026-09-10T11:00:00+02:00'
    });

    expect(overlaps).toEqual([]);
  });

  it('ignores CANCELLED and ABANDONED bookings (would-be conflicts are skipped)', () => {
    seedBooking({
      status: 'CANCELLED',
      scheduledStart: '2026-09-10T10:00:00+02:00',
      scheduledEnd: '2026-09-10T11:00:00+02:00'
    });
    // Note: ABANDONED is not a schema status; CANCELLED is the documented
    // terminal state. This asserts the doc rule.
    const overlaps = slotOverlap.findOverlappingBookings({
      scheduledStart: '2026-09-10T10:00:00+02:00',
      scheduledEnd: '2026-09-10T11:00:00+02:00'
    });
    expect(overlaps).toEqual([]);
  });

  it('returns COLLECTING_INFO for a malformed scheduledStart, not a crash', () => {
    const result = slotOverlap.assertNoSlotConflict(
      { scheduledStart: 'not-a-date' },
      { durationMinutes: 60 },
      '2026-09-10T00:00:00+02:00'
    );

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.status).toBe('COLLECTING_INFO');
    expect(result.missingFields).toEqual(['scheduledStart']);
  });

  it('returns COLLECTING_INFO for a past scheduledStart', () => {
    const result = slotOverlap.assertNoSlotConflict(
      { scheduledStart: '2020-01-01T10:00:00+02:00' },
      { durationMinutes: 60 },
      '2026-09-10T00:00:00+02:00'
    );

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.status).toBe('COLLECTING_INFO');
    expect(result.missingFields).toContain('scheduledStart');
  });

  it('returns null for a free future slot', () => {
    const result = slotOverlap.assertNoSlotConflict(
      { scheduledStart: '2026-09-10T10:00:00+02:00' },
      { durationMinutes: 60 },
      '2026-09-10T00:00:00+02:00'
    );

    expect(result).toBeNull();
  });

  it('returns NEEDS_HUMAN for an overlapping active booking', () => {
    seedBooking({
      status: 'QUOTED',
      scheduledStart: '2026-09-10T10:00:00+02:00',
      scheduledEnd: '2026-09-10T11:00:00+02:00'
    });

    const result = slotOverlap.assertNoSlotConflict(
      { scheduledStart: '2026-09-10T10:30:00+02:00' },
      { durationMinutes: 60 },
      '2026-09-10T00:00:00+02:00'
    );

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.status).toBe('NEEDS_HUMAN');
  });

  it('public booking creation rejects overlap once slot is full (capacity=2, integration)', () => {
    delete require.cache[require.resolve('../services/public-bookings')];
    const { createPublicBooking } = require('../services/public-bookings');

    // Fill the slot to capacity (2 bookings).
    const first = createPublicBooking(validPayload({
      idempotencyKey: 'm0-005a-overlap-first',
      preferredDate: '2026-09-10',
      preferredTime: '10:00'
    }));
    expect(first.status).toBe('QUOTED');

    const fill = createPublicBooking(validPayload({
      idempotencyKey: 'm0-005a-overlap-fill',
      customerName: 'Fill Customer',
      phone: '01088888888',
      preferredDate: '2026-09-10',
      preferredTime: '10:00'
    }));
    expect(fill.status).toBe('QUOTED');

    // Now the slot is full; overlapping booking at 10:30 must be rejected.
    const second = createPublicBooking(validPayload({
      idempotencyKey: 'm0-005a-overlap-second',
      customerName: 'Second Customer',
      phone: '01099999999',
      preferredDate: '2026-09-10',
      preferredTime: '10:30'
    }));

    expect(second.success).toBe(false);
    expect(second.status).toBe('NEEDS_HUMAN');
  });
});

function seedBooking({ status, scheduledStart, scheduledEnd }) {
  const id = `book_seed_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const db = require('../database').db;
  // Ensure a customer + service package exist (FK requirements).
  const customerId = 'cust_seed';
  db.prepare(`
    INSERT OR IGNORE INTO customers (
      id, full_name, phone_e164, phone_raw, language, created_at, updated_at
    ) VALUES (?, 'Seed Customer', '+201000000000', '01000000000', 'en', ?, ?)
  `).run(customerId, now, now);

  const packageId = 'svc_seed';
  db.prepare(`
    INSERT OR IGNORE INTO service_packages (
      id, code, name_en, name_ar, name_de, duration_minutes, price_amount, price_currency, active, created_at, updated_at
    ) VALUES (?, 'SEED_PACKAGE', 'Seed', 'Seed', 'Seed', 60, 10000, 'EGP', 1, ?, ?)
  `).run(packageId, now, now);

  const publicRef = `CR-SEED-${id.slice(-6)}`;
  db.prepare(`
    INSERT INTO bookings_v2 (
      id, public_ref, customer_id, vehicle_id, service_package_id,
      scheduled_start, scheduled_end, timezone, status, payment_status,
      source, language, notes, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Africa/Cairo', ?, 'UNPAID', 'WEB_FORM', 'en', '', ?, ?)
  `).run(id, publicRef, customerId, packageId, scheduledStart, scheduledEnd, status, now, now);

  return { id, publicRef };
}

function validPayload(overrides = {}) {
  return {
    customerName: 'Nour Hassan',
    phone: '01012345678',
    email: 'nour@example.com',
    servicePackageCode: 'EXTERIOR_SEDAN',
    carType: 'Sedan',
    address: 'Abu Tig Marina',
    area: 'El Gouna',
    source: 'WEB_FORM',
    ...overrides
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
