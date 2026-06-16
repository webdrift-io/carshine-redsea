'use strict';

/**
 * M0-006 — User service (read/update).
 *
 * Queries the M0 `users` table.  Write operations are limited to last_login_at
 * stamping.  Password management stays in server.js for now (M0-006 scope).
 *
 * Hard rules:
 *   - no schema changes
 *   - no INSERT / DELETE
 *   - all db.prepare with bound params (no raw string interpolation)
 */

const database = require('../database');
const { db } = database;

function getUserByEmail(email) {
  if (!email) return null;
  return db.prepare(`
    SELECT id, email, phone, password_hash, role, display_name, language,
           active, shift_start, shift_end, last_login_at, created_at
    FROM users
    WHERE email = ? AND active = 1 AND deleted_at IS NULL
  `).get(email) || null;
}

function getActiveUserById(id) {
  if (!id) return null;
  return db.prepare(`
    SELECT id, email, phone, role, display_name, language, active
    FROM users
    WHERE id = ? AND active = 1 AND deleted_at IS NULL
  `).get(id) || null;
}

function updateLastLogin(userId) {
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, userId);
}

function listActiveCleaners() {
  return db.prepare(`
    SELECT id, email, phone, display_name, language, shift_start, shift_end
    FROM users
    WHERE role = 'CLEANER' AND active = 1 AND deleted_at IS NULL
    ORDER BY display_name ASC
  `).all();
}

function listUsersByRole(role) {
  const validRoles = ['OWNER', 'DISPATCHER', 'CLEANER'];
  if (!validRoles.includes(role)) return [];
  return db.prepare(`
    SELECT id, email, phone, role, display_name, language, active, last_login_at
    FROM users
    WHERE role = ? AND deleted_at IS NULL
    ORDER BY display_name ASC
  `).all(role);
}

function updatePassword(userId, newHash) {
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, now, userId);
}

module.exports = { getUserByEmail, getActiveUserById, updateLastLogin, updatePassword, listActiveCleaners, listUsersByRole };
