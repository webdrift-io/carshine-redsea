'use strict';
/* eslint-disable no-undef */
/**
 * CarShine Red Sea — Operations Console v4
 * webdrift.io design system. Every button is wired via addEventListener
 * to a real API call. Every event is delegated to a single dispatcher so
 * dynamic content (kanban cards, payment rows) works.
 */

const API = (() => ({
  get token() { return localStorage.getItem('carshine_admin_token') || localStorage.getItem('carshine_token') || ''; },
  set token(v) {
    if (!v) return;
    localStorage.setItem('carshine_admin_token', v);
    localStorage.removeItem('carshine_token');
  },
  clearToken() {
    localStorage.removeItem('carshine_admin_token');
    localStorage.removeItem('carshine_token');
  },
  async fetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    let res;
    try { res = await fetch(path, { ...opts, headers }); }
    catch (e) { throw new Error(`Network error: ${e.message}`); }
    if (!res.ok) {
      let detail = '';
      try { const body = await res.json(); detail = body.error || body.message || JSON.stringify(body).slice(0, 200); }
      catch (_e) { detail = await res.text().catch(() => ''); }
      const err = new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      err.status = res.status;
      err.detail = detail;
      if (res.status === 401) showAuthGate('Please log in to continue.');
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }
}))();

const state = {
  bookings: [], allBookings: [], payments: [], staff: [], chats: [], customers: [], calendar: [],
  leads: [], contacts: [], joinRequests: [], followUps: [], media: [],
  refreshTimer: null,
  user: null
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(v) { return (Number(v) || 0).toLocaleString() + ' EGP'; }
function timeOnly(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch (_e) { return '—'; }
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); }
  catch (_e) { return '—'; }
}
function statusClass(s) {
  return {
    'NEW': 'new', 'COLLECTING_INFO': 'pending', 'QUOTED': 'pending',
    'BOOKED': 'booked', 'ASSIGNED': 'assigned', 'ON_THE_WAY': 'assigned',
    'IN_PROGRESS': 'assigned', 'COMPLETED': 'completed', 'CANCELLED': 'cancelled',
    'NEEDS_HUMAN': 'pending', 'VERIFIED': 'verified', 'REJECTED': 'rejected',
    'SUBMITTED': 'pending', 'pending': 'pending', 'waiting_approval': 'pending',
    'approved': 'verified', 'rejected': 'rejected'
  }[s] || 'info';
}

function normalizeDispatchStatus(status = '') {
  const s = String(status || '').toUpperCase();
  return {
    pending: 'NEW',
    confirmed: 'ASSIGNED',
    rejected: 'CANCELLED'
  }[String(status || '')] || s;
}

function listFromResponse(response, keys) {
  for (const key of keys) {
    if (Array.isArray(response?.[key])) return response[key];
  }
  return Array.isArray(response) ? response : [];
}

function paymentCustomerName(p) { return p.customer?.name || p.customer_name || '—'; }
function paymentCustomerPhone(p) { return p.customer?.phone || p.customer_phone || '—'; }
function paymentPublicRef(p) { return p.publicRef || p.public_ref || p.bookingId || p.booking_id || '—'; }
function paymentBookingId(p) { return p.bookingId || p.booking_id || ''; }
function paymentBookingStatus(p) { return p.booking?.status || p.booking_status || '—'; }
function paymentAmount(p) { return Number(p.amountPiasters ?? p.amount ?? 0); }
function paymentSubmittedAt(p) { return p.submittedAt || p.submitted_at || p.createdAt || p.created_at; }
function paymentScreenshotUrl(p) { return p.screenshotUrl || p.screenshot_url || ''; }
function paymentRejectionReason(p) { return p.rejectionReason || p.rejection_reason || ''; }
function isReviewablePayment(p) { return ['SUBMITTED', 'PAYMENT_PENDING_REVIEW'].includes(p.status); }

function toast(msg, type = 'info', durationMs = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show alert ${type}`;
  setTimeout(() => t.className = 'toast', durationMs);
}

function currentRole() {
  const role = state.user?.role;
  return role === 'admin' ? 'OWNER' : role;
}

function isOwner() {
  return currentRole() === 'OWNER';
}

function showAuthGate(message = '') {
  const gate = document.getElementById('auth-gate');
  const err = document.getElementById('auth-error');
  if (message && err) {
    err.textContent = message;
    err.classList.add('show');
  }
  if (gate) {
    gate.classList.add('open');
    gate.setAttribute('aria-hidden', 'false');
  }
}

function hideAuthGate() {
  const gate = document.getElementById('auth-gate');
  const err = document.getElementById('auth-error');
  if (err) err.classList.remove('show');
  if (gate) {
    gate.classList.remove('open');
    gate.setAttribute('aria-hidden', 'true');
  }
}

async function verifyAuth() {
  if (!API.token) {
    if (new URLSearchParams(location.search).has('login')) showAuthGate();
    return false;
  }
  try {
    const r = await API.fetch('/api/auth/verify');
    state.user = r.user || null;
    hideAuthGate();
    applyRoleUi();
    return true;
  } catch (_e) {
    API.clearToken();
    showAuthGate('Your session expired. Please log in again.');
    return false;
  }
}

async function login(event) {
  event.preventDefault();
  const btn = document.getElementById('login-submit');
  const err = document.getElementById('auth-error');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (err) err.classList.remove('show');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new Error(body.error || `Login failed (${res.status})`);
    API.token = body.token;
    state.user = body.user || null;
    hideAuthGate();
    applyRoleUi();
    toast('Logged in', 'success');
    await refreshCurrent();
  } catch (e) {
    if (err) {
      err.textContent = e.message;
      err.classList.add('show');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function applyRoleUi() {
  const ownerOnly = isOwner();
  ['ap-test-btn', 'ap-start-btn', 'ap-stop-btn', 'autopilot-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('data-owner-only', '');
  });
  document.querySelectorAll('[data-owner-only]').forEach(el => {
    el.disabled = !ownerOnly;
    el.title = ownerOnly ? '' : 'Owner role required';
    el.style.opacity = ownerOnly ? '' : '0.55';
  });
}

function renderErrorRow(tbodyId, colspan, error) {
  const el = document.getElementById(tbodyId);
  if (!el) return;
  const msg = error?.status === 403 ? 'You do not have permission for this action.' : (error?.message || 'Failed to load');
  el.innerHTML = `<tr><td colspan="${colspan}" class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(msg)}</td></tr>`;
}

function setTableLoading(tbodyId, colspan, label) {
  const el = document.getElementById(tbodyId);
  if (el) el.innerHTML = `<tr><td colspan="${colspan}" class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>${escapeHtml(label || 'Loading…')}</td></tr>`;
}

document.getElementById('admin-login-form')?.addEventListener('submit', login);

// ============================================================================
// Page routing
// ============================================================================
const pageLoaders = {
  overview: refreshOverview,
  bookings: loadBookings,
  dispatch: loadDispatch,
  payments: loadPayments,
  inbox: loadInbox,
  leads: loadLeads,
  contacts: loadContacts,
  followups: loadFollowUps,
  join: loadJoinRequests,
  customers: loadCustomers,
  staff: loadStaff,
  calendar: loadCalendar,
  portal: () => {},
  marketing: loadAutopilot,
  media: loadMedia,
  reports: loadReports
};

function setPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  const nav = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');
  const title = nav?.textContent?.trim().split(/\s+/).slice(0, 2).join(' ') || name;
  document.getElementById('page-title').textContent = title;
  const loader = pageLoaders[name];
  if (loader) Promise.resolve(loader()).catch(err => console.error(`[${name}]`, err));
}

async function refreshCurrent() {
  const active = document.querySelector('.page.active');
  if (!active) return;
  const loader = pageLoaders[active.id.replace('page-', '')];
  if (loader) await Promise.resolve(loader()).catch(err => console.error(err));
  toast('Refreshed', 'success', 1500);
}

// Wire all nav items
document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', (e) => { e.preventDefault(); setPage(n.dataset.page); });
});

document.querySelector('.menu-toggle')?.addEventListener('click', () => {
  document.querySelector('.app')?.classList.toggle('sidebar-collapsed');
});

document.getElementById('global-search')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q) { toast('Type a customer name, phone, or booking reference first.', 'info'); return; }
  setPage('customers');
  const input = document.getElementById('cust-search');
  if (input) input.value = q;
  loadCustomers();
});

// ============================================================================
// OVERVIEW
// ============================================================================
async function refreshOverview() {
  const [bRes, pRes, cRes, verifiedRes] = await Promise.all([
    API.fetch('/api/admin/dispatch/board').catch(() => ({ bookings: [] })),
    API.fetch('/api/admin/payments?status=PAYMENT_PENDING_REVIEW').catch(() => ({ payments: [] })),
    API.fetch('/api/chats').catch(() => ({ chats: [] })),
    API.fetch('/api/admin/payments?status=VERIFIED&limit=100').catch(() => ({ payments: [] }))
  ]);
  const bizRes = await API.fetch('/api/admin/business/summary').catch(() => ({ summary: {} }));
  state.bookings = listFromResponse(bRes, ['bookings']);
  state.payments = listFromResponse(pRes, ['items', 'payments']);
  state.chats = listFromResponse(cRes, ['chats']);
  const verified = listFromResponse(verifiedRes, ['items', 'payments']);

  const today = new Date().toISOString().slice(0, 10);
  const todayBookings = state.bookings.map(b => ({ ...b, status: normalizeDispatchStatus(b.status) })).filter(b => {
    const when = b.scheduled_start || b.legacyDate || b.preferredDate;
    return when && when.slice(0, 10) === today;
  });

  document.getElementById('kpi-today').textContent = todayBookings.length;
  document.getElementById('kpi-today-sub').textContent = todayBookings.length === 0 ? 'no bookings yet today' : `${todayBookings.filter(b => b.status === 'COMPLETED').length} completed`;
  document.getElementById('kpi-payments').textContent = state.payments.length;
  const revenueTotal = verified.reduce((s, x) => s + paymentAmount(x), 0);
  document.getElementById('kpi-revenue').textContent = fmtMoney(revenueTotal);
  document.getElementById('kpi-chats').textContent = state.chats.length;
  const conv = state.chats.length === 0 ? 0
    : Math.round((state.bookings.filter(b => b.status !== 'pending').length / state.chats.length) * 100);
  document.getElementById('kpi-conversion').textContent = conv + '%';

  document.getElementById('nav-payments-count').textContent = state.payments.length;
  document.getElementById('nav-dispatch-count').textContent = todayBookings.filter(b => ['NEW', 'COLLECTING_INFO', 'QUOTED', 'BOOKED'].includes(b.status)).length;
  const leadsBadge = document.getElementById('nav-leads-count');
  if (leadsBadge) leadsBadge.textContent = bizRes.summary?.openLeads || 0;

  const tbody = document.getElementById('today-tbody');
  if (todayBookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty"><i class="fa-regular fa-calendar"></i>No bookings today</td></tr>';
  } else {
    tbody.innerHTML = todayBookings.map(b => `
      <tr>
        <td><strong>${timeOnly(b.scheduled_start || b.legacyDate || b.preferredDate)}</strong></td>
        <td>${escapeHtml(b.customerName || '—')}</td>
        <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(b.phone || '—')}</code></td>
        <td>${escapeHtml(b.area || '—')}</td>
        <td>${escapeHtml(b.service || b.package || '—')}</td>
        <td><span class="status s-${statusClass(b.status)}">${b.status}</span></td>
        <td><span class="status s-${statusClass(b.paymentStatus || 'UNPAID')}">${b.paymentStatus || 'UNPAID'}</span></td>
      </tr>
    `).join('');
  }
  document.getElementById('today-sub').textContent = `${today} · ${todayBookings.length} booking${todayBookings.length !== 1 ? 's' : ''}`;
  document.getElementById('conn-dot').className = 'dot';
  document.getElementById('conn-text').textContent = 'Live';
}

// ============================================================================
// DISPATCH (Kanban)
// ============================================================================
function bookingPlanName(b) {
  return b.service?.name || b.serviceName || b.package || b.packageName || b.service || b.service_code || '—';
}

function bookingPrice(b) {
  return Number(b.service?.pricePiasters ?? b.pricePiasters ?? b.price_amount ?? b.price ?? b.amount ?? 0);
}

function bookingCustomerName(b) {
  return b.customer?.name || b.customerName || b.customer_name || '—';
}

function bookingPhone(b) {
  return b.customer?.phone || b.phone || b.phone_raw || b.phone_e164 || '—';
}

function bookingWhen(b) {
  return b.scheduledStart || b.scheduled_start || b.legacyDate || b.preferredDate || b.createdAt || b.created_at;
}

function bookingId(b) {
  return b.id || b.bookingV2Id || b.bookingId || b.booking_id || '';
}

async function loadBookings() {
  setTableLoading('bookings-tbody', 9, 'Loading bookings and plans…');
  try {
    const params = new URLSearchParams({ limit: '200' });
    const status = document.getElementById('booking-status')?.value || '';
    const paymentStatus = document.getElementById('booking-payment-status')?.value || '';
    if (status) params.set('status', status);
    if (paymentStatus) params.set('paymentStatus', paymentStatus);
    const r = await API.fetch(`/api/admin/bookings-v2?${params.toString()}`);
    state.allBookings = listFromResponse(r, ['bookings', 'items']);
    const tbody = document.getElementById('bookings-tbody');
    if (!state.allBookings.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty"><i class="fa-solid fa-clipboard-list"></i>No bookings match this filter. New website and Layla bookings will appear here.</td></tr>';
      return;
    }
    tbody.innerHTML = state.allBookings.map(b => `
      <tr>
        <td>${fmtDateTime(bookingWhen(b))}</td>
        <td><strong>${escapeHtml(bookingCustomerName(b))}</strong></td>
        <td><code style="font-size:11px;color:var(--text-2);">${escapeHtml(bookingPhone(b))}</code></td>
        <td>${escapeHtml(bookingPlanName(b))}</td>
        <td>${bookingPrice(b) ? fmtMoney(bookingPrice(b)) : '—'}</td>
        <td>${escapeHtml(b.area || b.customer?.area || '—')}</td>
        <td><span class="status s-${statusClass(b.status)}">${escapeHtml(b.status || '—')}</span></td>
        <td><span class="status s-${statusClass(b.paymentStatus || b.payment_status || 'UNPAID')}">${escapeHtml(b.paymentStatus || b.payment_status || 'UNPAID')}</span></td>
        <td><button class="btn sm" data-action="booking-detail" data-id="${escapeHtml(bookingId(b))}"><i class="fa-solid fa-eye"></i> Open</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="booking-detail"]').forEach(btn => btn.addEventListener('click', () => openBookingDetail(btn.dataset.id)));
  } catch (e) {
    renderErrorRow('bookings-tbody', 9, e);
  }
}

