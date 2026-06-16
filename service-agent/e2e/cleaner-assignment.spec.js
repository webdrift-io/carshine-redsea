'use strict';

/**
 * M0-008 — cleaner assignment E2E.
 *
 * Covers: assign cleaner to QUOTED booking, verify in booking detail, release.
 * M0-007 status lifecycle (ON_THE_WAY/IN_PROGRESS/COMPLETED) is implemented and
 * tested in the second describe block below.
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

});

// ---------------------------------------------------------------------------
// M0-007 — cleaner job status lifecycle (ON_THE_WAY / IN_PROGRESS / COMPLETED)
//
// Schema names used:
//   ON_THE_WAY  = "EN_ROUTE" in the task spec
//   IN_PROGRESS = "ON_SITE" in the task spec
// ---------------------------------------------------------------------------

async function cleanerLogin(request) {
  const res = await request.post('/api/auth/login', {
    data: { email: 'mahmoud.cleaner@example.com', password: 'CleanerChangeMe123!' },
  });
  const body = await res.json();
  return body.token;
}

async function dispatcherLogin(request) {
  const res = await request.post('/api/auth/login', {
    data: { email: 'dispatcher@carshineredsea.com', password: 'DispatcherChangeMe123!' },
  });
  const body = await res.json();
  return body.token;
}

test.describe.serial('M0-007 cleaner status lifecycle', () => {
  let ownerToken;
  let cleanerToken;
  let dispatcherToken;
  let bookingId;
  let paymentId;
  let cleanerId;

  test('login: owner, cleaner, dispatcher', async ({ request }) => {
    ownerToken = await ownerLogin(request);
    cleanerToken = await cleanerLogin(request);
    dispatcherToken = await dispatcherLogin(request);
    expect(ownerToken).toBeTruthy();
    expect(cleanerToken).toBeTruthy();
    expect(dispatcherToken).toBeTruthy();
  });

  test('create QUOTED booking for lifecycle test', async ({ request }) => {
    bookingId = await createQuotedBooking(request, '2027-09-10');
    expect(bookingId).toBeTruthy();
  });

  test('get payment ID from booking detail', async ({ request }) => {
    const res = await request.get(`/api/admin/bookings-v2/${bookingId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    paymentId = body.booking.payment.id;
    expect(paymentId).toBeTruthy();
  });

  test('owner submits payment proof → PAYMENT_PENDING_REVIEW', async ({ request }) => {
    const res = await request.post(`/api/admin/payments/${paymentId}/submit`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { reference: 'LIFECYCLE-E2E-001' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.payment.status).toBe('PAYMENT_PENDING_REVIEW');
  });

  test('owner verifies payment → VERIFIED', async ({ request }) => {
    const res = await request.post(`/api/admin/payments/${paymentId}/verify`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.payment.status).toBe('VERIFIED');
  });

  test('owner assigns cleaner to the booking', async ({ request }) => {
    const cleanerListRes = await request.get('/api/admin/users/cleaners', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const { cleaners } = await cleanerListRes.json();
    cleanerId = cleaners[0].id;

    const res = await request.post(`/api/admin/bookings-v2/${bookingId}/assign`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { cleanerId },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test('cleaner lists own bookings — sees the assigned booking', async ({ request }) => {
    const res = await request.get('/api/cleaner/bookings', {
      headers: { Authorization: `Bearer ${cleanerToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const found = body.bookings.find(b => b.bookingV2Id === bookingId);
    expect(found).toBeTruthy();
    expect(found.paymentStatus).toBe('VERIFIED');
  });

  test('DISPATCHER cannot use cleaner lifecycle endpoint → 403', async ({ request }) => {
    const res = await request.post(`/api/cleaner/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
      data: { status: 'ON_THE_WAY' },
    });
    expect(res.status()).toBe(403);
  });

  test('cleaner transitions to ON_THE_WAY (EN_ROUTE)', async ({ request }) => {
    const res = await request.post(`/api/cleaner/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${cleanerToken}` },
      data: { status: 'ON_THE_WAY' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.booking.status).toBe('ON_THE_WAY');
  });

  test('cleaner transitions to IN_PROGRESS (ON_SITE)', async ({ request }) => {
    const res = await request.post(`/api/cleaner/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${cleanerToken}` },
      data: { status: 'IN_PROGRESS' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.booking.status).toBe('IN_PROGRESS');
  });

  test('cleaner transitions to COMPLETED', async ({ request }) => {
    const res = await request.post(`/api/cleaner/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${cleanerToken}` },
      data: { status: 'COMPLETED' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.booking.status).toBe('COMPLETED');
  });

  test('invalid transition after COMPLETED → 409', async ({ request }) => {
    const res = await request.post(`/api/cleaner/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${cleanerToken}` },
      data: { status: 'ON_THE_WAY' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('ALREADY_COMPLETED');
  });

  test('admin read model reflects COMPLETED status', async ({ request }) => {
    const res = await request.get(`/api/admin/bookings-v2/${bookingId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.booking.status).toBe('COMPLETED');
    // Status history has lifecycle transitions
    const lifecycleHistory = body.statusHistory.filter(h => h.reason === 'CLEANER_LIFECYCLE');
    expect(lifecycleHistory.length).toBe(3);
  });
});
