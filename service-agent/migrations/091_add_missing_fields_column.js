'use strict';

function up(db) {
  // SQLite allows adding a nullable column via ALTER TABLE without a full table rewrite.
  // Existing rows will have NULL; public-bookings.js (M0-008) now writes JSON arrays here.
  // The regex-based parseMissingFields shim in admin-bookings-read.js falls back to
  // notes parsing for legacy rows where this column is NULL.
  const columns = db.pragma('table_info(bookings_v2)').map(c => c.name);
  if (!columns.includes('missing_fields')) {
    db.exec('ALTER TABLE bookings_v2 ADD COLUMN missing_fields TEXT');
  }
}

module.exports = { id: '091_add_missing_fields_column', up };