function openBookingDetail(id) {
  const b = state.allBookings.find(x => bookingId(x) === id) || state.bookings.find(x => bookingId(x) === id);
  if (!b) { toast('Booking not found', 'error'); return; }
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>${escapeHtml(bookingCustomerName(b))}</h2>
    <p class="modal-sub">${escapeHtml(bookingPlanName(b))} · ${fmtDateTime(bookingWhen(b))}</p>
    <div class="panel" style="padding:12px;margin-bottom:12px;">
      <p><strong>Phone:</strong> ${escapeHtml(bookingPhone(b))}</p>
      <p><strong>Area:</strong> ${escapeHtml(b.area || b.customer?.area || '—')}</p>
      <p><strong>Price:</strong> ${bookingPrice(b) ? fmtMoney(bookingPrice(b)) : '—'}</p>
      <p><strong>Status:</strong> <span class="status s-${statusClass(b.status)}">${escapeHtml(b.status || '—')}</span></p>
      <p><strong>Payment:</strong> <span class="status s-${statusClass(b.paymentStatus || b.payment_status || 'UNPAID')}">${escapeHtml(b.paymentStatus || b.payment_status || 'UNPAID')}</span></p>
    </div>
    <div class="form-group">
      <label>Update booking status</label>
      <select id="booking-detail-status">${['NEW','COLLECTING_INFO','QUOTED','BOOKED','ASSIGNED','ON_THE_WAY','IN_PROGRESS','COMPLETED','CANCELLED','NEEDS_HUMAN']
        .map(s => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div class="form-group"><label>Admin note / reason</label><input id="booking-detail-note" placeholder="Optional reason or note"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn primary" id="booking-detail-save">Save status</button>
      ${bookingPhone(b) !== '—' ? `<a class="btn" href="${getCustomerWhatsAppUrl(bookingPhone(b))}" target="_blank"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>` : ''}
      <button class="btn ghost" id="booking-detail-close">Close</button>
    </div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('booking-detail-close').addEventListener('click', closeModal);
  document.getElementById('booking-detail-save').addEventListener('click', async () => {
    try {
      await API.fetch(`/api/bookings/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: document.getElementById('booking-detail-status').value, reason: document.getElementById('booking-detail-note').value })
      });
      toast('Booking updated', 'success');
      closeModal();
      loadBookings();
      refreshOverview();
    } catch (e) { toast(e.message, 'error', 5000); }
  });
}

async function loadDispatch() {
  setTableLoading('dispatch-progress-tbody', 9, 'Loading operations progress…');
  try {
    const r = await API.fetch('/api/admin/bookings-v2?limit=200');
    state.bookings = listFromResponse(r, ['bookings', 'items']).map(b => ({ ...b, status: normalizeDispatchStatus(b.status) }));
  } catch (e) {
    renderErrorRow('dispatch-progress-tbody', 9, e);
    state.bookings = [];
    return;
  }
  const open = state.bookings.filter(b => !['COMPLETED', 'CANCELLED'].includes(b.status));
  const paid = state.bookings.reduce((sum, b) => sum + Number(b.payment?.amountPiasters || b.payment?.amount || 0), 0);
  const cost = state.bookings.reduce((sum, b) => sum + Number(b.ops?.operationalCost || 0), 0);
  document.getElementById('ops-open').textContent = open.length;
  document.getElementById('ops-paid').textContent = fmtMoney(paid);
  document.getElementById('ops-cost').textContent = fmtMoney(cost);
  document.getElementById('ops-profit').textContent = fmtMoney(paid - cost);
  const tbody = document.getElementById('dispatch-progress-tbody');
  if (!state.bookings.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty"><i class="fa-solid fa-truck-fast"></i>No bookings yet. New bookings will appear here as operations progress.</td></tr>';
    return;
  }
  tbody.innerHTML = state.bookings.map(b => {
    const paidAmount = Number(b.payment?.amountPiasters || b.payment?.amount || 0);
    const opCost = Number(b.ops?.operationalCost || 0);
    const washesNeeded = Number(b.ops?.washesNeeded || 1);
    const washesCompleted = Number(b.ops?.washesCompleted || 0);
    const vehicle = b.vehicle ? [b.vehicle.make, b.vehicle.model, b.vehicle.carType, b.vehicle.plate].filter(Boolean).join(' · ') : 'No car saved';
    return `
      <tr>
        <td><strong>${escapeHtml(bookingCustomerName(b))}</strong><br><small style="color:var(--text-3);">${escapeHtml(vehicle)}</small></td>
        <td>${escapeHtml(b.area || b.customer?.area || '—')}<br><small style="color:var(--text-3);">${escapeHtml(b.address || '—')}</small></td>
        <td><strong>${washesCompleted}/${washesNeeded}</strong><br><small style="color:var(--text-3);">${escapeHtml(bookingPlanName(b))}</small></td>
        <td>${paidAmount ? fmtMoney(paidAmount) : '<span class="status s-info">No payment</span>'}</td>
        <td>${opCost ? fmtMoney(opCost) : '<span class="status s-info">No cost</span>'}</td>
        <td><strong>${fmtMoney(paidAmount - opCost)}</strong></td>
        <td>${b.assignment?.cleaner?.displayName ? `${escapeHtml(b.assignment.cleaner.displayName)}<br><small style="color:var(--text-3);">${escapeHtml(b.assignment.cleaner.phone || '')}</small>` : '<span class="status s-pending">Unassigned</span>'}</td>
        <td><small>Last: ${b.ops?.lastWashAt ? fmtDateTime(b.ops.lastWashAt) : '—'}</small><br><small>Next: ${b.ops?.nextWashAt ? fmtDateTime(b.ops.nextWashAt) : fmtDateTime(bookingWhen(b))}</small></td>
        <td><button class="btn sm" data-action="ops-edit" data-id="${escapeHtml(bookingId(b))}">Edit</button> <button class="btn sm" data-action="booking-detail" data-id="${escapeHtml(bookingId(b))}">Status</button></td>
      </tr>
    `;
  }).join('');
  tbody.querySelectorAll('[data-action="ops-edit"]').forEach(btn => btn.addEventListener('click', () => openOpsEdit(btn.dataset.id)));
  tbody.querySelectorAll('[data-action="booking-detail"]').forEach(btn => btn.addEventListener('click', () => openBookingDetail(btn.dataset.id)));
}

function openOpsEdit(id) {
  const b = state.bookings.find(x => bookingId(x) === id);
  if (!b) return toast('Booking not found', 'error');
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>Operations finance</h2>
    <p class="modal-sub">${escapeHtml(bookingCustomerName(b))} · ${escapeHtml(bookingPlanName(b))}</p>
    <div class="form-row">
      <div class="form-group"><label>Washes needed</label><input id="ops-washes-needed" type="number" min="1" value="${Number(b.ops?.washesNeeded || 1)}"></div>
      <div class="form-group"><label>Washes completed</label><input id="ops-washes-completed" type="number" min="0" value="${Number(b.ops?.washesCompleted || 0)}"></div>
      <div class="form-group"><label>Investment / cost (EGP)</label><input id="ops-cost-input" type="number" min="0" value="${Number(b.ops?.operationalCost || 0)}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Last wash</label><input id="ops-last" type="datetime-local"></div>
      <div class="form-group"><label>Next wash</label><input id="ops-next" type="datetime-local"></div>
    </div>
    <div class="form-group"><label>Owner notes</label><textarea id="ops-owner-notes" rows="4">${escapeHtml(b.ops?.ownerNotes || '')}</textarea></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="ops-save">Save progress</button><button class="btn ghost" id="ops-close">Close</button></div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('ops-close').addEventListener('click', closeModal);
  document.getElementById('ops-save').addEventListener('click', async () => {
    try {
      await API.fetch(`/api/admin/bookings-v2/${encodeURIComponent(id)}/ops`, {
        method: 'PATCH',
        body: JSON.stringify({
          washesNeeded: document.getElementById('ops-washes-needed').value,
          washesCompleted: document.getElementById('ops-washes-completed').value,
          operationalCost: document.getElementById('ops-cost-input').value,
          lastWashAt: document.getElementById('ops-last').value,
          nextWashAt: document.getElementById('ops-next').value,
          ownerNotes: document.getElementById('ops-owner-notes').value
        })
      });
      toast('Operations progress saved', 'success');
      closeModal();
      loadDispatch();
    } catch (e) { toast(e.message, 'error', 5000); }
  });
}

function openBooking(id) {
  const b = state.bookings.find(x => x.id === id);
  if (!b) { toast('Booking not found', 'error'); return; }
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>${escapeHtml(b.customerName || 'Booking')}</h2>
    <p class="modal-sub">${timeOnly(b.scheduled_start || b.legacyDate || b.preferredDate)} · ${escapeHtml(b.area || '—')} · <span class="status s-${statusClass(b.status)}">${b.status || 'pending'}</span></p>
    <div class="form-group">
      <label>New status</label>
      <select id="new-status">
        ${['NEW','COLLECTING_INFO','QUOTED','BOOKED','ASSIGNED','ON_THE_WAY','IN_PROGRESS','COMPLETED','CANCELLED','NEEDS_HUMAN']
          .map(s => `<option ${b.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Reason (optional)</label><input id="new-status-reason" placeholder="e.g. customer requested" /></div>
    <div style="display:flex;gap:8px;">
      <button class="btn primary" id="save-status-btn"><i class="fa-solid fa-check"></i> Save</button>
      <button class="btn ghost" id="close-modal-btn">Close</button>
    </div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('save-status-btn').addEventListener('click', () => saveBookingStatus(id));
  document.getElementById('close-modal-btn').addEventListener('click', closeModal);
}

async function saveBookingStatus(id) {
  const status = document.getElementById('new-status').value;
  const reason = document.getElementById('new-status-reason')?.value || '';
  try {
    const r = await API.fetch(`/api/bookings/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, reason })
    });
    toast(`Booking ${r.bookingId?.slice(0,12)}… → ${status}`, 'success');
    closeModal();
    await refreshOverview();
    loadDispatch();
  } catch (e) {
    toast('Failed: ' + e.message, 'error', 5000);
  }
}

function closeModal() {
  document.getElementById('modal-bg').classList.remove('open');
}
document.getElementById('modal-bg').addEventListener('click', (e) => {
  if (e.target.id === 'modal-bg') closeModal();
});

// ============================================================================
// PAYMENTS
// ============================================================================
async function loadPayments() {
  const status = document.getElementById('pay-filter').value;
  setTableLoading('payments-tbody', 8, `Loading ${status.toLowerCase()} payments…`);
  try {
    const r = await API.fetch(`/api/admin/payments?status=${encodeURIComponent(status)}&limit=200`);
    state.payments = listFromResponse(r, ['items', 'payments']);
    renderPayments();
  } catch (e) {
    renderErrorRow('payments-tbody', 8, e);
  }
}

function renderPayments() {
  const tbody = document.getElementById('payments-tbody');
  if (state.payments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty"><i class="fa-solid fa-money-bill"></i>No payments in this state</td></tr>';
    return;
  }
  tbody.innerHTML = state.payments.map(p => `
    <tr>
      <td>${fmtDateTime(paymentSubmittedAt(p))}</td>
      <td><strong>${escapeHtml(paymentCustomerName(p))}</strong></td>
      <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(paymentPublicRef(p))}</code></td>
      <td>${escapeHtml(p.method)}</td>
      <td><strong>${fmtMoney(paymentAmount(p))}</strong></td>
      <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(p.reference || '—')}</code></td>
      <td>${paymentScreenshotUrl(p) ? `<a href="${paymentScreenshotUrl(p)}" target="_blank" class="btn sm">View proof</a>` : '<span class="status s-info">No file</span>'}</td>
      <td>
        <button class="btn sm" data-action="payment-detail" data-id="${p.id}"><i class="fa-solid fa-circle-info"></i> Details</button>
        ${isReviewablePayment(p) ? `
          <button class="btn sm success" data-action="verify" data-owner-only data-id="${p.id}"><i class="fa-solid fa-check"></i> Verify</button>
          <button class="btn sm danger" data-action="reject" data-owner-only data-id="${p.id}"><i class="fa-solid fa-xmark"></i> Reject</button>
        ` : `<span class="status s-${statusClass(p.status)}">${p.status}</span>${paymentRejectionReason(p) ? `<br><small style="color:var(--text-3);">${escapeHtml(paymentRejectionReason(p))}</small>` : ''}`}
      </td>
    </tr>
  `).join('');

  // Event delegation for verify/reject buttons
  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'verify') verifyPayment(id);
      else if (btn.dataset.action === 'reject') rejectPayment(id);
      else if (btn.dataset.action === 'payment-detail') openPaymentDetail(id);
    });
  });
  applyRoleUi();
}

document.getElementById('pay-filter').addEventListener('change', loadPayments);

async function verifyPayment(id) {
  if (!isOwner()) { toast('Owner role required to verify payments', 'error'); return; }
  if (!confirm('Verify this payment? Booking will move to BOOKED.')) return;
  try {
    const r = await API.fetch(`/api/admin/payments/${id}/verify`, { method: 'POST', body: '{}' });
    const bookingId = r.bookingId || r.payment?.bookingId || paymentBookingId(state.payments.find(p => p.id === id) || {});
    toast(`Payment verified${bookingId ? ` · booking ${bookingId.slice(0,12)}…` : ''}`, 'success');
    loadPayments();
    refreshOverview();
  } catch (e) {
    toast('Failed: ' + e.message, 'error', 5000);
  }
}

async function rejectPayment(id) {
  if (!isOwner()) { toast('Owner role required to reject payments', 'error'); return; }
  const reason = prompt('Reason for rejection (sent to customer):');
  if (!reason) return;
  try {
    await API.fetch(`/api/admin/payments/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
    toast('Payment rejected', 'success');
    loadPayments();
    refreshOverview();
  } catch (e) {
    toast('Failed: ' + e.message, 'error', 5000);
  }
}

function openPaymentDetail(id) {
  const p = state.payments.find(item => item.id === id);
  if (!p) { toast('Payment not found in the current list', 'error'); return; }
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>Payment ${escapeHtml(p.id)}</h2>
    <p class="modal-sub">${escapeHtml(paymentCustomerName(p))} · ${escapeHtml(paymentPublicRef(p))}</p>
    <div class="panel" style="margin:0 0 12px;padding:12px;">
      <table class="tbl">
        <tbody>
          <tr><th>Status</th><td><span class="status s-${statusClass(p.status)}">${escapeHtml(p.status || '—')}</span></td></tr>
          <tr><th>Method</th><td>${escapeHtml(p.method || '—')}</td></tr>
          <tr><th>Amount</th><td>${fmtMoney(paymentAmount(p))}</td></tr>
          <tr><th>Reference</th><td><code>${escapeHtml(p.reference || '—')}</code></td></tr>
          <tr><th>Submitted</th><td>${fmtDateTime(paymentSubmittedAt(p))}</td></tr>
          <tr><th>Booking status</th><td>${escapeHtml(paymentBookingStatus(p))}</td></tr>
          <tr><th>Customer phone</th><td><code>${escapeHtml(paymentCustomerPhone(p))}</code></td></tr>
          <tr><th>Proof</th><td>${paymentScreenshotUrl(p) ? `<a class="btn sm" target="_blank" href="${paymentScreenshotUrl(p)}">Open uploaded proof</a>` : 'No uploaded proof file'}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${isReviewablePayment(p) ? `<button class="btn success" data-owner-only id="detail-verify-btn">Verify</button><button class="btn danger" data-owner-only id="detail-reject-btn">Reject</button>` : ''}
      <button class="btn ghost" id="detail-close-btn">Close</button>
    </div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('detail-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('detail-verify-btn')?.addEventListener('click', () => verifyPayment(id));
  document.getElementById('detail-reject-btn')?.addEventListener('click', () => rejectPayment(id));
  applyRoleUi();
}

// ============================================================================
// INBOX + TEST WHATSAPP
// ============================================================================
async function loadInbox() {
  setTableLoading('inbox-tbody', 6, 'Loading live chat sessions…');
  const sub = document.getElementById('inbox-sub');
  if (sub) sub.textContent = 'Loading live chat sessions…';
  try {
    const r = await API.fetch('/api/chats');
    state.chats = listFromResponse(r, ['chats']);
    renderInbox();
  } catch (e) {
    renderErrorRow('inbox-tbody', 6, e);
    if (sub) sub.textContent = 'Inbox API failed to load.';
  }
}

function renderInbox() {
  const tbody = document.getElementById('inbox-tbody');
  const sub = document.getElementById('inbox-sub');
  if (state.chats.length === 0) {
    if (sub) sub.textContent = 'Connected to /api/chats. No conversations found yet.';
    tbody.innerHTML = '<tr><td colspan="6" class="empty"><i class="fa-solid fa-comments"></i>No chats yet — start a test WhatsApp above</td></tr>';
    return;
  }
  if (sub) sub.textContent = `Connected to /api/chats · ${state.chats.length} conversation${state.chats.length !== 1 ? 's' : ''}`;
  tbody.innerHTML = state.chats.slice(0, 50).map(c => `
    <tr>
      <td>${fmtDateTime(c.updated_at || c.lastActivityAt || c.updatedAt || c.createdAt || c.created_at)}</td>
      <td><strong>${escapeHtml(c.customerName || c.customer_name || c.phone || '—')}</strong></td>
      <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(c.phone || '—')}</code></td>
      <td>${escapeHtml(String(c.lastMessage?.text || c.last_message || c.summary || '').slice(0, 80))}</td>
      <td><span class="status s-${statusClass(c.status)}">${c.status || 'OPEN'}</span></td>
      <td><button class="btn sm" data-action="chat-detail" data-id="${escapeHtml(c.id)}"><i class="fa-solid fa-eye"></i> Open</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('button[data-action="chat-detail"]').forEach(btn => {
    btn.addEventListener('click', () => openChatDetail(btn.dataset.id));
  });
}

function openChatDetail(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) { toast('Chat not found in the current inbox list', 'error'); return; }
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const details = chat.bookingDetails || chat.booking_details || {};
  const intent = details.intent || details.package || chat.package || chat.summary || chat.lastMessage?.text || 'Conversation intent not classified yet';
  const rows = messages.length ? messages.slice(-12).map(m => `
    <div style="padding:8px 10px;margin-bottom:6px;border:1px solid var(--ring);border-radius:10px;background:${m.sender === 'customer' ? 'var(--card-2)' : 'var(--accent-soft)'};">
      <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:4px;">
        <strong style="font-size:11px;text-transform:uppercase;color:var(--text-2);">${escapeHtml(m.sender || 'message')}</strong>
        <span style="font-size:11px;color:var(--text-3);">${fmtDateTime(m.timestamp || m.created_at)}</span>
      </div>
      <div style="white-space:pre-wrap;">${escapeHtml(m.text || '')}</div>
    </div>
  `).join('') : '<div class="empty" style="padding:20px;">No messages saved for this chat yet.</div>';
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>${escapeHtml(chat.customerName || chat.customer_name || chat.phone || 'Conversation')}</h2>
    <p class="modal-sub">${escapeHtml(chat.phone || 'No phone')} · <span class="status s-${statusClass(chat.status)}">${escapeHtml(chat.status || 'OPEN')}</span> · ${messages.length} message${messages.length !== 1 ? 's' : ''}</p>
    <div class="panel" style="padding:12px;margin-bottom:12px;">
      <p><strong>Lead intent:</strong> ${escapeHtml(String(intent).slice(0, 220))}</p>
      <p><strong>Language:</strong> ${escapeHtml(chat.language || 'en')} · <strong>Updated:</strong> ${fmtDateTime(chat.updatedAt || chat.updated_at || chat.createdAt || chat.created_at)}</p>
    </div>
    <div class="panel" style="margin:0 0 12px;padding:12px;max-height:420px;overflow:auto;">${rows}</div>
    <div class="form-group"><label>Send WhatsApp/admin reply</label><textarea id="chat-outbound-message" rows="3" placeholder="Write a message to send via configured Meta/Twilio provider"></textarea></div>
    <div class="form-group"><label>Follow-up note</label><input id="chat-followup-note" placeholder="e.g. Call customer about Premium plan"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${chat.phone ? `<a class="btn primary" target="_blank" href="${getCustomerWhatsAppUrl(chat.phone)}"><i class="fa-brands fa-whatsapp"></i> Open WhatsApp</a>` : ''}
      <button class="btn" id="chat-send-btn"><i class="fa-solid fa-paper-plane"></i> Send via provider</button>
      <button class="btn" id="chat-followup-btn"><i class="fa-solid fa-list-check"></i> Create follow-up</button>
      <button class="btn ghost" id="chat-close-btn">Close</button>
    </div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('chat-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('chat-send-btn')?.addEventListener('click', async () => {
    const message = document.getElementById('chat-outbound-message').value.trim();
    if (!chat.phone || !message) return toast('Phone and message are required', 'error');
    try {
      await API.fetch('/api/admin/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({ phone: chat.phone, name: chat.customerName || chat.customer_name, message })
      });
      toast('WhatsApp message sent/logged', 'success');
      closeModal();
      loadInbox();
    } catch (e) {
      toast(e.status === 503 ? 'WhatsApp provider is not configured yet. Message was not sent.' : e.message, 'error', 5000);
    }
  });
  document.getElementById('chat-followup-btn')?.addEventListener('click', async () => {
    const note = document.getElementById('chat-followup-note').value.trim() || `Follow up with ${chat.customerName || chat.phone || 'chat lead'}`;
    try {
      await API.fetch('/api/admin/follow-ups', {
        method: 'POST',
        body: JSON.stringify({ title: note, channel: 'whatsapp', notes: `Chat session: ${chat.id}` })
      });
      toast('Follow-up created from chat', 'success');
      closeModal();
    } catch (e) { toast(e.message, 'error', 5000); }
  });
}

function normalizeEgyptMobileForWhatsApp(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `20${digits.slice(1)}`;
  return digits;
}

function getCustomerWhatsAppUrl(phone) {
  const n = normalizeEgyptMobileForWhatsApp(phone);
  return n ? `https://wa.me/${n}` : '#';
}

function openTestWhatsApp() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2><i class="fa-brands fa-whatsapp" style="color:#22c55e;"></i> Test WhatsApp → Layla</h2>
    <p class="modal-sub">Simulate an inbound WhatsApp message. Same code path as Meta's webhook.</p>
    <div class="form-group"><label>Customer phone (E.164)</label><input id="wa-phone" value="+201****7205" /></div>
    <div class="form-group"><label>Customer name</label><input id="wa-name" value="WhatsApp Test" /></div>
    <div class="form-group"><label>Message</label><textarea id="wa-message" rows="3">hi, I want a full detail tomorrow at 10am in El Gouna</textarea></div>
    <div style="display:flex;gap:8px;">
      <button class="btn primary" id="wa-send-btn"><i class="fa-solid fa-paper-plane"></i> Send to Layla</button>
      <button class="btn ghost" id="wa-close-btn">Close</button>
    </div>
    <div id="wa-result" style="margin-top:14px;"></div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('wa-send-btn').addEventListener('click', sendTestWhatsApp);
  document.getElementById('wa-close-btn').addEventListener('click', closeModal);
}

async function sendTestWhatsApp() {
  const phone = document.getElementById('wa-phone').value.trim();
  const name = document.getElementById('wa-name').value.trim();
  const message = document.getElementById('wa-message').value.trim();
  if (!phone || !message) { toast('Phone and message required', 'error'); return; }
  const out = document.getElementById('wa-result');
  out.innerHTML = '<div class="alert info">Layla is thinking…</div>';
  try {
    const r = await API.fetch('/api/admin/test/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ phone, name, message })
    });
    out.innerHTML = `
      <div class="alert success"><i class="fa-solid fa-check"></i> Layla replied${r.bookingCreated ? ` · booking <code>${r.bookingId}</code> created` : ''}${r.humanNeeded ? ' · human handoff requested' : ''}</div>
      <div class="form-group"><label>Layla's reply</label><textarea rows="6" readonly>${escapeHtml(r.reply)}</textarea></div>
    `;
    loadInbox();
    refreshOverview();
  } catch (e) {
    out.innerHTML = '<div class="alert error">' + escapeHtml(e.message) + '</div>';
  }
}

// ============================================================================
// BUSINESS OPS: LEADS / CONTACTS / FOLLOW-UPS / JOIN / MEDIA
// ============================================================================
function statusOptions(current, values) {
  return values.map(v => `<option value="${v}" ${current === v ? 'selected' : ''}>${v}</option>`).join('');
}

async function loadLeads() {
  setTableLoading('leads-tbody', 8, 'Loading leads…');
  try {
    const q = document.getElementById('lead-search')?.value || '';
    const status = document.getElementById('lead-status')?.value || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    const r = await API.fetch(`/api/admin/leads?${params.toString()}`);
    state.leads = r.leads || [];
    const badge = document.getElementById('nav-leads-count');
    if (badge) badge.textContent = state.leads.filter(l => !['won', 'lost', 'closed'].includes(l.status)).length;
    const tbody = document.getElementById('leads-tbody');
    if (!state.leads.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty"><i class="fa-solid fa-address-card"></i>No leads yet. Contact form, join form, chatbot, or manual leads will appear here.</td></tr>';
      return;
    }
    tbody.innerHTML = state.leads.map(l => `
      <tr>
        <td>${fmtDateTime(l.createdAt)}</td>
        <td><strong>${escapeHtml(l.name || 'Unknown')}</strong><br><small style="color:var(--text-3);">${escapeHtml(l.intent || '')}</small></td>
        <td>${escapeHtml(l.email || '—')}<br><code style="font-size:11px;color:var(--text-2);">${escapeHtml(l.phone || '—')}</code></td>
        <td><span class="status s-info">${escapeHtml(l.source)}</span></td>
        <td>${escapeHtml(l.interest || '—')}</td>
        <td><select data-action="lead-status" data-id="${l.id}">${statusOptions(l.status, ['new','contacted','qualified','won','lost','closed'])}</select></td>
        <td>${l.nextFollowUpAt ? fmtDateTime(l.nextFollowUpAt) : '—'}</td>
        <td><button class="btn sm" data-action="lead-note" data-id="${l.id}"><i class="fa-solid fa-pen"></i> Note</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="lead-status"]').forEach(el => el.addEventListener('change', () => updateLead(el.dataset.id, { status: el.value })));
    tbody.querySelectorAll('[data-action="lead-note"]').forEach(btn => btn.addEventListener('click', () => openLeadNote(btn.dataset.id)));
  } catch (e) {
    renderErrorRow('leads-tbody', 8, e);
  }
}

async function updateLead(id, body) {
  try {
    await API.fetch(`/api/admin/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast('Lead updated', 'success');
    loadLeads();
  } catch (e) {
    toast(e.message, 'error', 5000);
  }
}

function openLeadNote(id) {
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>${escapeHtml(lead.name || 'Lead')}</h2>
    <p class="modal-sub">${escapeHtml(lead.source)} · ${escapeHtml(lead.phone || lead.email || 'no contact')}</p>
    <div class="form-group"><label>Notes</label><textarea id="lead-note-text" rows="5">${escapeHtml(lead.notes || '')}</textarea></div>
    <div class="form-group"><label>Next follow-up date/time</label><input id="lead-follow-at" type="datetime-local" /></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="lead-save-note">Save</button><button class="btn ghost" id="lead-close">Close</button></div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('lead-save-note').addEventListener('click', () => updateLead(id, {
    notes: document.getElementById('lead-note-text').value,
    nextFollowUpAt: document.getElementById('lead-follow-at').value
  }).then(closeModal));
  document.getElementById('lead-close').addEventListener('click', closeModal);
}

function openAddLead() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>Add lead</h2>
    <p class="modal-sub">Manual leads are useful for phone calls, walk-ins, and referrals.</p>
    <div class="form-row"><div class="form-group"><label>Name</label><input id="new-lead-name"></div><div class="form-group"><label>Phone</label><input id="new-lead-phone"></div></div>
    <div class="form-row"><div class="form-group"><label>Email</label><input id="new-lead-email"></div><div class="form-group"><label>Interest</label><input id="new-lead-interest" placeholder="Premium plan, fleet, etc."></div></div>
    <div class="form-group"><label>Notes / intent</label><textarea id="new-lead-notes" rows="4"></textarea></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="new-lead-save">Create</button><button class="btn ghost" id="new-lead-close">Close</button></div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('new-lead-close').addEventListener('click', closeModal);
  document.getElementById('new-lead-save').addEventListener('click', async () => {
    try {
      await API.fetch('/api/admin/leads', { method: 'POST', body: JSON.stringify({
        source: 'manual',
        name: document.getElementById('new-lead-name').value,
        phone: document.getElementById('new-lead-phone').value,
        email: document.getElementById('new-lead-email').value,
        interest: document.getElementById('new-lead-interest').value,
        notes: document.getElementById('new-lead-notes').value
      }) });
      toast('Lead created', 'success');
      closeModal();
      loadLeads();
    } catch (e) { toast(e.message, 'error', 5000); }
  });
}

async function loadContacts() {
  setTableLoading('contacts-tbody', 7, 'Loading contact forms…');
  try {
    const params = new URLSearchParams();
    const q = document.getElementById('contact-search')?.value || '';
    const status = document.getElementById('contact-status')?.value || '';
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    const r = await API.fetch(`/api/admin/contact-submissions?${params.toString()}`);
    state.contacts = r.contacts || [];
    const tbody = document.getElementById('contacts-tbody');
    if (!state.contacts.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty"><i class="fa-solid fa-envelope-open-text"></i>No contact form submissions yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.contacts.map(c => `
      <tr>
        <td>${fmtDateTime(c.createdAt)}</td><td><strong>${escapeHtml(c.name)}</strong></td><td>${escapeHtml(c.email || '—')}</td>
        <td><code style="font-size:11px;color:var(--text-2);">${escapeHtml(c.phone || '—')}</code></td>
        <td>${escapeHtml(c.message).slice(0, 120)}</td>
        <td><select data-action="contact-status" data-id="${c.id}">${statusOptions(c.status, ['new','contacted','closed'])}</select></td>
        <td><button class="btn sm" data-action="contact-note" data-id="${c.id}">Notes</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="contact-status"]').forEach(el => el.addEventListener('change', () => updateContact(el.dataset.id, { status: el.value })));
    tbody.querySelectorAll('[data-action="contact-note"]').forEach(btn => btn.addEventListener('click', () => openContactNote(btn.dataset.id)));
  } catch (e) { renderErrorRow('contacts-tbody', 7, e); }
}

async function updateContact(id, body) {
  await API.fetch(`/api/admin/contact-submissions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  toast('Contact updated', 'success');
  loadContacts();
}

function openContactNote(id) {
  const item = state.contacts.find(c => c.id === id);
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>${escapeHtml(item.name)}</h2><p class="modal-sub">${escapeHtml(item.email || '')} ${escapeHtml(item.phone || '')}</p>
    <div class="form-group"><label>Original message</label><textarea rows="4" readonly>${escapeHtml(item.message)}</textarea></div>
    <div class="form-group"><label>Follow-up notes</label><textarea id="contact-follow-note" rows="4">${escapeHtml(item.followUpNotes || '')}</textarea></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="contact-note-save">Save</button><button class="btn ghost" id="contact-note-close">Close</button></div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('contact-note-close').addEventListener('click', closeModal);
  document.getElementById('contact-note-save').addEventListener('click', () => updateContact(id, { followUpNotes: document.getElementById('contact-follow-note').value }).then(closeModal));
}

async function loadFollowUps() {
  setTableLoading('followups-tbody', 6, 'Loading follow-ups…');
  try {
    const status = document.getElementById('followup-status')?.value || '';
    const r = await API.fetch(`/api/admin/follow-ups${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    state.followUps = r.followUps || [];
    const tbody = document.getElementById('followups-tbody');
    if (!state.followUps.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty"><i class="fa-solid fa-list-check"></i>No follow-ups yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.followUps.map(f => `
      <tr><td>${f.dueAt ? fmtDateTime(f.dueAt) : '—'}</td><td><strong>${escapeHtml(f.title)}</strong></td><td>${escapeHtml(f.channel)}</td>
      <td><span class="status s-${f.status === 'done' ? 'verified' : 'pending'}">${f.status}</span></td><td>${escapeHtml(f.notes || '—')}</td>
      <td>${f.status !== 'done' ? `<button class="btn sm success" data-action="fu-done" data-id="${f.id}">Done</button>` : '—'}</td></tr>
    `).join('');
    tbody.querySelectorAll('[data-action="fu-done"]').forEach(btn => btn.addEventListener('click', () => updateFollowUp(btn.dataset.id, { status: 'done' })));
  } catch (e) { renderErrorRow('followups-tbody', 6, e); }
}

async function updateFollowUp(id, body) {
  await API.fetch(`/api/admin/follow-ups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  toast('Follow-up updated', 'success');
  loadFollowUps();
}

function openAddFollowUp() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>Add follow-up</h2>
    <div class="form-group"><label>Title</label><input id="new-fu-title" placeholder="Call Ahmed about Premium plan"></div>
    <div class="form-row"><div class="form-group"><label>Channel</label><select id="new-fu-channel"><option>whatsapp</option><option>phone</option><option>email</option></select></div><div class="form-group"><label>Due</label><input id="new-fu-due" type="datetime-local"></div></div>
    <div class="form-group"><label>Notes</label><textarea id="new-fu-notes" rows="3"></textarea></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="new-fu-save">Create</button><button class="btn ghost" id="new-fu-close">Close</button></div>`;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('new-fu-close').addEventListener('click', closeModal);
  document.getElementById('new-fu-save').addEventListener('click', async () => {
    try {
      await API.fetch('/api/admin/follow-ups', { method: 'POST', body: JSON.stringify({
        title: document.getElementById('new-fu-title').value,
        channel: document.getElementById('new-fu-channel').value,
        dueAt: document.getElementById('new-fu-due').value,
        notes: document.getElementById('new-fu-notes').value
      }) });
      toast('Follow-up created', 'success');
      closeModal();
      loadFollowUps();
    } catch (e) { toast(e.message, 'error', 5000); }
  });
}

async function loadJoinRequests() {
  setTableLoading('join-tbody', 7, 'Loading join requests…');
  try {
    const params = new URLSearchParams();
    const q = document.getElementById('join-search')?.value || '';
    const status = document.getElementById('join-status')?.value || '';
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    const r = await API.fetch(`/api/admin/join-requests?${params.toString()}`);
    state.joinRequests = r.requests || [];
    const tbody = document.getElementById('join-tbody');
    if (!state.joinRequests.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty"><i class="fa-solid fa-handshake-angle"></i>No join requests yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state.joinRequests.map(j => `
      <tr><td>${fmtDateTime(j.createdAt)}</td><td><strong>${escapeHtml(j.name)}</strong></td>
      <td>${escapeHtml(j.email || '—')}<br><code style="font-size:11px;color:var(--text-2);">${escapeHtml(j.phone || '—')}</code></td>
      <td>${escapeHtml(j.roleType)}</td><td>${escapeHtml(j.message || '—').slice(0, 120)}</td>
      <td><select data-action="join-status" data-id="${j.id}">${statusOptions(j.status, ['new','reviewing','accepted','rejected'])}</select></td>
      <td><button class="btn sm" data-action="join-note" data-id="${j.id}">Notes</button></td></tr>
    `).join('');
    tbody.querySelectorAll('[data-action="join-status"]').forEach(el => el.addEventListener('change', () => updateJoin(el.dataset.id, { status: el.value })));
    tbody.querySelectorAll('[data-action="join-note"]').forEach(btn => btn.addEventListener('click', () => openJoinNote(btn.dataset.id)));
  } catch (e) { renderErrorRow('join-tbody', 7, e); }
}

async function updateJoin(id, body) {
  await API.fetch(`/api/admin/join-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  toast('Join request updated', 'success');
  loadJoinRequests();
}

function openJoinNote(id) {
  const item = state.joinRequests.find(j => j.id === id);
  const modal = document.getElementById('modal');
  modal.innerHTML = `<h2>${escapeHtml(item.name)}</h2><p class="modal-sub">${escapeHtml(item.roleType)}</p>
    <div class="form-group"><label>Application message</label><textarea rows="4" readonly>${escapeHtml(item.message || '')}</textarea></div>
    <div class="form-group"><label>Admin notes</label><textarea id="join-admin-note" rows="4">${escapeHtml(item.adminNotes || '')}</textarea></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="join-note-save">Save</button><button class="btn ghost" id="join-note-close">Close</button></div>`;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('join-note-close').addEventListener('click', closeModal);
  document.getElementById('join-note-save').addEventListener('click', () => updateJoin(id, { adminNotes: document.getElementById('join-admin-note').value }).then(closeModal));
}

async function loadMedia() {
  setTableLoading('media-tbody', 7, 'Loading media library…');
  try {
    const params = new URLSearchParams();
    const platform = document.getElementById('media-platform')?.value || '';
    const status = document.getElementById('media-status')?.value || '';
    if (platform) params.set('platform', platform);
    if (status) params.set('status', status);
    const r = await API.fetch(`/api/admin/media-library?${params.toString()}`);
    state.media = r.media || [];
    const tbody = document.getElementById('media-tbody');
    if (!state.media.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty"><i class="fa-solid fa-photo-film"></i>No media drafts yet. Create a draft or run marketing autopilot.</td></tr>';
      return;
    }
    tbody.innerHTML = state.media.map(m => `
      <tr><td>${fmtDateTime(m.createdAt)}</td><td><span class="status s-info">${escapeHtml(m.platform)}</span></td>
      <td><strong>${escapeHtml(m.title)}</strong><br><small style="color:var(--text-3);">${escapeHtml(m.topic || '')}</small></td>
      <td>${escapeHtml(m.caption || '').slice(0, 140)}</td><td><span class="status s-${m.status === 'approved' ? 'verified' : 'pending'}">${escapeHtml(m.status)}</span></td>
      <td>${m.scheduledAt ? fmtDateTime(m.scheduledAt) : '—'}</td>
      <td><button class="btn sm" data-action="media-open" data-id="${m.id}">Open</button>${isOwner() && m.status !== 'approved' ? ` <button class="btn sm success" data-action="media-approve" data-id="${m.id}">Approve</button>` : ''}${isOwner() ? ` <button class="btn sm danger" data-action="media-delete" data-id="${m.id}">Delete</button>` : ''}</td></tr>
    `).join('');
    tbody.querySelectorAll('[data-action="media-open"]').forEach(btn => btn.addEventListener('click', () => openMediaDetail(btn.dataset.id)));
    tbody.querySelectorAll('[data-action="media-approve"]').forEach(btn => btn.addEventListener('click', () => updateMedia(btn.dataset.id, { status: 'approved' })));
    tbody.querySelectorAll('[data-action="media-delete"]').forEach(btn => btn.addEventListener('click', () => deleteMedia(btn.dataset.id)));
  } catch (e) { renderErrorRow('media-tbody', 7, e); }
}

async function updateMedia(id, body) {
  await API.fetch(`/api/admin/media-library/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  toast('Media updated', 'success');
  loadMedia();
}

async function deleteMedia(id) {
  if (!confirm('Delete this media draft?')) return;
  await API.fetch(`/api/admin/media-library/${encodeURIComponent(id)}`, { method: 'DELETE' });
  toast('Media deleted', 'success');
  loadMedia();
}

async function regenerateMedia(id) {
  try {
    await API.fetch(`/api/admin/media-library/${encodeURIComponent(id)}/regenerate`, { method: 'POST', body: '{}' });
    toast('Media regenerated with MiniMax', 'success');
    closeModal();
    loadMedia();
  } catch (e) {
    toast(e.status === 503 ? 'MiniMax key is required before regeneration.' : e.message, 'error', 5000);
  }
}

function openMediaDetail(id) {
  const m = state.media.find(x => x.id === id);
  const modal = document.getElementById('modal');
  modal.innerHTML = `<h2>${escapeHtml(m.title)}</h2><p class="modal-sub">${escapeHtml(m.platform)} · ${escapeHtml(m.status)}</p>
    ${m.assetUrl ? `<div class="form-group"><label>Asset</label><a class="btn" href="${escapeHtml(m.assetUrl)}" target="_blank">Open generated asset</a></div>` : '<div class="alert info">No generated asset is attached yet. Add MINIMAX_API_KEY and regenerate, or upload/paste an asset URL later.</div>'}
    <div class="form-group"><label>Caption</label><textarea rows="8" readonly>${escapeHtml(m.caption || '')}</textarea></div>
    <div class="form-group"><label>Hashtags</label><input readonly value="${escapeHtml((m.hashtags || []).map(h => '#' + h).join(' '))}"></div>
    <div class="form-group"><label>Manual publish/export</label><textarea rows="3" readonly>${escapeHtml(`${m.caption || ''}\n\n${(m.hashtags || []).map(h => '#' + h).join(' ')}`)}</textarea></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${isOwner() ? `<button class="btn" id="media-regenerate">Regenerate</button><button class="btn success" id="media-approve-detail">Approve</button>` : ''}
      <button class="btn ghost" id="media-close">Close</button>
    </div>`;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('media-close').addEventListener('click', closeModal);
  document.getElementById('media-regenerate')?.addEventListener('click', () => regenerateMedia(id));
  document.getElementById('media-approve-detail')?.addEventListener('click', () => updateMedia(id, { status: 'approved' }).then(closeModal));
}

function openCreateMedia() {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<h2>Create content draft</h2><p class="modal-sub">Creates a saved draft now; real MiniMax generation can be enabled with provider keys.</p>
    <div class="form-row"><div class="form-group"><label>Platform</label><select id="new-media-platform"><option>instagram</option><option>facebook</option><option>tiktok</option></select></div><div class="form-group"><label>Topic</label><input id="new-media-topic" value="premium mobile car wash"></div></div>
    <div class="form-group"><label>Caption override (optional)</label><textarea id="new-media-caption" rows="4"></textarea></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="new-media-save">Create draft</button><button class="btn ghost" id="new-media-close">Close</button></div>`;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('new-media-close').addEventListener('click', closeModal);
  document.getElementById('new-media-save').addEventListener('click', async () => {
    try {
      await API.fetch('/api/admin/media-library', { method: 'POST', body: JSON.stringify({
        platform: document.getElementById('new-media-platform').value,
        topic: document.getElementById('new-media-topic').value,
        caption: document.getElementById('new-media-caption').value,
        generateImage: true,
        provider: 'minimax'
      }) });
      toast('Media draft created', 'success');
      closeModal();
      loadMedia();
    } catch (e) { toast(e.message, 'error', 5000); }
  });
}

document.getElementById('lead-search-btn')?.addEventListener('click', loadLeads);
document.getElementById('lead-add-btn')?.addEventListener('click', openAddLead);
document.getElementById('contact-search-btn')?.addEventListener('click', loadContacts);
document.getElementById('followup-refresh-btn')?.addEventListener('click', loadFollowUps);
document.getElementById('followup-add-btn')?.addEventListener('click', openAddFollowUp);
document.getElementById('join-search-btn')?.addEventListener('click', loadJoinRequests);
document.getElementById('media-refresh-btn')?.addEventListener('click', loadMedia);
document.getElementById('media-generate-btn')?.addEventListener('click', () => {
  if (!isOwner()) return toast('Owner role required to create media drafts', 'error');
  openCreateMedia();
});

// ============================================================================
// CUSTOMERS
// ============================================================================
async function loadCustomers() {
  try {
    const q = document.getElementById('cust-search')?.value || '';
    const r = await API.fetch(`/api/admin/customers${q ? '?q=' + encodeURIComponent(q) : ''}`);
    const list = r.customers || r || [];
    const tbody = document.getElementById('customers-tbody');
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty"><i class="fa-solid fa-users"></i>No customers match</td></tr>';
      return;
    }
    tbody.innerHTML = list.slice(0, 100).map(c => `
      <tr>
        <td><strong>${escapeHtml(c.full_name || c.fullName || '—')}</strong></td>
        <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(c.phone_e164 || c.phone_raw || c.phone || '—')}</code></td>
        <td>${escapeHtml(c.email || '—')}</td>
        <td>${escapeHtml(c.area || '—')}</td>
        <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(c.language || 'en')}</code></td>
        <td>${(c.vehicle_count || 0)}</td>
        <td>${(c.created_at || '').slice(0, 10)}</td>
      </tr>
    `).join('');
  } catch (e) {
    document.getElementById('customers-tbody').innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(e.message)}</td></tr>`;
  }
}

document.getElementById('cust-search')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadCustomers();
});

// ============================================================================
// STAFF
// ============================================================================
async function loadStaffLegacy() {
  try {
    const r = await API.fetch('/api/admin/staff');
    const list = r.staff || r || [];
    state.staff = list;
    const tbody = document.getElementById('staff-tbody');
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty"><i class="fa-solid fa-people-group"></i>No staff yet</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(s => `
      <tr>
        <td><strong>${escapeHtml(s.display_name || s.displayName || '—')}</strong></td>
        <td><span class="status s-${s.role === 'OWNER' ? 'verified' : s.role === 'DISPATCHER' ? 'assigned' : 'info'}">${s.role}</span></td>
        <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(s.phone || '—')}</code></td>
        <td>${escapeHtml((s.shift_start || '—') + ' — ' + (s.shift_end || '—'))}</td>
        <td>${s.active ? '<span class="status s-verified">Active</span>' : '<span class="status s-cancelled">Inactive</span>'}</td>
        <td>${s.last_login_at ? new Date(s.last_login_at).toLocaleString() : '<span style="color:var(--text-3);">never</span>'}</td>
      </tr>
    `).join('');
    const cleaners = list.filter(s => s.role === 'CLEANER' && s.active).length;
    const k = document.getElementById('kpi-cleaners');
    if (k) k.textContent = cleaners;
  } catch (e) {
    document.getElementById('staff-tbody').innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(e.message)}</td></tr>`;
  }
}

// Owner staff controls override the older read-only renderer above.
async function loadStaff() {
  try {
    const r = await API.fetch('/api/admin/staff');
    const list = r.staff || r || [];
    state.staff = list;
    const tbody = document.getElementById('staff-tbody');
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty"><i class="fa-solid fa-people-group"></i>No staff yet</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(s => `
      <tr>
        <td><strong>${escapeHtml(s.display_name || s.displayName || '—')}</strong></td>
        <td><span class="status s-${s.role === 'OWNER' ? 'verified' : s.role === 'DISPATCHER' ? 'assigned' : 'info'}">${s.role}</span></td>
        <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(s.phone || '—')}</code></td>
        <td>${escapeHtml((s.shift_start || '—') + ' — ' + (s.shift_end || '—'))}</td>
        <td>${s.active ? '<span class="status s-verified">Active</span>' : '<span class="status s-cancelled">Inactive</span>'}</td>
        <td>${s.last_login_at ? new Date(s.last_login_at).toLocaleString() : '<span style="color:var(--text-3);">never</span>'}</td>
        <td>${isOwner() ? `<button class="btn sm danger" data-action="staff-delete" data-id="${s.id}">Delete</button>` : '<span class="status s-info">Owner only</span>'}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-action="staff-delete"]').forEach(btn => btn.addEventListener('click', () => deleteStaff(btn.dataset.id)));
    const cleaners = list.filter(s => s.role === 'CLEANER' && s.active).length;
    const k = document.getElementById('kpi-cleaners');
    if (k) k.textContent = cleaners;
  } catch (e) {
    document.getElementById('staff-tbody').innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(e.message)}</td></tr>`;
  }
}

function openAddStaff() {
  if (!isOwner()) return toast('Owner role required to add staff', 'error');
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h2>Add staff</h2>
    <p class="modal-sub">Create cleaners, dispatchers, or owners. If password is blank, a temporary password is generated.</p>
    <div class="form-row"><div class="form-group"><label>Name</label><input id="staff-name"></div><div class="form-group"><label>Email</label><input id="staff-email" type="email"></div></div>
    <div class="form-row"><div class="form-group"><label>Phone</label><input id="staff-phone"></div><div class="form-group"><label>Role</label><select id="staff-role"><option>CLEANER</option><option>DISPATCHER</option><option>OWNER</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Shift start</label><input id="staff-shift-start" type="time"></div><div class="form-group"><label>Shift end</label><input id="staff-shift-end" type="time"></div></div>
    <div class="form-group"><label>Password (optional)</label><input id="staff-password" type="password"></div>
    <div style="display:flex;gap:8px;"><button class="btn primary" id="staff-save">Create staff</button><button class="btn ghost" id="staff-close">Close</button></div>
    <div id="staff-create-result" style="margin-top:12px;"></div>
  `;
  document.getElementById('modal-bg').classList.add('open');
  document.getElementById('staff-close').addEventListener('click', closeModal);
  document.getElementById('staff-save').addEventListener('click', async () => {
    try {
      const r = await API.fetch('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          displayName: document.getElementById('staff-name').value,
          email: document.getElementById('staff-email').value,
          phone: document.getElementById('staff-phone').value,
          role: document.getElementById('staff-role').value,
          shiftStart: document.getElementById('staff-shift-start').value,
          shiftEnd: document.getElementById('staff-shift-end').value,
          password: document.getElementById('staff-password').value
        })
      });
      document.getElementById('staff-create-result').innerHTML = `<div class="alert success">Staff created${r.temporaryPassword ? ` · temporary password: <code>${escapeHtml(r.temporaryPassword)}</code>` : ''}</div>`;
      loadStaff();
    } catch (e) { toast(e.message, 'error', 5000); }
  });
}

async function deleteStaff(id) {
  if (!isOwner()) return toast('Owner role required to delete staff', 'error');
  if (!confirm('Delete/deactivate this staff member?')) return;
  try {
    await API.fetch(`/api/admin/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('Staff deleted', 'success');
    loadStaff();
  } catch (e) { toast(e.message, 'error', 5000); }
}

document.getElementById('staff-add-btn')?.addEventListener('click', openAddStaff);

// ============================================================================
// CALENDAR
// ============================================================================
async function loadCalendar() {
  try {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const r = await API.fetch(`/api/admin/calendar-v2?dateFrom=${start.toISOString().slice(0, 10)}&dateTo=${end.toISOString().slice(0, 10)}`);
    const list = Array.isArray(r) ? r : (r.events || r || []);
    const panel = document.getElementById('calendar-panel');
    if (list.length === 0) {
      panel.innerHTML = '<div class="empty"><i class="fa-regular fa-calendar"></i>No calendar events yet</div>';
      return;
    }
    const byDay = {};
    list.forEach(e => {
      const d = (e.start || e.start_time || e.scheduled_start || e.scheduledStart || '').slice(0, 10);
      if (!d) return;
      (byDay[d] = byDay[d] || []).push(e);
    });
    panel.innerHTML = Object.keys(byDay).sort().map(d => `
      <h3 style="font-size:13px;margin:14px 0 8px;color:var(--accent-2);">${d}</h3>
      <div class="scroll-x">
        <table class="tbl">
          <thead><tr><th>Time</th><th>Customer</th><th>Area</th><th>Service</th><th>Status</th></tr></thead>
          <tbody>${byDay[d].sort((a, b) => (a.start || a.scheduledStart || '').localeCompare(b.start || b.scheduledStart || '')).map(e => `
            <tr>
              <td>${timeOnly(e.start || e.start_time || e.scheduled_start || e.scheduledStart)}</td>
              <td>${escapeHtml(e.customerName || e.customer_name || '—')}</td>
              <td>${escapeHtml(e.area || '—')}</td>
              <td>${escapeHtml(e.serviceCode || e.service_code || e.servicePackageId || '—')}</td>
              <td><span class="status s-${statusClass(e.status)}">${e.status || '—'}</span></td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('calendar-panel').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================================
// PORTAL
// ============================================================================
async function issuePortalToken() {
  const customerId = document.getElementById('portal-customer').value.trim();
  if (!customerId) { toast('Customer ID required', 'error'); return; }
  const scope = document.getElementById('portal-scope').value;
  const bookingId = document.getElementById('portal-booking').value.trim() || null;
  const issuedVia = document.getElementById('portal-channel').value;
  const issuedTo = document.getElementById('portal-to').value.trim() || null;
  const ttlDays = parseInt(document.getElementById('portal-ttl').value) || 14;
  try {
    const r = await API.fetch('/api/admin/portal/issue-token', {
      method: 'POST',
      body: JSON.stringify({ customerId, scope, bookingId, issuedVia, issuedTo, ttlDays })
    });
    const out = document.getElementById('portal-result');
    out.innerHTML = `
      <div class="alert success"><i class="fa-solid fa-check"></i> Token issued (valid ${ttlDays} days)</div>
      <div class="form-group"><label>Magic link (copy + send via WhatsApp/email)</label>
        <textarea rows="3" readonly>${escapeHtml(r.link)}</textarea>
      </div>
      <div style="font-size:11px;color:var(--text-3);">Token id: <code>${r.id}</code> · expires: ${new Date(r.expiresAt).toLocaleString()}</div>
    `;
  } catch (e) {
    toast('Failed: ' + e.message, 'error', 5000);
  }
}
document.getElementById('portal-issue-btn')?.addEventListener('click', issuePortalToken);

// ============================================================================
// MARKETING AUTOPILOT
// ============================================================================
async function loadAutopilot() {
  try {
    const r = await API.fetch('/api/admin/marketing/autopilot/status');
    updateAutopilotUI(r);
  } catch (e) {
    document.getElementById('autopilot-status-banner').innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Failed to load: ' + escapeHtml(e.message);
  }
}

function updateAutopilotUI(r) {
  const banner = document.getElementById('autopilot-status-banner');
  const dot = document.getElementById('autopilot-dot');
  const text = document.getElementById('autopilot-text');
  const toggle = document.getElementById('autopilot-toggle');
  const toggleLabel = document.getElementById('autopilot-toggle-label');
  const modeSel = document.getElementById('autopilot-mode');
  toggle.checked = !!r.enabled;
  toggleLabel.textContent = r.enabled ? 'Disable autopilot' : 'Enable autopilot';
  modeSel.value = r.mode || 'draft';
  if (r.enabled && r.mode === 'live') {
    banner.className = 'alert success';
    banner.innerHTML = '<i class="fa-solid fa-circle-check"></i> Autopilot LIVE · scheduled at 07:30, 16:30, 21:00';
    dot.className = 'dot';
    text.textContent = 'Autopilot: LIVE';
  } else if (r.enabled && r.mode === 'draft') {
    banner.className = 'alert info';
    banner.innerHTML = '<i class="fa-solid fa-circle-info"></i> Autopilot ENABLED in DRAFT mode (artifacts saved, no Postiz publish)';
    dot.className = 'dot warn';
    text.textContent = 'Autopilot: DRAFT';
  } else {
    banner.className = 'alert';
    banner.innerHTML = '<i class="fa-solid fa-pause"></i> Autopilot paused · last run: ' + (r.lastRun ? new Date(r.lastRun).toLocaleString() : 'never');
    dot.className = 'dot off';
    text.textContent = 'Autopilot: OFF';
  }
  const tbody = document.getElementById('runs-tbody');
  if (!r.runs || r.runs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No runs yet — click "Test publish now" to generate your first ad set</td></tr>';
  } else {
    tbody.innerHTML = r.runs.map(run => `
      <tr>
        <td>${new Date(run.timestamp).toLocaleString()}</td>
        <td>${run.success ? '<span class="status s-verified">OK</span>' : '<span class="status s-rejected">FAIL</span>'} exit=${run.exitCode}</td>
        <td>${(run.elapsedMs / 1000).toFixed(1)}s</td>
        <td><code style="font-size:11px; color:var(--text-2);">${escapeHtml(run.adsetDir || '—')}</code></td>
      </tr>
    `).join('');
  }
  document.getElementById('runs-sub').textContent = `${r.runs?.length || 0} runs · ${r.errorCount || 0} errors`;
}

document.getElementById('autopilot-toggle')?.addEventListener('change', async (e) => {
  if (!isOwner()) {
    e.target.checked = !e.target.checked;
    toast('Owner role required to change autopilot', 'error');
    return;
  }
  const mode = document.getElementById('autopilot-mode').value;
  try {
    const endpoint = e.target.checked ? '/api/admin/marketing/autopilot/enable' : '/api/admin/marketing/autopilot/disable';
    const r = await API.fetch(endpoint, { method: 'POST', body: JSON.stringify({ mode }) });
    updateAutopilotUI(r);
    toast(e.target.checked ? `Autopilot enabled (${mode})` : 'Autopilot disabled', 'success');
  } catch (err) {
    toast('Failed: ' + err.message, 'error', 5000);
    e.target.checked = !e.target.checked;
  }
});

async function testPublish() {
  if (!isOwner()) { toast('Owner role required for marketing publishing actions', 'error'); return; }
  const language = document.getElementById('autopilot-lang').value;
  const topic = document.getElementById('autopilot-topic').value || undefined;
  toast('Running pipeline… this can take 15-30s');
  try {
    const r = await API.fetch('/api/admin/marketing/autopilot/test-publish', {
      method: 'POST', body: JSON.stringify({ language, topic })
    });
    if (r.success) {
      toast('Pipeline complete · ' + r.run.adsetDir, 'success', 5000);
      loadAutopilot();
    } else {
      toast('Pipeline failed: ' + (r.run?.stderrTail || 'unknown'), 'error', 6000);
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error', 5000);
  }
}
async function startScheduler() {
  if (!isOwner()) { toast('Owner role required to start scheduler', 'error'); return; }
  try {
    const r = await API.fetch('/api/admin/marketing/autopilot/scheduler/start', { method: 'POST', body: '{}' });
    toast(`Scheduler started · next: ${new Date(r.nextScheduled).toLocaleString()}`, 'success');
  } catch (e) { toast('Failed: ' + e.message, 'error', 5000); }
}
async function stopScheduler() {
  if (!isOwner()) { toast('Owner role required to stop scheduler', 'error'); return; }
  try {
    await API.fetch('/api/admin/marketing/autopilot/scheduler/stop', { method: 'POST' });
    toast('Scheduler stopped', 'success');
  } catch (e) { toast('Failed: ' + e.message, 'error', 5000); }
}

document.getElementById('ap-test-btn')?.addEventListener('click', testPublish);
document.getElementById('ap-start-btn')?.addEventListener('click', startScheduler);
document.getElementById('ap-stop-btn')?.addEventListener('click', stopScheduler);

// ============================================================================
// REPORTS
// ============================================================================
async function loadReports() {
  try {
    const r = await API.fetch('/api/admin/reports/summary');
    document.getElementById('r-rev-7').textContent = fmtMoney(r.revenue7d);
    document.getElementById('r-bk-7').textContent = r.bookings7d;
    document.getElementById('r-avg-7').textContent = fmtMoney(r.avgTicket7d);
    document.getElementById('r-pending').textContent = r.pendingPayments;
    if (r.byService && r.byService.length) {
      document.getElementById('r-by-service').innerHTML = '<div class="scroll-x"><table class="tbl"><thead><tr><th>Service</th><th>Bookings</th><th>Revenue</th></tr></thead><tbody>' +
        r.byService.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${s.count}</td><td>${fmtMoney(s.revenue)}</td></tr>`).join('') + '</tbody></table></div>';
    } else {
      document.getElementById('r-by-service').innerHTML = '<div class="empty">No completed bookings yet</div>';
    }
    if (r.byArea && r.byArea.length) {
      document.getElementById('r-by-area').innerHTML = '<div class="scroll-x"><table class="tbl"><thead><tr><th>Area</th><th>Bookings</th></tr></thead><tbody>' +
        r.byArea.map(a => `<tr><td>${escapeHtml(a.area)}</td><td>${a.count}</td></tr>`).join('') + '</tbody></table></div>';
    } else {
      document.getElementById('r-by-area').innerHTML = '<div class="empty">No bookings yet</div>';
    }
  } catch (e) {
    console.error('reports error', e);
  }
}

// ============================================================================
// INITIAL + AUTO-REFRESH
// ============================================================================
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}, 1000);

state.refreshTimer = setInterval(() => {
  const active = document.querySelector('.page.active');
  if (!active) return;
  const loader = pageLoaders[active.id.replace('page-', '')];
  if (loader) Promise.resolve(loader()).catch(err => console.error(err));
}, 5000);

(async function initDashboard() {
  await verifyAuth();
  await refreshOverview().catch(err => console.error('[overview]', err));
  await loadAutopilot().catch(() => {});
})();
