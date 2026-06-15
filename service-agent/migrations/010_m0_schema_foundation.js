'use strict';

const BOOKING_STATUSES = [
  'NEW',
  'COLLECTING_INFO',
  'QUOTED',
  'BOOKED',
  'ASSIGNED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NEEDS_HUMAN'
];

const PAYMENT_STATUSES = [
  'UNPAID',
  'PAYMENT_INSTRUCTIONS_SENT',
  'PAYMENT_PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
  'REFUNDED'
];

const ROLES = ['OWNER', 'DISPATCHER', 'CLEANER'];

function quoted(values) {
  return values.map((value) => `'${value}'`).join(', ');
}

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN (${quoted(ROLES)})),
      display_name TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      active INTEGER NOT NULL DEFAULT 1,
      shift_start TEXT,
      shift_end TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone_e164 TEXT,
      phone_raw TEXT,
      email TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      address TEXT,
      area TEXT,
      notes TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      legacy_phone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_customers_phone_e164 ON customers(phone_e164);
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
    CREATE INDEX IF NOT EXISTS idx_customers_area ON customers(area);

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      car_type TEXT NOT NULL,
      make TEXT,
      model TEXT,
      color TEXT,
      plate TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON vehicles(customer_id);

    CREATE TABLE IF NOT EXISTS service_packages (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name_en TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      name_de TEXT NOT NULL,
      description_en TEXT,
      description_ar TEXT,
      description_de TEXT,
      duration_minutes INTEGER NOT NULL,
      price_amount INTEGER NOT NULL,
      price_currency TEXT NOT NULL DEFAULT 'EGP',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings_v2 (
      id TEXT PRIMARY KEY,
      legacy_booking_id TEXT UNIQUE,
      public_ref TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL,
      vehicle_id TEXT,
      service_package_id TEXT NOT NULL,
      scheduled_start TEXT NOT NULL,
      scheduled_end TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
      status TEXT NOT NULL CHECK (status IN (${quoted(BOOKING_STATUSES)})),
      payment_status TEXT NOT NULL CHECK (payment_status IN (${quoted(PAYMENT_STATUSES)})),
      source TEXT NOT NULL CHECK (source IN ('WEB_FORM', 'CHATBOT', 'WHATSAPP', 'EMAIL', 'OWNER', 'LEGACY')),
      language TEXT NOT NULL DEFAULT 'en',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY (service_package_id) REFERENCES service_packages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_v2_start ON bookings_v2(scheduled_start);
    CREATE INDEX IF NOT EXISTS idx_bookings_v2_status ON bookings_v2(status);
    CREATE INDEX IF NOT EXISTS idx_bookings_v2_customer ON bookings_v2(customer_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_v2_payment_status ON bookings_v2(payment_status);

    CREATE TABLE IF NOT EXISTS booking_status_history (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL CHECK (to_status IN (${quoted(BOOKING_STATUSES)})),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'AI', 'CUSTOMER', 'OWNER', 'DISPATCHER', 'CLEANER')),
      actor_id TEXT,
      reason TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id)
    );

    CREATE INDEX IF NOT EXISTS idx_booking_status_history_booking ON booking_status_history(booking_id);

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      cleaner_id TEXT NOT NULL,
      assigned_by TEXT,
      assigned_at TEXT NOT NULL,
      released_at TEXT,
      release_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id),
      FOREIGN KEY (cleaner_id) REFERENCES users(id),
      FOREIGN KEY (assigned_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_booking ON assignments(booking_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_cleaner ON assignments(cleaner_id);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL CHECK (method IN ('INSTAPAY', 'CASH', 'OTHER')),
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP',
      status TEXT NOT NULL CHECK (status IN (${quoted(PAYMENT_STATUSES)})),
      reference TEXT,
      screenshot_url TEXT,
      submitted_at TEXT,
      verified_by_user_id TEXT,
      verified_at TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id),
      FOREIGN KEY (verified_by_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'INSTRUCTIONS_SENT', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'REFUNDED', 'REOPENED')),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'AI', 'CUSTOMER', 'OWNER', 'DISPATCHER', 'CLEANER')),
      actor_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id);

    CREATE TABLE IF NOT EXISTS conversations_v2 (
      id TEXT PRIMARY KEY,
      legacy_chat_session_id TEXT UNIQUE,
      customer_id TEXT,
      booking_id TEXT,
      channel TEXT NOT NULL CHECK (channel IN ('WEB_CHAT', 'WHATSAPP', 'EMAIL', 'SMS')),
      status TEXT NOT NULL DEFAULT 'OPEN',
      language TEXT NOT NULL DEFAULT 'en',
      handoff_active INTEGER NOT NULL DEFAULT 0,
      handoff_owner_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id),
      FOREIGN KEY (handoff_owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages_v2 (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      customer_id TEXT,
      booking_id TEXT,
      channel TEXT NOT NULL CHECK (channel IN ('WEB_CHAT', 'WHATSAPP', 'EMAIL', 'SMS')),
      direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
      sender_type TEXT NOT NULL CHECK (sender_type IN ('CUSTOMER', 'AI', 'OWNER', 'DISPATCHER', 'CLEANER', 'SYSTEM')),
      template_code TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      subject TEXT,
      body TEXT NOT NULL,
      provider TEXT,
      provider_message_id TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'QUEUED',
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations_v2(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id),
      UNIQUE(provider, provider_message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_v2_conversation ON messages_v2(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_v2_booking ON messages_v2(booking_id);

    CREATE TABLE IF NOT EXISTS agent_actions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      booking_id TEXT,
      tool_name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      success INTEGER NOT NULL,
      latency_ms INTEGER,
      actor_type TEXT NOT NULL DEFAULT 'AI' CHECK (actor_type = 'AI'),
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations_v2(id),
      FOREIGN KEY (booking_id) REFERENCES bookings_v2(id)
    );

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

module.exports = {
  id: '010_m0_schema_foundation',
  up,
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  ROLES
};
