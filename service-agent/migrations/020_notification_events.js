'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_events (
      id TEXT PRIMARY KEY,
      booking_id TEXT,
      channel TEXT NOT NULL,
      template TEXT NOT NULL,
      recipient TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id)
    );
    CREATE INDEX IF NOT EXISTS idx_notification_events_booking ON notification_events(booking_id);
    CREATE INDEX IF NOT EXISTS idx_notification_events_template ON notification_events(template);
  `);
}

module.exports = { id: '020_notification_events', up };
