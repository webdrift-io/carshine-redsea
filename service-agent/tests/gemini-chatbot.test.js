/**
 * Tests for gemini-chatbot.js
 * Focuses on testable functions: fallbackResponse, slot checking
 * Skips actual Gemini API calls (requires GEMINI_API_KEY)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the database module
vi.mock('../database', () => ({
  default: {},
  isSlotAvailable: vi.fn((date, time) => {
    const hour = parseInt(time.split(':')[0], 10);
    return hour >= 9 && hour <= 17;
  }),
  getAllBookings: vi.fn(() => []),
  getChatsByStatus: vi.fn(() => []),
  getChat: vi.fn(() => null),
  createChat: vi.fn(),
  addMessage: vi.fn(),
  createBooking: vi.fn(),
  updateChat: vi.fn()
}));

import { fallbackResponse, checkSlotAvailable } from '../gemini-chatbot.js';

describe('fallbackResponse', () => {
  describe('Language Detection', () => {
    it('responds in Arabic to Arabic input', () => {
      const result = fallbackResponse('مرحبا', {});
      // Should contain Arabic characters
      expect(result.REPLY).toMatch(/[\u0600-\u06FF]/);
    });

    it('responds in German to German input', () => {
      const result = fallbackResponse('Hallo, ich möchte buchen', {});
      // Should be in German (no Arabic)
      expect(result.REPLY).not.toMatch(/[\u0600-\u06FF]/);
      expect(result.REPLY.toLowerCase()).toMatch(/willkommen|auto|bitte/i);
    });

    it('responds in English to English input', () => {
      const result = fallbackResponse('Hello', {});
      expect(result.REPLY.toLowerCase()).toMatch(/welcome|hello|help|car/);
    });
  });

  describe('Intent Recognition', () => {
    it('recognizes greetings', () => {
      const en = fallbackResponse('Hi there', {});
      expect(en.HUMAN_NEED).toBe(false);
      expect(en.PENDING_BOOKING).toBeNull();
      expect(en.REPLY.length).toBeGreaterThan(20);
    });

    it('recognizes booking requests', () => {
      const result = fallbackResponse('I want to book a car wash', {});
      expect(result.HUMAN_NEED).toBe(false);
      expect(result.PENDING_BOOKING).toBeNull();
    });

    it('flags cancellation requests for human takeover', () => {
      const result = fallbackResponse('I want to cancel please', {});
      expect(result.HUMAN_NEED).toBe(true);
      expect(result.PENDING_BOOKING).toBeNull();
    });

    it('flags complaints for human takeover', () => {
      const result = fallbackResponse('I have a serious complaint', {});
      expect(result.HUMAN_NEED).toBe(true);
    });

    it('returns error message for unrecognized input', () => {
      const result = fallbackResponse('xyz random gibberish', {});
      expect(result.HUMAN_NEED).toBe(false);
      expect(result.PENDING_BOOKING).toBeNull();
      expect(result.REPLY).toBeTruthy();
    });
  });

  describe('Response Structure', () => {
    it('always returns valid structure', () => {
      const result = fallbackResponse('anything', {});
      expect(result).toHaveProperty('REPLY');
      expect(result).toHaveProperty('PENDING_BOOKING');
      expect(result).toHaveProperty('HUMAN_NEED');
      expect(typeof result.HUMAN_NEED).toBe('boolean');
    });

    it('PENDING_BOOKING is null in fallback mode', () => {
      const result = fallbackResponse('I want to book', {});
      expect(result.PENDING_BOOKING).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string', () => {
      const result = fallbackResponse('', {});
      expect(result.REPLY).toBeTruthy();
    });

    it('handles very long input', () => {
      const longText = 'Hello '.repeat(100);
      const result = fallbackResponse(longText, {});
      expect(result.REPLY).toBeTruthy();
    });
  });
});

describe('checkSlotAvailable', () => {
  it('checks slot against database', () => {
    const available = checkSlotAvailable('2026-07-01', '10:00');
    expect(typeof available).toBe('boolean');
  });
});