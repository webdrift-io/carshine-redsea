'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_credits (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      credits_remaining INTEGER NOT NULL DEFAULT 0,
      package_code TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS pricing_rules (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      multiplier REAL NOT NULL DEFAULT 1.0,
      day_of_week INTEGER,
      hour_start INTEGER,
      hour_end INTEGER,
      area TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS referral_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      customer_id TEXT,
      discount_percent INTEGER NOT NULL DEFAULT 10,
      uses_count INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS marketing_drafts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      caption TEXT,
      image_path TEXT,
      platform TEXT NOT NULL DEFAULT 'POSTIZ',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      postiz_id TEXT,
      created_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pricing_rules (id, code, name, multiplier, day_of_week, hour_start, hour_end, area, active, created_at, updated_at)
    VALUES (?, 'PEAK_FRI_SAT', 'Friday/Saturday peak', 1.15, NULL, 10, 14, NULL, 1, ?, ?)
    ON CONFLICT(code) DO NOTHING
  `).run('pr_peak', now, now);
}

module.exports = { id: '100_revenue_ops', up };
