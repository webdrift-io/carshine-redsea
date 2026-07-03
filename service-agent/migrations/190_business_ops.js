'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_leads (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'manual',
      name TEXT,
      email TEXT,
      phone TEXT,
      area TEXT,
      interest TEXT,
      intent TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      priority TEXT NOT NULL DEFAULT 'normal',
      notes TEXT,
      next_follow_up_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_submissions (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      follow_up_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES business_leads(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role_type TEXT NOT NULL DEFAULT 'team',
      message TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      admin_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES business_leads(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      customer_id TEXT,
      title TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      status TEXT NOT NULL DEFAULT 'open',
      due_at TEXT,
      completed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES business_leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generated_media (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      topic TEXT,
      platform TEXT NOT NULL,
      caption TEXT,
      hashtags TEXT,
      asset_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      provider TEXT NOT NULL DEFAULT 'manual',
      meta TEXT,
      scheduled_at TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_business_leads_status ON business_leads(status);
    CREATE INDEX IF NOT EXISTS idx_business_leads_source ON business_leads(source);
    CREATE INDEX IF NOT EXISTS idx_business_leads_created ON business_leads(created_at);
    CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_submissions(status);
    CREATE INDEX IF NOT EXISTS idx_join_status ON join_requests(status);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(due_at);
    CREATE INDEX IF NOT EXISTS idx_generated_media_status ON generated_media(status);
    CREATE INDEX IF NOT EXISTS idx_generated_media_platform ON generated_media(platform);
  `);
}

module.exports = { up };
