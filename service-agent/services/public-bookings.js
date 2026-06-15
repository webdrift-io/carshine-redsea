'use strict';

const crypto = require('crypto');
const database = require('../database');

const { db } = database;

function createPublicBooking(input = {}) {
  const normalized = normalizeInput(input);
  const duplicate = findDuplicateBooking(normalized);
  if (duplicate) {
    return buildDuplicateResponse(duplicate);
  }

  return db.transaction(() => {
    const now = new Date().toISOString();
    const customer = upsertCustomer(normalized, now);
    const servicePackage = resolveServicePackage(normalized, now);
    const missingFields = getMissingFields(normalized, servicePackage);
    const status = normalized.needsHuman ? 'NEEDS_HUMAN' : missingFields.length > 0 ? 'COLLECTING_INFO' : 'QUOTED';
    const vehicle = createVehicleIfPresent(customer.id, normalized, now);
    const schedule = buildSchedule(normalized.scheduledStart, servicePackage);
    const publicRef = generatePublicRef(now);
    const bookingId = createId('book');
    const paymentInstructions = getPaymentInstructions(publicRef, servicePackage, normalized.language);
    const paymentStatus = paymentInstructions ? 'PAYMENT_INSTRUCTIONS_SENT' : 'UNPAID';
    const notes = buildBookingNotes(normalized, missingFields, servicePackage.fallback);

    insertBooking({
      id: bookingId,
      publicRef,
      customerId: customer.id,
      vehicleId: vehicle ? vehicle.id : null,
      servicePackageId: servicePackage.id,
      scheduledStart: schedule.start,
      scheduledEnd: schedule.end,
      status,
      paymentStatus,
      source: normalized.source,
      language: normalized.language,
      notes,
      now
    });

    insertStatusHistory({
      bookingId,
      toStatus: status,
      actorType: normalized.source === 'CHATBOT' ? 'AI' : 'CUSTOMER',
      reason: 'public_booking_created',
      metadata: {
        idempotencyKey: normalized.idempotencyKey || null,
        missingFields,
        source: normalized.source,
        usedIntakeFallbacks: servicePackage.fallback || normalized.usedSchedulePlaceholder
      },
      now
    });

    const payment = insertPayment({
      bookingId,
      amount: servicePackage.priceAmount,
      currency: servicePackage.priceCurrency,
      status: paymentStatus,
      method: paymentInstructions ? 'INSTAPAY' : normalizePaymentMethod(normalized.paymentMethod),
      now
    });

    insertPaymentEvent({
      paymentId: payment.id,
      eventType: paymentInstructions ? 'INSTRUCTIONS_SENT' : 'CREATED',
      actorType: 'SYSTEM',
      metadata: {
        bookingId,
        publicRef,
        instructionsSent: Boolean(paymentInstructions)
      },
      now
    });

    const conversation = createConversationAndMessageIfNeeded({
      normalized,
      customerId: customer.id,
      bookingId,
      now
    });

    if (normalized.source === 'CHATBOT') {
      insertAgentAction({
        conversationId: conversation ? conversation.id : null,
        bookingId,
        input: {
          idempotencyKey: normalized.idempotencyKey || null,
          source: normalized.source
        },
        output: {
          status,
          paymentStatus,
          missingFields
        },
        now
      });
    }

    return buildCreatedResponse({
      bookingId,
      publicRef,
      customer,
      vehicle,
      payment,
      status,
      paymentStatus,
      missingFields,
      paymentInstructions,
      normalized,
      servicePackage
    });
  })();
}

