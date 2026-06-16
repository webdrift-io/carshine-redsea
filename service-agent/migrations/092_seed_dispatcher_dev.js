'use strict';

const bcrypt = require('bcryptjs');

function up(db) {
  if (process.env.NODE_ENV === 'production') return;

  const timestamp = new Date().toISOString();
  const dispatcherHash = bcrypt.hashSync('DispatcherChangeMe123!', 12);

  db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, role, display_name, language, active, shift_start, shift_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `).run(
    'usr_dispatcher_dev',
    'dispatcher@carshineredsea.com',
    '+201555567206',
    dispatcherHash,
    'DISPATCHER',
    'CarShine Dispatcher',
    'en',
    1,
    null,
    null,
    timestamp,
    timestamp
  );
}

module.exports = { id: '092_seed_dispatcher_dev', up };
