'use strict';

/**
 * Migration 160 — customer portal tokens
 *
 * Customers don't have passwords. They receive a magic-link token in WhatsApp
 * or email that authenticates them to their self-service portal:
 *   /portal/[ref]?token=...
 *
 * Tokens are:
 *   - Single-purpose (bookingId-scoped or customer-scoped)
 *   - Time-limited (default 14 days)
 *   - One-time-revokable
 *   - Stored hashed (we never store the raw token)
 *
 * Run with:
 *   node migrations/160_create_customer_portal_tokens.js
 *
 * Or import and call `applyPortalTokensMigration(db)` from app startup.
 */

const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite');

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_portal_tokens (
      id              TEXT PRIMARY KEY,
      customer_id     TEXT NOT NULL,
      scope           TEXT NOT NULL CHECK (scope IN ('all','booking')),
      booking_id      TEXT,
      token_hash      TEXT UNIQUE NOT NULL,
      issued_via      TEXT NOT NULL CHECK (issued_via IN ('whatsapp','email','link','admin')),
      issued_to       TEXT,
      expires_at      TEXT NOT NULL,
      last_used_at    TEXT,
      use_count       INTEGER NOT NULL DEFAULT 0,
      revoked_at      TEXT,
      revoked_reason  TEXT,
      created_at      TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id)
    );

    CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer
      ON customer_portal_tokens(customer_id);
    CREATE INDEX IF NOT EXISTS idx_portal_tokens_hash
      ON customer_portal_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_portal_tokens_expires
      ON customer_portal_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_portal_tokens_booking
      ON customer_portal_tokens(booking_id);
  `);
}

/**
 * Issue a new portal token. Returns { id, rawToken } — only the rawToken is
 * ever shown to the customer; we store only token_hash.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} args
 * @param {string} args.customerId
 * @param {'all'|'booking'} [args.scope='all']
 * @param {string} [args.bookingId]
 * @param {'whatsapp'|'email'|'link'|'admin'} [args.issuedVia='link']
 * @param {string} [args.issuedTo]   phone or email of recipient
 * @param {number} [args.ttlDays=14]
 */
function issueToken(db, args) {
  const customerId = args.customerId;
  if (!customerId) throw new Error('customerId required');

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + (args.ttlDays ?? 14) * 24 * 60 * 60 * 1000);

  const id = 'pt_' + crypto.randomBytes(8).toString('hex');
  db.prepare(`
    INSERT INTO customer_portal_tokens
      (id, customer_id, scope, booking_id, token_hash, issued_via, issued_to, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    customerId,
    args.scope ?? 'all',
    args.bookingId ?? null,
    tokenHash,
    args.issuedVia ?? 'link',
    args.issuedTo ?? null,
    expires.toISOString(),
    now.toISOString()
  );

  return { id, rawToken, expiresAt: expires.toISOString() };
}

/**
 * Verify a raw token. Returns the token row (minus hash) if valid, else null.
 * Updates last_used_at + use_count.
 */
function verifyToken(db, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const row = db.prepare(`
    SELECT id, customer_id, scope, booking_id, expires_at, revoked_at, use_count
    FROM customer_portal_tokens
    WHERE token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  const newCount = row.use_count + 1;
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE customer_portal_tokens
    SET last_used_at = ?, use_count = ?
    WHERE id = ?
  `).run(nowIso, newCount, row.id);

  return { ...row, last_used_at: nowIso, use_count: newCount };
}

function revokeToken(db, rawToken, reason) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return db.prepare(`
    UPDATE customer_portal_tokens
    SET revoked_at = ?, revoked_reason = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), reason ?? 'manual', tokenHash);
}

module.exports = { up, issueToken, verifyToken, revokeToken, DB_PATH };

// CLI entry
if (require.main === module) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  try {
    up(db);
    console.log('Migration 160 applied: customer_portal_tokens table created.');
  } finally {
    db.close();
  }
}
