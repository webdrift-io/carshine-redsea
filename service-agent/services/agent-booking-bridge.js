'use strict';

/**
 * Bridge between Mastra agent tools and the M0 bookings_v2 pipeline.
 * All chat/WhatsApp bookings flow through createPublicBooking + slot-overlap.
 */

const { createPublicBooking } = require('./public-bookings');
const { findOverlappingBookings } = require('./slot-overlap');
const database = require('../database');

const { db } = database;

const MAX_CONCURRENT = 2;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

const AGENT_PACKAGE_MAP = {
  'Trial Wash': 'EXTERIOR_SEDAN',
  'Smart Plan': 'EXTERIOR_SUV',
  'Premium Plan': 'FULL_DETAIL'
};

const ALL_OPERATING_HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

function combineDateTime(date, time) {
  if (!date || !time) return '';
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalizedTime}+02:00`;
}

function normalizePhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!value) return '';
  if (value.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('20')) return `+${digits}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

function countOverlappingBookings(date, time) {
  const scheduledStart = combineDateTime(date, time);
  const startDate = new Date(scheduledStart);
  if (Number.isNaN(startDate.getTime())) return 0;
  const endDate = new Date(startDate.getTime() + DEFAULT_DURATION_MS);
  return findOverlappingBookings({
    scheduledStart: startDate.toISOString(),
    scheduledEnd: endDate.toISOString()
  }).length;
}

function checkSlotV2({ date, time }) {
  if (!date || !time) {
    return { date, time, isAvailable: false, currentBookings: 0, capacity: MAX_CONCURRENT, reason: 'missing-args' };
  }
  const hour = parseInt(String(time).split(':')[0], 10);
  if (Number.isNaN(hour) || hour < 9 || hour > 17) {
    return { date, time, isAvailable: false, currentBookings: 0, capacity: MAX_CONCURRENT, reason: 'outside-hours' };
  }
  const currentBookings = countOverlappingBookings(date, time);
  const isAvailable = currentBookings < MAX_CONCURRENT;
  return {
    date,
    time,
    isAvailable,
    currentBookings,
    capacity: MAX_CONCURRENT,
    reason: isAvailable ? 'ok' : 'full'
  };
}

function suggestAlternativesV2({ date, excludeTime, max = 3 } = {}) {
  if (!date) return { date, alternatives: [] };
  const alternatives = ALL_OPERATING_HOURS
    .filter((t) => t !== excludeTime)
    .filter((t) => checkSlotV2({ date, time: t }).isAvailable)
    .slice(0, max);
  return { date, alternatives, capacity: MAX_CONCURRENT };
}

function mapAgentPackage(packageName) {
  return AGENT_PACKAGE_MAP[packageName] || packageName;
}

function createAgentBooking(input = {}) {
  const payload = {
    customerName: input.customerName,
    phone: input.phone,
    area: input.area,
    carType: input.carType,
    package: mapAgentPackage(input.package),
    serviceType: input.package,
    preferredDate: input.preferredDate || input.date,
    preferredTime: input.preferredTime || input.time,
    address: input.location || input.address,
    location: input.location,
    paymentMethod: input.paymentMethod,
    notes: input.notes || '',
    source: input.source || 'CHATBOT',
    language: input.language || 'en',
    idempotencyKey: input.chatSessionId ? `chat:${input.chatSessionId}` : input.idempotencyKey
  };

  if (String(input.paymentMethod).toLowerCase() === 'instapay') {
    payload.notes = (payload.notes ? payload.notes + ' ' : '') + 'Awaiting receipt screenshot';
  }

  const result = createPublicBooking(payload);

  if (!result.success) {
    if (result.status === 'NEEDS_HUMAN') {
      return {
        bookingCreated: false,
        bookingId: null,
        missingFields: null,
        error: 'slot-unavailable',
        alternatives: suggestAlternativesV2({
          date: payload.preferredDate,
          excludeTime: payload.preferredTime
        }).alternatives
      };
    }
    return {
      bookingCreated: false,
      bookingId: null,
      missingFields: result.missingFields || null,
      error: result.message || 'booking-failed'
    };
  }

  if (result.status !== 'QUOTED') {
    return {
      bookingCreated: false,
      bookingId: result.bookingId || null,
      missingFields: result.missingFields || null,
      error: result.status === 'COLLECTING_INFO' ? 'incomplete-intake' : 'needs-human'
    };
  }

  return {
    bookingCreated: true,
    bookingId: result.bookingId,
    bookingV2Id: result.bookingV2Id,
    publicRef: result.bookingId,
    missingFields: null,
    error: null,
    booking: {
      id: result.bookingId,
      bookingV2Id: result.bookingV2Id,
      status: result.status,
      paymentStatus: result.paymentStatus,
      preferredDate: payload.preferredDate,
      preferredTime: payload.preferredTime,
      notes: payload.notes
    }
  };
}

function getBookingsV2ByPhone(phone) {
  if (!phone) return [];
  const phoneE164 = normalizePhone(phone);
  const rows = db.prepare(`
    SELECT
      b.id,
      b.public_ref,
      b.status,
      b.payment_status,
      b.scheduled_start,
      b.scheduled_end,
      b.source,
      b.notes,
      b.created_at,
      c.full_name AS customer_name,
      c.phone_raw AS phone,
      c.area
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.deleted_at IS NULL
      AND (c.phone_e164 = ? OR c.phone_raw = ? OR c.phone_e164 = ? OR c.phone_raw = ?)
    ORDER BY b.created_at DESC
  `).all(phoneE164, phone, phone, phoneE164);

  return rows.map((row) => {
    const dateParts = splitDateTime(row.scheduled_start);
    return {
      id: row.public_ref || row.id,
      bookingV2Id: row.id,
      customerName: row.customer_name,
      phone: row.phone,
      area: row.area,
      preferredDate: dateParts.date,
      preferredTime: dateParts.time,
      status: row.status,
      paymentStatus: row.payment_status,
      notes: row.notes,
      createdAt: row.created_at,
      source: row.source
    };
  });
}

function splitDateTime(value) {
  if (!value || !String(value).includes('T')) return { date: undefined, time: undefined };
  const [date, rest] = String(value).split('T');
  return { date, time: rest.slice(0, 5) };
}

function getBookingV2ByRef(ref) {
  const row = db.prepare(`
    SELECT b.*, c.full_name AS customer_name, c.phone_raw AS phone
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.deleted_at IS NULL AND (b.public_ref = ? OR b.id = ?)
    LIMIT 1
  `).get(ref, ref);
  if (!row) return null;
  const dateParts = splitDateTime(row.scheduled_start);
  return {
    id: row.public_ref || row.id,
    bookingV2Id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    preferredDate: dateParts.date,
    preferredTime: dateParts.time,
    status: row.status,
    paymentStatus: row.payment_status,
    notes: row.notes
  };
}

module.exports = {
  checkSlotV2,
  suggestAlternativesV2,
  createAgentBooking,
  getBookingsV2ByPhone,
  getBookingV2ByRef,
  combineDateTime,
  ALL_OPERATING_HOURS,
  AGENT_PACKAGE_MAP
};
