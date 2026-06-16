import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

describe('M0-006 users service', () => {
  let database;
  let users;
  let tmpPath;
  let previousDatabasePath;
  let previousNodeEnv;
  let testCounter = 0;

  beforeEach(() => {
    previousDatabasePath = process.env.DATABASE_PATH;
    previousNodeEnv = process.env.NODE_ENV;
    testCounter += 1;
    tmpPath = path.join(
      process.env.TEMP || '/tmp',
      `m0_006_auth_${process.pid}_${testCounter}_${Date.now()}.sqlite`
    );
    process.env.DATABASE_PATH = tmpPath;
    process.env.NODE_ENV = 'development';

    delete require.cache[require.resolve('../services/users')];
    delete require.cache[require.resolve('../database')];
    database = require('../database');
    users = require('../services/users');
  });

  afterEach(() => {
    database.db.close();
    try { fs.unlinkSync(tmpPath); } catch (e) { void e; }
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    delete require.cache[require.resolve('../services/users')];
    delete require.cache[require.resolve('../database')];
  });

  it('getUserByEmail returns OWNER user from dev seed', () => {
    const user = users.getUserByEmail('owner@carshineredsea.com');
    expect(user).not.toBeNull();
    expect(user.role).toBe('OWNER');
    expect(user.display_name).toBe('CarShine Owner');
    expect(user.active).toBe(1);
  });

  it('getUserByEmail returns CLEANER user from dev seed', () => {
    const user = users.getUserByEmail('mahmoud.cleaner@example.com');
    expect(user).not.toBeNull();
    expect(user.role).toBe('CLEANER');
    expect(user.password_hash).toBeTruthy();
  });

  it('getUserByEmail returns null for unknown email', () => {
    const user = users.getUserByEmail('nobody@example.com');
    expect(user).toBeNull();
  });

  it('getUserByEmail returns null for empty/null input', () => {
    expect(users.getUserByEmail('')).toBeNull();
    expect(users.getUserByEmail(null)).toBeNull();
  });

  it('updateLastLogin sets last_login_at for a known user', () => {
    const owner = users.getUserByEmail('owner@carshineredsea.com');
    expect(owner).not.toBeNull();
    users.updateLastLogin(owner.id);
    const updated = database.db.prepare(
      'SELECT last_login_at FROM users WHERE id = ?'
    ).get(owner.id);
    expect(updated.last_login_at).toBeTruthy();
    expect(new Date(updated.last_login_at).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it('listActiveCleaners returns only CLEANER-role active users', () => {
    const cleaners = users.listActiveCleaners();
    expect(cleaners.length).toBeGreaterThanOrEqual(1);
    cleaners.forEach(c => {
      expect(c).not.toHaveProperty('password_hash');
      expect(c).not.toHaveProperty('role');
    });
    // Dev seed has 'Mahmoud' as the cleaner
    expect(cleaners.some(c => c.display_name === 'Mahmoud')).toBe(true);
  });

  it('listUsersByRole filters correctly', () => {
    const owners = users.listUsersByRole('OWNER');
    expect(owners.length).toBeGreaterThanOrEqual(1);
    owners.forEach(u => expect(u.role).toBe('OWNER'));

    const cleaners = users.listUsersByRole('CLEANER');
    expect(cleaners.length).toBeGreaterThanOrEqual(1);
    cleaners.forEach(u => expect(u.role).toBe('CLEANER'));

    const invalid = users.listUsersByRole('SUPERADMIN');
    expect(invalid).toEqual([]);
  });
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
