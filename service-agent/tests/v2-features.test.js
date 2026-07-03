import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(process.cwd(), 'test-v2-features.sqlite');
process.env.DATABASE_PATH = TEST_DB;

let portalSvc, paymentsSvc, marketingSvc, brandSlides, minimaxCopy, Database;

beforeAll(async () => {
  // Clean slate
  for (const ext of ['', '-shm', '-wal', '-journal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch (_e) { /* best-effort cleanup */ }
  }
  // Use the real migrations via database.js (don't re-create schema manually)
  vi.resetModules();
  const dbMod = await import('../database.js');
  const db = dbMod.db || (dbMod.default && dbMod.default.db);
  Database = (await import('better-sqlite3')).default;
  // Seed fixtures
  db.prepare(`DELETE FROM booking_status_history`).run();
  db.prepare(`DELETE FROM payment_events`).run();
  db.prepare(`DELETE FROM payments`).run();
  db.prepare(`DELETE FROM customer_portal_tokens`).run();
  db.prepare(`DELETE FROM bookings_v2`).run();
  db.prepare(`DELETE FROM vehicles`).run();
  db.prepare(`DELETE FROM customers`).run();
  db.prepare(`DELETE FROM users WHERE id != 'admin_seed'`).run();
  try {
    db.prepare(`INSERT INTO customers (id, full_name, phone_e164, phone_raw, email, language, address, area, notes, tags, legacy_phone, created_at, updated_at, deleted_at) VALUES ('cust_test_1', 'Ahmed Hassan', '+20123456111', '+20123456111', 'ahmed@test.com', 'en', 'Marina 5', 'El Gouna', '', '[]', null, '2026-06-20T00:00:00Z', '2026-06-20T00:00:00Z', null)`).run();
    db.prepare(`INSERT INTO vehicles VALUES ('veh_test_1', 'cust_test_1', 'Sedan', 'BMW', '5 Series', 'Black', 'ABC-123', '', '2026-06-20T00:00:00Z', '2026-06-20T00:00:00Z', null)`).run();
    db.prepare(`INSERT OR IGNORE INTO service_packages VALUES ('sp_test_1', 'FULL', 'Full Detail', 'تفصيل كامل', 'Volldetail', '', '', '', 90, 500, 'EGP', 1, '2026-06-20T00:00:00Z', '2026-06-20T00:00:00Z', null)`).run();
    db.prepare(`INSERT INTO bookings_v2 (id, public_ref, customer_id, vehicle_id, service_package_id, scheduled_start, scheduled_end, timezone, status, payment_status, source, language, notes, created_at, updated_at) VALUES ('book_test_1', 'CR-20260620-001', 'cust_test_1', 'veh_test_1', 'sp_test_1', '2026-12-12T10:00:00Z', '2026-12-12T11:30:00Z', 'Africa/Cairo', 'QUOTED', 'UNPAID', 'WEB_FORM', 'en', '', '2026-06-20T00:00:00Z', '2026-06-20T00:00:00Z')`).run();
    db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, role, display_name, language, active, created_at, updated_at) VALUES ('user_owner', 'owner@test.com', 'x', 'OWNER', 'Owner', 'en', 1, '2026-06-20T00:00:00Z', '2026-06-20T00:00:00Z')`).run();
  } catch (e) {
    console.error('Seed error:', e.message);
  }
  // Now load the services — they will pick up TEST_DB
  portalSvc = await import('../services/customer-portal.js');
  paymentsSvc = await import('../services/public-payments.js');
  marketingSvc = await import('../services/marketing-autopilot.js');
  brandSlides = await import('../../tiktok-marketing/scripts/providers/brand-slides.js');
  minimaxCopy = await import('../../tiktok-marketing/scripts/providers/minimax-copy.js');
});

afterAll(() => {
  for (const ext of ['', '-shm', '-wal', '-journal']) {
    try { fs.unlinkSync(TEST_DB + ext); } catch (_e) { /* best-effort cleanup */ }
  }
});

// ---------------------------------------------------------------------------
describe('Customer Portal', () => {
  it('issues a token and verifies it', () => {
    const { rawToken, id } = portalSvc.issuePortalToken('cust_test_1', { scope: 'all', issuedVia: 'whatsapp', issuedTo: '+20123456111', ttlDays: 7 });
    expect(rawToken).toBeTruthy();
    expect(id).toMatch(/^pt_/);
    const row = portalSvc._internal.isValidToken(rawToken);
    expect(row).toBeTruthy();
    expect(row.customer_id).toBe('cust_test_1');
  });

  it('returns null for a tampered token', () => {
    expect(portalSvc._internal.isValidToken('not-a-real-token')).toBeNull();
  });

  it('returns the customer via getMe', () => {
    const { rawToken } = portalSvc.issuePortalToken('cust_test_1', { scope: 'all' });
    const req = { headers: { 'x-portal-token': rawToken }, query: {}, portal: null };
    const jsonCalls = [];
    const res = { json: (v) => { jsonCalls.push(v); return v; }, status: () => res };
    let calledNext = false;
    portalSvc.portalAuthMiddleware(req, res, () => {
      calledNext = true;
      portalSvc.getMe(req, res);
    });
    expect(calledNext).toBe(true);
    expect(jsonCalls[0].success).toBe(true);
    expect(jsonCalls[0].customer.id).toBe('cust_test_1');
  });

  it('rejects reschedule with < 24h notice', () => {
    const db = new Database(TEST_DB);
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO bookings_v2 (id, public_ref, customer_id, vehicle_id, service_package_id, scheduled_start, scheduled_end, timezone, status, payment_status, source, language, notes, created_at, updated_at) VALUES ('book_soon', 'CR-SOON-1', 'cust_test_1', 'veh_test_1', 'sp_test_1', ?, ?, 'Africa/Cairo', 'BOOKED', 'UNPAID', 'WEB_FORM', 'en', '', '2026-06-20T00:00:00Z', '2026-06-20T00:00:00Z')`).run(soon, later);
    db.close();
    const booking = { id: 'book_soon', status: 'BOOKED', scheduled_start: soon };
    const guard = portalSvc._internal.assertReschedulable(booking);
    expect(guard.ok).toBe(false);
    expect(guard.error).toBe('TOO_LATE');
  });

  it('accepts reschedule with > 24h notice', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const booking = { id: 'book_future', status: 'BOOKED', scheduled_start: future };
    const guard = portalSvc._internal.assertReschedulable(booking);
    expect(guard.ok).toBe(true);
  });
});

