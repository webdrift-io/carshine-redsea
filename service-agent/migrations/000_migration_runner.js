'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = __dirname;

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function migrationIdFor(file) {
  return path.basename(file, '.js');
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => file !== '000_migration_runner.js')
    .sort();
}

function applyMigrationModule(db, migration, id) {
  if (typeof migration.up === 'function') {
    return migration.up(db);
  }

  if (typeof migration.applyHandoffTicketsMigration === 'function') {
    return migration.applyHandoffTicketsMigration(db);
  }

  throw new Error(`Migration ${id} does not export up(db)`);
}

function runMigrations(db, options = {}) {
  if (!db) throw new Error('runMigrations: db instance is required');

  ensureMigrationsTable(db);

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id)
  );
  const files = listMigrationFiles();
  const appliedNow = [];

  for (const file of files) {
    const id = migrationIdFor(file);
    if (applied.has(id)) continue;

    const filePath = path.join(MIGRATIONS_DIR, file);
    delete require.cache[require.resolve(filePath)];
    const migration = require(filePath);

    const tx = db.transaction(() => {
      applyMigrationModule(db, migration, id);
      db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(id, new Date().toISOString());
    });

    tx();
    appliedNow.push(id);
  }

  if (options.log && appliedNow.length) {
    console.log(`[DB] Applied migrations: ${appliedNow.join(', ')}`);
  }

  return {
    applied: appliedNow,
    skipped: files.map(migrationIdFor).filter((id) => !appliedNow.includes(id))
  };
}

module.exports = {
  ensureMigrationsTable,
  listMigrationFiles,
  runMigrations
};
