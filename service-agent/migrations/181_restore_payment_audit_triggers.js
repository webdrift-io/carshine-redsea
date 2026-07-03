'use strict';

function up(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS payment_events_no_update
    BEFORE UPDATE ON payment_events
    BEGIN
      SELECT RAISE(ABORT, 'payment_events is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS payment_events_no_delete
    BEFORE DELETE ON payment_events
    BEGIN
      SELECT RAISE(ABORT, 'payment_events is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS payment_events_no_ai_verify
    BEFORE INSERT ON payment_events
    WHEN NEW.event_type = 'VERIFIED' AND NEW.actor_type = 'AI'
    BEGIN
      SELECT RAISE(ABORT, 'AI cannot verify payments');
    END;

    CREATE TRIGGER IF NOT EXISTS payments_verified_requires_owner
    BEFORE UPDATE OF status ON payments
    WHEN NEW.status = 'VERIFIED' AND NEW.verified_by_user_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'verified payments require a manual owner user id');
    END;

    CREATE TRIGGER IF NOT EXISTS payments_insert_verified_requires_owner
    BEFORE INSERT ON payments
    WHEN NEW.status = 'VERIFIED' AND NEW.verified_by_user_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'verified payments require a manual owner user id');
    END;
  `);
}

module.exports = { up };