function normalizeInput(input) {
  const preferredDate = clean(input.preferredDate || input.date);
  const preferredTime = clean(input.preferredTime || input.time);
  const scheduledStart = clean(input.scheduledStart) || combineDateTime(preferredDate, preferredTime);
  const source = normalizeSource(input.source);
  const servicePackageCode = clean(input.servicePackageCode || input.packageCode || input.package);

  return {
    customerName: clean(input.customerName || input.name),
    phone: clean(input.phone),
    email: clean(input.email),
    servicePackageCode,
    servicePackageId: clean(input.servicePackageId || input.serviceId),
    serviceType: clean(input.serviceType || input.package || input.service),
    carType: clean(input.carType || input.car),
    carMake: clean(input.carMake || input.make),
    carModel: clean(input.carModel || input.model),
    carPlate: clean(input.carPlate || input.plate),
    address: clean(input.address || input.location),
    area: clean(input.area),
    scheduledStart,
    preferredDate,
    preferredTime,
    notes: clean(input.notes),
    paymentMethod: clean(input.paymentMethod || input.payment),
    source,
    language: normalizeLanguage(input.language),
    idempotencyKey: sanitizeIdempotencyKey(input.idempotencyKey),
    initialMessage: clean(input.initialMessage || input.message || input.body),
    providerMessageId: clean(input.providerMessageId || input.messageId),
    needsHuman: input.needsHuman === true || input.humanNeeded === true || source === 'EMAIL',
    usedSchedulePlaceholder: !scheduledStart
  };
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function sanitizeIdempotencyKey(value) {
  return clean(value).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
}

function normalizeLanguage(language) {
  const value = clean(language).toLowerCase();
  if (['ar', 'de'].includes(value)) return value;
  return 'en';
}

function normalizeSource(source) {
  const value = clean(source).toLowerCase();
  if (['chatbot', 'chat', 'web_chat', 'webchat'].includes(value)) return 'CHATBOT';
  if (['whatsapp', 'wa'].includes(value)) return 'WHATSAPP';
  if (value === 'email') return 'EMAIL';
  return 'WEB_FORM';
}

function normalizePaymentMethod(method) {
  const value = clean(method).toLowerCase();
  if (value.includes('cash')) return 'CASH';
  if (value.includes('instapay')) return 'INSTAPAY';
  return 'OTHER';
}

function combineDateTime(date, time) {
  if (!date || !time) return '';
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalizedTime}+02:00`;
}

function normalizePhone(phone) {
  const value = clean(phone);
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return value;
  if (value.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('20')) return `+${digits}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

function upsertCustomer(normalized, now) {
  const phoneE164 = normalizePhone(normalized.phone);
  const existing = phoneE164
    ? db.prepare('SELECT * FROM customers WHERE phone_e164 = ? AND deleted_at IS NULL').get(phoneE164)
    : normalized.email
      ? db.prepare('SELECT * FROM customers WHERE email = ? AND deleted_at IS NULL').get(normalized.email)
      : null;

  if (existing) {
    db.prepare(`
      UPDATE customers
      SET full_name = COALESCE(NULLIF(?, ''), full_name),
          phone_raw = COALESCE(NULLIF(?, ''), phone_raw),
          email = COALESCE(NULLIF(?, ''), email),
          language = ?,
          address = COALESCE(NULLIF(?, ''), address),
          area = COALESCE(NULLIF(?, ''), area),
          updated_at = ?
      WHERE id = ?
    `).run(
      normalized.customerName,
      normalized.phone,
      normalized.email,
      normalized.language,
      normalized.address,
      normalized.area,
      now,
      existing.id
    );
    return { ...existing, id: existing.id };
  }

  const id = createId('cust');
  db.prepare(`
    INSERT INTO customers (
      id, full_name, phone_e164, phone_raw, email, language, address, area, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalized.customerName || 'Unknown Customer',
    phoneE164 || null,
    normalized.phone || null,
    normalized.email || null,
    normalized.language,
    normalized.address || null,
    normalized.area || null,
    now,
    now
  );
  return { id };
}

function createVehicleIfPresent(customerId, normalized, now) {
  const hasVehicle = normalized.carType || normalized.carMake || normalized.carModel || normalized.carPlate;
  if (!hasVehicle) return null;

  const id = createId('veh');
  db.prepare(`
    INSERT INTO vehicles (id, customer_id, car_type, make, model, plate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    customerId,
    normalized.carType || 'OTHER',
    normalized.carMake || null,
    normalized.carModel || null,
    normalized.carPlate || null,
    now,
    now
  );
  return { id };
}

function resolveServicePackage(normalized, now) {
  let servicePackage = null;
  if (normalized.servicePackageId) {
    servicePackage = db.prepare('SELECT * FROM service_packages WHERE id = ? AND deleted_at IS NULL').get(normalized.servicePackageId);
  }
  if (!servicePackage && normalized.servicePackageCode) {
    servicePackage = db.prepare('SELECT * FROM service_packages WHERE code = ? AND deleted_at IS NULL')
      .get(normalized.servicePackageCode.toUpperCase());
  }
  if (!servicePackage && normalized.serviceType) {
    const mappedCode = mapLegacyServiceType(normalized.serviceType);
    if (mappedCode) {
      servicePackage = db.prepare('SELECT * FROM service_packages WHERE code = ? AND deleted_at IS NULL').get(mappedCode);
    }
  }
  if (servicePackage) return mapServiceRow(servicePackage, false);

  const fallback = ensureIntakeServicePackage(now);
  return mapServiceRow(fallback, true);
}

function mapLegacyServiceType(serviceType) {
  const value = serviceType.toLowerCase();
  if (value.includes('suv')) return 'EXTERIOR_SUV';
  if (value.includes('interior') || value.includes('inside')) return 'INTERIOR_ADDON';
  if (value.includes('detail') || value.includes('full') || value.includes('premium')) return 'FULL_DETAIL';
  if (value.includes('sedan') || value.includes('trial') || value.includes('exterior') || value.includes('wash')) {
    return 'EXTERIOR_SEDAN';
  }
  return null;
}

function ensureIntakeServicePackage(now) {
  db.prepare(`
    INSERT INTO service_packages (
      id, code, name_en, name_ar, name_de, duration_minutes, price_amount, price_currency, active, created_at, updated_at
    )
    VALUES (
      'svc_m0_intake_placeholder', 'M0_INTAKE_PLACEHOLDER', 'M0 Intake Placeholder',
      'M0 Intake Placeholder', 'M0 Intake Placeholder', 60, 0, 'EGP', 1, ?, ?
    )
    ON CONFLICT(code) DO NOTHING
  `).run(now, now);

  return db.prepare("SELECT * FROM service_packages WHERE code = 'M0_INTAKE_PLACEHOLDER'").get();
}

function mapServiceRow(row, fallback) {
  return {
    id: row.id,
    code: row.code,
    durationMinutes: row.duration_minutes || 60,
    priceAmount: row.price_amount || 0,
    priceCurrency: row.price_currency || 'EGP',
    fallback
  };
}

function getMissingFields(normalized, servicePackage) {
  const missing = [];
  if (!normalized.customerName) missing.push('customerName');
  if (!normalized.phone) missing.push('phone');
  if (servicePackage.fallback) missing.push('servicePackage');
  if (!normalized.address && !normalized.area) missing.push('address');
  if (!normalized.scheduledStart) missing.push('scheduledStart');
  return missing;
}

function buildSchedule(scheduledStart, servicePackage) {
  const start = scheduledStart || new Date().toISOString();
  const startDate = new Date(start);
  const validStart = Number.isNaN(startDate.getTime()) ? new Date() : startDate;
  const end = new Date(validStart.getTime() + servicePackage.durationMinutes * 60 * 1000).toISOString();
  return { start: Number.isNaN(startDate.getTime()) ? validStart.toISOString() : start, end };
}

function generatePublicRef(now) {
  const compactDate = now.slice(0, 10).replace(/-/g, '');
  const prefix = `CR-${compactDate}-`;
  const count = db.prepare('SELECT COUNT(*) AS count FROM bookings_v2 WHERE public_ref LIKE ?').get(`${prefix}%`).count;
  return `${prefix}${String(count + 1).padStart(3, '0')}`;
}

function buildBookingNotes(normalized, missingFields, usedFallbackService) {
  const parts = [
    normalized.notes,
    normalized.address ? `Address: ${normalized.address}` : '',
    normalized.area ? `Area: ${normalized.area}` : '',
    normalized.serviceType ? `Legacy service type: ${normalized.serviceType}` : '',
    normalized.idempotencyKey ? `Idempotency-Key: ${normalized.idempotencyKey}` : '',
    missingFields.length ? `Missing fields: ${missingFields.join(', ')}` : '',
    usedFallbackService ? 'M0 intake placeholder service package used until service is collected.' : '',
    normalized.usedSchedulePlaceholder ? 'M0 intake placeholder scheduled_start used until preferred time is collected.' : ''
  ];
  return parts.filter(Boolean).join('\n');
}

function insertBooking(data) {
  db.prepare(`
    INSERT INTO bookings_v2 (
      id, public_ref, customer_id, vehicle_id, service_package_id, scheduled_start,
      scheduled_end, status, payment_status, source, language, notes, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.id,
    data.publicRef,
    data.customerId,
    data.vehicleId,
    data.servicePackageId,
    data.scheduledStart,
    data.scheduledEnd,
    data.status,
    data.paymentStatus,
    data.source,
    data.language,
    data.notes,
    data.now,
    data.now
  );
}

function insertStatusHistory(data) {
  db.prepare(`
    INSERT INTO booking_status_history (
      id, booking_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at
    )
    VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?)
  `).run(
    createId('hist'),
    data.bookingId,
    data.toStatus,
    data.actorType,
    data.reason,
    JSON.stringify(data.metadata || {}),
    data.now
  );
}

function insertPayment(data) {
  const id = createId('pay');
  db.prepare(`
    INSERT INTO payments (id, booking_id, method, amount, currency, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.bookingId, data.method, data.amount, data.currency, data.status, data.now, data.now);
  return { id };
}

function insertPaymentEvent(data) {
  db.prepare(`
    INSERT INTO payment_events (id, payment_id, event_type, actor_type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    createId('pevt'),
    data.paymentId,
    data.eventType,
    data.actorType,
    JSON.stringify(data.metadata || {}),
    data.now
  );
}

function createConversationAndMessageIfNeeded({ normalized, customerId, bookingId, now }) {
  if (!['CHATBOT', 'WHATSAPP', 'EMAIL'].includes(normalized.source) || !normalized.initialMessage) {
    return null;
  }

  const channel = normalized.source === 'CHATBOT' ? 'WEB_CHAT' : normalized.source;
  const conversationId = createId('conv');
  db.prepare(`
    INSERT INTO conversations_v2 (id, customer_id, booking_id, channel, status, language, handoff_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)
  `).run(
    conversationId,
    customerId,
    bookingId,
    channel,
    normalized.language,
    normalized.needsHuman ? 1 : 0,
    now,
    now
  );

  db.prepare(`
    INSERT INTO messages_v2 (
      id, conversation_id, customer_id, booking_id, channel, direction, sender_type,
      language, body, provider, provider_message_id, delivery_status, created_at
    )
    VALUES (?, ?, ?, ?, ?, 'INBOUND', 'CUSTOMER', ?, ?, ?, ?, 'DELIVERED', ?)
  `).run(
    createId('msg'),
    conversationId,
    customerId,
    bookingId,
    channel,
    normalized.language,
    normalized.initialMessage,
    normalized.source.toLowerCase(),
    normalized.providerMessageId || null,
    now
  );

  return { id: conversationId };
}

function insertAgentAction(data) {
  db.prepare(`
    INSERT INTO agent_actions (id, conversation_id, booking_id, tool_name, input, output, success, actor_type, created_at)
    VALUES (?, ?, ?, 'public_booking_create', ?, ?, 1, 'AI', ?)
  `).run(
    createId('act'),
    data.conversationId,
    data.bookingId,
    JSON.stringify(data.input || {}),
    JSON.stringify(data.output || {}),
    data.now
  );
}

function getPaymentInstructions(publicRef, servicePackage, language) {
  const receivingNumber = clean(process.env.INSTAPAY_RECEIVING_NUMBER);
  if (!receivingNumber) return null;

  const receivingName = clean(process.env.INSTAPAY_RECEIVING_NAME) || 'CarShine Red Sea';
  const amountEgp = servicePackage.priceAmount / 100;
  const copy = {
    en: `Transfer ${amountEgp} EGP to InstaPay ${receivingNumber} (${receivingName}) and include booking ref ${publicRef}.`,
    ar: `يا فندم ابعت ${amountEgp} جنيه على InstaPay رقم ${receivingNumber} باسم ${receivingName} واكتب رقم الحجز ${publicRef}.`,
    de: `Bitte ueberweise ${amountEgp} EGP per InstaPay an ${receivingNumber} (${receivingName}) mit Buchungsnummer ${publicRef}.`
  };

  return {
    method: 'INSTAPAY',
    receivingNumber,
    receivingName,
    amount: servicePackage.priceAmount,
    currency: servicePackage.priceCurrency,
    bookingRef: publicRef,
    message: copy[language] || copy.en,
    qrImageUrl: clean(process.env.INSTAPAY_QR_IMAGE_URL) || undefined,
    paymentLink: clean(process.env.INSTAPAY_PAYMENT_LINK) || undefined
  };
}

function findDuplicateBooking(normalized) {
  if (normalized.idempotencyKey) {
    const row = db.prepare(`
      SELECT b.*, p.id AS payment_id, p.status AS payment_row_status
      FROM bookings_v2 b
      LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.notes LIKE ?
      ORDER BY b.created_at DESC
      LIMIT 1
    `).get(`%Idempotency-Key: ${normalized.idempotencyKey}%`);
    if (row) return row;
  }

  if (!normalized.idempotencyKey && normalized.source === 'WEB_FORM' && normalized.phone && normalized.scheduledStart) {
    const customer = db.prepare('SELECT id FROM customers WHERE phone_e164 = ? OR phone_raw = ? ORDER BY updated_at DESC LIMIT 1')
      .get(normalizePhone(normalized.phone), normalized.phone);
    if (!customer) return null;

    const servicePackage = findExistingServiceForDuplicate(normalized);
    if (!servicePackage) return null;

    const createdAfter = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    return db.prepare(`
      SELECT b.*, p.id AS payment_id, p.status AS payment_row_status
      FROM bookings_v2 b
      LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.customer_id = ?
        AND b.service_package_id = ?
        AND b.scheduled_start = ?
        AND b.source = 'WEB_FORM'
        AND b.created_at >= ?
      ORDER BY b.created_at DESC
      LIMIT 1
    `).get(customer.id, servicePackage.id, normalized.scheduledStart, createdAfter);
  }

  return null;
}

function findExistingServiceForDuplicate(normalized) {
  if (normalized.servicePackageId) {
    return db.prepare('SELECT id FROM service_packages WHERE id = ? AND deleted_at IS NULL').get(normalized.servicePackageId);
  }
  const code = normalized.servicePackageCode || mapLegacyServiceType(normalized.serviceType);
  if (!code) return null;
  return db.prepare('SELECT id FROM service_packages WHERE code = ? AND deleted_at IS NULL').get(code.toUpperCase());
}

function buildDuplicateResponse(row) {
  return {
    success: true,
    duplicate: true,
    idempotent: true,
    id: row.public_ref,
    bookingId: row.public_ref,
    bookingV2Id: row.id,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id || undefined,
    paymentId: row.payment_id,
    status: row.status,
    paymentStatus: row.payment_status,
    message: `Existing booking ${row.public_ref} returned for duplicate request.`,
    booking: legacyBookingResponse(row)
  };
}

function buildCreatedResponse(data) {
  const message = data.status === 'COLLECTING_INFO'
    ? 'Booking intake saved. We still need more details before quoting.'
    : data.status === 'NEEDS_HUMAN'
      ? 'Booking request saved for human review.'
      : `Booking request ${data.publicRef} saved.`;

  return {
    success: true,
    id: data.publicRef,
    bookingId: data.publicRef,
    bookingV2Id: data.bookingId,
    customerId: data.customer.id,
    vehicleId: data.vehicle ? data.vehicle.id : undefined,
    paymentId: data.payment.id,
    status: data.status,
    paymentStatus: data.paymentStatus,
    message,
    paymentInstructions: data.paymentInstructions || undefined,
    missingFields: data.missingFields.length ? data.missingFields : undefined,
    booking: legacyBookingResponse({
      id: data.bookingId,
      public_ref: data.publicRef,
      customer_id: data.customer.id,
      vehicle_id: data.vehicle ? data.vehicle.id : null,
      status: data.status,
      payment_status: data.paymentStatus,
      scheduled_start: data.normalized.scheduledStart,
      source: data.normalized.source
    })
  };
}

function legacyBookingResponse(row) {
  const dateParts = splitDateTime(row.scheduled_start);
  return {
    id: row.public_ref || row.id,
    bookingV2Id: row.id,
    status: row.status,
    paymentStatus: row.payment_status,
    preferredDate: dateParts.date,
    preferredTime: dateParts.time,
    source: row.source
  };
}

function splitDateTime(value) {
  if (!value || !value.includes('T')) return { date: undefined, time: undefined };
  const [date, rest] = value.split('T');
  return { date, time: rest.slice(0, 5) };
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

module.exports = {
  createPublicBooking,
  normalizeInput,
  mapLegacyServiceType
};
