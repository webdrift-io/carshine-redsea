# M0 Status

Status: readiness audit complete; implementation not started.

M0 target: customer creates booking, booking appears in dashboard calendar,
owner assigns cleaner, payment is tracked and verified, and customer receives
confirmation.

## Current Reality

- Real legacy booking records exist in `service-agent/database.sqlite`.
- Calendar is a separate legacy `calendar_events` table and only gets rows when a booking is approved or manually inserted.
- Payment is currently a booking `paymentMethod` string and notes; there is no `payments` or `payment_events` table.
- Customers, vehicles, users/cleaners, and assignments are not normalized tables yet.
- Landing page booking form still posts to hardcoded `http://localhost:5000/api/bookings` and has fake success fallback.
- `/api/public/bookings` exists and creates legacy bookings, but it does not implement the planned normalized M0 flow.
- E2E-12 is planned in docs only; no `e2e/` directory or runnable `test:e2e` script exists.

## Next Recommended PR

M0-001: Migration runner and normalized M0 schema foundation.
