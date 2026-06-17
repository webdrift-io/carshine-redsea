'use strict';

/**
 * Outbound notification service — booking confirmations, reminders, payment nudges.
 * Uses WhatsApp when configured; always logs to notification_events table.
 */

const database = require('../database');
const crypto = require('crypto');

const { db } = database;

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function logNotification({ bookingId, channel, template, recipient, body, status, metadata }) {
  try {
    db.prepare(`
      INSERT INTO notification_events (
        id, booking_id, channel, template, recipient, body, status, metadata, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId('ntf'),
      bookingId || null,
      channel,
      template,
      recipient || null,
      body,
      status,
      JSON.stringify(metadata || {}),
      new Date().toISOString()
    );
  } catch (err) {
    console.warn('[notifications] log failed:', err.message);
  }
}

async function sendWhatsAppText(phone, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneId || !phone) {
    return { sent: false, reason: 'whatsapp-not-configured' };
  }
  const to = String(phone).replace(/\D/g, '');
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      return { sent: false, reason: errText.slice(0, 200) };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

async function notifyBookingConfirmation(bookingRow, customerRow) {
  const lang = bookingRow.language || customerRow?.language || 'en';
  const ref = bookingRow.public_ref;
  const copy = {
    en: `Booking ${ref} confirmed! We'll see you at your location. Pay via InstaPay if selected — reply with your screenshot.`,
    ar: `تمام يا فندم! حجزك ${ref} اتسجل. هنيجي في الميعاد. لو InstaPay ابعتلي سكرين شوت التحويل.`,
    de: `Buchung ${ref} bestätigt. Wir kommen zum Termin. Bei InstaPay bitte Screenshot senden.`
  };
  const body = copy[lang] || copy.en;
  const phone = customerRow?.phone_raw || customerRow?.phone_e164;
  const wa = await sendWhatsAppText(phone, body);
  logNotification({
    bookingId: bookingRow.id,
    channel: 'WHATSAPP',
    template: 'booking_confirmation',
    recipient: phone,
    body,
    status: wa.sent ? 'SENT' : 'QUEUED',
    metadata: { reason: wa.reason || null }
  });
  return wa;
}

async function notifyPaymentNudge(bookingRow, customerRow) {
  const ref = bookingRow.public_ref;
  const body = `Reminder: payment pending for booking ${ref}. Send InstaPay screenshot when ready.`;
  const phone = customerRow?.phone_raw || customerRow?.phone_e164;
  const wa = await sendWhatsAppText(phone, body);
  logNotification({
    bookingId: bookingRow.id,
    channel: 'WHATSAPP',
    template: 'payment_nudge',
    recipient: phone,
    body,
    status: wa.sent ? 'SENT' : 'QUEUED',
    metadata: {}
  });
  return wa;
}

async function notifyDayBeforeReminder(bookingRow, customerRow) {
  const body = `Reminder: CarShine wash tomorrow for booking ${bookingRow.public_ref}. See you then!`;
  const phone = customerRow?.phone_raw || customerRow?.phone_e164;
  const wa = await sendWhatsAppText(phone, body);
  logNotification({
    bookingId: bookingRow.id,
    channel: 'WHATSAPP',
    template: 'day_before_reminder',
    recipient: phone,
    body,
    status: wa.sent ? 'SENT' : 'QUEUED',
    metadata: {}
  });
  return wa;
}

async function notifyCompletion(bookingRow, customerRow) {
  const reviewUrl = process.env.GOOGLE_REVIEW_URL || 'https://carshineredsea.com';
  const body = `Thanks for choosing CarShine! Booking ${bookingRow.public_ref} is complete. Leave a review: ${reviewUrl}`;
  const phone = customerRow?.phone_raw || customerRow?.phone_e164;
  const wa = await sendWhatsAppText(phone, body);
  logNotification({
    bookingId: bookingRow.id,
    channel: 'WHATSAPP',
    template: 'completion_review',
    recipient: phone,
    body,
    status: wa.sent ? 'SENT' : 'QUEUED',
    metadata: {}
  });
  return wa;
}

async function notifyOwnerEscalationSla(ticketRow) {
  const ownerPhone = process.env.ADMIN_WHATSAPP_PHONE;
  if (!ownerPhone) return { sent: false, reason: 'no-owner-phone' };
  const body = `Handoff SLA: open ticket ${ticketRow.id} (${ticketRow.reason}) — ${ticketRow.summary}`;
  return sendWhatsAppText(ownerPhone, body);
}

module.exports = {
  logNotification,
  sendWhatsAppText,
  notifyBookingConfirmation,
  notifyPaymentNudge,
  notifyDayBeforeReminder,
  notifyCompletion,
  notifyOwnerEscalationSla
};
