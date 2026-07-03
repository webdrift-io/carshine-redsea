import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const { up, issueToken, verifyToken, revokeToken } =
  require('../migrations/160_create_customer_portal_tokens.js');

const DB_PATH = path.join(process.cwd(), 'test-portal-tokens.sqlite');

let db;
beforeAll(() => {
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, full_name TEXT, created_at TEXT);
    CREATE TABLE bookings_v2 (id TEXT PRIMARY KEY, customer_id TEXT, created_at TEXT);
    INSERT INTO customers VALUES ('cust_test_1', 'Test User', '2026-06-20T00:00:00Z');
    INSERT INTO bookings_v2 VALUES ('book_test_1', 'cust_test_1', '2026-06-20T00:00:00Z');
  `);
  up(db);
});

afterAll(() => {
  db.close();
  try { fs.unlinkSync(DB_PATH); } catch (_e) { /* best-effort cleanup */ }
});

describe('Migration 160: customer_portal_tokens', () => {
  it('issues a token and verifies it', () => {
    const { rawToken, id } = issueToken(db, {
      customerId: 'cust_test_1',
      scope: 'booking',
      bookingId: 'book_test_1',
      issuedVia: 'whatsapp',
      issuedTo: '+201****0111',
      ttlDays: 7
    });
    expect(rawToken).toBeTruthy();
    expect(rawToken.length).toBeGreaterThan(30);
    expect(id).toMatch(/^pt_/);

    const row = verifyToken(db, rawToken);
    expect(row).toBeTruthy();
    expect(row.customer_id).toBe('cust_test_1');
    expect(row.scope).toBe('booking');
    expect(row.booking_id).toBe('book_test_1');
    expect(row.use_count).toBe(1);
  });

  it('returns null for an invalid token', () => {
    const row = verifyToken(db, 'not-a-real-token');
    expect(row).toBeNull();
  });

  it('rejects a revoked token', () => {
    const { rawToken } = issueToken(db, { customerId: 'cust_test_1' });
    revokeToken(db, rawToken, 'customer requested');
    const row = verifyToken(db, rawToken);
    expect(row).toBeNull();
  });

  it('rejects an expired token', () => {
    const { rawToken } = issueToken(db, { customerId: 'cust_test_1', ttlDays: 1 });
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    db.prepare('UPDATE customer_portal_tokens SET expires_at = ? WHERE token_hash = ?')
      .run('2000-01-01T00:00:00Z', tokenHash);
    const row = verifyToken(db, rawToken);
    expect(row).toBeNull();
  });

  it('increments use_count on each verify', () => {
    const { rawToken } = issueToken(db, { customerId: 'cust_test_1' });
    const a = verifyToken(db, rawToken);
    const b = verifyToken(db, rawToken);
    const c = verifyToken(db, rawToken);
    expect(a.use_count).toBe(1);
    expect(b.use_count).toBe(2);
    expect(c.use_count).toBe(3);
  });
});
