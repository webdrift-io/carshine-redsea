# M0-004A Manual QA Checklist — Landing Booking Form

This checklist exists because the landing page does not yet have a frontend
test runner (Playwright E2E is M0-008). All items below should be exercised
manually in a real browser before merging the M0-004A PR.

## Prerequisites

- [ ] `service-agent` is running on the configured backend port
      (default `http://localhost:5000`).
- [ ] `.env` files are NOT committed. `.env.example` is committed.
- [ ] Production build of the landing page has been generated:
      `cd landing-page && npm ci && npm run build`.

## 0. Build + Audit Gate (automated)

- [ ] `cd landing-page && npm ci` — exit 0, no native-module lock warnings.
- [ ] `cd landing-page && npm run build` — exit 0, three builds (en, ar, de).
- [ ] `cd landing-page && npm audit --audit-level=high` — 0 vulnerabilities.
- [ ] `cd .. && npm ci` — exit 0.
- [ ] `cd .. && npm run build` — exit 0.
- [ ] `cd .. && npm audit --audit-level=high` — 0 vulnerabilities.

## 1. Environment wiring (no hardcoded `localhost:5000` in shipped code)

- [ ] `landing-page/.env.example` exists and documents
      `VITE_API_BASE_URL`, `VITE_WHATSAPP_FALLBACK_URL`, `VITE_BOOKING_SOURCE`.
- [ ] `grep -R "http://localhost:5000" landing-page/src` returns no hits.
- [ ] `grep -R "http://localhost:5000" landing-page/dist` is allowed only when
      a developer built with the default fallback. Production builds must
      set `VITE_API_BASE_URL` to the real host.
- [ ] Building with `VITE_API_BASE_URL=https://api.example.com npm run build:en`
      produces `dist/en/assets/*.js` containing the configured URL.

## 2. Submit-button disabled state

- [ ] Open the booking form in any language.
- [ ] Click **Confirm My Booking** with a valid form.
- [ ] During the network round-trip, the submit button is `disabled` and
      shows the "Submitting booking…" label.
- [ ] Double-clicking does NOT trigger two POSTs.
- [ ] After the response, the button is enabled again and the original
      "Confirm My Booking" label is restored.

## 3. State: `QUOTED` (success)

- [ ] Submit a complete, valid form (all required fields + future date).
- [ ] Expect: 201 response, status `QUOTED`, status region turns **green**,
      success modal opens, form is reset.
- [ ] Booking reference (e.g. `CS-20260615-AB12CD`) is shown in the status
      region.
- [ ] `bookings_v2` row exists with `status='QUOTED'` (verify with
      `sqlite3 service-agent/database.sqlite "SELECT status FROM bookings_v2 ORDER BY created_at DESC LIMIT 1"`).
- [ ] A `payments` row exists with `status='PAYMENT_INSTRUCTIONS_SENT'` or
      `'UNPAID'`. **Never `VERIFIED`.**

## 4. State: `COLLECTING_INFO`

- [ ] Submit a form WITHOUT a chosen `date` / `time` after deleting it.
- [ ] Expect: backend returns
      `success: true, status: 'COLLECTING_INFO', missingFields: ['scheduledStart', ...]`.
- [ ] Status region turns **yellow**, shows the missing-fields list, and
      explicitly does NOT say "booking confirmed".
- [ ] Form is NOT reset.

## 5. State: `NEEDS_HUMAN` (slot conflict)

- [ ] Submit a complete booking, then submit a SECOND booking for the
      same phone + service + date/time within 5 minutes (with a different
      `idempotencyKey`).
      — OR —
      Create one QUOTED booking, then submit a second with the exact same
      future time slot.
- [ ] Expect: backend returns `success: false, status: 'NEEDS_HUMAN'`.
- [ ] Status region turns **yellow** and includes a WhatsApp fallback URL.
- [ ] No second `bookings_v2` row was created.

## 6. State: `duplicate`

- [ ] Submit a complete booking.
- [ ] Without changing the form, click **Confirm My Booking** again with
      the same phone + service + scheduled time within 5 minutes.
- [ ] Expect: backend returns
      `success: true, duplicate: true, status: 'QUOTED'`.
- [ ] Status region turns **blue/info**, says "We already received your
      request", and shows the existing `public_ref`.
- [ ] The form is NOT reset.

## 7. State: `backend_error` (HTTP 5xx)

- [ ] Stop the backend (`pkill -f "node server.js"` or stop the dev script).
- [ ] Submit the form.
- [ ] Expect: status region turns **red**, error message is shown, and
      a WhatsApp fallback URL is included.
- [ ] Form is NOT reset.
- [ ] Restart the backend afterwards.

## 8. State: `network_error` (offline / CORS)

- [ ] Open DevTools → Network → set throttling to **Offline**.
- [ ] Submit the form.
- [ ] Expect: status region turns **red**, message says the booking
      system could not be reached, and a WhatsApp fallback URL is shown.
- [ ] Form is NOT reset.

## 9. Language coverage (EN / AR / DE)

- [ ] Repeat checks §2–§8 on `index.en.html`, `index.ar.html`, and
      `index.de.html`. The form labels are language-specific; the status
      region is in English (M0-004A scope; localization is later).
- [ ] In AR build, `<html dir="rtl">` and the status region flow correctly.
- [ ] The booking `language` field is correctly populated as
      `en` / `ar` / `de` from `<html lang>` (verify in `bookings_v2.notes`
      or via backend logs).

## 10. Idempotency

- [ ] Two consecutive POSTs from the SAME form submission (double-click)
      must NOT create two `bookings_v2` rows. The second request should
      return the first booking by `X-Idempotency-Key`.
- [ ] Open DevTools → Network, look for the `X-Idempotency-Key` header on
      the booking POST. It must be present and unique per form session.

## 11. No fake success

- [ ] With the backend STOPPED, submit a form. The success modal must NOT
      open. Only the red status region + WhatsApp fallback should be shown.
- [ ] Search the code:
      `grep -R "success: true" landing-page/src` should NOT return any
      client-side fake success path. The string may legitimately appear
      in JSDoc examples inside `booking-api.js` documenting the
      `PublicBookingSuccess` typedef; that is acceptable.

## 12. Security posture

- [ ] No secrets, API keys, or JWTs in the client bundle:
      `grep -R "AIza\\|sk-\\|Bearer\\|JWT" landing-page/dist | wc -l` → 0
      (or only Vite-internal public tokens).
- [ ] CORS: the backend must allow the landing page origin. If the
      landing page is served from `https://carshineredsea.com` and the
      backend at `https://api.carshineredsea.com`, the response must
      include a matching `Access-Control-Allow-Origin` header. Otherwise
      browsers will reject the POST before it ever reaches the route.

## Sign-off

- [ ] Date:
- [ ] Tester:
- [ ] Build SHA:
- [ ] Notes / anomalies:
