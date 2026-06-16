// ============================================================================
// CarShine Red Sea — DESIGN-ONLY MOCKS
//
// IMPORTANT — read before consuming anything in this file:
//
// 1. This file is for design review and stakeholder demo ONLY.
// 2. Every value here is fabricated. No real customer data, no real bookings,
//    no real WhatsApp threads, no real cleaner assignments.
// 3. The shipping dashboard reads from `bookings_v2` (M0-005 work) and
//    `conversations_v2` (M0-005 work). This file does NOT feed the API.
// 4. To remove all mock data from the bundle, delete this file and the
//    `service-agent/public/m0-004b-design/` directory. The shipping dashboard
//    under `service-agent/public/index.html` is unaffected.
// 5. Status values mirror the M0 schema enum
//    (bookings_v2.status: 'QUOTED' | 'COLLECTING_INFO' | 'NEEDS_HUMAN' |
//    'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' |
//    'ABANDONED' | 'NO_SHOW'). Payment values mirror
//    (payments.status: 'UNPAID' | 'PAYMENT_INSTRUCTIONS_SENT' |
//    'RECEIVED_PENDING_REVIEW' | 'VERIFIED' | 'REJECTED'). The UI must
//    NEVER mark a payment as VERIFIED — only an authenticated owner
//    action does that (M0-006).
// ============================================================================

export const DESIGN_BANNER = {
  show: true,
  text: 'DESIGN PREVIEW — data here is fake. Not connected to the live backend.'
};

// ---- Today's bookings ------------------------------------------------------
// What the owner sees when they open the dashboard in the morning.
// 4 real-ish bookings + 1 placeholder for a just-arrived COLLECTING_INFO
// intake that needs the team to finish collection.
export const TODAY_BOOKINGS = [
  {
    id: 'bk_001',
    publicRef: 'CSR-A4F2',
    customer: { name: 'Ahmed Samir', phone: '+20 100 123 4567' },
    area: 'El Gouna',
    locationType: 'home',
    car: 'Toyota Corolla 2021 — silver',
    servicePackage: { id: 'smart', name: 'Smart Plan' },
    scheduledStart: '2026-06-16T09:00:00+02:00',
    durationMinutes: 60,
    status: 'QUOTED',
    paymentStatus: 'PAYMENT_INSTRUCTIONS_SENT',
    notes: 'Gate code 4421, dog in the garden, please call on arrival.'
  },
  {
    id: 'bk_002',
    publicRef: 'CSR-B7C1',
    customer: { name: 'Lina Adel', phone: '+20 122 765 4321' },
    area: 'Hurghada',
    locationType: 'hotel',
    car: 'Hyundai Tucson 2022 — white',
    servicePackage: { id: 'trial', name: 'Trial Wash' },
    scheduledStart: '2026-06-16T10:30:00+02:00',
    durationMinutes: 60,
    status: 'CONFIRMED',
    paymentStatus: 'VERIFIED',
    notes: 'Room 412, hotel valet will hand over keys.'
  },
  {
    id: 'bk_003',
    publicRef: 'CSR-D9E3',
    customer: { name: 'Mostafa Hany', phone: '+20 109 988 7766' },
    area: 'Sahl Hasheesh',
    locationType: 'compound',
    car: 'BMW X5 2023 — black',
    servicePackage: { id: 'premium', name: 'Premium Plan' },
    scheduledStart: '2026-06-16T13:00:00+02:00',
    durationMinutes: 90,
    status: 'IN_PROGRESS',
    paymentStatus: 'VERIFIED',
    notes: 'Compound map: gate 3, building C, ground floor.',
    assignedCleanerId: 'cl_002'
  },
  {
    id: 'bk_004',
    publicRef: 'CSR-F0A1',
    customer: { name: 'Yara Mostafa', phone: '+20 111 222 3333' },
    area: 'Hurghada',
    locationType: 'office',
    car: 'Kia Picanto 2019 — red',
    servicePackage: { id: 'trial', name: 'Trial Wash' },
    scheduledStart: '2026-06-16T15:00:00+02:00',
    durationMinutes: 45,
    status: 'COLLECTING_INFO',
    paymentStatus: null, // no payment row for COLLECTING_INFO
    missingFields: ['date'],
    notes: 'Customer asked for "next available afternoon" — needs a specific date.'
  },
  {
    id: 'bk_005',
    publicRef: 'CSR-G2D8',
    customer: { name: 'Karim Nabil', phone: '+20 100 555 8844' },
    area: 'El Gouna',
    locationType: 'marina',
    car: 'Mercedes C200 2020 — grey',
    servicePackage: { id: 'smart', name: 'Smart Plan' },
    scheduledStart: '2026-06-16T16:30:00+02:00',
    durationMinutes: 60,
    status: 'QUOTED',
    paymentStatus: 'UNPAID',
    notes: ''
  }
];

