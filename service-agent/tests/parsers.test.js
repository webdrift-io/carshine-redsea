/**
 * Tests for parsers.js
 * Covers: language detection, area/package/payment/car/date/time/name parsing
 */

import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  parseArea,
  parsePackage,
  parsePaymentMethod,
  parseCarType,
  parseDate,
  parseTime,
  parseName,
  parseBookingDetails,
  validateBooking,
  isValidPhone
} from '../parsers.js';

describe('detectLanguage', () => {
  it('detects Arabic from Arabic script', () => {
    expect(detectLanguage('أهلاً بك')).toBe('ar');
    expect(detectLanguage('حجز غسيل عربيتي')).toBe('ar');
  });

  it('detects German from German keywords', () => {
    expect(detectLanguage('Hallo, ich möchte buchen')).toBe('de');
    expect(detectLanguage('Guten Tag')).toBe('de');
  });

  it('defaults to English for everything else', () => {
    expect(detectLanguage('Hello, I want to book')).toBe('en');
    expect(detectLanguage('I need a car wash')).toBe('en');
  });

  it('handles empty/null inputs', () => {
    expect(detectLanguage('')).toBe('en');
    expect(detectLanguage(null)).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });
});

describe('parseArea', () => {
  it('parses El Gouna (English + Arabic)', () => {
    expect(parseArea('I am in El Gouna')).toBe('El Gouna');
    expect(parseArea('أنا في الجونة')).toBe('El Gouna');
  });

  it('parses Hurghada (English + Arabic)', () => {
    expect(parseArea('I am in Hurghada')).toBe('Hurghada');
    expect(parseArea('أنا في الغردقة')).toBe('Hurghada');
  });

  it('parses Sahl Hasheesh (English + Arabic)', () => {
    expect(parseArea('I am in Sahl Hasheesh')).toBe('Sahl Hasheesh');
    expect(parseArea('أنا في سهل حشيش')).toBe('Sahl Hasheesh');
  });

  it('returns null for unrecognized areas', () => {
    expect(parseArea('I am in Cairo')).toBeNull();
    expect(parseArea('hello')).toBeNull();
  });

  it('handles empty input', () => {
    expect(parseArea('')).toBeNull();
    expect(parseArea(null)).toBeNull();
  });
});

describe('parsePackage', () => {
  it('parses Trial Wash (English/Arabic/German/price)', () => {
    expect(parsePackage('I want a trial wash')).toBe('Trial Wash - 150 EGP');
    expect(parsePackage('تجريب')).toBe('Trial Wash - 150 EGP');
    expect(parsePackage('Probe-Wäsche')).toBe('Trial Wash - 150 EGP');
    expect(parsePackage('that costs 150')).toBe('Trial Wash - 150 EGP');
  });

  it('parses Smart Plan', () => {
    expect(parsePackage('Smart Plan please')).toBe('Smart Plan - 300 EGP / month');
    expect(parsePackage('الباقة الذكية')).toBe('Smart Plan - 300 EGP / month');
    expect(parsePackage('300 per month')).toBe('Smart Plan - 300 EGP / month');
  });

  it('parses Premium Plan', () => {
    expect(parsePackage('Premium plan')).toBe('Premium Plan - 500 EGP / month');
    expect(parsePackage('الباقة المميزة')).toBe('Premium Plan - 500 EGP / month');
    expect(parsePackage('500 monthly')).toBe('Premium Plan - 500 EGP / month');
  });

  it('returns null for unrecognized packages', () => {
    expect(parsePackage('I want a car wash')).toBeNull();
    expect(parsePackage('')).toBeNull();
  });
});

describe('parsePaymentMethod', () => {
  it('parses Cash (multi-language)', () => {
    expect(parsePaymentMethod('Cash please')).toBe('Cash');
    expect(parsePaymentMethod('كاش')).toBe('Cash');
    expect(parsePaymentMethod('Barzahlung')).toBe('Cash');
  });

  it('parses InstaPay', () => {
    expect(parsePaymentMethod('InstaPay')).toBe('InstaPay');
    expect(parsePaymentMethod('انستا باي')).toBe('InstaPay');
  });

  it('parses Vodafone Cash', () => {
    expect(parsePaymentMethod('Vodafone Cash')).toBe('Vodafone Cash');
    expect(parsePaymentMethod('فودافون كاش')).toBe('Vodafone Cash');
  });

  it('parses Orange Cash', () => {
    expect(parsePaymentMethod('Orange Cash')).toBe('Orange Cash');
  });

  it('parses Fawry', () => {
    expect(parsePaymentMethod('Fawry')).toBe('Fawry');
    expect(parsePaymentMethod('فوري')).toBe('Fawry');
  });

  it('returns null for unrecognized methods', () => {
    expect(parsePaymentMethod('Credit card')).toBeNull();
  });
});

describe('parseCarType', () => {
  it('parses car brands', () => {
    expect(parseCarType('I have a BMW X5')).toBe('BMW');
    expect(parseCarType('Toyota Camry')).toBe('TOYOTA');
    expect(parseCarType('Mercedes Benz')).toBe('MERCEDES');
    expect(parseCarType('Tesla Model 3')).toBe('TESLA');
  });

  it('parses car type keywords', () => {
    expect(parseCarType('SUV please')).toBe('SUV');
    expect(parseCarType('Sedan')).toBe('SEDAN');
  });

  it('parses Arabic car descriptions', () => {
    expect(parseCarType('عربية تويوتا')).toMatch(/تويوتا/);
    expect(parseCarType('سيارة هوندا')).toMatch(/هوندا/);
  });

  it('returns null for no car info', () => {
    expect(parseCarType('hello world')).toBeNull();
  });
});

