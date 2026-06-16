// ============================================================================
// Carshine Red Sea — M0-004B Dashboard Design Preview (UI only)
//
// Renders the 7 dashboard sections from the DESIGN_ONLY_MOCKS data so the
// design team can review layout, copy, empty/loading/error states, and
// responsive behavior without touching the live backend.
//
// Hard rule: nothing here calls the API. Everything is in-memory.
// Hard rule: no payment can be marked VERIFIED from this preview.
// ============================================================================

import {
  DESIGN_BANNER,
  TODAY_BOOKINGS,
  LIVE_INBOX,
  CALENDAR_BOARD,
  PAYMENT_REVIEW_QUEUE,
  CLEANERS,
  AI_AUTOPILOT,
  HUMAN_TAKEOVERS,
  UI_STATES,
  STATUS_LABELS,
  PAYMENT_LABELS
} from './DESIGN_ONLY_MOCKS.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---- Helpers ---------------------------------------------------------------

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateLong(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });
}

function formatRelative(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

function showState(cardEl, state) {
  // data-state on the card drives the empty/loading/error visibility.
  $$('.preview-state', cardEl).forEach(el => {
    el.hidden = el.dataset.state !== state;
  });
}

// ---- Section 1: Today's bookings -------------------------------------------

function renderToday() {
  const card = $('#todayCard');
  const list = $('#todayList');
  if (!list) return;

  // Update filter counts.
  const counts = TODAY_BOOKINGS.reduce((acc, b) => {
    acc.all = (acc.all || 0) + 1;
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});
  $$('[data-count]', card).forEach(el => {
    const key = el.dataset.count;
    el.textContent = counts[key] || 0;
  });

  function draw(filter) {
    const rows = TODAY_BOOKINGS
      .filter(b => filter === 'all' || b.status === filter)
      .map(b => {
        const statusLabel = STATUS_LABELS[b.status] || b.status;
        const paymentPill = b.paymentStatus
          ? `<span class="preview-pill" data-payment="${b.paymentStatus}">${PAYMENT_LABELS[b.paymentStatus] || b.paymentStatus}</span>`
          : '';
        const missing = b.missingFields && b.missingFields.length
          ? `<span class="preview-pill" data-status="COLLECTING_INFO">Missing: ${b.missingFields.map(humanize).join(', ')}</span>`
          : '';
        return `
          <article class="preview-booking-row" role="listitem" tabindex="0" aria-label="Booking ${b.publicRef} for ${b.customer.name}">
            <div class="preview-booking-time">
              <strong>${formatTime(b.scheduledStart)}</strong>
              <small>${b.durationMinutes} min</small>
            </div>
            <div class="preview-booking-main">
              <span class="preview-booking-title">${b.publicRef} · ${b.customer.name}</span>
              <span class="preview-booking-sub">${b.area} · ${b.locationType} · ${b.car} · ${b.servicePackage.name}</span>
            </div>
            <div class="preview-booking-pills">
              <span class="preview-pill" data-status="${b.status}">${statusLabel}</span>
              ${paymentPill}
              ${missing}
            </div>
          </article>
        `;
      });
    list.innerHTML = rows.join('');

    // Switch between list / empty state.
    if (rows.length === 0) {
      list.hidden = true;
      showState(card, 'empty');
    } else {
      list.hidden = false;
      showState(card, 'ready');
    }
  }

  draw('all');

  $$('.preview-chip', card).forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.preview-chip', card).forEach(c => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      draw(chip.dataset.filter);
    });
  });

  // Demo the error state on demand.
  // (Left commented out so the page always loads clean.)
  // setTimeout(() => showState(card, 'error'), 100);
}