// ---- Live inbox ------------------------------------------------------------
// Recent chat-style messages across all channels. The full chatbot-inbox UI
// is owned by the chatbot team. This is a 1-line summary strip on the
// dashboard top.
export const LIVE_INBOX = [
  {
    id: 'msg_001',
    channel: 'WHATSAPP',
    customer: { name: 'Ahmed Samir', phone: '+20 100 123 4567' },
    preview: 'هل ممكن نغير الموعد لبكرا بدل النهاردة؟',
    timestamp: '2026-06-15T23:18:00+02:00',
    unread: true
  },
  {
    id: 'msg_002',
    channel: 'WHATSAPP',
    customer: { name: 'Lina Adel', phone: '+20 122 765 4321' },
    preview: 'Thanks, see you tomorrow morning!',
    timestamp: '2026-06-15T22:42:00+02:00',
    unread: false
  },
  {
    id: 'msg_003',
    channel: 'CHATBOT',
    customer: { name: 'Visitor 8842', phone: null },
    preview: 'I want to book a wash in El Gouna next week',
    timestamp: '2026-06-15T22:05:00+02:00',
    unread: true
  },
  {
    id: 'msg_004',
    channel: 'EMAIL',
    customer: { name: 'info@redseahotel.com', phone: null },
    preview: 'Fleet partnership proposal — monthly plan for 12 cars',
    timestamp: '2026-06-15T20:11:00+02:00',
    unread: false
  }
];

// ---- Calendar / booking board ----------------------------------------------
// 1-day window for the board. Real product would support week / month and
// drag-to-reschedule. M0-005 owns the data layer.
export const CALENDAR_BOARD = {
  date: '2026-06-16',
  slots: [
    { hour: '09:00', bookings: ['CSR-A4F2'] },
    { hour: '10:00', bookings: [] },
    { hour: '10:30', bookings: ['CSR-B7C1'] },
    { hour: '11:00', bookings: [] },
    { hour: '11:30', bookings: [] },
    { hour: '12:00', bookings: [] },
    { hour: '13:00', bookings: ['CSR-D9E3'] },
    { hour: '13:30', bookings: ['CSR-D9E3 (cont.)'] },
    { hour: '14:00', bookings: [] },
    { hour: '14:30', bookings: [] },
    { hour: '15:00', bookings: ['CSR-F0A1 (collecting-info)'] },
    { hour: '15:30', bookings: [] },
    { hour: '16:00', bookings: [] },
    { hour: '16:30', bookings: ['CSR-G2D8'] },
    { hour: '17:00', bookings: [] }
  ]
};

// ---- Payment review --------------------------------------------------------
// Queue of payments awaiting owner verification. M0-006 will read this from
// `payments` and `payment_events`.
export const PAYMENT_REVIEW_QUEUE = [
  {
    id: 'pay_001',
    bookingId: 'bk_005',
    publicRef: 'CSR-G2D8',
    customer: { name: 'Karim Nabil', phone: '+20 100 555 8844' },
    amount: 300,
    currency: 'EGP',
    method: 'INSTAPAY',
    status: 'RECEIVED_PENDING_REVIEW',
    receivedAt: '2026-06-15T22:48:00+02:00',
    note: 'Customer sent InstaPay screenshot, awaiting owner confirmation.'
  },
  {
    id: 'pay_002',
    bookingId: 'bk_001',
    publicRef: 'CSR-A4F2',
    customer: { name: 'Ahmed Samir', phone: '+20 100 123 4567' },
    amount: 300,
    currency: 'EGP',
    method: 'VODAFONE_CASH',
    status: 'RECEIVED_PENDING_REVIEW',
    receivedAt: '2026-06-15T20:12:00+02:00',
    note: 'Vodafone Cash reference: 8XQ-441.'
  }
];

