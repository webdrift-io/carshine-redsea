import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('M0-005a requireRole middleware', () => {
  let requireRole;

  beforeEach(() => {
    delete require.cache[require.resolve('../middleware/require-role')];
    ({ requireRole } = require('../middleware/require-role'));
  });

  function mockReq(role) {
    return { user: { role, sub: 'test-user', email: 'test@example.com' } };
  }

  function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  }

  it('allows OWNER to access OWNER-only endpoint', () => {
    const mw = requireRole(['OWNER']);
    const res = mockRes();
    let called = false;
    mw(mockReq('OWNER'), res, () => { called = true; });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('allows DISPATCHER to access OWNER+DISPATCHER endpoint', () => {
    const mw = requireRole(['OWNER', 'DISPATCHER']);
    const res = mockRes();
    let called = false;
    mw(mockReq('DISPATCHER'), res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('blocks CLEANER from admin read endpoints (403 ROLE_REQUIRED)', () => {
    const mw = requireRole(['OWNER', 'DISPATCHER']);
    const res = mockRes();
    let called = false;
    mw(mockReq('CLEANER'), res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ROLE_REQUIRED');
    expect(res.body.required).toEqual(['OWNER', 'DISPATCHER']);
  });

  it('blocks CLEANER from OWNER-only reschedule endpoint', () => {
    const mw = requireRole(['OWNER']);
    const res = mockRes();
    let called = false;
    mw(mockReq('CLEANER'), res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('maps legacy "admin" JWT role to OWNER (full access)', () => {
    const mw = requireRole(['OWNER', 'DISPATCHER']);
    const res = mockRes();
    let called = false;
    mw(mockReq('admin'), res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('blocks request with no req.user (unauthenticated)', () => {
    const mw = requireRole(['OWNER']);
    const res = mockRes();
    let called = false;
    mw({}, res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