describe('Public Payments', () => {
  it('submits a payment and creates a row + event', () => {
    const result = paymentsSvc.submitPayment({
      bookingId: 'book_test_1',
      method: 'instapay',
      amount: 500,
      reference: 'TRX-12345'
    });
    expect(result.success).toBe(true);
    expect(result.paymentId).toMatch(/^pay_/);
    expect(result.status).toBe('SUBMITTED');
  });

  it('rejects submission with missing fields', () => {
    const r = paymentsSvc.submitPayment({ bookingId: 'book_test_1', method: 'instapay', amount: 500 });
    expect(r.success).toBe(false);
    expect(r.error).toBe('MISSING_REFERENCE');
  });

  it('lists the SUBMITTED queue', () => {
    const list = paymentsSvc.listQueue({ status: 'SUBMITTED' });
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].booking_id).toBe('book_test_1');
  });

  it('verifies a payment and advances booking to BOOKED (OWNER only)', () => {
    const list = paymentsSvc.listQueue({ status: 'SUBMITTED' });
    const payment = list[0];
    const denied = paymentsSvc.verifyPayment({ paymentId: payment.id, actorUserId: 'user_x', actorRole: 'CLEANER' });
    expect(denied.success).toBe(false);
    expect(denied.error).toBe('NOT_AUTHORIZED');
    const ok = paymentsSvc.verifyPayment({ paymentId: payment.id, actorUserId: 'user_owner', actorRole: 'OWNER' });
    expect(ok.success).toBe(true);
    expect(ok.status).toBe('VERIFIED');
    const db = new Database(TEST_DB);
    const booking = db.prepare('SELECT * FROM bookings_v2 WHERE id = ?').get('book_test_1');
    expect(booking.status).toBe('BOOKED');
    expect(booking.payment_status).toBe('VERIFIED');
    db.close();
  });

  it('rejects a payment with reason and writes event', () => {
    const sub = paymentsSvc.submitPayment({ bookingId: 'book_test_1', method: 'vodafone_cash', amount: 200, reference: 'TRX-X' });
    const r = paymentsSvc.rejectPayment({ paymentId: sub.paymentId, actorUserId: 'user_owner', actorRole: 'OWNER', reason: 'amount mismatch' });
    expect(r.success).toBe(true);
    expect(r.status).toBe('REJECTED');
  });
});

