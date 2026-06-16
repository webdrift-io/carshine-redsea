# Hermes Planning Report: M0-005 Dashboard Calendar + Booking Board

> Status: **PLANNING ONLY** • Owner: Hermes
> Date: 2026-06-15
> This is a planning document. **Do not code M0-005 until M0-004C is PASS and merged into `master`.**

---

## 1. M0-004 dependency status

**Status: WAITING FOR OPUS FINAL PASS AND MERGE OF M0-004C.**

- M0-004C is the `feature/m0-004b-ui-polish` branch at `0aad888` (4 commits ahead of `master` at `ee76622`).
- The branch lives in a git worktree at `.worktrees/m0-004b-ui/`; `master` is untouched.
- The M0-004A QA checklist is committed at `docs/M0_004A_QA_CHECKLIST.md` and covers 12 manual sections (build/audit, env wiring, submit-button disabled state, no fake success, EN/AR/DE parity, etc.).
- Until Opus final-pass + merge, M0-005 is **blocked** on this dependency. No branch, no PR, no code from M0-005 may touch the working tree.
- What unblocks M0-005: Opus's signed-off `feature/m0-004b-ui-polish` → `master` merge. After that, the live `bookings_v2` table will receive real `COLLECTING_INFO` and `QUOTED` rows from a real public form. Until then, the M0-005 read model is a dashboard over zero rows — useless to test and misleading to ship.

**Hard rule for the next 24–72 hours:**
- Do not branch off `master` for M0-005.
- Do not start the M0-005 read model in a worktree off the M0-004C branch (the M0-004C branch is reserved for M0-004C fixes only).
- Do not "warm up" the dashboard by reading from `bookings_v2` while M0-004C is in review — the data is real bookings and a partially-wired dashboard could mislead Opus's review.

---

## 2. M0-005 objective

**One line:** Replace the legacy `bookings` / `calendar_events` data path in the owner dashboard with a real read model over `bookings_v2`, `customers`, `vehicles`, `service_packages`, `payments`, `bookings_v2.payment_status`, and `assignments` (the last is M0-007 territory and will join as `null` for now). The dashboard must show real bookings the moment the landing form posts them. No hardcoded data. No legacy `bookings` reads in the M0-critical views.

**In scope for M0-005:**
1. Backend: read-only query layer over the M0 schema. Three new endpoints, one new service module.
2. Backend: replace the `checkSlotConflict` equality check with a window-overlap query + add a malformed-date guard (the two follow-ups I flagged in the M0-003b review §3 N2/N3). They are small, low-risk, and fit naturally in this PR because the dashboard calendar exercises them.
3. Frontend (dashboard SPA): switch the Bookings, Calendar, and Today sections from `/api/bookings` + `/api/calendar` to the new `/api/admin/bookings-v2/*` endpoints. Render the **current M0 status machine** correctly. Add safe empty / loading / error states.
4. Tests: integration tests for the new endpoints, a small smoke test for the dashboard, and the slot-overlap test that exercises the new window-overlap query.

