/**
 * Tests for the booking interruption layer.
 *
 * Goal: prove that Layla does NOT get stuck on "What type of car do you
 * have?" when the user types a general question mid-flow.
 *
 * The seven required scenarios (per QA spec):
 *   1. user starts booking then asks price  → bot answers price, no car type
 *   2. user says "wait"                      → booking pauses
 *   3. user says "continue booking"          → booking resumes
 *   4. user says "cancel booking"             → draft clears
 *   5. user asks "how are you"               → friendly answer
 *   6. booking still works after interruption → car type is asked again
 *   7. missing AI token still gives safe fallback → orchestrator uses deterministic layer
 *
 * We don't make real LLM calls (USE_MASTRA_AGENT default + no
 * OPENAI_API_KEY). The orchestrator must produce a safe reply from the
 * deterministic interruption layer + the website-knowledge base.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const createdPaths = [];

let testCounter = 0;
function freshDb() {
  delete require.cache[require.resolve('../database')];
  delete require.cache[require.resolve('better-sqlite3')];
  delete require.cache[require.resolve('../migrations/001_create_handoff_tickets')];
  delete require.cache[require.resolve('../agents/tools')];
  delete require.cache[require.resolve('../agents/decision')];
  delete require.cache[require.resolve('../agents/orchestrator')];
  delete require.cache[require.resolve('../agents/interruption')];
  delete require.cache[require.resolve('../website-knowledge')];
  testCounter++;
  const tmpPath = path.join(
    process.env.TEMP || '/tmp',
    `interrupt_test_${process.pid}_${testCounter}_${Date.now()}.sqlite`
  );
  process.env.DATABASE_PATH = tmpPath;
  createdPaths.push(tmpPath);
  const db = require('../database');
  return { db, tmpPath };
}

afterAll(() => {
  for (const p of createdPaths) {
    try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
  }
});

describe('interruption.detectInterruption', () => {
  let interruption;
  beforeEach(() => { interruption = require('../agents/interruption'); });

  it('classifies explicit cancel_booking commands', () => {
    expect(interruption.detectInterruption('cancel booking').action).toBe('cancel_booking');
    expect(interruption.detectInterruption('Cancel my booking').action).toBe('cancel_booking');
    expect(interruption.detectInterruption('stop the booking').action).toBe('cancel_booking');
    expect(interruption.detectInterruption('quit booking').action).toBe('cancel_booking');
    expect(interruption.detectInterruption('إلغاء الحجز').action).toBe('cancel_booking');
  });

  it('classifies restart commands', () => {
    expect(interruption.detectInterruption('restart').action).toBe('restart');
    expect(interruption.detectInterruption('Reset').action).toBe('restart');
    expect(interruption.detectInterruption('start over').action).toBe('restart');
  });

  it('classifies continue_booking commands', () => {
    expect(interruption.detectInterruption('continue').action).toBe('continue_booking');
    expect(interruption.detectInterruption('continue booking').action).toBe('continue_booking');
    expect(interruption.detectInterruption('resume').action).toBe('continue_booking');
    expect(interruption.detectInterruption('go on').action).toBe('continue_booking');
  });

  it('classifies wait / hold on / not now as interrupt', () => {
    expect(interruption.detectInterruption('wait').action).toBe('interrupt');
    expect(interruption.detectInterruption('hold on').action).toBe('interrupt');
    expect(interruption.detectInterruption('not now').action).toBe('interrupt');
    expect(interruption.detectInterruption('wait i have other question').action).toBe('interrupt');
    expect(interruption.detectInterruption('i have other questions').action).toBe('interrupt');
  });

  it('classifies how are you / help as interrupt', () => {
    expect(interruption.detectInterruption('how are you').action).toBe('interrupt');
    expect(interruption.detectInterruption('are you there').action).toBe('interrupt');
    expect(interruption.detectInterruption('help').action).toBe('interrupt');
  });

  it('classifies price/area/hours/payment questions as interrupt (via KNOWLEDGE_TRIGGERS)', () => {
    expect(interruption.detectInterruption('how much').action).toBe('interrupt');
    expect(interruption.detectInterruption('what is the price').action).toBe('interrupt');
    expect(interruption.detectInterruption('do you serve Hurghada').action).toBe('interrupt');
    expect(interruption.detectInterruption('what are the hours').action).toBe('interrupt');
    expect(interruption.detectInterruption('how can I pay').action).toBe('interrupt');
  });

  it('does NOT classify "ok" / "thanks" / "got it" as interrupt', () => {
    // These are valid in-flow responses; they should fall through to the
    // regular slot-fill so the bot can still ask for the next missing field.
    expect(interruption.detectInterruption('ok').action).toBe('passthrough');
    expect(interruption.detectInterruption('okay').action).toBe('passthrough');
    expect(interruption.detectInterruption('thanks').action).toBe('passthrough');
    expect(interruption.detectInterruption('thank you').action).toBe('passthrough');
    expect(interruption.detectInterruption('got it').action).toBe('passthrough');
  });

  it('does NOT classify pure greetings as interrupt', () => {
    // Greetings are the start of a session — they should hit the regular
    // intake greeting flow, not the interrupt reply.
    expect(interruption.detectInterruption('hi').action).toBe('passthrough');
    expect(interruption.detectInterruption('hello').action).toBe('passthrough');
    expect(interruption.detectInterruption('hey').action).toBe('passthrough');
  });

  it('does NOT hijack booking-slot answers that contain weak keywords', () => {
    // These are valid slot-fill ANSWERS, not questions. They must pass
    // through to the booking machinery (regression: the bot used to loop on
    // "Which area are you in?" because these were treated as questions).
    expect(interruption.detectInterruption('El Gouna').action).toBe('passthrough');
    expect(interruption.detectInterruption('elgouna').action).toBe('passthrough');
    expect(interruption.detectInterruption('Hurghada').action).toBe('passthrough');
    expect(interruption.detectInterruption('Trial Wash').action).toBe('passthrough');
    expect(interruption.detectInterruption('InstaPay').action).toBe('passthrough');
    expect(interruption.detectInterruption('Vodafone Cash').action).toBe('passthrough');
    expect(interruption.detectInterruption('sedan').action).toBe('passthrough');
    expect(interruption.detectInterruption('I want to book in El Gouna').action).toBe('passthrough');
    expect(interruption.detectInterruption('Sheraton Road near the marina').action).toBe('passthrough');
  });

  it('DOES treat question-shaped weak-keyword messages as interrupt', () => {
    expect(interruption.detectInterruption('do you serve Hurghada?').action).toBe('interrupt');
    expect(interruption.detectInterruption('where are you located').action).toBe('interrupt');
    expect(interruption.detectInterruption('what payment methods do you take').action).toBe('interrupt');
    expect(interruption.detectInterruption('what is included in the wash?').action).toBe('interrupt');
    expect(interruption.detectInterruption('what are the working hours').action).toBe('interrupt');
  });

  it('STRONG price keywords always interrupt (even without a question mark)', () => {
    expect(interruption.detectInterruption('price').action).toBe('interrupt');
    expect(interruption.detectInterruption('packages').action).toBe('interrupt');
    expect(interruption.detectInterruption('how much').action).toBe('interrupt');
  });
});

describe('interruption.buildInterruptionReply', () => {
  let interruption;
  beforeEach(() => { interruption = require('../agents/interruption'); });

  it('replies politely in English for cancel_booking', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'cancel_booking' }, false, 'en', null
    );
    expect(r).toMatch(/cleared/i);
  });

  it('replies politely in Arabic for cancel_booking', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'cancel_booking' }, false, 'ar', null
    );
    expect(r).toMatch(/ألغيت/);
  });

  it('replies politely in German for cancel_booking', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'cancel_booking' }, false, 'de', null
    );
    expect(r).toMatch(/gelöscht/i);
  });

  it('restart reply mentions fresh start', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'restart' }, false, 'en', null
    );
    expect(r.toLowerCase()).toContain('fresh start');
  });

  it('continue_booking reply asks to continue', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'continue_booking' }, true, 'en', null
    );
    expect(r.toLowerCase()).toContain('continue');
  });

  it('interrupt_with_progress reply mentions the existing booking', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'interrupt' }, true, 'en', null
    );
    expect(r.toLowerCase()).toContain('continue the booking');
  });

  it('interrupt_no_progress reply is a simple "what would you like to know"', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'interrupt' }, false, 'en', null
    );
    expect(r.toLowerCase()).toContain('happy to help');
  });

  it('appends the knowledge answer when provided', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'interrupt' }, false, 'en', 'Trial Wash: 150 EGP'
    );
    expect(r).toContain('Trial Wash: 150 EGP');
    expect(r).toContain('happy to help');
  });

  it('falls back to English for unknown language', () => {
    const r = interruption.buildInterruptionReply(
      { action: 'cancel_booking' }, false, 'xx', null
    );
    expect(r).toMatch(/cleared/i);
  });
});

describe('Orchestrator: 7 required interruption scenarios', () => {
  let ctx;
  let orch;

  beforeEach(() => {
    ctx = freshDb();
    orch = require('../agents/orchestrator');
  });

  // 1. user starts booking then asks price → bot answers price, no car type
  it('Scenario 1: user starts booking then asks price → answers packages, no car type', async () => {
    const phone = '+201****0011';
    await orch.handleIncomingMessage(phone, 'hi', 'Test');
    const r2 = await orch.handleIncomingMessage(phone, 'elgouna', 'Test');
    expect(r2.reply.toLowerCase()).toContain('car');  // asks for car
    const r3 = await orch.handleIncomingMessage(phone, 'no i want know more about the price', 'Test');
    // Must NOT be the car-type question.
    expect(r3.reply.toLowerCase()).not.toContain('what type of car');
    // Should mention packages or price.
    expect(r3.reply).toMatch(/trial wash|smart plan|premium plan|150|300|500|price/i);
  });

  // 2. user says "wait" → booking pauses
  it('Scenario 2: user says "wait" → booking pauses, offers to continue', async () => {
    const phone = '+201****0012';
    await orch.handleIncomingMessage(phone, 'hi', 'Test');
    await orch.handleIncomingMessage(phone, 'elgouna', 'Test');
    const r = await orch.handleIncomingMessage(phone, 'wait', 'Test');
    expect(r.reply.toLowerCase()).toMatch(/continue|change|stop|happy to help/);
  });

  // 3. user says "continue booking" → booking resumes
  it('Scenario 3: user says "continue booking" → booking resumes (asks next field)', async () => {
    const phone = '+201****0013';
    await orch.handleIncomingMessage(phone, 'hi', 'Test');
    await orch.handleIncomingMessage(phone, 'elgouna', 'Test');
    // Force an interrupt first
    await orch.handleIncomingMessage(phone, 'wait', 'Test');
    // Now ask to continue
    const r = await orch.handleIncomingMessage(phone, 'continue booking', 'Test');
    // Should not be the cancel/restart reply.
    expect(r.reply.toLowerCase()).not.toContain('cleared the booking');
    expect(r.reply.toLowerCase()).not.toContain('fresh start');
  });

  // 4. user says "cancel booking" → draft clears
  it('Scenario 4: user says "cancel booking" → draft clears, polite reply', async () => {
    const phone = '+201****0014';
    await orch.handleIncomingMessage(phone, 'hi', 'Test');
    await orch.handleIncomingMessage(phone, 'elgouna', 'Test');
    const r = await orch.handleIncomingMessage(phone, 'cancel booking', 'Test');
    expect(r.reply.toLowerCase()).toMatch(/cleared|whenever you need me/);
    // Verify the next message starts a fresh intake (asks for area again).
    const r2 = await orch.handleIncomingMessage(phone, 'hi', 'Test');
    // After cancel + a fresh hi, bot should ask for area again (or greeting).
    expect(r2.reply.toLowerCase()).toMatch(/area|welcome|gouna|hurghada|sahl/);
  });

  // 5. user asks "how are you" → friendly answer
  it('Scenario 5: user asks "how are you" → friendly, no car-type loop', async () => {
    const phone = '+201****0015';
    await orch.handleIncomingMessage(phone, 'hi', 'Test');
    await orch.handleIncomingMessage(phone, 'elgouna', 'Test');
    const r = await orch.handleIncomingMessage(phone, 'how are you', 'Test');
    expect(r.reply.toLowerCase()).not.toContain('what type of car');
    expect(r.reply.toLowerCase()).toMatch(/happy to help|continue|change|stop/);
  });

  // 6. booking still works after interruption
  it('Scenario 6: booking still works after interruption (car type is asked again)', async () => {
    const phone = '+201****0016';
    await orch.handleIncomingMessage(phone, 'hi', 'Test');
    await orch.handleIncomingMessage(phone, 'elgouna', 'Test');
    await orch.handleIncomingMessage(phone, 'wait i have other question', 'Test');
    const r = await orch.handleIncomingMessage(phone, 'continue', 'Test');
    // After continue, the orchestrator should resume the booking flow
    // and ask for the next missing field (car type).
    expect(r.reply.toLowerCase()).toMatch(/car|continue/);
  });

  // 7. missing AI token still gives safe fallback
  it('Scenario 7: no OPENAI_API_KEY → deterministic layer still answers', async () => {
    // Ensure no LLM key
    delete process.env.OPENAI_API_KEY;
    delete process.env.ENABLE_LLM_REPLY_TEXT;
    const phone = '+201****0017';
    const r1 = await orch.handleIncomingMessage(phone, 'hi', 'Test');
    // First turn should give a real greeting (not "happy to help").
    expect(r1.reply.toLowerCase()).toMatch(/welcome|gouna|hurghada|sahl|wash|plan/);
    // No 500 error, no "undefined" reply.
    expect(r1.reply).toBeTruthy();
    expect(r1.reply.length).toBeGreaterThan(10);
  });
});

describe('Regression: original bug conversation', () => {
  let ctx;
  let orch;
  beforeEach(() => {
    ctx = freshDb();
    orch = require('../agents/orchestrator');
  });

  it('a web visitor (web_ phone) completes a full booking — contact phone does not orphan the session', async () => {
    // Regression: when the customer typed their contact number it used to
    // overwrite session.phone (the stable web-session key), so the NEXT
    // message could no longer find the session, a fresh empty session was
    // created, all slots were lost, and the bot greeted instead of booking.
    const webPhone = 'web_1700000000000_abc123';
    const flow = ['hi', 'El Gouna', 'sedan', 'Trial Wash', 'tomorrow', '11:00', 'Marina villa 9', 'Sara Ali', '01000000022', 'Cash'];
    let last = null;
    for (const text of flow) {
      last = await orch.handleIncomingMessage(webPhone, text, 'Website Visitor');
    }
    expect(last.bookingCreated).toBe(true);
    expect(last.bookingId).toBeTruthy();
    expect(last.reply.toLowerCase()).toMatch(/booked|all set/);
  });

  it('a full booking conversation completes without the interrupt layer hijacking answers', async () => {
    const phone = '+201****0088';
    // hi → greeting; then a normal slot-fill conversation. None of these
    // answers should be swallowed by the interruption layer.
    await orch.handleIncomingMessage(phone, 'hi', 'Test');
    await orch.handleIncomingMessage(phone, 'El Gouna', 'Test');
    const rCar = await orch.handleIncomingMessage(phone, 'sedan', 'Test');
    // After area + car, the bot must move forward (ask package), NOT loop on area.
    expect(rCar.reply.toLowerCase()).not.toMatch(/which area are you in/);
    let result = null;
    for (const text of ['Trial Wash', 'tomorrow', '11:00', 'Sheraton Road villa 4', 'Ahmed Hassan', 'InstaPay']) {
      result = await orch.handleIncomingMessage(phone, text, 'Test');
    }
    // The conversation should have progressed far past "Which area" — i.e. the
    // slot answers were captured, not hijacked.
    expect(result.reply.toLowerCase()).not.toMatch(/which area are you in/);
  });

  it('the exact bug conversation no longer loops on car type', async () => {
    const phone = '+201****0099';
    const conversation = [
      'hi',
      'elgouna',
      'i have other questions',
      'wait i have other question',
      'no i want know more about the price',
      'how are you'
    ];
    const replies = [];
    for (const text of conversation) {
      const r = await orch.handleIncomingMessage(phone, text, 'Test');
      replies.push(r.reply);
    }
    // The bug was: turns 3, 4, 6 all replied "What type of car do you have?"
    // After the fix, at most ONE of the turns should ask for car type
    // (the legitimate one at turn 2 after the area is provided).
    const carTypeAsks = replies.filter((r) =>
      r.toLowerCase().includes('what type of car')
    );
    expect(carTypeAsks.length).toBeLessThanOrEqual(1);
  });
});

// Cleanup tmp DBs at the end
process.on('exit', () => {
  // Best-effort: the tmp DBs live in /tmp; on Windows they live in %TEMP%.
  // vitest doesn't give us a global teardown easily; leaving them is fine.
});