// ---- Cleaner assignment ----------------------------------------------------
// Cleaners on shift today. The owner uses this to assign / re-assign
// bookings. Status values are illustrative — the real schema uses the
// `assignments` table (M0-007).
export const CLEANERS = [
  {
    id: 'cl_001',
    name: 'Hossam Ezzat',
    shift: { start: '08:00', end: '16:00' },
    status: 'on-shift',
    assignedBookingIds: [],
    photo: null
  },
  {
    id: 'cl_002',
    name: 'Mahmoud Salem',
    shift: { start: '12:00', end: '20:00' },
    status: 'on-shift',
    assignedBookingIds: ['bk_003'],
    photo: null
  },
  {
    id: 'cl_003',
    name: 'Tarek Anis',
    shift: { start: '08:00', end: '16:00' },
    status: 'on-shift',
    assignedBookingIds: [],
    photo: null
  },
  {
    id: 'cl_004',
    name: 'Sara Magdy',
    shift: { start: '14:00', end: '22:00' },
    status: 'off-shift',
    assignedBookingIds: [],
    photo: null
  }
];

// ---- AI autopilot control --------------------------------------------------
// Owner toggles autopilot. When OFF, all incoming web-form and WhatsApp
// messages route to the human inbox.
export const AI_AUTOPILOT = {
  enabled: true,
  since: '2026-06-01T08:00:00+02:00',
  handledLast7Days: 38,
  escalatedLast7Days: 4,
  models: [
    { id: 'minimax', label: 'Primary', role: 'intake + booking' },
    { id: 'gemini', label: 'Fallback', role: 'intake + booking' },
    { id: 'rulebased', label: 'Last resort', role: 'fallback' }
  ],
  channels: [
    { id: 'web_form', label: 'Landing form', routed: 'intake-agent' },
    { id: 'whatsapp', label: 'WhatsApp', routed: 'intake-agent' },
    { id: 'chatbot', label: 'Website chatbot', routed: 'router-agent' },
    { id: 'email', label: 'Email', routed: 'human-inbox' }
  ]
};

// ---- Human takeover --------------------------------------------------------
// Active takeover sessions. When autopilot is OFF or a booking escalates,
// a human (owner / operations) takes the thread.
export const HUMAN_TAKEOVERS = [
  {
    id: 'tk_001',
    channel: 'WHATSAPP',
    customer: { name: 'Yara Mostafa', phone: '+20 111 222 3333' },
    reason: 'Collecting-info — needs date confirmation',
    startedAt: '2026-06-15T22:30:00+02:00',
    owner: 'ops-lead'
  },
  {
    id: 'tk_002',
    channel: 'EMAIL',
    customer: { name: 'info@redseahotel.com', phone: null },
    reason: 'Fleet partnership inquiry',
    startedAt: '2026-06-15T20:11:00+02:00',
    owner: 'owner'
  }
];

// ---- Empty / loading / error UI strings -------------------------------------
// Centralized so the design team can review them in one place. The shipping
// dashboard will localize these via the i18n bundle.
export const UI_STATES = {
  loading: 'Loading the latest data…',
  emptyBookings: {
    title: 'No bookings for today yet',
    body: 'New web-form and WhatsApp bookings will appear here as they arrive.'
  },
  emptyInbox: {
    title: 'Inbox is clear',
    body: 'You answered every conversation. Nice work.'
  },
  emptyCalendar: {
    title: 'Calendar is empty for this day',
    body: 'Use the date picker to jump to another day.'
  },
  emptyPayments: {
    title: 'No payments waiting for review',
    body: 'Verified and rejected payments move to the audit log.'
  },
  emptyCleaners: {
    title: 'No cleaners on shift',
    body: 'Add a cleaner or change the shift window to start assigning bookings.'
  },
  error: {
    title: 'We couldn\'t load this section',
    body: 'Try refreshing in a moment. If the problem continues, check the live server logs.'
  }
};

// ---- Status / payment labels (used by the status pills) -------------------
export const STATUS_LABELS = {
  QUOTED: 'Quoted',
  COLLECTING_INFO: 'Collecting info',
  NEEDS_HUMAN: 'Needs human',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  ABANDONED: 'Abandoned',
  NO_SHOW: 'No show'
};

export const PAYMENT_LABELS = {
  UNPAID: 'Unpaid',
  PAYMENT_INSTRUCTIONS_SENT: 'Instructions sent',
  RECEIVED_PENDING_REVIEW: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected'
};
