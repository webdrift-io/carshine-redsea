'use strict';

/**
 * Migration 110 — first-party website analytics
 * Stores lightweight, privacy-safe website events (no PII).
 * IP stored as truncated prefix only (first 3 octets for IPv4).
 * Country inferred from Cloudflare/Hostinger headers — no external geo API.
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS website_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT NOT NULL CHECK (event_type IN (
                    'page_view','chatbot_open','booking_started',
                    'booking_submitted','cta_click','page_section'
                  )),
      page_path   TEXT,
      referrer    TEXT,
      ip_prefix   TEXT,
      country     TEXT,
      device_type TEXT CHECK (device_type IN ('mobile','tablet','desktop')),
      session_id  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_we_created ON website_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_we_event   ON website_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_we_session ON website_events(session_id);
  `);
}

module.exports = { up };
