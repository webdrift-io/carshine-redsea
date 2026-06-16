'use strict';

const { test, expect } = require('@playwright/test');

// Public booking API E2E — no browser required.
// Tests run serially within this file to avoid slot-conflict races.

function quotedPayload(overrides = {}) {
  return {
    customerName: 'E2E Test User',
    phone: '01012345678',
    email: 'e2e@example.com',
    servicePackageCode: 'EXTERIOR_SEDAN',
    carType: 'Sedan',
    carMake: 'Toyota',
    carModel: 'Corolla',
    carPlate: 'E2E-001',
    address: 'Abu Tig Marina, El Gouna',
    area: 'El Gouna',
    source: 'WEB_FORM',
    ...overrides,
  };
}

const INCOMPLETE_BOOKING = {
  customerName: 'E2E Incomplete',
  phone: '01099887766',
  source: 'WEB_FORM',
  // missing servicePackageCode, carType, scheduledStart
};

test.describe.serial('Public booking API', () => {
  test('incomplete booking → COLLECTING_INFO with populated missingFields', async ({ request }) => {
    const res = await request.post('/api/public/bookings', { data: INCOMPLETE_BOOKING });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('COLLECTING_INFO');
    expect(Array.isArray(body.missingFields)).toBe(true);
    expect(body.missingFields.length).toBeGreaterThan(0);
    body.missingFields.forEach(f => expect(typeof f).toBe('string'));
    expect(body.bookingId).toMatch(/^CR-/);
    // COLLECTING_INFO has no payment row
    expect(body.paymentStatus === null || body.paymentStatus === undefined).toBe(true);
  });

  test('complete booking → QUOTED with real booking ID and payment instructions', async ({ request }) => {
    // Use a unique date to avoid slot conflict with other tests
    const res = await request.post('/api/public/bookings', {
      data: quotedPayload({ preferredDate: '2027-09-01', preferredTime: '10:00', phone: '01012345601' }),
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('QUOTED');
    expect(body.bookingId).toMatch(/^CR-/);
    expect(body.bookingId.length).toBeGreaterThan(5);
    expect(body.paymentStatus).not.toBeNull();
    expect(body.paymentId).toBeTruthy();
    expect(!body.missingFields || body.missingFields.length === 0).toBe(true);
  });

  test('idempotency: same idempotencyKey returns original booking', async ({ request }) => {
    const key = `e2e-idempotency-test-${Date.now()}`;
    const payload = quotedPayload({
      preferredDate: '2027-09-02',
      preferredTime: '10:00',
      phone: '01011111112',
      idempotencyKey: key,
    });

    const first = await request.post('/api/public/bookings', { data: payload });
    const second = await request.post('/api/public/bookings', { data: payload });

    expect(first.status()).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.status).toBe('QUOTED');

    expect(second.status()).toBe(200); // duplicate returns 200
    const secondBody = await second.json();
    expect(firstBody.bookingId).toBe(secondBody.bookingId);
    expect(secondBody.duplicate).toBe(true);
  });

  test('COLLECTING_INFO booking stores missing_fields as JSON array in API response', async ({ request }) => {
    const res = await request.post('/api/public/bookings', {
      data: { customerName: 'Fields Test', phone: '01055500001', source: 'WEB_FORM' },
    });
    const body = await res.json();
    expect(body.status).toBe('COLLECTING_INFO');
    expect(Array.isArray(body.missingFields)).toBe(true);
  });
});