function humanize(field) {
  return String(field)
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ---- Section 2: Live inbox ------------------------------------------------

function renderInbox() {
  const list = $('#inboxList');
  if (!list) return;
  list.innerHTML = LIVE_INBOX.map(m => {
    const dot = m.unread ? '<span class="preview-unread-dot" aria-label="Unread"></span>' : '';
    return `
      <li class="preview-inbox-item" role="listitem" tabindex="0" aria-label="Message from ${m.customer.name}">
        <span class="preview-channel-icon" data-channel="${m.channel}">${m.channel.slice(0, 3)}</span>
        <div class="preview-inbox-main">
          <span class="preview-inbox-name">${m.customer.name} ${dot}</span>
          <span class="preview-inbox-preview">${m.preview}</span>
        </div>
        <span class="preview-inbox-time">${formatRelative(m.timestamp)}</span>
      </li>
    `;
  }).join('');
}

// ---- Section 3: Calendar / board ------------------------------------------

function renderCalendar() {
  const board = $('#calendarBoard');
  const dateLabel = $('#calendarDate');
  if (!board) return;
  if (dateLabel) dateLabel.textContent = formatDateLong(CALENDAR_BOARD.date + 'T00:00:00');
  board.innerHTML = CALENDAR_BOARD.slots.map(s => {
    const chips = s.bookings.length
      ? s.bookings.map(b => {
          // Find the booking to know its status (for chip color).
          const booking = TODAY_BOOKINGS.find(t => t.publicRef === b);
          const status = booking?.status || 'QUOTED';
          const display = b.includes('(collecting-info)')
            ? `${b} <small>collecting</small>`
            : booking
              ? `<strong>${b}</strong><small>${booking.customer.name.split(' ')[0]}</small>`
              : `<strong>${b}</strong>`;
          return `<span class="preview-slot-chip" data-status="${status}">${display}</span>`;
        }).join('')
      : '';
    return `
      <div class="preview-slot-time">${s.hour}</div>
      <div class="preview-slot-content">${chips}</div>
    `;
  }).join('');
}

// ---- Section 4: Payment review --------------------------------------------

function renderPayments() {
  const list = $('#paymentsList');
  if (!list) return;
  list.innerHTML = PAYMENT_REVIEW_QUEUE.map(p => {
    const status = PAYMENT_LABELS[p.status] || p.status;
    return `
      <li class="preview-payment-item" role="listitem" tabindex="0" aria-label="Payment ${p.id} for ${p.customer.name}">
        <span class="preview-channel-icon" data-channel="EMAIL">PAY</span>
        <div class="preview-payment-main">
          <span class="preview-payment-name">${p.publicRef} · ${p.customer.name}</span>
          <span class="preview-payment-sub">${p.amount} ${p.currency} via ${p.method} · ${p.note}</span>
        </div>
        <span class="preview-payment-meta">
          <span class="preview-pill" data-payment="${p.status}">${status}</span>
          <br><small>${formatRelative(p.receivedAt)}</small>
        </span>
      </li>
    `;
  }).join('');
}

// ---- Section 5: Cleaner assignment ----------------------------------------

function renderCleaners() {
  const grid = $('#cleanersGrid');
  if (!grid) return;
  grid.innerHTML = CLEANERS.map(c => {
    const initials = c.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const onShift = c.status === 'on-shift';
    const assignments = c.assignedBookingIds.length
      ? c.assignedBookingIds.map(id => `<span class="preview-slot-chip" data-status="CONFIRMED">${id}</span>`).join('')
      : '<span class="preview-cleaner-empty">No bookings assigned</span>';
    return `
      <article class="preview-cleaner-card" data-cleaner-id="${c.id}" aria-label="Cleaner ${c.name}">
        <div class="preview-cleaner-head">
          <div class="preview-cleaner-avatar" aria-hidden="true">${initials}</div>
          <div>
            <div class="preview-cleaner-name">${c.name}</div>
            <div class="preview-cleaner-shift">${c.shift.start} – ${c.shift.end}</div>
          </div>
        </div>
        <span class="preview-cleaner-status" data-on-shift="${onShift}">${onShift ? 'On shift' : 'Off shift'}</span>
        <div class="preview-cleaner-assignments">${assignments}</div>
      </article>
    `;
  }).join('');
}

// ---- Section 6: AI autopilot ---------------------------------------------

function renderAutopilot() {
  const toggle = $('#autopilotToggle');
  const pill = $('#autopilotPill');
  const handled = $('#autopilotHandled');
  const escalated = $('#autopilotEscalated');
  const modelList = $('#modelList');
  const channelList = $('#channelList');

  if (handled) handled.textContent = AI_AUTOPILOT.handledLast7Days;
  if (escalated) escalated.textContent = AI_AUTOPILOT.escalatedLast7Days;
  if (modelList) {
    modelList.innerHTML = AI_AUTOPILOT.models.map(m =>
      `<li><strong>${m.label}</strong><small>${m.role}</small></li>`
    ).join('');
  }
  if (channelList) {
    channelList.innerHTML = AI_AUTOPILOT.channels.map(c =>
      `<li><strong>${c.label}</strong><small>${c.routed}</small></li>`
    ).join('');
  }

  function sync() {
    const on = !!toggle?.checked;
    if (pill) {
      pill.dataset.on = String(on);
      pill.textContent = on ? 'Autopilot on' : 'Autopilot off';
    }
  }
  toggle?.addEventListener('change', sync);
  sync();
}

// ---- Section 7: Human takeover --------------------------------------------

function renderTakeover() {
  const list = $('#takeoverList');
  if (!list) return;
  list.innerHTML = HUMAN_TAKEOVERS.map(t => `
    <li class="preview-takeover-item" role="listitem" tabindex="0" aria-label="Active takeover with ${t.customer.name}">
      <span class="preview-channel-icon" data-channel="${t.channel}">${t.channel.slice(0, 3)}</span>
      <div class="preview-takeover-main">
        <span class="preview-takeover-name">${t.customer.name}</span>
        <span class="preview-takeover-sub">${t.reason}</span>
      </div>
      <span class="preview-takeover-meta">since ${formatRelative(t.startedAt)}</span>
      <button class="preview-takeover-action" type="button">Open thread</button>
    </li>
  `).join('');
}

// ---- Banner ---------------------------------------------------------------

function renderBanner() {
  const banner = $('#designBannerText');
  if (banner && DESIGN_BANNER?.text) banner.textContent = DESIGN_BANNER.text;
}

// ---- Demo controls (off by default) ---------------------------------------
// These are exposed on window so a reviewer can flip the page into loading
// or error states for each section. Keeps the design review fast.
function wireStateDemo() {
  window.__preview = {
    setState(section, state) {
      const card = document.getElementById(`${section}Card`);
      if (card) showState(card, state);
    },
    sections: ['today', 'inbox', 'calendar', 'payments', 'autopilot', 'takeover']
  };
}

// ---- Boot -----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  renderBanner();
  renderToday();
  renderInbox();
  renderCalendar();
  renderPayments();
  renderCleaners();
  renderAutopilot();
  renderTakeover();
  wireStateDemo();
});
