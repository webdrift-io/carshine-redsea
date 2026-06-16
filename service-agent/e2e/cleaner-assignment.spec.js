'use strict';

/**
 * M0-008 — cleaner assignment E2E.
 *
 * Covers: assign cleaner to QUOTED booking, verify in booking detail, release.
 * M0-007 status lifecycle (EN_ROUTE/ON_SITE/COMPLETED) is NOT_STARTED — tests
 * for those transitions are intentionally omitted here and skipped explicitly below.
 *
 * Each test creates its own QUOTED booking on a unique date to avoid slot conflicts.
 * The detail endpoint response shape is: { success, booking, statusHistory, paymentEvents }
 * so assignment lives at result.booking.assignment.
 */

const { test, expect } = require('@playwright/test');

async function ownerLogin(request) {
  const res = await request.post('/api/auth/login', {
    data: { email: 'owner@carshineredsea.com', password: 'ChangeMe123!' },
  });
  const body = await res.json();
  return body.token;
}

async function createQuotedBooking(request, date) {
  const res = await request.post('/api/public/bookings', {
    data: {
      customerName: 'Assignment E2E Test',
      phone: `010${date.replace(/-/g, '').slice(4)}`, // unique phone per date
      email: `assign-${date}@example.com`,
      servicePackageCode: 'EXTERIOR_SEDAN',
      carType: 'Sedan',
      carMake: 'Toyota',
      carModel: 'Corolla',
      address: 'Marina Blvd',
      area: 'El Gouna',
      preferredDate: date,
      preferredTime: '09:00',
      source: 'WEB_FORM',
    },
  });
  const body = await res.json();
  expect(body.status).toBe('QUOTED');
  return body.bookingV2Id;
}

test.describe.serial('Cleaner assignment', () => {
  test('list active cleaners returns at least one CLEANER from dev seed', async ({ request }) => {
    const token = await ownerLogin(request);
    const res = await request.get('/api/admin/users/cleaners', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.cleaners)).toBe(true);
    expect(body.cleaners.length).toBeGreaterThanOrEqual(1);
    // listActiveCleaners omits password_hash and role
    body.cleaners.forEach(c => {
      expect(c).not.toHaveProperty('password_hash');
      expect(c.display_name).toBeTruthy();
    });
  });

  test('assign cleaner to QUOTED booking → 200 with assignment detail', async ({ request }) => {
    const token = await ownerLogin(request);

    const cleanerListRes = await request.get('/api/admin/users/cleaners', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { cleaners } = await cleanerListRes.json();
    const cleanerId = cleaners[0].id;

    const bookingId = await createQuotedBooking(request, '2027-07-10');

    const assignRes = await request.post(`/api/admin/bookings-v2/${bookingId}/assign`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { cleanerId },
    });
    expect(assignRes.status()).toBe(200);
    const assignBody = await assignRes.json();
    expect(assignBody.success).toBe(true);
    // assignCleaner service returns flat DB row: cleaner_id at top level
    expect(assignBody.assignment).toBeTruthy();
    expect(assignBody.assignment.cleaner_id).toBe(cleanerId);
    expect(assignBody.assignment.booking_id).toBe(bookingId);
  });

  test('booking detail shows the active assignment after assign', async ({ request }) => {
    const token = await ownerLogin(request);
    const cleanerListRes = await request.get('/api/admin/users/cleaners', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { cleaners } = await cleanerListRes.json();
    const cleanerId = cleaners[0].id;

    const bookingId = await createQuotedBooking(request, '2027-07-11');

    await request.post(`/api/admin/bookings-v2/${bookingId}/assign`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { cleanerId },
    });

    // Detail endpoint returns { success, booking, statusHistory, paymentEvents }
    const detailRes = await request.get(`/api/admin/bookings-v2/${bookingId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.success).toBe(true);
    expect(detail.booking.assignment).toBeTruthy();
    // formatBookingForAdmin uses nested cleaner: { id, displayName, phone }
    expect(detail.booking.assignment.cleaner).toBeTruthy();
    expect(detail.booking.assignment.cleaner.id).toBe(cleanerId);
  });

  test('release cleaner → 200, booking detail shows no active assignment', async ({ request }) => {
    const token = await ownerLogin(request);
    const cleanerListRes = await request.get('/api/admin/users/cleaners', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { cleaners } = await cleanerListRes.json();
    const cleanerId = cleaners[0].id;

    const bookingId = await createQuotedBooking(request, '2027-07-12');

    await request.post(`/api/admin/bookings-v2/${bookingId}/assign`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { cleanerId },
    });

    const releaseRes = await request.post(`/api/admin/bookings-v2/${bookingId}/release`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { releaseReason: 'E2E_TEST' },
    });
    expect(releaseRes.status()).toBe(200);
    expect((await releaseRes.json()).success).toBe(true);

    const detailRes = await request.get(`/api/admin/bookings-v2/${bookingId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detail = await detailRes.json();
    // After release, no active assignment
    expect(detail.booking.assignment === null || detail.booking.assignment === undefined).toBe(true);
  });

  test('assign fails for non-QUOTED booking status (COLLECTING_INFO)', async ({ request }) => {
    const token = await ownerLogin(request);
    const cleanerListRes = await request.get('/api/admin/users/cleaners', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { cleaners } = await cleanerListRes.json();
    const cleanerId = cleaners[0].id;

    // Create a COLLECTING_INFO booking (missing fields)
    const bookingRes = await request.post('/api/public/bookings', {
      data: { customerName: 'Assign Fail Test', phone: '01044455566', source: 'WEB_FORM' },
    });
    const bookingBody = await bookingRes.json();
    expect(bookingBody.status).toBe('COLLECTING_INFO');
    const bookingId = bookingBody.bookingV2Id;

    const assignRes = await request.post(`/api/admin/bookings-v2/${bookingId}/assign`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { cleanerId },
    });
    expect(assignRes.status()).toBe(409);
    const assignBody = await assignRes.json();
    expect(assignBody.code).toBe('WRONG_STATUS');
  });

  test.skip('M0-007 cleaner status lifecycle (EN_ROUTE/ON_SITE/COMPLETED) — NOT_STARTED', () => {
    // Status lifecycle transitions for the cleaner mobile path are not yet implemented.
    // This test is intentionally skipped — not a fake pass.
    // When M0-007 lifecycle is implemented, add: EN_ROUTE, ON_SITE, IN_PROGRESS, COMPLETED, NO_SHOW transitions.
  });
});