describe('parseDate', () => {
  it('parses "tomorrow" in all languages', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expected = tomorrow.toISOString().split('T')[0];
    
    expect(parseDate('tomorrow')).toBe(expected);
    expect(parseDate('بكرة')).toBe(expected);
    expect(parseDate('morgen')).toBe(expected);
  });

  it('parses "today" in all languages', () => {
    const today = new Date().toISOString().split('T')[0];
    
    expect(parseDate('today')).toBe(today);
    expect(parseDate('النهاردة')).toBe(today);
    expect(parseDate('heute')).toBe(today);
  });

  it('parses numeric dates (day/month)', () => {
    expect(parseDate('on 15/6')).toMatch(/^\d{4}-06-15$/);
    expect(parseDate('on 15.6')).toMatch(/^\d{4}-06-15$/);
    expect(parseDate('on 15-6')).toMatch(/^\d{4}-06-15$/);
  });

  it('swaps day/month if month > 12', () => {
    // English: 6/15 = June 15
    expect(parseDate('on 6/15')).toMatch(/^\d{4}-06-15$/);
  });

  it('returns null for invalid dates', () => {
    expect(parseDate('hello')).toBeNull();
    expect(parseDate('32/13')).toBeNull();
  });
});

describe('parseTime', () => {
  it('parses 24-hour time', () => {
    expect(parseTime('at 14:00')).toBe('14:00');
    expect(parseTime('9:30')).toBe('09:30');
  });

  it('parses AM/PM time', () => {
    expect(parseTime('at 2pm')).toBe('14:00');
    expect(parseTime('9am')).toBe('09:00');
    expect(parseTime('12pm')).toBe('12:00');
    expect(parseTime('12am')).toBe('00:00');
  });

  it('returns null for invalid times', () => {
    expect(parseTime('hello')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('13:60')).toBeNull();
  });
});

describe('parseName', () => {
  it('parses English name patterns', () => {
    expect(parseName('my name is Ahmed')).toBe('Ahmed');
    expect(parseName("I'm Sarah")).toBe('Sarah');
    expect(parseName('name is John Doe')).toBe('John Doe');
  });

  it('parses Arabic name patterns', () => {
    expect(parseName('اسمي أحمد')).toBe('أحمد');
    expect(parseName('اسمي محمد علي')).toBe('محمد علي');
  });

  it('parses German name patterns', () => {
    expect(parseName('Ich heiße Hans')).toBe('Hans');
  });

  it('returns null when no name pattern found', () => {
    expect(parseName('hello')).toBeNull();
  });
});

describe('parseBookingDetails', () => {
  it('extracts multiple fields from a single message', () => {
    const details = parseBookingDetails('my name is Ahmed, I have a BMW and I am in El Gouna, Cash please');
    expect(details.customerName).toBe('Ahmed');
    expect(details.carType).toBe('BMW');
    expect(details.area).toBe('El Gouna');
    expect(details.paymentMethod).toBe('Cash');
  });

  it('returns empty object when nothing matches', () => {
    expect(parseBookingDetails('hello world')).toEqual({});
  });

  it('handles empty input', () => {
    expect(parseBookingDetails('')).toEqual({});
    expect(parseBookingDetails(null)).toEqual({});
  });
});

describe('validateBooking', () => {
  const validBooking = {
    customerName: 'Ahmed',
    phone: '+20100000000',
    area: 'El Gouna',
    carType: 'BMW',
    package: 'Trial Wash',
    preferredDate: '2026-06-15',
    preferredTime: '14:00',
    location: 'Villa 10',
    paymentMethod: 'Cash'
  };

  it('returns valid for complete booking', () => {
    const result = validateBooking(validBooking);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports missing required fields', () => {
    const incomplete = { ...validBooking };
    delete incomplete.customerName;
    delete incomplete.phone;
    
    const result = validateBooking(incomplete);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('customerName');
    expect(result.missing).toContain('phone');
  });

  it('rejects null or non-object input', () => {
    expect(validateBooking(null).valid).toBe(false);
    expect(validateBooking(undefined).valid).toBe(false);
    expect(validateBooking('string').valid).toBe(false);
  });

  it('rejects empty/whitespace strings as missing', () => {
    const withBlanks = { ...validBooking, customerName: '   ' };
    expect(validateBooking(withBlanks).missing).toContain('customerName');
  });
});

describe('isValidPhone', () => {
  it('accepts valid international numbers', () => {
    expect(isValidPhone('+20100000000')).toBe(true);
    expect(isValidPhone('+1 555 123 4567')).toBe(true);
    expect(isValidPhone('4915123456789')).toBe(true);
  });

  it('accepts local numbers', () => {
    expect(isValidPhone('01000000000')).toBe(true);
    expect(isValidPhone('0123456789')).toBe(true);
  });

  it('rejects too-short numbers', () => {
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('+12')).toBe(false);
  });

  it('rejects too-long numbers', () => {
    expect(isValidPhone('+123456789012345678')).toBe(false);
  });

  it('rejects empty/null inputs', () => {
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone(null)).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
  });
});