// ============================================================================
// CarShine Red Sea - Landing page runtime config
// ----------------------------------------------------------------------------
// Resolves VITE_* env vars at build time. Vite injects these into the
// client bundle. There are no secrets in here.
//
// Fallback policy:
// - API_BASE_URL falls back to http://localhost:5000 ONLY for local dev.
//   Production builds MUST set VITE_API_BASE_URL.
// - WHATSAPP_FALLBACK_URL falls back to the public CarShine Redsea number.
// - BOOKING_SOURCE falls back to 'WEB_FORM'.
// ============================================================================

const DEFAULT_LOCAL_API_URL = 'http://localhost:5000';
const DEFAULT_WHATSAPP_URL = 'https://wa.me/201555567205';
const DEFAULT_BOOKING_SOURCE = 'WEB_FORM';

/**
 * Read a Vite env var. Vite exposes only `VITE_*` vars to the bundle.
 * In dev mode without a .env file, `import.meta.env.VITE_FOO` is `undefined`.
 *
 * @param {string} name
 * @returns {string|undefined}
 */
function readEnv(name) {
  try {
    // Guarded because some unit test runners may shim import.meta.env.
    const env = import.meta && import.meta.env ? import.meta.env : undefined;
    if (!env) return undefined;
    const v = env[name];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  } catch (_) {
    return undefined;
  }
}

/**
 * Strip a trailing slash from a base URL so we can safely concatenate
 * `/api/public/bookings` without producing `//api/public/bookings`.
 *
 * @param {string} url
 * @returns {string}
 */
function stripTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

const rawApiBase = readEnv('VITE_API_BASE_URL') || DEFAULT_LOCAL_API_URL;
const rawWhatsapp = readEnv('VITE_WHATSAPP_FALLBACK_URL') || DEFAULT_WHATSAPP_URL;
const rawSource = readEnv('VITE_BOOKING_SOURCE') || DEFAULT_BOOKING_SOURCE;

export const API_BASE_URL = stripTrailingSlash(rawApiBase);
export const WHATSAPP_FALLBACK_URL = rawWhatsapp;
export const BOOKING_SOURCE = rawSource;
