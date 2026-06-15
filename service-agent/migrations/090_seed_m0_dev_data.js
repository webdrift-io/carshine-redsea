'use strict';

const bcrypt = require('bcryptjs');

function now() {
  return new Date().toISOString();
}

function up(db) {
  if (process.env.NODE_ENV === 'production') return;

  const timestamp = now();
  const ownerHash = bcrypt.hashSync(process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMe123!', 12);
  const cleanerHash = bcrypt.hashSync('CleanerChangeMe123!', 12);

  db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, role, display_name, language, active, shift_start, shift_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `).run(
    'usr_owner_dev',
    'owner@carshineredsea.com',
    '+201555567205',
    ownerHash,
    'OWNER',
    'CarShine Owner',
    'en',
    1,
    null,
    null,
    timestamp,
    timestamp
  );

  db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, role, display_name, language, active, shift_start, shift_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `).run(
    'usr_cleaner_dev',
    'mahmoud.cleaner@example.com',
    '+201000000001',
    cleanerHash,
    'CLEANER',
    'Mahmoud',
    'ar',
    1,
    '09:00',
    '17:00',
    timestamp,
    timestamp
  );

  const services = [
    ['svc_exterior_sedan', 'EXTERIOR_SEDAN', 'Exterior Sedan Wash', 'غسيل خارجي سيدان', 'Aussenwaesche Limousine', 60, 35000],
    ['svc_exterior_suv', 'EXTERIOR_SUV', 'Exterior SUV Wash', 'غسيل خارجي SUV', 'Aussenwaesche SUV', 75, 45000],
    ['svc_interior_addon', 'INTERIOR_ADDON', 'Interior Add-on', 'تنضيف داخلي إضافي', 'Innenraum Zusatz', 45, 25000],
    ['svc_full_detail', 'FULL_DETAIL', 'Full Detail', 'تنضيف كامل', 'Komplettaufbereitung', 150, 120000]
  ];

  const insertService = db.prepare(`
    INSERT INTO service_packages (
      id, code, name_en, name_ar, name_de, duration_minutes, price_amount, price_currency, active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'EGP', 1, ?, ?)
    ON CONFLICT(code) DO NOTHING
  `);

  for (const service of services) {
    insertService.run(...service, timestamp, timestamp);
  }
}

module.exports = {
  id: '090_seed_m0_dev_data',
  up
};
