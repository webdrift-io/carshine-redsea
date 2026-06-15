/**
 * Database Module - SQLite with better-sqlite3
 * Handles bookings, calendar events, chats, and admin credentials
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Allow override via env var (for tests)
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================================
// PREPARED STATEMENTS (initialized after schema)
// ============================================================================

let stmtGetBooking, stmtGetAllBookings, stmtGetBookingsByStatus, stmtGetBookingsByDate, stmtGetBookingsByPhone;
let stmtInsertBooking, stmtUpdateBooking, stmtDeleteBooking, stmtCountBookingsByDateHour;
let stmtGetCalendarEvent, stmtGetCalendarByBooking, stmtGetAllCalendar, stmtGetCalendarByDate;
let stmtInsertCalendar, stmtUpdateCalendar, stmtDeleteCalendar, stmtDeleteCalendarByBooking;
let stmtGetChat, stmtGetAllChats, stmtGetChatsByStatus, stmtInsertChat, stmtUpdateChat, stmtDeleteChat;
let stmtGetMessages, stmtInsertMessage, stmtDeleteMessagesBySession;
let stmtGetAdmin, stmtUpsertAdmin;
let stmtGetSocialPost, stmtGetAllSocialPosts, stmtGetSocialPostsByStatus;
let stmtInsertSocialPost, stmtUpdateSocialPost, stmtDeleteSocialPost;
let stmtInsertAnalytics, stmtGetAnalytics;

function initPreparedStatements() {
  // Bookings
  stmtGetBooking = db.prepare('SELECT * FROM bookings WHERE id = ?');
  stmtGetAllBookings = db.prepare('SELECT * FROM bookings ORDER BY createdAt DESC');
  stmtGetBookingsByStatus = db.prepare('SELECT * FROM bookings WHERE status = ? ORDER BY createdAt DESC');
  stmtGetBookingsByDate = db.prepare('SELECT * FROM bookings WHERE preferredDate = ? ORDER BY preferredTime');
  stmtGetBookingsByPhone = db.prepare('SELECT * FROM bookings WHERE phone = ? ORDER BY createdAt DESC');
  stmtInsertBooking = db.prepare(`
    INSERT INTO bookings (id, customerName, phone, area, carType, package, preferredDate, preferredTime, location, paymentMethod, status, notes, createdAt, updatedAt, chatSessionId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmtUpdateBooking = db.prepare(`
    UPDATE bookings SET 
      customerName = ?, phone = ?, area = ?, carType = ?, package = ?,
      preferredDate = ?, preferredTime = ?, location = ?, paymentMethod = ?,
      status = ?, notes = ?, updatedAt = ?, approvedAt = ?, rejectedAt = ?, chatSessionId = ?
    WHERE id = ?
  `);
  stmtDeleteBooking = db.prepare('DELETE FROM bookings WHERE id = ?');
  stmtCountBookingsByDateHour = db.prepare(`
    SELECT COUNT(*) as count FROM bookings 
    WHERE preferredDate = ? AND CAST(substr(preferredTime, 1, 2) AS INTEGER) = ?
  `);

  // Calendar
  stmtGetCalendarEvent = db.prepare('SELECT * FROM calendar_events WHERE id = ?');
  stmtGetCalendarByBooking = db.prepare('SELECT * FROM calendar_events WHERE bookingId = ?');
  stmtGetAllCalendar = db.prepare('SELECT * FROM calendar_events ORDER BY start');
  stmtGetCalendarByDate = db.prepare('SELECT * FROM calendar_events WHERE date(start) = ? ORDER BY start');
  stmtInsertCalendar = db.prepare(`
    INSERT INTO calendar_events (id, bookingId, start, customerName, carType, area, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmtUpdateCalendar = db.prepare(`
    UPDATE calendar_events SET start = ?, customerName = ?, carType = ?, area = ?, status = ?
    WHERE id = ?
  `);
  stmtDeleteCalendar = db.prepare('DELETE FROM calendar_events WHERE id = ?');
  stmtDeleteCalendarByBooking = db.prepare('DELETE FROM calendar_events WHERE bookingId = ?');

  // Chat Sessions
  stmtGetChat = db.prepare('SELECT * FROM chat_sessions WHERE id = ?');
  stmtGetAllChats = db.prepare('SELECT * FROM chat_sessions ORDER BY updatedAt DESC');
  stmtGetChatsByStatus = db.prepare('SELECT * FROM chat_sessions WHERE status = ? ORDER BY updatedAt DESC');
  stmtInsertChat = db.prepare(`
    INSERT INTO chat_sessions (id, customerName, phone, area, carType, package, preferredDate, preferredTime, location, paymentMethod, status, language, lastAskedField, bookingDetails, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmtUpdateChat = db.prepare(`
    UPDATE chat_sessions SET 
      customerName = ?, phone = ?, area = ?, carType = ?, package = ?,
      preferredDate = ?, preferredTime = ?, location = ?, paymentMethod = ?,
      status = ?, language = ?, lastAskedField = ?, bookingDetails = ?, updatedAt = ?
    WHERE id = ?
  `);
  stmtDeleteChat = db.prepare('DELETE FROM chat_sessions WHERE id = ?');

  // Chat Messages
  stmtGetMessages = db.prepare('SELECT * FROM chat_messages WHERE sessionId = ? ORDER BY timestamp');
  stmtInsertMessage = db.prepare('INSERT INTO chat_messages (sessionId, sender, text, timestamp) VALUES (?, ?, ?, ?)');
  stmtDeleteMessagesBySession = db.prepare('DELETE FROM chat_messages WHERE sessionId = ?');

  // Admin Credentials
  stmtGetAdmin = db.prepare('SELECT * FROM admin_credentials WHERE email = ?');
  stmtUpsertAdmin = db.prepare(`
    INSERT INTO admin_credentials (email, passwordHash, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET passwordHash = excluded.passwordHash, updatedAt = excluded.updatedAt
  `);

  // Social Posts
  stmtGetSocialPost = db.prepare('SELECT * FROM social_posts WHERE id = ?');
  stmtGetAllSocialPosts = db.prepare('SELECT * FROM social_posts ORDER BY createdAt DESC');
  stmtGetSocialPostsByStatus = db.prepare('SELECT * FROM social_posts WHERE status = ? ORDER BY createdAt DESC');
  stmtInsertSocialPost = db.prepare(`
    INSERT INTO social_posts (id, title, caption, platforms, scheduledAt, postedAt, status, privacyLevel, images, meta, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmtUpdateSocialPost = db.prepare(`
    UPDATE social_posts SET 
      title = ?, caption = ?, platforms = ?, scheduledAt = ?, postedAt = ?,
      status = ?, privacyLevel = ?, images = ?, meta = ?
    WHERE id = ?
  `);
  stmtDeleteSocialPost = db.prepare('DELETE FROM social_posts WHERE id = ?');

  // Social Analytics
  stmtInsertAnalytics = db.prepare(`
    INSERT INTO social_analytics (postId, platform, views, likes, comments, shares, recordedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmtGetAnalytics = db.prepare('SELECT * FROM social_analytics WHERE postId = ? ORDER BY recordedAt DESC');
}

// ============================================================================
// SCHEMA INITIALIZATION
// ============================================================================

function initSchema() {
  // Bookings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      customerName TEXT NOT NULL,
      phone TEXT NOT NULL,
      area TEXT NOT NULL,
      carType TEXT NOT NULL,
      package TEXT NOT NULL,
      preferredDate TEXT NOT NULL,
      preferredTime TEXT NOT NULL,
      location TEXT NOT NULL,
      paymentMethod TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      approvedAt TEXT,
      rejectedAt TEXT,
      chatSessionId TEXT
    );
  `);

  // Calendar events table (synced from bookings on approve)
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      bookingId TEXT NOT NULL UNIQUE,
      start TEXT NOT NULL,
      customerName TEXT NOT NULL,
      carType TEXT NOT NULL,
      area TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE CASCADE
    );
  `);

  // Chat sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      customerName TEXT,
      phone TEXT,
      area TEXT,
      carType TEXT,
      package TEXT,
      preferredDate TEXT,
      preferredTime TEXT,
      location TEXT,
      paymentMethod TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      language TEXT NOT NULL DEFAULT 'en',
      lastAskedField TEXT,
      bookingDetails TEXT, -- JSON
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  // Chat messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);

  // Admin credentials table
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      email TEXT PRIMARY KEY,
      passwordHash TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  // Social media posts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      title TEXT,
      caption TEXT,
      platforms TEXT NOT NULL, -- JSON array
      scheduledAt TEXT,
      postedAt TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      privacyLevel TEXT DEFAULT 'SELF_ONLY',
      images TEXT, -- JSON array
      meta TEXT, -- JSON
      createdAt TEXT NOT NULL
    );
  `);

  // Social media analytics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId TEXT NOT NULL,
      platform TEXT NOT NULL,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      recordedAt TEXT NOT NULL,
      FOREIGN KEY (postId) REFERENCES social_posts(id) ON DELETE CASCADE
    );
  `);

  // Indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(preferredDate);
    CREATE INDEX IF NOT EXISTS idx_bookings_area ON bookings(area);
    CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(createdAt);
    CREATE INDEX IF NOT EXISTS idx_calendar_booking ON calendar_events(bookingId);
    CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(start);
    CREATE INDEX IF NOT EXISTS idx_chat_status ON chat_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_chat_updated ON chat_sessions(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(sessionId);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON chat_messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
    CREATE INDEX IF NOT EXISTS idx_social_analytics_post ON social_analytics(postId);
  `);

  console.log('[DB] Schema initialized');
  
  // Initialize prepared statements after schema
  initPreparedStatements();
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

// Transaction: Approve booking (update booking + insert calendar)
const approveBookingTransaction = db.transaction((bookingId, approvedAt) => {
  const updatedAt = new Date().toISOString();
  
  // Get booking details first
  const booking = stmtGetBooking.get(bookingId);
  if (!booking) throw new Error('Booking not found');
  
  // Update booking status only
  stmtUpdateBooking.run(
    booking.customerName,
    booking.phone,
    booking.area,
    booking.carType,
    booking.package,
    booking.preferredDate,
    booking.preferredTime,
    booking.location,
    booking.paymentMethod,
    'confirmed',
    booking.notes,
    updatedAt,
    approvedAt,
    booking.rejectedAt,
    booking.chatSessionId,
    bookingId
  );
  
  // Insert calendar event
  const calEvent = {
    id: 'cal_' + Date.now(),
    bookingId,
    start: `${booking.preferredDate}T${booking.preferredTime}:00`,
    customerName: booking.customerName,
    carType: booking.carType,
    area: booking.area,
    status: 'confirmed',
    createdAt: updatedAt
  };
  stmtInsertCalendar.run(
    calEvent.id, calEvent.bookingId, calEvent.start,
    calEvent.customerName, calEvent.carType, calEvent.area,
    calEvent.status, calEvent.createdAt
  );
  
  return { booking: { ...booking, status: 'confirmed', updatedAt, approvedAt }, calendarEvent: calEvent };
});

// Transaction: Reject booking
const rejectBookingTransaction = db.transaction((bookingId, rejectedAt) => {
  const updatedAt = new Date().toISOString();
  
  // Get booking details first
  const booking = stmtGetBooking.get(bookingId);
  if (!booking) throw new Error('Booking not found');
  
  // Update booking status only
  stmtUpdateBooking.run(
    booking.customerName,
    booking.phone,
    booking.area,
    booking.carType,
    booking.package,
    booking.preferredDate,
    booking.preferredTime,
    booking.location,
    booking.paymentMethod,
    'rejected',
    booking.notes,
    updatedAt,
    booking.approvedAt,
    rejectedAt,
    booking.chatSessionId,
    bookingId
  );
  
  // Remove calendar event if exists
  stmtDeleteCalendarByBooking.run(bookingId);
  
  return { success: true };
});

// Transaction: Create booking with chat session
const createBookingTransaction = db.transaction((booking, chatSessionId) => {
  const now = new Date().toISOString();
  stmtInsertBooking.run(
    booking.id, booking.customerName, booking.phone, booking.area,
    booking.carType, booking.package, booking.preferredDate,
    booking.preferredTime, booking.location, booking.paymentMethod,
    booking.status, booking.notes || '', now, now, chatSessionId
  );
  return booking;
});

// Transaction: Create chat session with initial message
const createChatTransaction = db.transaction((session, initialMessage) => {
  const now = new Date().toISOString();
  stmtInsertChat.run(
    session.id, session.customerName, session.phone, session.area,
    session.carType, session.package, session.preferredDate,
    session.preferredTime, session.location, session.paymentMethod,
    session.status, session.language, session.lastAskedField,
    JSON.stringify(session.bookingDetails || {}), now, now
  );
  stmtInsertMessage.run(session.id, 'customer', initialMessage.text, initialMessage.timestamp);
  return session;
});

// Initialize schema and prepared statements on load
initSchema();

// ============================================================================
// PUBLIC API
// ============================================================================

module.exports = {
  db,
  
  // Bookings
  getBooking: (id) => stmtGetBooking.get(id),
  getAllBookings: () => stmtGetAllBookings.all(),
  getBookingsByStatus: (status) => stmtGetBookingsByStatus.all(status),
  getBookingsByDate: (date) => stmtGetBookingsByDate.all(date),
  getBookingsByPhone: (phone) => stmtGetBookingsByPhone.all(phone),
  createBooking: (booking, chatSessionId) => createBookingTransaction(booking, chatSessionId),
  updateBooking: (id, data) => {
    const now = new Date().toISOString();
    const existing = stmtGetBooking.get(id);
    if (!existing) return null;
    stmtUpdateBooking.run(
      data.customerName ?? existing.customerName,
      data.phone ?? existing.phone,
      data.area ?? existing.area,
      data.carType ?? existing.carType,
      data.package ?? existing.package,
      data.preferredDate ?? existing.preferredDate,
      data.preferredTime ?? existing.preferredTime,
      data.location ?? existing.location,
      data.paymentMethod ?? existing.paymentMethod,
      data.status ?? existing.status,
      data.notes ?? existing.notes,
      now,
      data.status === 'confirmed' ? now : existing.approvedAt,
      data.status === 'rejected' ? now : existing.rejectedAt,
      data.chatSessionId ?? existing.chatSessionId,
      id
    );
    return { ...existing, ...data, updatedAt: now };
  },
  deleteBooking: (id) => stmtDeleteBooking.run(id),
  approveBooking: (id) => approveBookingTransaction(id, new Date().toISOString()),
  rejectBooking: (id) => rejectBookingTransaction(id, new Date().toISOString()),
  isSlotAvailable: (date, time) => {
    const hour = parseInt(time.split(':')[0], 10);
    if (hour < 9 || hour > 17) return false;
    const row = stmtCountBookingsByDateHour.get(date, hour);
    return row.count < 2;
  },
  
  // Calendar
  getCalendarEvent: (id) => stmtGetCalendarEvent.get(id),
  getCalendarByBooking: (bookingId) => stmtGetCalendarByBooking.get(bookingId),
  getAllCalendar: () => stmtGetAllCalendar.all(),
  getCalendarByDate: (date) => stmtGetCalendarByDate.all(date),
  insertCalendar: (event) => stmtInsertCalendar.run(
    event.id, event.bookingId, event.start,
    event.customerName, event.carType, event.area,
    event.status, event.createdAt
  ),
  updateCalendar: (id, data) => {
    const existing = stmtGetCalendarEvent.get(id);
    if (!existing) return null;
    stmtUpdateCalendar.run(
      data.start ?? existing.start,
      data.customerName ?? existing.customerName,
      data.carType ?? existing.carType,
      data.area ?? existing.area,
      data.status ?? existing.status,
      id
    );
    return { ...existing, ...data };
  },
  deleteCalendar: (id) => stmtDeleteCalendar.run(id),
  
  // Chat Sessions
  getChat: (id) => {
    const session = stmtGetChat.get(id);
    if (session) {
      session.messages = stmtGetMessages.all(id);
      session.bookingDetails = session.bookingDetails ? JSON.parse(session.bookingDetails) : {};
    }
    return session;
  },
  getAllChats: () => {
    const sessions = stmtGetAllChats.all();
    return sessions.map(s => ({
      ...s,
      bookingDetails: s.bookingDetails ? JSON.parse(s.bookingDetails) : {}
    }));
  },
  getChatsByStatus: (status) => {
    const sessions = stmtGetChatsByStatus.all(status);
    return sessions.map(s => ({
      ...s,
      bookingDetails: s.bookingDetails ? JSON.parse(s.bookingDetails) : {}
    }));
  },
  createChat: (session, initialMessage) => createChatTransaction(session, initialMessage),
  updateChat: (id, data) => {
    const now = new Date().toISOString();
    const existing = stmtGetChat.get(id);
    if (!existing) return null;
    stmtUpdateChat.run(
      data.customerName ?? existing.customerName,
      data.phone ?? existing.phone,
      data.area ?? existing.area,
      data.carType ?? existing.carType,
      data.package ?? existing.package,
      data.preferredDate ?? existing.preferredDate,
      data.preferredTime ?? existing.preferredTime,
      data.location ?? existing.location,
      data.paymentMethod ?? existing.paymentMethod,
      data.status ?? existing.status,
      data.language ?? existing.language,
      data.lastAskedField ?? existing.lastAskedField,
      JSON.stringify(data.bookingDetails ?? existing.bookingDetails),
      now,
      id
    );
    return { ...existing, ...data, updatedAt: now };
  },
  deleteChat: (id) => {
    stmtDeleteMessagesBySession.run(id);
    return stmtDeleteChat.run(id);
  },
  addMessage: (sessionId, sender, text, timestamp) => {
    stmtInsertMessage.run(sessionId, sender, text, timestamp);
  },
  
  // Admin Credentials
  getAdmin: (email) => stmtGetAdmin.get(email),
  setAdminPassword: (email, passwordHash) => stmtUpsertAdmin.run(email, passwordHash, new Date().toISOString()),
  
  // Social Posts
  getSocialPost: (id) => {
    const post = stmtGetSocialPost.get(id);
    if (post) {
      post.platforms = post.platforms ? JSON.parse(post.platforms) : [];
      post.images = post.images ? JSON.parse(post.images) : [];
      post.meta = post.meta ? JSON.parse(post.meta) : {};
    }
    return post;
  },
  getAllSocialPosts: () => {
    const posts = stmtGetAllSocialPosts.all();
    return posts.map(p => ({
      ...p,
      platforms: p.platforms ? JSON.parse(p.platforms) : [],
      images: p.images ? JSON.parse(p.images) : [],
      meta: p.meta ? JSON.parse(p.meta) : {}
    }));
  },
  getSocialPostsByStatus: (status) => {
    const posts = stmtGetSocialPostsByStatus.all(status);
    return posts.map(p => ({
      ...p,
      platforms: p.platforms ? JSON.parse(p.platforms) : [],
      images: p.images ? JSON.parse(p.images) : [],
      meta: p.meta ? JSON.parse(p.meta) : {}
    }));
  },
  createSocialPost: (post) => {
    stmtInsertSocialPost.run(
      post.id, post.title, post.caption, JSON.stringify(post.platforms || []),
      post.scheduledAt, post.postedAt, post.status || 'scheduled',
      post.privacyLevel || 'SELF_ONLY', JSON.stringify(post.images || []),
      JSON.stringify(post.meta || {}), post.createdAt || new Date().toISOString()
    );
    return post;
  },
  updateSocialPost: (id, data) => {
    const existing = stmtGetSocialPost.get(id);
    if (!existing) return null;
    stmtUpdateSocialPost.run(
      data.title ?? existing.title,
      data.caption ?? existing.caption,
      JSON.stringify(data.platforms ?? JSON.parse(existing.platforms || '[]')),
      data.scheduledAt ?? existing.scheduledAt,
      data.postedAt ?? existing.postedAt,
      data.status ?? existing.status,
      data.privacyLevel ?? existing.privacyLevel,
      JSON.stringify(data.images ?? JSON.parse(existing.images || '[]')),
      JSON.stringify(data.meta ?? JSON.parse(existing.meta || '{}')),
      id
    );
    return { ...existing, ...data };
  },
  deleteSocialPost: (id) => stmtDeleteSocialPost.run(id),
  
  // Social Analytics
  recordAnalytics: (data) => stmtInsertAnalytics.run(
    data.postId, data.platform, data.views || 0,
    data.likes || 0, data.comments || 0, data.shares || 0,
    data.recordedAt || new Date().toISOString()
  ),
  getAnalytics: (postId) => stmtGetAnalytics.all(postId),
  
  // Migration helper
  migrateFromJSON: (bookingsFile, calendarFile) => {
    console.log('[DB] Migrating from JSON files...');
    let migrated = { bookings: 0, calendar: 0 };
    
    // Migrate bookings
    if (fs.existsSync(bookingsFile)) {
      const bookingsData = JSON.parse(fs.readFileSync(bookingsFile, 'utf8'));
      for (const b of bookingsData) {
        const exists = stmtGetBooking.get(b.id);
        if (!exists) {
          stmtInsertBooking.run(
            b.id, b.customerName, b.phone, b.area, b.carType, b.package,
            b.preferredDate, b.preferredTime, b.location, b.paymentMethod,
            b.status, b.notes || '', b.createdAt, b.createdAt, b.chatSessionId || null
          );
          migrated.bookings++;
        }
      }
    }
    
    // Migrate calendar
    if (fs.existsSync(calendarFile)) {
      const calendarData = JSON.parse(fs.readFileSync(calendarFile, 'utf8'));
      for (const c of calendarData) {
        const exists = stmtGetCalendarEvent.get(c.id);
        if (!exists) {
          stmtInsertCalendar.run(
            c.id, c.bookingId, c.start, c.customerName, c.carType, c.area, c.status, c.createdAt || new Date().toISOString()
          );
          migrated.calendar++;
        }
      }
    }
    
    console.log(`[DB] Migration complete: ${migrated.bookings} bookings, ${migrated.calendar} calendar events`);
    return migrated;
  }
};