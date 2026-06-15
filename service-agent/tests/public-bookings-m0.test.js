import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('M0 public booking API service', () => {
  let database;
  let createPublicBooking;
  let tmpPath;
  let previousDatabasePath;
  let previousNodeEnv;
  let previousInstapayNumber;
  let previousInstapayName;
  let testCounter = 0;

  beforeEach(() => {
    previousDatabasePath = process.env.DATABASE_PATH;
    previousNodeEnv = process.env.NODE_ENV;
    previousInstapayNumber = process.env.INSTAPAY_RECEIVING_NUMBER;
    previousInstapayName = process.env.INSTAPAY_RECEIVING_NAME;

    testCounter += 1;
    tmpPath = path.join(
      process.env.TEMP || '/tmp',
      `m0_public_booking_${process.pid}_${testCounter}_${Date.now()}.sqlite`
    );
    process.env.DATABASE_PATH = tmpPath;
    process.env.NODE_ENV = 'development';
    process.env.INSTAPAY_RECEIVING_NUMBER = '01000000000';
    process.env.INSTAPAY_RECEIVING_NAME = 'CarShine Red Sea';

    delete require.cache[require.resolve('../services/public-bookings')];
    delete require.cache[require.resolve('../database')];
    database = require('../database');
    ({ createPublicBooking } = require('../services/public-bookings'));
  });

  afterEach(() => {
    database.db.close();
    try {
      fs.unlinkSync(tmpPath);
    } catch (error) {
      void error;
    }
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('INSTAPAY_RECEIVING_NUMBER', previousInstapayNumber);
    restoreEnv('INSTAPAY_RECEIVING_NAME', previousInstapayName);
    delete require.cache[require.resolve('../services/public-bookings')];
    delete require.cache[require.resolve('../database')];
  });

  it('creates normalized customer, vehicle, booking, payment, and audit rows', () => {
    const result = createPublicBooking(validBookingPayload({ idempotencyKey: 'm0-success-1' }));

    expect(result.success).toBe(true);
    expect(result.status).toBe('QUOTED');
    expect(result.paymentStatus).toBe('PAYMENT_INSTRUCTIONS_SENT');
    expect(result.bookingId).toMatch(/^CR-/);
    expect(result.booking.id).toBe(result.bookingId);

    const customer = database.db.prepare('SELECT * FROM customers WHERE id = ?').get(result.customerId);
    const vehicle = database.db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.vehicleId);
    const booking = database.db.prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(result.bookingV2Id);
    const history = database.db.prepare('SELECT * FROM booking_status_history WHERE booking_id = ?').get(result.bookingV2Id);
    const payment = database.db.prepare('SELECT * FROM payments WHERE id = ?').get(result.paymentId);
    const event = database.db.prepare('SELECT * FROM payment_events WHERE payment_id = ?').get(result.paymentId);

    expect(customer.full_name).toBe('Nour Hassan');
    expect(vehicle.car_type).toBe('Sedan');
    expect(booking.public_ref).toBe(result.bookingId);
    expect(booking.status).toBe('QUOTED');
    expect(history.to_status).toBe('QUOTED');
    expect(payment.status).toBe('PAYMENT_INSTRUCTIONS_SENT');
    expect(payment.amount).toBe(35000);
    expect(event.event_type).toBe('INSTRUCTIONS_SENT');
    expect(event.actor_type).toBe('SYSTEM');
  });

  it('never creates VERIFIED payment state from public booking input', () => {
    const result = createPublicBooking(validBookingPayload({
      idempotencyKey: 'm0-never-verified',
      paymentStatus: 'VERIFIED',
      status: 'VERIFIED'
    }));

    const payment = database.db.prepare('SELECT status FROM payments WHERE id = ?').get(result.paymentId);
    const verifiedEvents = database.db
      .prepare("SELECT COUNT(*) AS count FROM payment_events WHERE event_type = 'VERIFIED'")
      .get();

    expect(payment.status).not.toBe('VERIFIED');
    expect(verifiedEvents.count).toBe(0);
  });

  it('records COLLECTING_INFO with explicit missing fields instead of claiming BOOKED', () => {
    const result = createPublicBooking({
      customerName: 'Mona',
      phone: '01011111111',
      source: 'web_form',
      idempotencyKey: 'm0-missing-1'
    });

    const booking = database.db.prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(result.bookingV2Id);
    const payment = database.db.prepare('SELECT * FROM payments WHERE id = ?').get(result.paymentId);

    expect(result.status).toBe('COLLECTING_INFO');
    expect(result.missingFields).toEqual(expect.arrayContaining(['servicePackage', 'address', 'scheduledStart']));
    expect(booking.status).toBe('COLLECTING_INFO');
    expect(booking.status).not.toBe('BOOKED');
    expect(payment.status).toBe('PAYMENT_INSTRUCTIONS_SENT');
  });

  it('returns the same booking for duplicate idempotency keys', () => {
    const first = createPublicBooking(validBookingPayload({ idempotencyKey: 'same-key-1' }));
    const second = createPublicBooking(validBookingPayload({ idempotencyKey: 'same-key-1' }));
    const bookingCount = database.db.prepare('SELECT COUNT(*) AS count FROM bookings_v2').get().count;

    expect(second.duplicate).toBe(true);
    expect(second.bookingId).toBe(first.bookingId);
    expect(second.bookingV2Id).toBe(first.bookingV2Id);
    expect(bookingCount).toBe(1);
  });

  it('maps legacy serviceType values and leaves legacy bookings untouched', () => {
    const legacyBefore = database.db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count;
    const result = createPublicBooking(validBookingPayload({
      idempotencyKey: 'legacy-service-1',
      servicePackageCode: undefined,
      serviceType: 'Trial Wash - 150 EGP'
    }));
    const legacyAfter = database.db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count;
    const booking = database.db.prepare(`
      SELECT sp.code
      FROM bookings_v2 b
      JOIN service_packages sp ON sp.id = b.service_package_id
      WHERE b.id = ?
    `).get(result.bookingV2Id);

    expect(booking.code).toBe('EXTERIOR_SEDAN');
    expect(legacyAfter).toBe(legacyBefore);
  });

  it('captures chatbot message context and agent action without verifying payment', () => {
    const result = createPublicBooking(validBookingPayload({
      idempotencyKey: 'chatbot-context-1',
      source: 'chatbot',
      initialMessage: 'I want to book a sedan wash tomorrow at 10.'
    }));

    const conversation = database.db.prepare('SELECT * FROM conversations_v2 WHERE booking_id = ?').get(result.bookingV2Id);
    const message = database.db.prepare('SELECT * FROM messages_v2 WHERE booking_id = ?').get(result.bookingV2Id);
    const action = database.db.prepare('SELECT * FROM agent_actions WHERE booking_id = ?').get(result.bookingV2Id);

    expect(conversation.channel).toBe('WEB_CHAT');
    expect(message.body).toContain('sedan wash');
    expect(action.tool_name).toBe('public_booking_create');
    expect(action.actor_type).toBe('AI');
  });
});

function validBookingPayload(overrides = {}) {
  return {
    customerName: 'Nour Hassan',
    phone: '01012345678',
    email: 'nour@example.com',
    servicePackageCode: 'EXTERIOR_SEDAN',
    carType: 'Sedan',
    carMake: 'Toyota',
    carModel: 'Corolla',
    carPlate: 'ABC-123',
    address: 'Abu Tig Marina',
    area: 'El Gouna',
    preferredDate: '2026-07-20',
    preferredTime: '10:00',
    notes: 'Please call on arrival.',
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