**Out of scope for M0-005 (named so we don't drift):**
- Payment approval UI (M0-006).
- Cleaner assignment UI (M0-007).
- Any new state-machine states (ASSIGNED, EN_ROUTE, ON_SITE, IN_PROGRESS, COMPLETED, NO_SHOW) — these are M0-007 work. M0-005 renders only the states the schema currently has.
- Drag-to-reschedule, drag-to-assign (M0-005+ refines, not ships).
- Multi-business / multi-tenant (Phase 2).
- Social media / marketing / Postiz / TikTok (Phase 2).
- A real InstaPay API or any automatic verification.

---

## 3. Files likely involved

### Backend (Claude Code owns)

**New files:**
- `service-agent/services/admin-bookings-read.js` — read-only query layer. Three exported functions: `listBookingsForAdmin({ dateFrom, dateTo, status, paymentStatus, source, language, limit, offset })`, `getBookingDetailForAdmin(bookingV2Id)`, `getCalendarForAdmin({ dateFrom, dateTo })`. All queries go through `db.prepare`, no raw SQL interpolation.
- `service-agent/services/slot-overlap.js` — `findOverlappingBookings({ scheduledStart, scheduledEnd, excludeBookingId })` and a thin wrapper `assertNoSlotConflict(normalized, now)` that returns the same `{ success: false, status, message }` shape as `checkSlotConflict`. The M0-003b function is renamed/replaced by this in the same PR.
- `service-agent/tests/admin-bookings-read.test.js` — integration tests for the read layer.
- `service-agent/tests/slot-overlap.test.js` — tests for the window-overlap query and the malformed-date guard.

**Modified files:**
- `service-agent/services/public-bookings.js` — replace `checkSlotConflict` (and its caller) with the new overlap-based helper. Add the malformed-date guard. **No new tables, no new columns, no schema changes.**
- `service-agent/routes/admin.js` — add three new GET endpoints (the new ones below). **Do not remove the legacy `/api/admin/*` routes yet; that is the M0-005b deprecation ticket.**
- `service-agent/server.js` — mount the new admin routes; keep the legacy `/api/bookings` and `/api/calendar` routes alive (for the dashboard's other views, and for the M0-005b deprecation window).
- `service-agent/database.js` — add a small helper for prepared statements over the new joins. **Do not change the schema. Do not add indexes via this PR.** The M0-001 indexes (`idx_bookings_v2_start`, `idx_bookings_v2_status`, `idx_bookings_v2_customer_id`, `idx_bookings_v2_payment_status`) are sufficient for the M0-005 query plan; if M0-005 needs more, that's a follow-up migration, not this PR.
- `service-agent/tests/public-bookings-m0.test.js` — update `rejects past scheduledStart` to assert the new malformed-date branch too. Add a test that exercises the overlap query (two 60-min services starting 30 min apart, second must be rejected).
- `docs/M0_STATUS.md`, `docs/AGENT_HANDOFF.md`, `docs/IMPLEMENTATION_QUEUE.md` — milestone updates.

**Not touched:**
- `service-agent/migrations/**` — no new tables, no new columns, no new triggers. **Hard rule: M0-005 is read-only on the schema.**
- `service-agent/integrations/**` — no new integrations.
- `service-agent/agents/**` — no AI changes.

### Frontend (MiniMax owns)

**Modified files:**
- `service-agent/public/app.js` — swap the three data sources in the Bookings, Calendar, and Today sections. The seven-section structure stays; only the data layer changes.
- `service-agent/public/i18n/{en,ar,de}.json` — strings for the new status badges (`COLLECTING_INFO`, `NEEDS_HUMAN`, `QUOTED`, `CANCELLED_*`) and the empty / loading / error states.
- `service-agent/public/index.html` — only if new badges or sections need DOM hooks. **No layout redesign.**

**Not touched:**
- `landing-page/**` — the landing form is M0-004's territory; M0-005 does not change it.
- `service-agent/public/cleaner.*` — cleaner view is M0-007.

**New files (frontend, optional):**
- `service-agent/public/components/booking-card.js` (or similar) — small component extraction if `app.js` becomes unmanageable. **Not a goal of M0-005.** The audit's plan called for a shadcn/ui + Radix migration; that's a future refactor, not M0-005.

### Tests

- `service-agent/tests/admin-bookings-read.test.js` — list/detail/calendar read tests.
- `service-agent/tests/slot-overlap.test.js` — overlap query + malformed-date.
- `service-agent/tests/public-bookings-m0.test.js` — extend with the overlap-rejection test.
- `service-agent/tests/integration/dashboard-bookings-v2.test.js` (optional) — full request/response test for the new admin endpoints.

---

## 4. Backend read model plan

### 4.1 The shape of an "admin booking" (the v2 response)

A new function `formatBookingForAdmin(row)` produces:

```jsonc
{
  "id": "book_xyz",                    // bookings_v2.id
  "publicRef": "CR-20260615-001",      // bookings_v2.public_ref
  "status": "QUOTED",                  // bookings_v2.status
  "paymentStatus": "PAYMENT_INSTRUCTIONS_SENT",  // bookings_v2.payment_status (or null)
  "scheduledStart": "2026-07-20T10:00:00+02:00",
  "scheduledEnd":   "2026-07-20T11:00:00+02:00",
  "timezone": "Africa/Cairo",
  "source": "WEB_FORM",
  "language": "en",
  "notes": "...",
  "createdAt": "...",
  "updatedAt": "...",
  "customer": {
    "id": "cust_xyz",
    "fullName": "Nour Hassan",
    "phoneE164": "+201012345678",
    "phoneRaw": "01012345678",
    "email": "nour@example.com",
    "address": "Abu Tig Marina",
    "area": "El Gouna"
  },
  "vehicle": {                        // null if no vehicle was captured
    "id": "veh_xyz",
    "carType": "SEDAN",
    "make": "Toyota",
    "model": "Corolla",
    "plate": "ABC-123"
  },
  "servicePackage": {
    "id": "svc_exterior_sedan",
    "code": "EXTERIOR_SEDAN",
    "nameEn": "Exterior Sedan Wash",
    "nameAr": "غسيل خارجي سيدان",
    "nameDe": "Aussenwaesche Limousine",
    "priceAmount": 35000,             // piasters
    "priceCurrency": "EGP",
    "durationMinutes": 60
  },
  "payment": {                        // null if status is COLLECTING_INFO or NEEDS_HUMAN (M0-003b rule)
    "id": "pay_xyz",
    "status": "PAYMENT_INSTRUCTIONS_SENT",
    "method": "INSTAPAY",
    "amount": 35000,
    "currency": "EGP",
    "submittedAt": null,
    "verifiedAt": null
  },
  "assignment": null,                 // always null in M0-005; populated in M0-007
  "missingFields": [],                // parsed from notes if status is COLLECTING_INFO
  "needsHuman": false
}
```

**Design decisions:**
- **Money is integer piasters, never float.** Same rule as the schema. The dashboard renders `EGP 350.00` (formatted) — formatting is render-time, not in the API.
- **Names come in three languages.** The dashboard picks the variant that matches the owner's `users.language` at render time. The API returns all three so the dashboard can switch without a refetch.
- **Vehicle is null when not captured.** This is the M0-003b reality for `COLLECTING_INFO` bookings; the dashboard must handle `vehicle: null` (render "—" or "Pending").
- **Payment is null when not created.** M0-003b's rule. The dashboard renders "No payment" with a link to the booking detail.
- **Missing fields are parsed from `bookings_v2.notes`** (M0-003's `Missing fields: a, b, c` line). This is a temporary shim. A future M0-005b can add a dedicated `missing_fields` column. **Document this in the code comment.**
- **Assignment is always null in M0-005.** The M0-001 `assignments` table exists; the M0-005 read model includes the LEFT JOIN but always returns `null` because no M0 code path creates `assignments` rows yet. The column is present so M0-007 can drop in without a schema change.

### 4.2 The list query

A single SQL with joins, indexed:

```sql
SELECT
  b.id, b.public_ref, b.status, b.payment_status, b.scheduled_start, b.scheduled_end,
  b.timezone, b.source, b.language, b.notes, b.created_at, b.updated_at,
  c.id AS customer_id, c.full_name, c.phone_e164, c.phone_raw, c.email, c.address, c.area,
  v.id AS vehicle_id, v.car_type, v.make AS v_make, v.model AS v_model, v.plate AS v_plate,
  sp.id AS sp_id, sp.code AS sp_code, sp.name_en, sp.name_ar, sp.name_de,
  sp.duration_minutes, sp.price_amount, sp.price_currency,
  p.id AS payment_id, p.status AS payment_status_row, p.method AS payment_method,
  p.amount AS payment_amount, p.currency AS payment_currency,
  p.submitted_at AS payment_submitted_at, p.verified_at AS payment_verified_at
FROM bookings_v2 b
JOIN customers c ON c.id = b.customer_id AND c.deleted_at IS NULL
LEFT JOIN vehicles v ON v.id = b.vehicle_id AND v.deleted_at IS NULL
JOIN service_packages sp ON sp.id = b.service_package_id AND sp.deleted_at IS NULL
LEFT JOIN payments p ON p.booking_id = b.id
WHERE b.deleted_at IS NULL
  AND (? IS NULL OR b.scheduled_start >= ?)
  AND (? IS NULL OR b.scheduled_start <  ?)
  AND (? IS NULL OR b.status = ?)
  AND (? IS NULL OR b.payment_status = ?)
  AND (? IS NULL OR b.source = ?)
  AND (? IS NULL OR b.language = ?)
ORDER BY b.scheduled_start ASC, b.created_at ASC
LIMIT ? OFFSET ?;
```

**Filters are all optional.** No filter → "all bookings" (capped at `limit`).

**Index check (already in M0-001):**
- `idx_bookings_v2_start` on `booked.scheduled_start` — handles the date-range WHERE.
- `idx_bookings_v2_status` — handles `status = ?`.
- `idx_bookings_v2_payment_status` — handles `payment_status = ?`.
- `idx_bookings_v2_customer_id` — covers the JOIN.

**Pagination:** `limit` default 50, max 500. `offset` default 0. Cursor pagination is a nice-to-have; offset is fine for M0-005 because the volume is small (Red Sea, single city, hour granularity).

**Sort:** `scheduled_start ASC, created_at ASC` (the natural ordering for a calendar view). The dashboard can re-sort client-side if it needs to.

### 4.3 The detail query

Same shape as the list query, filtered by `bookings_v2.id = ?`. One row. Includes `booking_status_history` rows (most recent 50, ordered DESC) and the most recent `payment_events` rows (most recent 20). The detail endpoint is the only one that returns history rows.

### 4.4 The calendar query

A narrower projection for the calendar grid:

```sql
SELECT id, public_ref, status, payment_status, scheduled_start, scheduled_end,
       customer_id, vehicle_id, service_package_id
FROM bookings_v2
WHERE deleted_at IS NULL
  AND scheduled_start >= ?
  AND scheduled_start <  ?
ORDER BY scheduled_start ASC;
```

The dashboard fills in customer name / service name / payment badge by cross-referencing the in-memory list cache (one call to `/api/admin/bookings-v2?dateFrom=...&dateTo=...` powers the whole calendar). The detail endpoint is for click-through.

### 4.5 RBAC and dev bypass

All three new endpoints go behind `requireRole(['OWNER', 'DISPATCHER'])`. The audit's F-SEC-3 dev-bypass gate (env-gated) applies. **The dashboard's existing `requireAuth` middleware is the right wrapper; reuse it.**

### 4.6 Auth and rate limit

- Owner / Dispatcher JWT, validated against the M0-001 `users` table (the `auth.js` from M0-000 already does this).
- Rate limit: 60 req/min per JWT (or per IP if no JWT — but the routes are auth-gated, so per JWT is fine).
- No new public route.

### 4.7 Legacy-route preservation

The M0-003b review's R2 already flagged this: the legacy `/api/bookings`, `/api/calendar`, `/api/bookings/:id/approve`, `/api/bookings/:id/reject` routes **stay alive** in M0-005. They are read/written by the legacy dashboard views (Conversations, Analytics, etc.) that M0-005 does not touch. M0-005b (a separate small ticket) will deprecate them after the dashboard is fully on `bookings_v2`.

---

## 5. Dashboard UI/data plan

### 5.1 Section-by-section

**Today (default landing)**
- **Right now:** `bookings_v2.status IN ('IN_PROGRESS', 'ON_SITE')` — **but these statuses don't exist in the M0 schema yet.** M0-005 renders this block as **empty** with a placeholder card "No jobs in progress. (M0-007 will populate this when the cleaner status flow lands.)" The block is not deleted; it's a deliberate placeholder so M0-007 is a fill-in, not a layout change.
- **Up next:** `bookings_v2.status IN ('ASSIGNED', 'EN_ROUTE')` — same situation. Empty placeholder.
- **Needs approval:** `bookings_v2.status = 'NEEDS_HUMAN'` OR `bookings_v2.payment_status = 'PENDING_REVIEW'`. **This is real data in M0-005.** Render a count and a list (top 5) with a "View all" link to Bookings filtered by status.
- **Unassigned:** `bookings_v2.status = 'QUOTED' AND payments.status = 'PAYMENT_INSTRUCTIONS_SENT' AND NOT EXISTS (assignments)`. Real data. Count + list with "Assign" CTA (greyed out — owner clicks it, but the assign action is M0-007; in M0-005 the button reads "Coming soon" and the click shows a tooltip).
- **Missing info:** `bookings_v2.status = 'COLLECTING_INFO'`. **Real data.** Count + list with a "Open chat" link (handoff ticket is M0-005; chat session is M0-003b's; the link opens a new tab at `/b/<public_ref>?t=<token>`).
- **KPI strip:** today's bookings (count), today's revenue (sum of `payments.amount` where `payments.status = 'VERIFIED'`), % paid (count of `QUOTED+` with verified payment / count of all today's `QUOTED+`). Note: in M0-005, % paid is **always 0%** because no payment can be VERIFIED yet (M0-006 work). Render the number honestly with a "(no verified payments yet)" tooltip.

**Calendar (day/week)**
- Day view: 09:00–17:00 hourly grid, two lanes per hour, color-coded per status. **Colors map to the actual M0 status machine** (not the aspirational plan):
  - gray: `COLLECTING_INFO`
  - blue: `QUOTED`
  - orange: `NEEDS_HUMAN`
  - emerald: `COMPLETED` (none in M0-005; render the color key anyway)
  - red: `CANCELLED_*`
  - emerald-stripe: `BOOKED` (none in M0-005)
- Week view: 7 columns, each cell shows booking count + "+N more" if > 3.
- **No drag-to-reschedule in M0-005.** The audit's R5 / M0-003b review's R3 was that this needs `slot_check` integration. The M0-005 backend adds the overlap query, but the dashboard's drag interaction is M0-005b polish. **Add a "Reschedule" button on the booking detail drawer that opens a small form (date + time pickers), and on submit calls `POST /api/admin/bookings-v2/:id/reschedule`.** This is a single click-to-reschedule, not a drag. The drag is M0-005b.
- **No drag-to-assign in M0-005.** M0-007.

**Bookings (table)**
- Columns: `publicRef`, Customer, Service, Date/Time (Africa/Cairo), Status (badge), Payment (badge), Source, Cleaner ("Unassigned" — M0-007 will fill), Actions.
- Filters: status (multi), payment_status (multi), date range, source, language. **Customer search and service search are M0-005b polish.**
- **Bulk actions: not in M0-005.** One-row actions only: View, Reschedule, Cancel (with reason).
- **No export in M0-005.** That's M0-006+.

**Conversations, Payments, Staff, Settings**
- **Not in M0-005 scope.** They stay on the legacy data path. M0-005 does not touch them. M0-006 will swap Payments to `bookings_v2`; M0-007 will swap Staff.

### 5.2 i18n

Every new string in EN + AR (RTL) + DE. The M0-004 work set the standard: a single `i18n/{en,ar,de}.json` source of truth, no English literals in JSX. M0-005 follows the same rule.

**New strings (minimum):**
- Status badges: `COLLECTING_INFO → "Collecting info" / "بنجمع البيانات" / "Infos sammeln"`, `NEEDS_HUMAN → "Needs human" / "محتاج تدخل" / "Braucht Hilfe"`, `QUOTED → "Quoted" / "تم التسعير" / "Angeboten"`, `CANCELLED → "Cancelled" / "ملغي" / "Storniert"`.
- Empty / loading / error: one set per section.
- KPI tooltip: "No verified payments yet — owner review lands in M0-006."

### 5.3 Safe states

Every list / table / grid renders three states explicitly:

1. **Loading:** skeleton or spinner. **No fake success.**
2. **Empty:** a friendly card in the customer's language. "No bookings yet." / "لسه مفيش حجوزات." / "Noch keine Buchungen."
3. **Error:** a non-modal error with a Retry button. On 401, redirect to `/login`. On 5xx, show a "try again" message and a "contact WhatsApp" link.

### 5.4 Real-time (Socket.io)

- `booking:created` (already emitted by M0-003) → prepend to Today, Bookings, Calendar.
- `booking:updated` (M0-007 will emit; not in M0-005) — render as "no listener registered" silently for now.
- `payment:created`, `payment:updated` — M0-006. Not in M0-005.
- The dashboard's existing Socket.io wiring is good enough. **No new events in M0-005.**

### 5.5 No hardcoded data

Every dashboard card, list, and table calls the new API. The audit's "Today" section's hardcoded agent list is removed. The "Needs approval" card's hardcoded `0` becomes the live count. The Calendar's `calendar_events` fallback is removed from the M0-critical views (Today, Bookings, Calendar) and moved to a deprecation comment in `app.js`. **No fake success anywhere.** This is non-negotiable.

---

## 6. Calendar/slot behavior plan (the M0-003b follow-ups folded in)

### 6.1 Window-overlap query (N2 from M0-003b)

Replace the equality check in `checkSlotConflict` with:

```js
function findOverlappingBookings({ scheduledStart, scheduledEnd, excludeBookingId }) {
  return db.prepare(`
    SELECT id, public_ref, status, scheduled_start, scheduled_end
    FROM bookings_v2
    WHERE deleted_at IS NULL
      AND id != COALESCE(?, '')
      AND status IN ('QUOTED', 'CONFIRMED', 'IN_PROGRESS')
      AND scheduled_start < ?  -- existing.end > new.start  (open interval on the right)
      AND scheduled_end   > ?  -- existing.start < new.end    (open interval on the left)
    LIMIT 1
  `).all(excludeBookingId || null, scheduledEnd, scheduledStart);
}
```

This catches:
- A 60-min service at 10:00 conflicts with a 60-min service at 10:30.
- A 75-min SUV service at 10:00 conflicts with a 60-min sedan at 10:45.
- A 45-min interior add-on at 10:15 conflicts with a 60-min service at 09:30.

**Note on the column:** the schema's `bookings_v2.scheduled_end` exists (M0-001). The M0-003b `checkSlotConflict` only used `scheduled_start`. The new query uses both. **No schema change needed.**

**Index check:** the M0-001 `idx_bookings_v2_start` covers `scheduled_start`; the `scheduled_end` predicate is a non-indexed column but the result set is tiny (today's bookings), and a future M0-005b can add `idx_bookings_v2_end` if needed. **For M0-005, this is fine.**

**Edge case:** the current M0-003 booking always uses 60-min `EXTERIOR_SEDAN`. The new query handles longer and shorter services. **Test it.**

### 6.2 Malformed-date guard (N3 from M0-003b)

In the new `assertNoSlotConflict(normalized, now)`:

```js
const start = new Date(normalized.scheduledStart);
if (Number.isNaN(start.getTime())) {
  return { success: false, status: 'COLLECTING_INFO', missingFields: ['scheduledStart'], message: 'Invalid date format.' };
}
if (start.getTime() < Date.now()) {
  return { success: false, status: 'COLLECTING_INFO', missingFields: ['scheduledStart'], message: 'The requested time is in the past.' };
}
const end = new Date(start.getTime() + servicePackage.durationMinutes * 60 * 1000);
const overlap = findOverlappingBookings({ scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() });
if (overlap.length > 0) {
  return { success: false, status: 'NEEDS_HUMAN', message: 'The requested time slot is unavailable. Please choose a different time or contact us for assistance.' };
}
return null;
```

The malformed-date branch was the one M0-003b missed. M0-005 closes it.

### 6.3 Public-booking refactor

The M0-003b `checkSlotConflict` is replaced by `assertNoSlotConflict` in `service-agent/services/public-bookings.js`. The caller in `createPublicBooking` is updated to use the new return shape (the shape is the same, so the change is one function name + one new parameter). **No behavior change for callers**; the existing tests continue to pass, plus the new overlap test.

---

## 7. API endpoints needed

All routes are owner-only (JWT role in OWNER or DISPATCHER). All read from the M0 schema. None write.

| Method | Path | Purpose | Auth | Rate limit |
|---|---|---|---|---|
| GET | `/api/admin/bookings-v2` | List bookings, filterable | OWNER/DISPATCHER | 60/min/JWT |
| GET | `/api/admin/bookings-v2/:id` | Single booking detail + history | OWNER/DISPATCHER | 60/min/JWT |
| GET | `/api/admin/calendar-v2` | Calendar projection, narrower payload | OWNER/DISPATCHER | 60/min/JWT |
| POST | `/api/admin/bookings-v2/:id/reschedule` | Owner reschedules a booking | OWNER only | 30/min/JWT |

**Query parameters for `/api/admin/bookings-v2`:**
- `dateFrom` (ISO), `dateTo` (ISO) — both optional, both inclusive of start, exclusive of end.
- `status` (single value, repeatable) — filters by `bookings_v2.status`.
- `paymentStatus` (single value, repeatable) — filters by `bookings_v2.payment_status`.
- `source` (single value) — `WEB_FORM` | `CHATBOT` | `WHATSAPP` | `EMAIL` | `OWNER` | `LEGACY`.
- `language` (single value) — `en` | `ar` | `de`.
- `limit` (default 50, max 500), `offset` (default 0).

**Response shape:** `{ success: true, count: N, bookings: [...], hasMore: boolean }`. `hasMore` is `bookings.length === limit` (cheap, correct for the offset pagination we use).

**Reschedule endpoint:**
- Body: `{ newScheduledStart: ISO, reason?: string }`.
- Behavior: calls `assertNoSlotConflict` (the new overlap helper). On success, updates the row, writes `booking_status_history`, emits `booking:updated`. On failure, returns 409 with `{ success: false, code: 'SLOT_UNAVAILABLE', message, suggestedSlots: [] }` (suggested slots populated by the helper in a follow-up if cheap; otherwise empty array for M0-005).
- **Side effect on `assignments`:** none. The reschedule does not change assignment state. If the cleaner can't make the new time, the owner re-assigns via the dashboard in M0-007.
- **No slot reservation lock.** Two concurrent reschedules could race; the DB's transaction will resolve it (one wins, the other gets 409).

**No POST `/api/admin/bookings-v2/:id/cancel` in M0-005.** Cancel is M0-006 (it needs the payment-side state machine to be settled).

---

## 8. Tests required

### 8.1 Backend unit + integration (Claude Code adds)

`service-agent/tests/admin-bookings-read.test.js`:
1. `listBookingsForAdmin returns COLLECTING_INFO bookings without payment rows` — 2 customers, one QUOTED (with payment), one COLLECTING_INFO (no payment). Assert the response shape, the `payment: null` for COLLECTING_INFO, and the missingFields parsing.
2. `listBookingsForAdmin filters by date range` — 3 bookings on 3 dates, filter to 1 day, assert 1 row.
3. `listBookingsForAdmin filters by status and paymentStatus` — multi-value filter, assert only matching rows.
4. `listBookingsForAdmin respects limit and offset` — insert 5, request `limit=2&offset=2`, assert 2 rows + `hasMore: true`.
5. `getBookingDetailForAdmin returns history rows in reverse chronological order` — write 2 status changes, assert order.
6. `getBookingDetailForAdmin returns payment_events for the linked payment` — write 2 events, assert both.
7. `getCalendarForAdmin returns the narrower projection` — assert no customer/vehicle/service fields.

`service-agent/tests/slot-overlap.test.js`:
1. `overlap query catches a 60-min collision at +30 min` — 10:00 booking, 10:30 attempt, both 60 min → conflict.
2. `overlap query catches a 75-min vs 60-min +15 min collision` — 10:00 SUV (75 min, ends 11:15), 10:45 sedan (60 min, ends 11:45) → conflict.
3. `overlap query does not flag a back-to-back booking at the same end` — 10:00–11:00 and 11:00–12:00 → no conflict.
4. `overlap query ignores CANCELLED_* and ABANDONED` — insert a CANCELLED at the same slot, assert no conflict.
5. `malformed scheduledStart returns COLLECTING_INFO, not a crash` — `scheduledStart: 'garbage'`, assert the malformed branch.
6. `past scheduledStart returns COLLECTING_INFO with scheduledStart in missingFields` — assert the past branch.

`service-agent/tests/public-bookings-m0.test.js` (extend):
1. The existing `rejects past scheduledStart` test stays; add a fixture that the start was indeed in the past (was implicit before; now assert explicitly).
2. `rejects overlap, not just exact match` — 10:00 QUOTED booking, 10:30 attempt, assert NEEDS_HUMAN.

**Target test count after M0-005:** 140 → ~155. **Don't pad.** Only add tests that catch real regressions.

### 8.2 Frontend (MiniMax adds)

No new test framework in M0-005. The dashboard's "no test runner" is documented; M0-008 brings Playwright. The M0-004A QA checklist has 12 manual sections; M0-005 needs a parallel `M0_005_QA_CHECKLIST.md` with:
- Empty / loading / error states render correctly (toggle network throttling in DevTools).
- Today, Bookings, Calendar all show the same data.
- Status badges render in EN / AR / DE.
- A booking created via the landing form appears in the dashboard within 2 seconds (Socket.io).
- A booking with no payment row renders "No payment" in the booking detail.
- A booking with `COLLECTING_INFO` shows the missingFields list.
- 401 redirects to `/login`.
- The reschedule drawer rejects a past time and a conflicting time.

### 8.3 No new E2E

E2E is M0-008. M0-005 ends at integration tests + manual QA.

---

## 9. What must NOT be included

| # | Do NOT do | Why |
|---|---|---|
| 1 | Schema changes (new tables, new columns, new triggers, new indexes via migration) | M0-005 is read-only on the schema. |
| 2 | Payment approval / verify / reject UI | M0-006. M0-005 only reads `payments.status`. |
| 3 | Cleaner assignment UI | M0-007. The `assignments` table is read-joined but always null. |
| 4 | Drag-to-reschedule on the calendar | M0-005b polish. M0-005 ships a click-to-reschedule drawer. |
| 5 | Drag-to-assign | M0-007. |
| 6 | New Socket.io events | M0-007 (`booking:updated`, `payment:created`, `payment:updated`). |
| 7 | Removing legacy `/api/bookings` or `/api/calendar` routes | M0-005b deprecation. Other dashboard views still read them. |
| 8 | A real InstaPay API integration | Out of scope. Manual flow only. |
| 9 | Multi-tenant / multi-business | Phase 2. |
| 10 | Social media / marketing / Postiz / TikTok | Phase 2. |
| 11 | New UI framework (shadcn/ui migration) | The audit's plan called for it; it's a future refactor, not M0-005. |
| 12 | Changing the public landing form | M0-004. |
| 13 | Changing the AI orchestrator | Out of scope. M0-005 is read-only on the AI layer. |
| 14 | Adding a `bookings_v2` index via this PR | M0-001's indexes are sufficient. If a follow-up migration is needed, that's M0-005b. |
| 15 | Renaming `bookings_v2` to `bookings` | v2 suffix is intentional (M0-001 review). Dropped in M1. |

---

## 10. Risks and blockers

### R1 — M0-004C must merge before M0-005 starts
- **Severity:** blocker. **Status:** waiting on Opus.
- **Mitigation:** none. Wait for the merge.

### R2 — `bookings_v2` row volume during M0-005 development
- The first M0-004 bookings will be a few manual test submissions. The read model must handle 0, 1, and 100 rows correctly. The empty-state and pagination tests cover this.

### R3 — M0-003's notes-based `missingFields` parsing
- The M0-003 service stores `Missing fields: a, b, c` in `bookings_v2.notes`. The dashboard parses this back out. **Fragile.** If the M0-003 service ever changes the format, the dashboard breaks.
- **Mitigation:** add a small comment in the read layer pointing to the M0-003 source line. Add a test that asserts the parse works. **A dedicated `missing_fields TEXT` column on `bookings_v2` is a M0-005b migration, not this PR.** M0-005b is a small follow-up that also drops the v2 suffix once legacy is gone.

### R4 — Owner JWT scope
- The current `/api/auth/login` (M0-000) returns a JWT for any user in `users` with a `password_hash`. The M0-001 schema has `users.role` with a CHECK constraint (`OWNER` | `DISPATCHER` | `CLEANER`). The M0-005 endpoints need `requireRole(['OWNER', 'DISPATCHER'])`. **This is a middleware, not a new schema.** Verify `auth.js` exposes the right helpers; if not, add a `requireRole` wrapper in M0-005.
- **Mitigation:** include a 1-line test that a `CLEANER` JWT gets 403 on `/api/admin/bookings-v2`.

### R5 — `service-agent` audit gate still red
- The 6 high findings in `socket.io → engine.io → ws` via `@mastra/core` are pre-existing. M0-002c is the ticket. **M0-005 is independent of M0-002c** — M0-005's new code is pure read and does not introduce a new vuln. The CI gate will still fail, but the failure is pre-existing.

### R6 — Live DB has real bookings
- The 27 legacy `bookings` rows are from the audit. M0-005's read model reads `bookings_v2` only; legacy is left alone. **The M0-005 dashboard's Bookings and Calendar will show 0 rows** in dev/staging until M0-004C is live and people start booking. **The empty-state UI is critical.** MiniMax must render a real empty state, not a fake list of test data.

### R7 — The dashboard's "Today" section is mostly empty in M0-005
- "Right now" and "Up next" blocks have no real data (those statuses don't exist). The KPI strip's % paid is always 0. The dashboard will look under-populated.
- **This is correct for M0-005.** M0-005 ships the read model; M0-007 fills in the missing states. The placeholder cards in §5.1 are deliberate. **Do not invent data to make the dashboard look fuller.**

### R8 — Reschedule race conditions
- Two concurrent reschedule requests on the same booking could both pass the overlap check and both update. The DB's transaction serializes the second one; it should fail with a "row changed" error and the route should return 409. **Add a test that asserts this.** If the second wins, the first user's UI shows stale data; Socket.io's `booking:updated` event will refresh it.

### R9 — Timezone correctness
- The `Africa/Cairo` timezone is hardcoded in the M0-003 service's date formatter. The dashboard must render in the same timezone. **Audit the `Date` and `toLocaleString` calls in the dashboard; replace any `new Date().toLocaleString()` (which respects the browser's timezone) with `new Date(...).toLocaleString('en-EG', { timeZone: 'Africa/Cairo' })` for display, and keep the raw ISO in state.** This is a small but easy-to-miss bug.

### R10 — AR (RTL) layout regressions
- The M0-004 work's i18n is structural. M0-005's new status badges, KPI strip, and reschedule drawer must render correctly in RTL. **The M0-005 QA checklist must include a "Switch to Arabic, walk every new section, confirm no horizontal scroll or badge alignment issues" item.**

---

## 11. Exact implementation prompt for Hermes Coding or Claude Code

> **⚠️ USE ONLY AFTER OPUS PASSES M0-004C AND M0-004 IS MERGED INTO `master`. ⚠️**
>
> Do not start this work until `master` contains the M0-004C commit and the live `bookings_v2` table has at least one row created by the new public form.

---

> ## M0-005 — Dashboard Calendar + Booking Board (read model)
>
> **Background.** M0-000 through M0-004 are merged. M0-001 schema is in production. M0-003 public booking API writes real `customers`, `vehicles`, `bookings_v2`, `payments`, `payment_events`, `booking_status_history` rows. M0-003b added `checkSlotConflict` and the COLLECTING_INFO payment-skip. M0-004 wired the landing form. The dashboard currently reads from the legacy `bookings` + `calendar_events` tables; this PR switches it to the M0 schema for the Bookings, Calendar, and Today sections.
>
> **Standing decisions (do not violate):**
> 1. Preserve legacy data. Do not drop, rename, or alter `bookings`, `calendar_events`, `chat_sessions`, `chat_messages`, `admin_credentials`, `social_posts`, `social_analytics`.
> 2. Migrations are forward-only and non-destructive in M0. **M0-005 is READ-ONLY on the schema.** No new tables, no new columns, no new triggers, no new indexes.
> 3. AI must never mark a payment VERIFIED. The DB triggers enforce this; do not weaken them.
> 4. No InstaPay API; manual owner verification only.
> 5. Social/marketing stays Phase 2.
> 6. v2 naming (`bookings_v2`, `conversations_v2`) is the M0 convention; do not rename.
> 7. The legacy `/api/bookings`, `/api/calendar`, `/api/bookings/:id/approve`, `/api/bookings/:id/reject` routes **stay alive**. M0-005b is the deprecation ticket.
> 8. M0-005 does not add new state-machine statuses (no ASSIGNED, EN_ROUTE, ON_SITE, IN_PROGRESS, COMPLETED, NO_SHOW). Render only the M0 schema's actual statuses: COLLECTING_INFO, QUOTED, NEEDS_HUMAN, CANCELLED_*, ABANDONED. M0-007 is the fill-in.
>
> ### M0-005a — Backend (Claude Code, ~2 days)
>
> **New files:**
> - `service-agent/services/admin-bookings-read.js` — read-only query layer. Three functions: `listBookingsForAdmin({ dateFrom, dateTo, status, paymentStatus, source, language, limit, offset })`, `getBookingDetailForAdmin(bookingV2Id)`, `getCalendarForAdmin({ dateFrom, dateTo })`. The response shape is in §4.1 of `docs/M0_REVIEW_PLAN_000_005.md`. **Every field is included, including `missingFields` (parsed from `bookings_v2.notes` if status is COLLECTING_INFO), and `assignment: null` always.**
> - `service-agent/services/slot-overlap.js` — `findOverlappingBookings({ scheduledStart, scheduledEnd, excludeBookingId })` and `assertNoSlotConflict(normalized, servicePackage, now)`. The window-overlap query is in §6.1 of the plan. The malformed-date guard is in §6.2.
> - `service-agent/tests/admin-bookings-read.test.js` — the 7 tests in §8.1.
> - `service-agent/tests/slot-overlap.test.js` — the 6 tests in §8.1.
>
> **Modified files:**
> - `service-agent/services/public-bookings.js` — replace `checkSlotConflict` with the new `assertNoSlotConflict`. Update the caller; the return shape is the same. **No behavior change for callers**; existing tests continue to pass.
> - `service-agent/routes/admin.js` — add four new routes: `GET /api/admin/bookings-v2`, `GET /api/admin/bookings-v2/:id`, `GET /api/admin/calendar-v2`, `POST /api/admin/bookings-v2/:id/reschedule`. **All four are wrapped in `requireRole(['OWNER', 'DISPATCHER'])` (or `requireRole(['OWNER'])` for reschedule).** The reschedule route calls `assertNoSlotConflict` before updating.
> - `service-agent/server.js` — mount the new admin routes. Do not touch the legacy routes.
> - `service-agent/tests/public-bookings-m0.test.js` — add the overlap-rejection test from §8.1.
> - `docs/M0_STATUS.md`, `docs/AGENT_HANDOFF.md`, `docs/IMPLEMENTATION_QUEUE.md` — milestone updates.
>
> **Hard rules:**
> - **No migrations in this PR.** If you need a new index, that's a follow-up M0-005b.
> - **No raw SQL string interpolation.** All queries use `db.prepare` with bound parameters.
> - **Do not remove or rename any legacy route.**
> - **Do not change the M0-001 schema or the 5 payment-safety triggers.**
> - **Do not introduce a new npm dependency.**
> - **Do not change the public endpoint's response shape.**
>
> **Acceptance for M0-005a:**
> - All 140 existing tests pass.
> - 13 new tests pass (7 read + 6 overlap).
> - Total `service-agent` test count goes 140 → 153.
> - A live exercise (run on a temp DB) confirms: list returns 0 rows on empty DB, list returns correct shape with 3 mixed-status bookings, detail returns history + payment events, calendar returns the narrower projection, reschedule rejects past + conflict + malformed.
> - Lint clean, typecheck clean.
> - Legacy `/api/bookings` and `/api/calendar` still work; the new endpoints are additive.
> - `docs/M0_STATUS.md` M0-005a section is written.
>
> ### M0-005b — Frontend (MiniMax, ~3 days, lands after M0-005a)
>
> **Modified files:**
> - `service-agent/public/app.js` — replace the three data sources in Today, Bookings, and Calendar:
>   - `bookingsList = await fetchJsonOrAuth('/api/bookings', 'Bookings')` → `bookingsList = await fetchJsonOrAuth('/api/admin/bookings-v2?...', 'Bookings')`
>   - The calendar grid's data source becomes `/api/admin/calendar-v2?dateFrom=...&dateTo=...`.
>   - **Remove the hardcoded agent list** in the Today section (M0-003 review §2 R2).
>   - **Remove the `calendar_events` fallback** in the Calendar section. Add a `// DEPRECATED: calendar_events is not read by the M0-critical views. M0-005c will remove this.` comment.
> - `service-agent/public/i18n/{en,ar,de}.json` — add the strings listed in §5.2 of the plan.
> - `service-agent/public/index.html` — add `data-testid` hooks on every new badge and CTA. **No layout redesign.**
>
> **New file (docs only):**
> - `docs/M0_005_QA_CHECKLIST.md` — the manual QA checklist from §8.2. Mirror the M0-004A structure: 12 numbered sections.
>
> **Hard rules:**
> - **No fake success fallback.** This is non-negotiable.
> - **No hardcoded data.** Every list / card / grid calls the new API.
> - **No new UI framework.** The audit's plan to migrate to shadcn/ui is a future refactor, not M0-005.
> - **Render `Africa/Cairo` everywhere.** Replace any `toLocaleString()` without `timeZone: 'Africa/Cairo'`.
> - **AR (RTL) layout must work in every new section.** Add an RTL walkthrough to the QA checklist.
>
> **Acceptance for M0-005b:**
> - The M0-005 QA checklist has 12 sections, all marked pass.
> - Three live manual scenarios pass: (a) submit a booking via the landing form, see it appear in the dashboard within 2 seconds; (b) submit a COLLECTING_INFO booking, see "Collecting info" badge + missingFields list; (c) reschedule a booking, see the row move in the calendar.
> - RTL test passes: switch to Arabic, every new section is correctly mirrored, no horizontal scroll.
> - Lint clean.
> - `docs/M0_STATUS.md` M0-005b section is written.
>
> ### M0-005c — Documentation + deprecation prep (Hermes, after M0-005b)
> - Update `docs/rebuild/DASHBOARD_PLAN.md` to reflect the current M0 status machine (not the aspirational one).
> - Add a "M0-005b deprecation window" note to the routes file. The legacy routes stay for one more release.
> - Update `docs/IMPLEMENTATION_QUEUE.md` to flip M0-005 from `TODO` to `DONE` and add M0-005b (deprecation) as a small TODO.
>
> ### What Claude Code and MiniMax should NOT do
> - **Do not start M0-005b before M0-005a merges.**
> - **Do not start M0-006 (payment review) or M0-007 (cleaner assignment) in this PR.**
> - **Do not change the AI orchestrator, the M0-001 schema, or the payment-safety triggers.**
> - **Do not add a new npm dependency.**
> - **Do not introduce a new test framework.** Vitest only.
> - **If you find a scope conflict, stop and ask Hermes before changing scope.**
>
> ### Reporting back
> - When the PR is ready for review, post a summary with: the diffstat, the new test count, the live-exercise output (paste the run), and any deviations from this prompt.

---

## 12. Memory update draft (DO NOT APPLY YET)

This is the draft text. **Do not write it to disk until M0-004C merges and M0-005 starts.**

### `docs/M0_STATUS.md` — append (after the M0-003b review section, before any future sections):

```markdown
---

## M0-005 Planning (2026-06-15, Hermes)

M0-005 is **planned but not yet started**. M0-004C must merge first.

### M0-005 split
- **M0-005a (Claude Code, ~2 days):** backend read model. New endpoints
  `/api/admin/bookings-v2`, `/api/admin/bookings-v2/:id`,
  `/api/admin/calendar-v2`, `POST /api/admin/bookings-v2/:id/reschedule`.
  Window-overlap slot check + malformed-date guard (closes M0-003b N2/N3).
  **No schema changes.** 13 new tests, total 140 → 153.
- **M0-005b (MiniMax, ~3 days, after M0-005a):** dashboard SPA reads
  from the new endpoints. Today, Bookings, Calendar sections swap.
  No fake success. RTL must work. i18n strings in EN/AR/DE.
  M0-005 QA checklist with 12 manual sections.
- **M0-005c (Hermes, after M0-005b):** update `DASHBOARD_PLAN.md` to
  reflect the actual M0 status machine; mark the legacy routes for
  deprecation; flip M0-005 to DONE in the queue.

### Standing decisions reaffirmed
- M0-005 is **read-only** on the schema. No new tables, no new
  columns, no new triggers, no new indexes via this PR.
- Legacy `/api/bookings`, `/api/calendar`, and approve/reject routes
  **stay alive** in M0-005. Deprecation is M0-005b+ (separate ticket).
- M0-005 does **not** add the M0-007 state-machine states
  (ASSIGNED, EN_ROUTE, ON_SITE, IN_PROGRESS, COMPLETED, NO_SHOW).
  Render only the M0 schema's actual statuses.
- Owner JWT scope: `requireRole(['OWNER', 'DISPATCHER'])` for reads,
  `requireRole(['OWNER'])` for reschedule.
- Africa/Cairo timezone is the only render timezone.

### Out of scope (M0-005)
- Payment approval UI (M0-006).
- Cleaner assignment UI (M0-007).
- Drag-to-reschedule / drag-to-assign (M0-005b polish at earliest).
- New Socket.io events (M0-007).
- shadcn/ui migration (future refactor).
- Multi-tenant / multi-business (Phase 2).
- Social media / marketing (Phase 2).
- Real InstaPay API (out of scope, manual only).

### Open risks tracked
- R3: M0-003's notes-based `missingFields` parsing. M0-005b adds a
  dedicated `missing_fields TEXT` column.
- R4: `requireRole` middleware existence — verify in M0-005a.
- R5: `service-agent` audit gate red (6 pre-existing highs in
  `socket.io` chain). M0-002c is the ticket, not M0-005.
- R7: The dashboard's "Right now" and "Up next" blocks will be empty
  in M0-005. This is correct; M0-007 fills them in.
- R8: Reschedule race conditions. Transaction serialization + 409.
- R9: Timezone correctness in the dashboard. Every `toLocaleString`
  needs `timeZone: 'Africa/Cairo'`.
- R10: AR (RTL) regressions. The M0-005 QA checklist has a dedicated
  RTL walkthrough.

### Next action (gated on M0-004C merge)
- **Hermes:** wait for Opus's M0-004C final pass + merge. Do not
  start M0-005a until `master` contains the M0-004C commit.
- **Claude Code:** ready to start M0-005a the moment the merge lands.
  The exact prompt is in `docs/M0_REVIEW_PLAN_000_005.md` §11.
- **MiniMax:** ready to start M0-005b the moment M0-005a merges.

### Full plan
- `docs/M0_REVIEW_PLAN_000_005.md` (this file).
```

### `docs/AGENT_HANDOFF.md` — append (after the M0-003b verified subsection):

```markdown
## M0-005 Planned, Blocked on M0-004C Merge (2026-06-15, Hermes)

- M0-005 planning complete. Three sub-tickets: M0-005a (backend read model),
  M0-005b (frontend SPA swap), M0-005c (docs + deprecation).
- **Blocked on M0-004C merge.** Opus is reviewing; do not start M0-005a
  until `master` contains the M0-004C commit.
- The plan closes the two open M0-003b follow-ups (window-overlap slot
  check + malformed-date guard) as part of M0-005a.
- No schema changes in M0-005. M0-005 is read-only on the DB schema.
- The dashboard's empty/loading/error states are critical. No fake
  success anywhere.
- Full plan: `docs/M0_REVIEW_PLAN_000_005.md`.

### Recommended next PRs (in order)
1. M0-004C merge (Opus's call).
2. M0-005a (Claude Code): backend read model + slot-overlap refinement.
3. M0-005b (MiniMax): dashboard SPA swap + i18n + QA checklist.
4. M0-005c (Hermes): docs + deprecation prep.
5. M0-002c (Claude Code, parallel with 2-4): resolve the pre-existing
   `service-agent` audit gate failure.
6. M0-006 (Claude Code): payment review queue.
7. M0-007 (Claude Code + MiniMax): cleaner assignment + status flow.
8. M0-008 (QA + MiniMax): Playwright E2E in EN/AR/DE.
```

### Do-not-apply reminder

**These drafts are not in the working tree.** The user (you) said: "Do not merge branches. Do not start dashboard live-data work until Opus says M0-004C is PASS and merged." The memory drafts will be applied by Hermes **after** M0-004C merges, as the first act of M0-005. Until then, this plan lives only in `docs/M0_REVIEW_PLAN_000_005.md`.

---

*End of planning report.*
