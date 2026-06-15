/**
 * Mem0 returning-customer memory wrapper.
 *
 * Exposes a single function:
 *
 *     lookupCustomer({ phone, name }) -> Promise<{
 *       lastBooking, preferences, totalBookings, firstSeen, mode
 *     }>
 *
 * Behaviour:
 *   - In LIVE mode (MEM0_API_KEY in env), it queries the Mem0 API.
 *   - In DRY-RUN mode (default), it falls back to
 *     `db.getBookingsByPhone(phone)` and synthesises the same shape.
 *   - NEVER throws. On any failure it returns a safe default
 *     `{ totalBookings: 0, firstSeen: null, lastBooking: null,
 *        preferences: {}, mode }` so the agent can keep going.
 *
 * Returned `mode` is "live" or "dry-run" so callers can tell
 * which source the data came from.
 *
 * `preferences` is a small, structured object:
 *   {
 *     preferredArea, preferredPackage, preferredPaymentMethod,
 *     preferredTimeOfDay, language
 *   }
 * Derived from the customer's most frequent / most recent booking.
 */

const MEM0_API_URL = 'https://api.mem0.ai/v1/memories/search/';

function isLiveMode() {
  return Boolean(process.env.MEM0_API_KEY);
}

function emptyResult(mode) {
  return {
    lastBooking: null,
    preferences: {
      preferredArea: null,
      preferredPackage: null,
      preferredPaymentMethod: null,
      preferredTimeOfDay: null,
      language: null
    },
    totalBookings: 0,
    firstSeen: null,
    mode
  };
}

function derivePreferences(bookings) {
  if (!bookings || bookings.length === 0) {
    return {
      preferredArea: null,
      preferredPackage: null,
      preferredPaymentMethod: null,
      preferredTimeOfDay: null,
      language: null
    };
  }

  // Most-recent booking first (caller passes sorted DESC).
  const latest = bookings[0];
  const counts = (key) => {
    const m = new Map();
    for (const b of bookings) {
      const v = b[key];
      if (!v) continue;
      m.set(v, (m.get(v) || 0) + 1);
    }
    let bestVal = null;
    let bestCount = -1;
    for (const [v, c] of m.entries()) {
      if (c > bestCount) {
        bestVal = v;
        bestCount = c;
      }
    }
    return bestVal;
  };

  // Time-of-day bucket from HH:MM
  let timeOfDay = null;
  if (latest && latest.preferredTime) {
    const hour = parseInt(String(latest.preferredTime).split(':')[0], 10);
    if (!Number.isNaN(hour)) {
      if (hour < 12) timeOfDay = 'morning';
      else if (hour < 17) timeOfDay = 'afternoon';
      else timeOfDay = 'evening';
    }
  }

  return {
    preferredArea: latest.area || counts('area') || null,
    preferredPackage: latest.package || counts('package') || null,
    preferredPaymentMethod: latest.paymentMethod || counts('paymentMethod') || null,
    preferredTimeOfDay: timeOfDay,
    language: null // we don't store per-customer language yet
  };
}

function summariseFromBookings(bookings) {
  if (!bookings || bookings.length === 0) {
    return emptyResult('dry-run');
  }

  const lastBooking = bookings[0] || null; // caller sorts DESC
  const firstSeen = bookings[bookings.length - 1]
    ? bookings[bookings.length - 1].createdAt
    : null;

  return {
    lastBooking: lastBooking
      ? {
          id: lastBooking.id,
          customerName: lastBooking.customerName,
          phone: lastBooking.phone,
          area: lastBooking.area,
          carType: lastBooking.carType,
          package: lastBooking.package,
          preferredDate: lastBooking.preferredDate,
          preferredTime: lastBooking.preferredTime,
          location: lastBooking.location,
          paymentMethod: lastBooking.paymentMethod,
          status: lastBooking.status,
          createdAt: lastBooking.createdAt
        }
      : null,
    preferences: derivePreferences(bookings),
    totalBookings: bookings.length,
    firstSeen,
    mode: 'dry-run'
  };
}

async function callMem0Live({ phone, name }) {
  // Minimal Mem0 search call. Mem0 is typically queried by user_id
  // rather than phone, so we use a derived userId. If the call
  // fails, the outer try/catch falls back to dry-run.
  const controller = (typeof AbortController === 'function') ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 1500) : null;

  const userId = 'carshine:' + (phone || (name || 'unknown'));
  const query = name
    ? `Customer ${name} (${phone || 'no phone'}) previous bookings and preferences`
    : `Customer ${phone || 'unknown'} previous bookings and preferences`;

  const res = await fetch(MEM0_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Token ' + process.env.MEM0_API_KEY
    },
    body: JSON.stringify({
      user_id: userId,
      query,
      limit: 10
    }),
    signal: controller ? controller.signal : undefined
  });

  if (timeout) clearTimeout(timeout);

  if (!res.ok) {
    throw new Error('Mem0 API returned ' + res.status);
  }

  const data = await res.json();

  // Mem0 returns { memories: [{ memory, ... }, ...] }
  const memories = Array.isArray(data) ? data : (data.memories || data.results || []);
  const totalBookings = memories.length;

  // Mem0 memories are free-form text. We can't reliably parse them
  // back into structured fields without an LLM, so we just expose
  // the raw memory list as "lastBooking" for the agent to use.
  const last = memories[0] || null;
  return {
    lastBooking: last
      ? { id: last.id || null, customerName: name || null, rawMemory: last.memory || null }
      : null,
    preferences: {
      preferredArea: null,
      preferredPackage: null,
      preferredPaymentMethod: null,
      preferredTimeOfDay: null,
      language: null
    },
    totalBookings,
    firstSeen: null,
    mode: 'live'
  };
}

/**
 * Look up a returning customer.
 *
 * @param {object} args
 * @param {string} [args.phone] - phone number (primary key)
 * @param {string} [args.name]  - customer name (fallback identifier)
 * @returns {Promise<{lastBooking, preferences, totalBookings, firstSeen, mode}>}
 */
async function lookupCustomer(args) {
  const { phone, name } = args || {};
  const live = isLiveMode();

  if (!phone && !name) {
    return emptyResult(live ? 'live' : 'dry-run');
  }

  // Always compute the dry-run version first so we have a fallback
  // we can return if the live call fails. The DB read is cheap and
  // gives us a real, well-formed result regardless.
  let dryResult = emptyResult('dry-run');
  try {
    // Lazy-require to avoid a hard dependency at import time.
    const db = require('../database');
    if (phone && typeof db.getBookingsByPhone === 'function') {
      const bookings = db.getBookingsByPhone(phone);
      // Ensure DESC by createdAt (defensive — DB is already sorted but
      // we want this wrapper to be robust if the caller swapped DBs).
      bookings.sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return tb - ta;
      });
      dryResult = summariseFromBookings(bookings);
    }
  } catch (e) {
    // db might not be loadable in some test contexts — keep the
    // empty default and let the live path try.
    dryResult = emptyResult('dry-run');
  }

  if (!live) {
    return dryResult;
  }

  // LIVE mode — try Mem0, fall back to dry-run result on failure.
  try {
    return await callMem0Live({ phone, name });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[mem0] live lookup failed, using dry-run fallback:', e.message);
    return dryResult;
  }
}

module.exports = {
  lookupCustomer,
  isLiveMode
};
