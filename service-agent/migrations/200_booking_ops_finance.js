'use strict';

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function up(db) {
  addColumnIfMissing(db, 'bookings_v2', 'washes_needed', 'INTEGER DEFAULT 1');
  addColumnIfMissing(db, 'bookings_v2', 'washes_completed', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'bookings_v2', 'operational_cost', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'bookings_v2', 'owner_notes', 'TEXT');
  addColumnIfMissing(db, 'bookings_v2', 'last_wash_at', 'TEXT');
  addColumnIfMissing(db, 'bookings_v2', 'next_wash_at', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_v2_next_wash ON bookings_v2(next_wash_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_v2_last_wash ON bookings_v2(last_wash_at);
  `);
}

module.exports = { up };
