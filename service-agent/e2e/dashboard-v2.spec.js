'use strict';

const { test, expect } = require('@playwright/test');

test('dashboard v2 loads JS and sidebar navigation works', async ({ page, request }) => {
  const asset = await request.get('/dashboard-v2.js');
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('application/javascript');

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto('/dashboard-v2');
  await expect(page.locator('#page-overview')).toHaveClass(/active/);

  for (const pageName of ['bookings', 'dispatch', 'payments', 'inbox', 'leads', 'contacts', 'customers', 'followups', 'join', 'staff', 'calendar', 'portal', 'marketing', 'media', 'reports']) {
    await page.locator(`.nav-item[data-page="${pageName}"]`).click();
    await expect(page.locator(`#page-${pageName}`)).toHaveClass(/active/);
  }

  await page.locator('.menu-toggle').click();
  await expect(page.locator('.app')).toHaveClass(/sidebar-collapsed/);
  await page.locator('.nav-item[data-page="bookings"]').click();
  await expect(page.locator('#page-bookings')).toHaveClass(/active/);
  await expect(page.locator('.nav-item[data-page="bookings"] i')).toBeVisible();

  await page.locator('.nav-item[data-page="payments"]').click();
  await expect(page.locator('#payments-connection-banner')).toContainText('proof-review API');
  await expect(page.locator('#payments-tbody')).not.toBeEmpty();

  await page.locator('.nav-item[data-page="inbox"]').click();
  await expect(page.locator('#inbox-sub')).toContainText(/Connected|failed/i);
  await expect(page.locator('#inbox-tbody')).not.toBeEmpty();

  await page.locator('button[title="Refresh"]').click();
  await expect(page.locator('#toast')).toHaveClass(/show/);

  const broken = consoleErrors.filter(text => {
    if (/fonts\.gstatic\.com|cdnjs\.cloudflare\.com|Failed to load resource: net::ERR_FAILED/i.test(text)) return false;
    if (/Failed to load resource.*favicon/i.test(text)) return false;
    return true;
  });
  expect(pageErrors).toEqual([]);
  expect(broken).toEqual([]);
});

test('payment and inbox action buttons open connected detail modals', async ({ page }) => {
  await page.route('**/api/admin/payments**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      count: 1,
      items: [{
        id: 'pay_test_1',
        booking_id: 'book_test_1',
        public_ref: 'CR-TEST-001',
        method: 'INSTAPAY',
        amount: 300,
        status: 'SUBMITTED',
        reference: 'REF-123',
        screenshot_url: null,
        submitted_at: '2026-06-21T14:00:00.000Z',
        booking_status: 'BOOKED',
        customer_name: 'Test Customer',
        customer_phone: '+201000000000'
      }]
    })
  }));
  await page.route('**/api/chats', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 'chat_test_1',
      customerName: 'Inbox Customer',
      phone: '+201000000001',
      status: 'active',
      updatedAt: '2026-06-21T14:10:00.000Z',
      messages: [
        { sender: 'customer', text: 'I need a car wash', timestamp: '2026-06-21T14:09:00.000Z' },
        { sender: 'bot', text: 'Happy to help.', timestamp: '2026-06-21T14:10:00.000Z' }
      ],
      lastMessage: { text: 'Happy to help.' }
    }])
  }));

  await page.goto('/dashboard-v2');

  await page.locator('.nav-item[data-page="payments"]').click();
  await page.locator('button[data-action="payment-detail"]').click();
  await expect(page.locator('#modal')).toContainText('Payment pay_test_1');
  await page.locator('#detail-close-btn').click();

  await page.locator('.nav-item[data-page="inbox"]').click();
  await page.locator('button[data-action="chat-detail"]').click();
  await expect(page.locator('#modal')).toContainText('Inbox Customer');
  await expect(page.locator('#modal')).toContainText('I need a car wash');
});
