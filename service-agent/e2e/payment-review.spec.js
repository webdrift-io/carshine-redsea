'use strict';

/**
 * M0-006 — Payment review E2E (API-only, no browser).
 *
 * Covers:
 * 1. Create a QUOTED booking (payment row in PAYMENT_INSTRUCTIONS_SENT)
 * 2. Submit proof → PAYMENT_PENDING_REVIEW
 * 3. Owner sees it in the pending review list
 * 4. Owner verifies → VERIFIED, booking payment_status = VERIFIED
 * 5. DISPATCHER verify attempt → 403
 * 6. CLEANER verify attempt → 403
 * 7. Public verify path remains 404
 * 8. Reject without reason → 400
 *
 * Runs deterministically on two consecutive `npm run test:e2e` runs
 * because each run gets a fresh temp DB (see playwright.config.js).
 * Date 2027-12-01 is reserved for this spec.
 */

const { test, expect } = require('@playwright/test');

const OWNER_CREDS = { email: 'owner@carshineredsea.com', password: 'ChangeMe123!' };
const DISPATCHER_CREDS = { email: 'dispatcher@carshineredsea.com', password: 'DispatcherChangeMe123!' };

async function login(request, creds) {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

test.describe.serial('M0-006 payment review workflow', () => {
  let ownerToken;
  let dispatcherToken;
  let paymentId;
  let bookingV2Id;

  test('login as OWNER and DISPATCHER', async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDS);
    dispatcherToken = await login(request, DISPATCHER_CREDS);
  });

  test('create a QUOTED booking with a payment row', async ({ request }) => {
    const res = await request.post('/api/public/bookings', {
      data: {
        customerName: 'Payment Review E2E',
        phone: '01055500099',
        email: 'pr-e2e@example.com',
        servicePackageCode: 'EXTERIOR_SEDAN',
        carType: 'Sedan',
        carMake: 'Honda',
        carModel: 'Civic',
        address: '10 Test Street',
        area: 'Hurghada',
        preferredDate: '2027-12-01',
        preferredTime: '10:00',
        source: 'WEB_FORM',
        idempotencyKey: 'pr-e2e-booking-2027-12-01'
      }
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(true);
    bookingV2Id = body.bookingV2Id;
    expect(bookingV2Id).toBeTruthy();
    // payment_status must never be VERIFIED from a public booking
    expect(body.paymentStatus).not.toBe('VERIFIED');
  });

  test('find payment ID via admin booking detail', async ({ request }) => {
    const res = await request.get(`/api/admin/bookings-v2/${bookingV2Id}`, {
      headers: authHeader(ownerToken)
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    paymentId = body.booking && body.booking.payment && body.booking.payment.id;
    expect(paymentId).toBeTruthy();
  });

  test('submit payment proof → PAYMENT_PENDING_REVIEW', async ({ request }) => {
    const res = await request.post(`/api/admin/payments/${paymentId}/submit`, {
      headers: authHeader(dispatcherToken),
      data: { reference: 'TXN-E2E-12345', notes: 'Customer sent screenshot via WhatsApp' }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.payment.status).toBe('PAYMENT_PENDING_REVIEW');
    expect(body.payment.reference).toBe('TXN-E2E-12345');
  });

  test('owner sees payment in pending review list', async ({ request }) => {
    const res = await request.get('/api/admin/payments?status=PAYMENT_PENDING_REVIEW', {
      headers: authHeader(ownerToken)
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const found = body.payments.find(p => p.id === paymentId);
    expect(found).toBeTruthy();
    expect(found.status).toBe('PAYMENT_PENDING_REVIEW');
  });

  test('DISPATCHER cannot verify payment — 403', async ({ request }) => {
    const res = await request.post(`/api/admin/payments/${paymentId}/verify`, {
      headers: authHeader(dispatcherToken),
      data: {}
    });
    expect(res.status()).toBe(403);
  });

  test('CLEANER cannot access payments endpoint — 403', async ({ request }) => {
    // Use a CLEANER JWT. We log in as cleaner (seeded in dev data).
    const cleanerRes = await request.post('/api/auth/login', {
      data: { email: 'cleaner@carshineredsea.com', password: 'CleanerChangeMe123!' }
    });
    // If no cleaner seed exists, skip gracefully.
    if (cleanerRes.status() !== 200) {
      test.skip(); // CLEANER seed not available; skipped.
      return;
    }
    const cleanerToken = (await cleanerRes.json()).token;
    const res = await request.get('/api/admin/payments', {
      headers: authHeader(cleanerToken)
    });
    expect(res.status()).toBe(403);
  });

  test('public verify path remains 404', async ({ request }) => {
    const res = await request.post('/api/public/payments/verify', {
      data: { paymentId, status: 'VERIFIED' }
    });
    expect(res.status()).toBe(404);
  });

  test('reject without reason returns 400', async ({ request }) => {
    const res = await request.post(`/api/admin/payments/${paymentId}/reject`, {
      headers: authHeader(ownerToken),
      data: { reason: '' }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('REASON_REQUIRED');
  });

  test('owner verifies payment → VERIFIED and booking VERIFIED', async ({ request }) => {
    const res = await request.post(`/api/admin/payments/${paymentId}/verify`, {
      headers: authHeader(ownerToken),
      data: { notes: 'Confirmed by E2E test' }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.payment.status).toBe('VERIFIED');
    expect(body.payment.verifiedAt).toBeTruthy();
    expect(body.payment.booking.paymentStatus).toBe('VERIFIED');
  });

  test('payment detail shows VERIFIED status and event log', async ({ request }) => {
    const res = await request.get(`/api/admin/payments/${paymentId}`, {
      headers: authHeader(ownerToken)
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.payment.status).toBe('VERIFIED');
    const verifiedEvent = body.events.find(e => e.eventType === 'VERIFIED');
    expect(verifiedEvent).toBeTruthy();
    expect(verifiedEvent.actorType).toBe('OWNER');
  });
});
