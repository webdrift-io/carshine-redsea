'use strict';

/**
 * M0-008 — admin auth + change-password endpoint integration tests.
 *
 * Closes the gap identified by Opus review: the M0-user change-password branch
 * had no endpoint-level test and was shadowed by the dev auth bypass.
 *
 * The fix (in requireAuth): when an Authorization: Bearer header is present,
 * the dev bypass is skipped even on localhost, so M0 users are authenticated
 * via their real JWT instead of the forced admin shortcut.
 */

const { test, expect } = require('@playwright/test');

const OWNER_EMAIL = 'owner@carshineredsea.com';
const OWNER_PASS = 'ChangeMe123!'; // default from 090_seed_m0_dev_data.js
const DISPATCHER_EMAIL = 'dispatcher@carshineredsea.com';
const DISPATCHER_PASS = 'DispatcherChangeMe123!'; // from 092_seed_dispatcher_dev.js

async function login(request, email, password) {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  const body = await res.json();
  return { status: res.status(), token: body.token, user: body.user };
}

test.describe.serial('OWNER login and change-password (M0 user path)', () => {
  test('OWNER can log in with seed credentials', async ({ request }) => {
    const { status, token, user } = await login(request, OWNER_EMAIL, OWNER_PASS);
    expect(status).toBe(200);
    expect(token).toBeTruthy();
    expect(user.role).toBe('OWNER');
    expect(user.email).toBe(OWNER_EMAIL);
  });

  test('DISPATCHER can log in with seed credentials', async ({ request }) => {
    const { status, token, user } = await login(request, DISPATCHER_EMAIL, DISPATCHER_PASS);
    expect(status).toBe(200);
    expect(token).toBeTruthy();
    expect(user.role).toBe('DISPATCHER');
  });

  test('change-password: missing newPassword → 400', async ({ request }) => {
    const { token } = await login(request, OWNER_EMAIL, OWNER_PASS);
    const res = await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${token}` },
      data: { currentPassword: OWNER_PASS },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
    // No hash in error response
    expect(JSON.stringify(body)).not.toMatch(/\$2[ab]\$/);
  });

  test('change-password: new password too short → 400', async ({ request }) => {
    const { token } = await login(request, OWNER_EMAIL, OWNER_PASS);
    const res = await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${token}` },
      data: { currentPassword: OWNER_PASS, newPassword: 'short' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/12/);
  });

  test('change-password: wrong current password → 401, no hash in response', async ({ request }) => {
    const { token } = await login(request, OWNER_EMAIL, OWNER_PASS);
    const res = await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${token}` },
      data: { currentPassword: 'WrongPassword999!', newPassword: 'NewValidPassword123!' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/incorrect/i);
    expect(JSON.stringify(body)).not.toMatch(/\$2[ab]\$/);
    expect(JSON.stringify(body)).not.toMatch(/hash/i);
  });

  test('change-password: valid change → 200, new works, old fails; then restore', async ({ request }) => {
    const NEW_PASS = 'NewOwnerTemporary456!';

    // 1. Login to get token
    const { token } = await login(request, OWNER_EMAIL, OWNER_PASS);

    // 2. Change password
    const changeRes = await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${token}` },
      data: { currentPassword: OWNER_PASS, newPassword: NEW_PASS },
    });
    expect(changeRes.status()).toBe(200);
    const changeBody = await changeRes.json();
    expect(changeBody.success).toBe(true);
    // No hash in success response
    expect(JSON.stringify(changeBody)).not.toMatch(/\$2[ab]\$/);

    // 3. Old password no longer works
    const oldLogin = await login(request, OWNER_EMAIL, OWNER_PASS);
    expect(oldLogin.status).toBe(401);

    // 4. New password works and returns the same user
    const newLoginResult = await login(request, OWNER_EMAIL, NEW_PASS);
    expect(newLoginResult.status).toBe(200);
    expect(newLoginResult.user.role).toBe('OWNER');
    const newToken = newLoginResult.token;

    // 5. Restore original password so later tests are clean
    const restoreRes = await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${newToken}` },
      data: { currentPassword: NEW_PASS, newPassword: OWNER_PASS },
    });
    expect(restoreRes.status()).toBe(200);
  });

  test('change-password is scoped to own account: DISPATCHER cannot change OWNER password', async ({ request }) => {
    // The endpoint uses req.user.sub (from JWT) — there is no body param for target userId.
    // A DISPATCHER JWT can only change the DISPATCHER's own password.
    const { token: dispToken } = await login(request, DISPATCHER_EMAIL, DISPATCHER_PASS);
    const DISP_NEW_PASS = 'DispatcherNewPass123!';

    const changeRes = await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${dispToken}` },
      data: { currentPassword: DISPATCHER_PASS, newPassword: DISP_NEW_PASS },
    });
    // Should succeed — changes DISPATCHER's own password
    expect(changeRes.status()).toBe(200);

    // DISPATCHER can log in with new password
    const newDispLogin = await login(request, DISPATCHER_EMAIL, DISP_NEW_PASS);
    expect(newDispLogin.status).toBe(200);
    expect(newDispLogin.user.role).toBe('DISPATCHER');

    // OWNER password is unchanged (was restored in the previous test)
    const ownerLogin = await login(request, OWNER_EMAIL, OWNER_PASS);
    expect(ownerLogin.status).toBe(200);
    expect(ownerLogin.user.role).toBe('OWNER');

    // Restore DISPATCHER password
    const { token: newDispToken } = await login(request, DISPATCHER_EMAIL, DISP_NEW_PASS);
    await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${newDispToken}` },
      data: { currentPassword: DISP_NEW_PASS, newPassword: DISPATCHER_PASS },
    });
  });
});
