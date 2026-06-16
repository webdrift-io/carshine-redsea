'use strict';

/**
 * M0-005a — RBAC role guard for M0 admin endpoints.
 *
 * The current JWT issues `role: 'admin'` (single-user mode). When M0-006 wires
 * per-user login against the `users` table, JWTs will carry OWNER | DISPATCHER |
 * CLEANER directly. Until then 'admin' maps to OWNER so the guard is already
 * aligned with the future role hierarchy.
 */

const ADMIN_ROLE_AS_M0 = 'OWNER';

function requireRole(roles) {
  return function requireRoleMiddleware(req, res, next) {
    const userRole = req.user && req.user.role;
    const effectiveRole = userRole === 'admin' ? ADMIN_ROLE_AS_M0 : userRole;
    if (!effectiveRole || !roles.includes(effectiveRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient role',
        code: 'ROLE_REQUIRED',
        required: roles
      });
    }
    next();
  };
}

module.exports = { requireRole };