describe('Marketing Autopilot', () => {
  it('reports enabled status', () => {
    const s = marketingSvc.getStatus();
    expect(typeof s.enabled).toBe('boolean');
  });

  it('enables + disables', () => {
    const a = marketingSvc.setEnabled(true, 'draft');
    expect(a.enabled).toBe(true);
    expect(a.mode).toBe('draft');
    const b = marketingSvc.setEnabled(false);
    expect(b.enabled).toBe(false);
  });

  it('computes next scheduled time', () => {
    const now = new Date('2026-06-20T08:00:00');
    const next = marketingSvc.computeNext(['07:30', '16:30', '21:00'], now);
    expect(new Date(next).getHours()).toBe(16);
    expect(new Date(next).getMinutes()).toBe(30);
  });
});

describe('Brand Slides', () => {
  it('renders a slide PNG', () => {
    const out = path.join(process.cwd(), 'test-slide-1.png');
    if (fs.existsSync(out)) fs.unlinkSync(out);
    const r = brandSlides.renderSlide({
      hook: 'WE COME TO YOU',
      caption: 'Premium car wash at your door.',
      hashtags: ['#CarShine', '#Egypt'],
      priceFrom: 150,
      ctaText: 'Book on WhatsApp →',
      slideNumber: 1,
      totalSlides: 1,
      outputPath: out
    });
    expect(r.path).toBe(out);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(10000);
  }, 60000);

  it('renders a 6-slide storyboard', () => {
    const dir = path.join(process.cwd(), 'test-storyboard');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    const slides = brandSlides.STORYBOARD_TEMPLATES.en('premium mobile car wash');
    const r = brandSlides.renderStoryboard({ slides, outputDir: dir, baseName: 'slide' });
    expect(r.length).toBe(6);
    expect(fs.existsSync(path.join(dir, 'slide-01.png'))).toBe(true);
  });
});

describe('MiniMax copy', () => {
  it('returns hooks + captions + hashtags (LLM or templates)', async () => {
    const r = await minimaxCopy.generateCopy({ topic: 'car wash', language: 'en', count: 3 });
    expect(typeof r.usedLLM).toBe('boolean');
    expect(r.hooks.length).toBe(3);
    expect(r.captions.length).toBe(3);
    expect(r.hashtags.length).toBeGreaterThan(0);
    expect(r.hooks.every(h => h && h.length > 0)).toBe(true);
  });

  it('returns Egyptian-Arabic templates', () => {
    const r = minimaxCopy.templateFallback({ topic: 'car wash', language: 'ar', count: 3 });
    expect(r.hooks[0]).toMatch(/[\u0600-\u06FF]/);
    expect(r.hashtags.some(h => /[\u0600-\u06FF]/.test(h))).toBe(true);
  });

  it('returns German templates', () => {
    const r = minimaxCopy.templateFallback({ topic: 'car wash', language: 'de', count: 3 });
    expect(r.hooks[0]).toMatch(/WIR|WIR KOMMEN/);
  });
});
