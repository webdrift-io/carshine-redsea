/**
 * Tests for memory/mem0.js
 * DRY-RUN mode only. We confirm:
 *   - returning-customer case: phone with bookings -> synthesised shape
 *   - new-customer case: phone with no bookings -> empty shape with mode='dry-run'
 *
 * Approach: import the database module fresh, monkey-patch its
 * `getBookingsByPhone` per test, then require mem0. Because mem0
 * lazy-requires the database, by the time it does so the patched
 * function is already in place.
 */

import { describe, it, expect, beforeEach } from 'vitest';

let mem0;
let db;

beforeEach(async () => {
  // Force DRY-RUN mode
  delete process.env.MEM0_API_KEY;
  // Load the real database module and patch getBookingsByPhone.
  // The test then sets bookingsForPhone on the returned object.
  // eslint-disable-next-line global-require
  db = require('../database');
  db.__mockBookings = {};
  db.getBookingsByPhone = (phone) => db.__mockBookings[phone] || [];
  // eslint-disable-next-line global-require
  mem0 = require('../memory/mem0.js');
});

function setBookingsForPhone(phone, bookings) {
  db.__mockBookings[phone] = bookings;
}

function sampleBooking(overrides) {
  return {
    id: 'b_test',
    customerName: 'Ahmed',
    phone: '+201555500000',
    area: 'El Gouna',
    carType: 'BMW X5',
    package: 'Premium Plan',
    preferredDate: '2026-07-01',
    preferredTime: '10:00',
    location: 'Marina',
    paymentMethod: 'InstaPay',
    status: 'pending',
    createdAt: '2026-06-01T10:00:00.000Z',
    ...overrides
  };
}

describe('mem0 wrapper — DRY-RUN mode', () => {
  it('returns a synthesised returning-customer profile from db.getBookingsByPhone', async () => {
    // Returning customer with two bookings (sorted DESC by createdAt)
    setBookingsForPhone('+201555500000', [
      sampleBooking({
        id: 'b_second',
        createdAt: '2026-06-10T10:00:00.000Z',
        package: 'Premium Plan',
        paymentMethod: 'Vodafone Cash',
        preferredTime: '15:00'
      }),
      sampleBooking({
        id: 'b_first',
        createdAt: '2026-05-01T10:00:00.000Z',
        package: 'Trial Wash',
        paymentMethod: 'Cash',
        preferredTime: '09:00'
      })
    ]);

    const { lookupCustomer } = mem0;
    const result = await lookupCustomer({ phone: '+201555500000', name: 'Ahmed' });

    expect(result.mode).toBe('dry-run');
    expect(result.totalBookings).toBe(2);
    expect(result.firstSeen).toBe('2026-05-01T10:00:00.000Z');
    // lastBooking is the most recent one (DESC sort)
    expect(result.lastBooking).toBeTruthy();
    expect(result.lastBooking.id).toBe('b_second');
    expect(result.lastBooking.package).toBe('Premium Plan');
    expect(result.lastBooking.paymentMethod).toBe('Vodafone Cash');
    // preferences derived from the most recent booking
    expect(result.preferences.preferredArea).toBe('El Gouna');
    expect(result.preferences.preferredPaymentMethod).toBe('Vodafone Cash');
    expect(result.preferences.preferredPackage).toBe('Premium Plan');
    // 15:00 -> afternoon
    expect(result.preferences.preferredTimeOfDay).toBe('afternoon');
  });

  it('returns an empty profile for a new (unknown) customer', async () => {
    // Other customers exist, but not for the phone we look up
    setBookingsForPhone('+201555599999', [
      sampleBooking({ id: 'b_other', phone: '+201555599999' })
    ]);
    // +201555500000 has NO bookings registered

    const { lookupCustomer } = mem0;
    const result = await lookupCustomer({ phone: '+201555500000', name: 'New Customer' });

    expect(result.mode).toBe('dry-run');
    expect(result.totalBookings).toBe(0);
    expect(result.firstSeen).toBeNull();
    expect(result.lastBooking).toBeNull();
    expect(result.preferences.preferredArea).toBeNull();
    expect(result.preferences.preferredPackage).toBeNull();
    expect(result.preferences.preferredPaymentMethod).toBeNull();
    expect(result.preferences.preferredTimeOfDay).toBeNull();
  });
});
