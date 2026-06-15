/**
 * Migration: handoff_tickets table
 *
 * Created for the Mastra multi-agent system to persist human handoff tickets
 * produced by the HumanHandoffAgent (escalations, complaints, cancellations,
 * reschedules, explicit "speak to a person" requests).
 *
 * This script is idempotent — it can be re-run safely. It does NOT replace
 * the existing schema; it only ensures the `handoff_tickets` table exists.
 *
 * Run with:
 *   node migrations/001_create_handoff_tickets.js
 *
 * Or import and call `applyHandoffTicketsMigration(db)` from app startup.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Allow override via env var (matches database.js convention)
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database.sqlite');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS handoff_tickets (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    customerName TEXT,
    reason TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'medium',
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    language TEXT NOT NULL DEFAULT 'en',
    intent TEXT,
    sentiment TEXT,
    chatSessionId TEXT,
    metadata TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    resolvedAt TEXT
  );
`;

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_handoff_phone ON handoff_tickets(phone);',
  'CREATE INDEX IF NOT EXISTS idx_handoff_status ON handoff_tickets(status);',
  'CREATE INDEX IF NOT EXISTS idx_handoff_urgency ON handoff_tickets(urgency);',
  'CREATE INDEX IF NOT EXISTS idx_handoff_created ON handoff_tickets(createdAt);'
];

/**
 * Apply the handoff_tickets migration to the given better-sqlite3 instance.
 * @param {import('better-sqlite3').Database} db - better-sqlite3 database instance
 * @returns {{applied: boolean, tableCreated: boolean, indexesCreated: number}}
 */
function applyHandoffTicketsMigration(db) {
  if (!db) throw new Error('applyHandoffTicketsMigration: db instance is required');

  // Check whether the table already exists before creating (idempotent + observable)
  const before = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='handoff_tickets'")
    .get();
  const tableCreated = !before;

  db.exec(SCHEMA);
  for (const idx of INDEXES) db.exec(idx);

  return { applied: true, tableCreated, indexesCreated: INDEXES.length };
}

// Allow running this file directly: `node migrations/001_create_handoff_tickets.js`
if (require.main === module) {
  // Lazy-require better-sqlite3 so this module can be imported by tests without
  // forcing the native binding to load when only the export is used.
  const Database = require('better-sqlite3');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  try {
    const result = applyHandoffTicketsMigration(db);
    console.log('[Migration 001] handoff_tickets:', result);
  } catch (err) {
    console.error('[Migration 001] FAILED:', err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

module.exports = {
  applyHandoffTicketsMigration,
  SCHEMA,
  INDEXES
};
