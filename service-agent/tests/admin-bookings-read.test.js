import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('M0-005a admin bookings read model', () => {
  let database;
  let adminRead;
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
      `m0_005a_read_${process.pid}_${testCounter}_${Date.now()}.sqlite`
    );
    process.env.DATABASE_PATH = tmpPath;
    process.env.NODE_ENV = 'development';

    delete require.cache[require.resolve('../services/admin-bookings-read')];
    delete require.cache[require.resolve('../database')];
    database = require('../database');
    adminRead = require('../services/admin-bookings-read');
  });

  afterEach(() => {
    database.db.close();
    try { fs.unlinkSync(tmpPath); } catch (error) { void error; }
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    delete require.cache[require.resolve('../services/admin-bookings-read')];
    delete require.cache[require.resolve('../database')];
  });

  it('listBookingsForAdmin returns the normalized admin shape with payment null for COLLECTING_INFO', () => {
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-10T10:00:00+02:00', paymentStatus: 'PAYMENT_INSTRUCTIONS_SENT' });
    seedBooking({ status: 'COLLECTING_INFO', scheduledStart: '2026-09-11T11:00:00+02:00', withPayment: false, notes: 'Missing fields: scheduledStart, address' });

    const result = adminRead.listBookingsForAdmin();

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.bookings).toHaveLength(2);

    const quoted = result.bookings.find(b => b.status === 'QUOTED');
    expect(quoted).toBeDefined();
    expect(quoted.payment).not.toBeNull();
    expect(quoted.payment.amountPiasters).toBe(35000);
    expect(quoted.vehicle).not.toBeNull();
    expect(quoted.servicePackage).not.toBeNull();
    expect(quoted.servicePackage.nameEn).toBe('Exterior Sedan Wash');
    expect(quoted.servicePackage.nameAr).toBeTruthy();
    expect(quoted.servicePackage.nameDe).toBeTruthy();
    expect(quoted.assignment).toBeNull();
    expect(quoted.missingFields).toEqual([]);

    const collecting = result.bookings.find(b => b.status === 'COLLECTING_INFO');
    expect(collecting).toBeDefined();
    expect(collecting.payment).toBeNull();
    expect(collecting.paymentStatus).toBeNull();
    expect(collecting.missingFields).toEqual(expect.arrayContaining(['scheduledStart', 'address']));
  });

  it('listBookingsForAdmin filters by date range', () => {
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-10T10:00:00+02:00' });
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-15T10:00:00+02:00' });
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-20T10:00:00+02:00' });

    const result = adminRead.listBookingsForAdmin({
      dateFrom: '2026-09-12T00:00:00+02:00',
      dateTo: '2026-09-19T00:00:00+02:00'
    });

    expect(result.count).toBe(1);
    expect(result.bookings[0].scheduledStart).toBe('2026-09-15T10:00:00+02:00');
  });

  it('listBookingsForAdmin filters by status and paymentStatus', () => {
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-10T10:00:00+02:00', paymentStatus: 'PAYMENT_INSTRUCTIONS_SENT' });
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-10T11:00:00+02:00', paymentStatus: 'UNPAID' });
    seedBooking({ status: 'COLLECTING_INFO', scheduledStart: '2026-09-10T12:00:00+02:00', withPayment: false });

    const byStatus = adminRead.listBookingsForAdmin({ status: 'QUOTED' });
    expect(byStatus.count).toBe(2);

    const byPayment = adminRead.listBookingsForAdmin({ paymentStatus: 'PAYMENT_INSTRUCTIONS_SENT' });
    expect(byPayment.count).toBe(1);
    expect(byPayment.bookings[0].paymentStatus).toBe('PAYMENT_INSTRUCTIONS_SENT');
  });

  it('listBookingsForAdmin respects limit, offset, and hasMore', () => {
    for (let i = 0; i < 5; i += 1) {
      seedBooking({ status: 'QUOTED', scheduledStart: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00+02:00` });
    }

    const page1 = adminRead.listBookingsForAdmin({ limit: 2, offset: 0 });
    expect(page1.count).toBe(2);
    expect(page1.hasMore).toBe(true);

    const page2 = adminRead.listBookingsForAdmin({ limit: 2, offset: 2 });
    expect(page2.count).toBe(2);
    expect(page2.hasMore).toBe(true);

    const page3 = adminRead.listBookingsForAdmin({ limit: 2, offset: 4 });
    expect(page3.count).toBe(1);
    expect(page3.hasMore).toBe(false);
  });

  it('getBookingDetailForAdmin returns history in reverse chronological order', () => {
    const bookingId = seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-10T10:00:00+02:00' });
    appendStatusHistory(bookingId, 'NEW', 'COLLECTING_INFO', { reason: 'intake' });
    appendStatusHistory(bookingId, 'COLLECTING_INFO', 'QUOTED', { reason: 'completed' });

    const detail = adminRead.getBookingDetailForAdmin(bookingId);

    expect(detail.success).toBe(true);
    expect(detail.statusHistory).toHaveLength(2);
    expect(detail.statusHistory[0].toStatus).toBe('QUOTED');
    expect(detail.statusHistory[1].toStatus).toBe('COLLECTING_INFO');
  });

  it('getBookingDetailForAdmin returns payment events for the linked payment', () => {
    const bookingId = seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-10T10:00:00+02:00' });
    const paymentId = database.db.prepare('SELECT id AS pid FROM payments WHERE booking_id = ?').get(bookingId).pid;
    appendPaymentEvent(paymentId, 'CREATED', { actorType: 'SYSTEM' });
    appendPaymentEvent(paymentId, 'INSTRUCTIONS_SENT', { actorType: 'SYSTEM' });

    const detail = adminRead.getBookingDetailForAdmin(bookingId);

    expect(detail.success).toBe(true);
    // seedBooking(withPayment:true) auto-inserts 1 INSTRUCTIONS_SENT event,
    // then we append CREATED + INSTRUCTIONS_SENT = 3 total, DESC by created_at.
    expect(detail.paymentEvents).toHaveLength(3);
    expect(detail.paymentEvents.map(e => e.eventType)).toEqual(['INSTRUCTIONS_SENT', 'CREATED', 'INSTRUCTIONS_SENT']);
    expect(detail.paymentEvents[0].actorType).toBe('SYSTEM');
  });

  it('getCalendarForAdmin returns the narrower projection (no customer/vehicle/service fields)', () => {
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-10T10:00:00+02:00' });
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-11T10:00:00+02:00' });
    seedBooking({ status: 'QUOTED', scheduledStart: '2026-09-20T10:00:00+02:00' });

    const result = adminRead.getCalendarForAdmin({
      dateFrom: '2026-09-10T00:00:00+02:00',
      dateTo: '2026-09-15T00:00:00+02:00'
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    const event = result.events[0];
    expect(event).toHaveProperty('bookingV2Id');
    expect(event).toHaveProperty('publicRef');
    expect(event).toHaveProperty('scheduledStart');
    expect(event).toHaveProperty('customerId');
    // Should NOT include the customer name, vehicle details, etc.
    expect(event).not.toHaveProperty('customer');
    expect(event).not.toHaveProperty('vehicle');
    expect(event).not.toHaveProperty('servicePackage');
  });

  it('parseMissingFields reads from the dedicated column when present', () => {
    // Seed a COLLECTING_INFO booking with missing_fields column populated (migration 091)
    const id = seedBooking({
      status: 'COLLECTING_INFO',
      scheduledStart: '2026-09-15T10:00:00+02:00',
      withPayment: false,
      paymentStatus: 'UNPAID',
      notes: ''
    });
    const db = require('../database').db;
    db.prepare('UPDATE bookings_v2 SET missing_fields = ? WHERE id = ?')
      .run(JSON.stringify(['scheduledStart', 'vehicle']), id);

    const result = adminRead.getBookingDetailForAdmin(id);
    expect(result.success).toBe(true);
    expect(result.booking.missingFields).toEqual(['scheduledStart', 'vehicle']);
  });

  it('parseMissingFields falls back to notes when missing_fields column is NULL', () => {
    const id = seedBooking({
      status: 'COLLECTING_INFO',
      scheduledStart: '2026-09-16T10:00:00+02:00',
      withPayment: false,
      paymentStatus: 'UNPAID',
      notes: 'Missing fields: phoneE164, carType'
    });

    const result = adminRead.getBookingDetailForAdmin(id);
    expect(result.success).toBe(true);
    expect(result.booking.missingFields).toEqual(['phoneE164', 'carType']);
  });
});

function seedBooking({ status, scheduledStart, scheduledEnd, scheduledEndOffsetMs, paymentStatus, withPayment = true, notes }) {
  const id = `book_read_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const db = require('../database').db;
  // Ensure a customer + service package + payment exist.
  const customerId = 'cust_read';
  db.prepare(`INSERT OR IGNORE INTO customers (id, full_name, phone_e164, phone_raw, email, language, address, area, created_at, updated_at) VALUES (?, 'Read Customer', '+201****0000', '01000000000', 'read@example.com', 'en', 'Marina', 'El Gouna', ?, ?)`).run(customerId, now, now);

  const vehicleId = 'veh_read';
  db.prepare(`INSERT OR IGNORE INTO vehicles (id, customer_id, car_type, make, model, plate, created_at, updated_at) VALUES (?, ?, 'SEDAN', 'Toyota', 'Corolla', 'R-123', ?, ?)`).run(vehicleId, customerId, now, now);

  // The dev seed migration inserts `EXTERIOR_SEDAN`. Look it up rather than
  // inserting a duplicate; the `code` column is UNIQUE NOT NULL.
  const existingPkg = db.prepare(`SELECT id FROM service_packages WHERE code = 'EXTERIOR_SEDAN' LIMIT 1`).get();
  const packageId = existingPkg ? existingPkg.id : 'svc_read';
  if (!existingPkg) {
    db.prepare(`INSERT INTO service_packages (id, code, name_en, name_ar, name_de, duration_minutes, price_amount, price_currency, active, created_at, updated_at) VALUES (?, 'EXTERIOR_SEDAN', 'Exterior Sedan Wash', 'غسيل خارجي سيدان', 'Aussenwaesche Limousine', 60, 35000, 'EGP', 1, ?, ?)`).run(packageId, now, now);
  }

  const publicRef = `CR-READ-${id.slice(-6)}`;
  const end = scheduledEnd || new Date(new Date(scheduledStart).getTime() + 60 * 60 * 1000).toISOString();
  const finalNotes = notes || '';

  db.prepare(`
    INSERT INTO bookings_v2 (
      id, public_ref, customer_id, vehicle_id, service_package_id,
      scheduled_start, scheduled_end, timezone, status, payment_status,
      source, language, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Africa/Cairo', ?, ?, 'WEB_FORM', 'en', ?, ?, ?)
  `).run(
    id, publicRef, customerId, vehicleId, packageId,
    scheduledStart, end, status,
    paymentStatus || (status === 'COLLECTING_INFO' ? 'UNPAID' : 'PAYMENT_INSTRUCTIONS_SENT'),
    finalNotes, now, now
  );

  if (withPayment) {
    const paymentId = `pay_read_${id.slice(-6)}`;
    db.prepare(`
      INSERT INTO payments (id, booking_id, method, amount, currency, status, created_at, updated_at)
      VALUES (?, ?, 'INSTAPAY', 35000, 'EGP', ?, ?, ?)
    `).run(paymentId, id, paymentStatus || 'PAYMENT_INSTRUCTIONS_SENT', now, now);

    db.prepare(`
      INSERT INTO payment_events (id, payment_id, event_type, actor_type, metadata, created_at)
      VALUES (?, ?, 'INSTRUCTIONS_SENT', 'SYSTEM', '{}', ?)
    `).run(`pevt_read_${id.slice(-6)}`, paymentId, now);
  }

  return id;
}

let historyClock = 0;
function appendStatusHistory(bookingId, fromStatus, toStatus, { reason } = {}) {
  const id = `hist_${Math.random().toString(36).slice(2, 10)}`;
  // Bump time by 1 ms each call so the DESC ordering is deterministic.
  const now = new Date(Date.now() + (++historyClock)).toISOString();
  require('../database').db.prepare(`
    INSERT INTO booking_status_history (id, booking_id, from_status, to_status, actor_type, reason, metadata, created_at)
    VALUES (?, ?, ?, ?, 'OWNER', ?, '{}', ?)
  `).run(id, bookingId, fromStatus, toStatus, reason || '', now);
}

let paymentEventClock = 0;
function appendPaymentEvent(paymentId, eventType, { actorType } = {}) {
  const id = `pevt_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date(Date.now() + (++paymentEventClock)).toISOString();
  require('../database').db.prepare(`
    INSERT INTO payment_events (id, payment_id, event_type, actor_type, metadata, created_at)
    VALUES (?, ?, ?, ?, '{}', ?)
  `).run(id, paymentId, eventType, actorType || 'OWNER', now);
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
