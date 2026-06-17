'use strict';

/**
 * Simple cron-style job runner for notification automation.
 * Runs in-process; disable with ENABLE_NOTIFICATION_JOBS=false.
 */

const database = require('../database');
const notifications = require('../services/notifications');

const { db } = database;

const INTERVAL_MS = Number(process.env.NOTIFICATION_JOB_INTERVAL_MS || 5 * 60 * 1000);
let timer = null;

function findPaymentNudgeCandidates() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT b.*, c.phone_raw, c.phone_e164, c.language AS customer_language
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.deleted_at IS NULL
      AND b.status = 'QUOTED'
      AND b.payment_status IN ('UNPAID', 'PAYMENT_INSTRUCTIONS_SENT')
      AND b.created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM notification_events n
        WHERE n.booking_id = b.id AND n.template = 'payment_nudge'
      )
    LIMIT 20
  `).all(cutoff);
}

function findTomorrowReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = tomorrow.toISOString().slice(0, 10);
  return db.prepare(`
    SELECT b.*, c.phone_raw, c.phone_e164
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.deleted_at IS NULL
      AND b.status IN ('QUOTED', 'CONFIRMED')
      AND date(b.scheduled_start) = date(?)
      AND NOT EXISTS (
        SELECT 1 FROM notification_events n
        WHERE n.booking_id = b.id AND n.template = 'day_before_reminder'
      )
    LIMIT 20
  `).all(`${day}T00:00:00+02:00`);
}

function findStaleHandoffs() {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM handoff_tickets
    WHERE status = 'open' AND createdAt <= ?
    LIMIT 10
  `).all(cutoff);
}

async function runNotificationJobs() {
  try {
    for (const row of findPaymentNudgeCandidates()) {
      await notifications.notifyPaymentNudge(row, row);
    }
    for (const row of findTomorrowReminders()) {
      await notifications.notifyDayBeforeReminder(row, row);
    }
    for (const ticket of findStaleHandoffs()) {
      await notifications.notifyOwnerEscalationSla(ticket);
    }
  } catch (err) {
    console.warn('[scheduler] job run failed:', err.message);
  }
}

function startNotificationScheduler() {
  if (process.env.ENABLE_NOTIFICATION_JOBS === 'false') return;
  if (timer) return;
  timer = setInterval(() => {
    runNotificationJobs().catch((err) => console.warn('[scheduler]', err.message));
  }, INTERVAL_MS);
  console.log(`[scheduler] notification jobs every ${INTERVAL_MS}ms`);
}

function stopNotificationScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startNotificationScheduler,
  stopNotificationScheduler,
  runNotificationJobs
};
