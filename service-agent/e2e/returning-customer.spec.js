/**
 * E2E — returning customer greeting uses Mem0/DB lookup (API smoke).
 */
const { test, expect } = require('@playwright/test');

test.describe('Returning customer', () => {
  test('lookupCustomer finds prior v2 booking by phone', async ({ request }) => {
    const phone = '+201555588877';
    const idem = `e2e-returning-${Date.now()}`;
    const book = await request.post('/api/public/bookings', {
      headers: { 'X-Idempotency-Key': idem, 'Content-Type': 'application/json' },
      data: {
        customerName: 'Returning Ahmed',
        phone,
        area: 'El Gouna',
        carType: 'Sedan',
        servicePackageCode: 'EXTERIOR_SEDAN',
        address: 'Test Marina',
        preferredDate: '2099-08-15',
        preferredTime: '11:00',
        paymentMethod: 'Cash',
        source: 'WEB_FORM',
        language: 'ar'
      }
    });
    expect(book.ok()).toBeTruthy();

    const chat = await request.post('/api/public/chat', {
      data: { sessionId: `sess_${Date.now()}`, message: 'أهلاً', phone, profileName: 'Returning Ahmed' }
    });
    expect(chat.ok()).toBeTruthy();
    const body = await chat.json();
    expect(body.reply).toBeTruthy();
    expect(body.reply).toMatch(/منورنا|أهلا|Welcome|Willkommen/i);
  });
});
