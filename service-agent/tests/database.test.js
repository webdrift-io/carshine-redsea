/**
 * Tests for database.js
 * Covers: CRUD operations, transactions, slot availability, migrations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Database Module', () => {
  let db;
  let testCounter = 0;
  
  beforeEach(async () => {
    // Reset module cache to pick up fresh database
    delete require.cache[require.resolve('../database')];
    delete require.cache[require.resolve('better-sqlite3')];
    // Use a unique file path for each test
    testCounter++;
    const tmpPath = path.join(process.env.TEMP || '/tmp', `test_db_${process.pid}_${testCounter}_${Date.now()}.sqlite`);
    process.env.DATABASE_PATH = tmpPath;
    // Re-require to trigger fresh DB init
    db = require('../database');
    // Clean up file after each test
    return () => {
      try { fs.unlinkSync(tmpPath); } catch (e) { void e; }
    };
  });

  describe('Bookings', () => {
    it('creates and retrieves a booking', () => {
      const booking = {
        id: 'b_test_1',
        customerName: 'Test User',
        phone: '+201****0000',
        area: 'El Gouna',
        carType: 'BMW X5',
        package: 'Trial Wash - 150 EGP',
        preferredDate: '2026-07-01',
        preferredTime: '10:00',
        location: 'Test Location',
        paymentMethod: 'Cash',
        status: 'pending',
        notes: ''
      };
      
      db.createBooking(booking, null);
      const retrieved = db.getBooking('b_test_1');
      
      expect(retrieved).toBeTruthy();
      expect(retrieved.customerName).toBe('Test User');
      expect(retrieved.area).toBe('El Gouna');
      expect(retrieved.status).toBe('pending');
    });

    it('rejects duplicate booking IDs', () => {
      const booking = {
        id: 'b_duplicate',
        customerName: 'Test',
        phone: '+201****0000',
        area: 'El Gouna',
        carType: 'BMW',
        package: 'Trial',
        preferredDate: '2026-07-01',
        preferredTime: '10:00',
        location: 'Test',
        paymentMethod: 'Cash',
        status: 'pending',
        notes: ''
      };
      
      db.createBooking(booking, null);
      
      expect(() => db.createBooking(booking, null)).toThrow();
    });

    it('retrieves all bookings sorted by date', () => {
      const b1 = createSampleBooking('b_sort_1', '2026-07-01');
      const b2 = createSampleBooking('b_sort_2', '2026-06-15');
      
      db.createBooking(b1, null);
      db.createBooking(b2, null);
      
      const all = db.getAllBookings();
      expect(all.length).toBe(2);
      // Most recent createdAt first
      expect(all[0].id).toBe('b_sort_2');
    });

    it('filters bookings by status', () => {
      const b1 = { ...createSampleBooking('b_filt_1'), status: 'pending' };
      const b2 = { ...createSampleBooking('b_filt_2'), status: 'confirmed' };
      
      db.createBooking(b1, null);
      db.createBooking(b2, null);
      
      const pending = db.getBookingsByStatus('pending');
      const confirmed = db.getBookingsByStatus('confirmed');
      
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe('b_filt_1');
      expect(confirmed.length).toBe(1);
      expect(confirmed[0].id).toBe('b_filt_2');
    });
  });

  describe('Slot Availability', () => {
    it('allows bookings within operating hours (09:00-17:00)', () => {
      expect(db.isSlotAvailable('2026-07-01', '09:00')).toBe(true);
      expect(db.isSlotAvailable('2026-07-01', '12:00')).toBe(true);
      expect(db.isSlotAvailable('2026-07-01', '17:00')).toBe(true);
    });

    it('rejects bookings outside operating hours', () => {
      expect(db.isSlotAvailable('2026-07-01', '08:00')).toBe(false);
      expect(db.isSlotAvailable('2026-07-01', '18:00')).toBe(false);
      expect(db.isSlotAvailable('2026-07-01', '20:00')).toBe(false);
    });

    it('limits to 2 bookings per hour', () => {
      const date = '2026-07-01';
      const time = '10:00';
      
      db.createBooking({ ...createSampleBooking('b_slot_1', date, time) }, null);
      expect(db.isSlotAvailable(date, time)).toBe(true);
      
      db.createBooking({ ...createSampleBooking('b_slot_2', date, time) }, null);
      expect(db.isSlotAvailable(date, time)).toBe(false);
    });

    it('treats different hours independently', () => {
      const date = '2026-07-01';
      
      db.createBooking({ ...createSampleBooking('b_hour_1', date, '10:00') }, null);
      db.createBooking({ ...createSampleBooking('b_hour_2', date, '10:00') }, null);
      
      // 10:00 is full, 11:00 should be available
      expect(db.isSlotAvailable(date, '10:00')).toBe(false);
      expect(db.isSlotAvailable(date, '11:00')).toBe(true);
    });
  });

  describe('Booking Approval (Transaction)', () => {
    it('approves booking and creates calendar event atomically', () => {
      const booking = createSampleBooking('b_approve', '2026-07-01', '10:00');
      db.createBooking(booking, null);
      
      const result = db.approveBooking('b_approve');
      
      expect(result.booking.status).toBe('confirmed');
      expect(result.calendarEvent).toBeTruthy();
      expect(result.calendarEvent.bookingId).toBe('b_approve');
      expect(result.calendarEvent.customerName).toBe(booking.customerName);
      
      // Verify calendar was created
      const cal = db.getCalendarByBooking('b_approve');
      expect(cal).toBeTruthy();
      expect(cal.customerName).toBe(booking.customerName);
    });

    it('rejects booking and removes any calendar event', () => {
      const booking = createSampleBooking('b_reject', '2026-07-01', '10:00');
      db.createBooking(booking, null);
      db.approveBooking('b_reject');  // First create calendar
      db.rejectBooking('b_reject');   // Then reject
      
      const retrieved = db.getBooking('b_reject');
      expect(retrieved.status).toBe('rejected');
      
      const cal = db.getCalendarByBooking('b_reject');
      expect(cal).toBeUndefined();
    });

    it('throws when approving non-existent booking', () => {
      expect(() => db.approveBooking('nonexistent')).toThrow();
    });
  });

  describe('Chat Sessions', () => {
    it('creates chat session with initial message', () => {
      const session = {
        id: 'session_test_1',
        customerName: 'Test',
        phone: '+201****0000',
        area: '',
        carType: '',
        package: '',
        preferredDate: '',
        preferredTime: '',
        location: '',
        paymentMethod: '',
        status: 'active',
        language: 'en',
        lastAskedField: 'customerName',
        bookingDetails: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      db.createChat(session, { 
        text: 'Hello', 
        timestamp: new Date().toISOString() 
      });
      
      const retrieved = db.getChat('session_test_1');
      expect(retrieved).toBeTruthy();
      expect(retrieved.messages.length).toBe(1);
      expect(retrieved.messages[0].text).toBe('Hello');
    });

    it('adds messages to existing session', () => {
      const session = createSampleSession('session_add');
      db.createChat(session, { text: 'First', timestamp: new Date().toISOString() });
      
      db.addMessage('session_add', 'customer', 'Second', new Date().toISOString());
      db.addMessage('session_add', 'bot', 'Reply', new Date().toISOString());
      
      const retrieved = db.getChat('session_add');
      expect(retrieved.messages.length).toBe(3);
    });

    it('deletes chat with cascade to messages', () => {
      const session = createSampleSession('session_delete');
      db.createChat(session, { text: 'Hi', timestamp: new Date().toISOString() });
      db.addMessage('session_delete', 'bot', 'Welcome', new Date().toISOString());
      
      db.deleteChat('session_delete');
      
      const retrieved = db.getChat('session_delete');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Admin Credentials', () => {
    it('stores and retrieves admin password hash', () => {
      const hash = '$2a$12$testhashvalue...';
      db.setAdminPassword('admin@test.com', hash);
      
      const admin = db.getAdmin('admin@test.com');
      expect(admin).toBeTruthy();
      expect(admin.passwordHash).toBe(hash);
    });

    it('upserts on conflict', () => {
      db.setAdminPassword('admin@test.com', 'hash1');
      db.setAdminPassword('admin@test.com', 'hash2');
      
      const admin = db.getAdmin('admin@test.com');
      expect(admin.passwordHash).toBe('hash2');
    });
  });

  describe('Social Posts', () => {
    it('creates and retrieves post with JSON fields', () => {
      const post = {
        id: 'post_test_1',
        title: 'Test Post',
        caption: 'Test caption',
        platforms: ['tiktok', 'instagram'],
        scheduledAt: new Date().toISOString(),
        status: 'scheduled',
        privacyLevel: 'SELF_ONLY',
        images: ['slide1.png'],
        meta: { test: true },
        createdAt: new Date().toISOString()
      };
      
      db.createSocialPost(post);
      
      const retrieved = db.getSocialPost('post_test_1');
      expect(retrieved).toBeTruthy();
      expect(retrieved.platforms).toEqual(['tiktok', 'instagram']);
      expect(retrieved.images).toEqual(['slide1.png']);
      expect(retrieved.meta).toEqual({ test: true });
    });

    it('records and retrieves analytics', () => {
      const postId = 'post_analytics';
      db.createSocialPost({
        id: postId,
        title: '',
        caption: '',
        platforms: ['tiktok'],
        status: 'posted',
        createdAt: new Date().toISOString()
      });
      
      db.recordAnalytics({
        postId,
        platform: 'tiktok',
        views: 1000,
        likes: 50,
        comments: 5,
        shares: 2,
        recordedAt: new Date().toISOString()
      });
      
      const analytics = db.getAnalytics(postId);
      expect(analytics.length).toBe(1);
      expect(analytics[0].views).toBe(1000);
      expect(analytics[0].likes).toBe(50);
    });
  });
});

// ============================================================================
// HELPERS
// ============================================================================

function createSampleBooking(id, date = '2026-07-01', time = '10:00') {
  return {
    id,
    customerName: 'Test User ' + id,
    phone: '+201****0000',
    area: 'El Gouna',
    carType: 'BMW X5',
    package: 'Trial Wash - 150 EGP',
    preferredDate: date,
    preferredTime: time,
    location: 'Test Location',
    paymentMethod: 'Cash',
    status: 'pending',
    notes: ''
  };
}

function createSampleSession(id) {
  return {
    id,
    customerName: 'Test',
    phone: '+201****0000',
    area: '',
    carType: '',
    package: '',
    preferredDate: '',
    preferredTime: '',
    location: '',
    paymentMethod: '',
    status: 'active',
    language: 'en',
    lastAskedField: 'customerName',
    bookingDetails: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
