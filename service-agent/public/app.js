// State management
let currentSection = 'overview';
let activeChatId = null;
let autopilotActive = true;
let bookingsList = [];
let calendarEvents = [];
let bookingsV2List = [];
let cleanersList = [];
let paymentReviewList = [];
let chatSessions = [];
let socialsPosts = [];
let integrationsStatus = null;
let logs = [];
let authToken = localStorage.getItem('carshine_admin_token') || '';

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const isApi = url.startsWith('/api') || url.startsWith(`${location.origin}/api`);
  if (!isApi || !authToken) return nativeFetch(input, options);
  const headers = new Headers(options.headers || {});
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${authToken}`);
  return nativeFetch(input, { ...options, headers });
};

function isAuthErrorResponse(res) {
  return res && (res.status === 401 || res.status === 403);
}

async function parseJsonSafe(res) {
  return res.json().catch(() => ({}));
}

let _redirectingToLogin = false;
function showDashboardAuthGate() {
  // Login now lives on a dedicated, standalone page (/login) — never inside
  // the dashboard. When the dashboard is opened without a valid session,
  // send the admin to the login page and come back here afterwards.
  if (_redirectingToLogin) return;
  _redirectingToLogin = true;
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login?next=${next}`);
}

function hideDashboardAuthGateNoop() { /* retained for compatibility */ }

function hideDashboardAuthGate() {
  document.getElementById('dashboard-auth-gate')?.remove();
}

const BUSINESS_CONTACT = {
  localPhone: '01555567205',
  e164Phone: '+201555567205',
  whatsappNumber: '201555567205'
};

function normalizeEgyptMobileForWhatsApp(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return BUSINESS_CONTACT.whatsappNumber;
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `20${digits.slice(1)}`;
  return digits;
}

function getCustomerWhatsAppUrl(phone) {
  return `https://wa.me/${normalizeEgyptMobileForWhatsApp(phone)}`;
}

function usesInstaPay(paymentMethod = '') {
  return String(paymentMethod).toLowerCase().includes('instapay');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Date settings for calendar
let currentCalDate = new Date(2026, 5, 9); // June 2026 (based on current date 2026-06-09)

// Selectors
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.dashboard-section');
const sectionTitle = document.getElementById('section-title');
const sectionSubtitle = document.getElementById('section-subtitle');
const currentTimeEl = document.getElementById('current-time');

// Autopilot elements
const headerAutopilotToggle = document.getElementById('header-autopilot-toggle');
const headerAutopilotStatus = document.getElementById('header-autopilot-status');
const settingsAutopilotToggle = document.getElementById('settings-autopilot-toggle');
const chatAutopilotToggle = document.getElementById('chat-autopilot-toggle');
const autopilotModeKPI = document.getElementById('kpi-autopilot-mode');

// Logs console
const logConsole = document.getElementById('log-console-area');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Presets
const presetSelect = document.getElementById('preset-select');
const simNameInput = document.getElementById('sim-name');
const simPhoneInput = document.getElementById('sim-phone');
const simLangSelect = document.getElementById('sim-lang');
const simChannelSelect = document.getElementById('sim-channel');
const simTextInput = document.getElementById('sim-text');
const btnSimulateSend = document.getElementById('btn-simulate-send');

// Theme toggle
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupAuthPanel();
  setupSettings();
  setupChatSimulator();
  setupThemeToggle();
  setupModal();
  setupCalendarControls();
  setupSocialMedia();
  setupTraces();
  setupPaymentReview();
  setupHeroCarFallback();
  setupSectionTransitions();
  setupCleanerOps();
  setupMobileMenu();

  // Start system clock
  updateClock();
  setInterval(updateClock, 60000);

  // Initial data fetch
  fetchData();
  setupSocketRealtime();

  // Fallback poll every 4 minutes if socket disconnects
  setInterval(fetchData, 240000);
});

function setAuthStatus(message, type = 'info') {
  const box = document.getElementById('auth-status-box');
  if (!box) return;
  box.textContent = message;
  box.className = `auth-status-box ${type}`;
}

let dashboardSocket = null;

function setupSocketRealtime() {
  if (typeof io === 'undefined' || !authToken) return;
  try {
    if (dashboardSocket) dashboardSocket.disconnect();
    dashboardSocket = io({
      auth: { token: authToken },
      transports: ['websocket', 'polling']
    });
    dashboardSocket.on('connect', () => {
      console.log('[Socket] connected');
    });
    dashboardSocket.on('booking:created', () => fetchData());
    dashboardSocket.on('chat:updated', () => fetchData());
    dashboardSocket.on('autopilot', () => fetchData());
    dashboardSocket.on('disconnect', () => {
      console.log('[Socket] disconnected — using slow poll fallback');
    });
  } catch (err) {
    console.warn('[Socket] setup failed', err);
  }
}

function setupAuthPanel() {
  const form = document.getElementById('admin-login-form');
  const verifyBtn = document.getElementById('btn-auth-verify');
  const clearBtn = document.getElementById('btn-auth-clear');
  if (authToken) {
    setAuthStatus('Auth status: token saved in this browser. API requests will include Authorization header.', 'ok');
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('admin-login-email')?.value?.trim();
    const password = document.getElementById('admin-login-password')?.value || '';
    setAuthStatus('Logging in...', 'info');
    try {
      const res = await nativeFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setAuthStatus(`Login failed: ${data.error || res.status}`, 'warn');
        return;
      }
      authToken = data.token;
      localStorage.setItem('carshine_admin_token', authToken);
      setAuthStatus(`Logged in as ${data.user?.email || email}. Token expires in ${data.expiresIn}.`, 'ok');
      setupSocketRealtime();
      fetchData();
    } catch (err) {
      setAuthStatus(`Login error: ${err.message}`, 'warn');
    }
  });
  verifyBtn?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/verify');
      const data = await res.json();
      if (res.ok && data.valid) {
        setAuthStatus(`Token verified for ${data.user?.email || 'admin'}.`, 'ok');
      } else {
        setAuthStatus(`Token invalid: ${data.error || res.status}`, 'warn');
      }
    } catch (err) {
      setAuthStatus(`Verify error: ${err.message}`, 'warn');
    }
  });
  clearBtn?.addEventListener('click', () => {
    authToken = '';
    localStorage.removeItem('carshine_admin_token');
    location.replace('/login');
  });
}

// Global logout helper (used by the topbar logout control).
function logout() {
  authToken = '';
  localStorage.removeItem('carshine_admin_token');
  location.replace('/login');
}
window.logout = logout;

// Update System Clock
function updateClock() {
  const options = { weekday: 'long', hour: '2-digit', minute: '2-digit' };
  currentTimeEl.textContent = new Date().toLocaleTimeString('en-US', options);
}

// Log message to activity console
function addLog(text, type = 'system') {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">[${time}]</span> ${text}`;
  
  logConsole.appendChild(entry);
  logConsole.scrollTop = logConsole.scrollHeight;
}

// Clear console logs
clearLogsBtn.addEventListener('click', () => {
  logConsole.innerHTML = `<div class="log-entry system"><span class="log-time">[${new Date().toLocaleTimeString('en-US', { hour12: false })}]</span> Log console cleared.</div>`;
});

// --- NAVIGATION ---
function setupNavigation() {
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = item.getAttribute('data-section');
      switchSection(sectionId);
    });
  });

  // Hero action buttons (M2) — same routing as sidebar nav.
  document.addEventListener('click', (e) => {
    const heroBtn = e.target.closest('.m1-hero-btn[data-section]');
    if (heroBtn) {
      e.preventDefault();
      const sectionId = heroBtn.getAttribute('data-section');
      if (sectionId) switchSection(sectionId);
    }
  });

  // Logo area in sidebar acts as quick "back to overview" (M2)
  document.addEventListener('click', (e) => {
    const logoLink = e.target.closest('.logo-area[data-section]');
    if (logoLink) {
      e.preventDefault();
      const sectionId = logoLink.getAttribute('data-section');
      if (sectionId) switchSection(sectionId);
    }
  });

  // Make clicking dashboard elements redirect to approvals
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('view-all-link')) {
      e.preventDefault();
      const target = e.target.getAttribute('data-target');
      switchSection(target);
    }
  });

  // KPI cards — click navigates to linked section
  document.addEventListener('click', (e) => {
    const kpiCard = e.target.closest('.kpi-card[data-section]');
    if (kpiCard) {
      e.preventDefault();
      const sectionId = kpiCard.getAttribute('data-section');
      if (sectionId) switchSection(sectionId);
    }
  });

  // KPI cards — keyboard navigation (Enter / Space)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const kpiCard = document.activeElement?.closest('.kpi-card[data-section]');
      if (kpiCard) {
        e.preventDefault();
        const sectionId = kpiCard.getAttribute('data-section');
        if (sectionId) switchSection(sectionId);
      }
    }
  });
}

function switchSection(sectionId) {
  currentSection = sectionId;
  
  // Toggle active class on sidebar items
  navItems.forEach(nav => {
    if (nav.getAttribute('data-section') === sectionId) {
      nav.classList.add('active');
    } else {
      nav.classList.remove('active');
    }
  });
  
  // Toggle active class on sections
  sections.forEach(sec => {
    if (sec.id === `section-${sectionId}`) {
      sec.classList.add('active');
    } else {
      sec.classList.remove('active');
    }
  });
  
  // Update header text
  const titles = {
    'overview': { title: 'Dashboard Overview', subtitle: 'Real-time control panel for Red Sea operations.' },
    'chat-simulator': { title: 'Chatbot Inbox', subtitle: 'Saved website, WhatsApp, Instagram, and Facebook conversations with customer details.' },
    'approvals': { title: 'Booking Approvals Queue', subtitle: 'Confirm or decline reservation requests captured by AI.' },
    'calendar': { title: 'Washes Schedule Calendar', subtitle: 'Timeline and dispatch overview for El Gouna, Hurghada & Sahl Hasheesh.' },
    'bookings-v2': { title: 'Web Bookings (V2)', subtitle: 'Normalized booking records from the web form, chatbot and WhatsApp.' },
    'socials': { title: 'Social Media Campaigns', subtitle: 'Manage slideshow scheduling, cross-platform posting, and views analytics.' },
    'settings': { title: 'Autopilot Configurations', subtitle: 'Manage AI autonomy level, business triggers and webhooks.' },
    'agents': { title: 'AI Autopilot Agents', subtitle: 'Control center and activity feed for the 10 operational agents.' },
    'cleaners-ops': { title: 'Cleaner Operations', subtitle: 'Field-team view: one card per cleaner, with their active queue and lifecycle status.' },
    'payments-review': { title: 'Payment Review', subtitle: 'Manual InstaPay proof review queue. Owner verifies or rejects; Dispatcher submits proof only.' },
    'traces': { title: 'Agent Traces', subtitle: 'Recent Langfuse trace events from the orchestrator and subagents.' }
  };
  
  sectionTitle.textContent = titles[sectionId].title;
  sectionSubtitle.textContent = titles[sectionId].subtitle;
}

// --- DATA SYNCHRONIZATION (REST API) ---
async function fetchData() {
  try {
    // 1. Fetch settings
    const settings = await fetchJsonOrAuth('/api/settings', 'Settings');
    updateAutopilotUI(settings.autopilot);
    
    // 2. Fetch bookings (legacy)
    bookingsList = await fetchJsonOrAuth('/api/bookings', 'Bookings');

    // 2b. Fetch V2 bookings + cleaners list — non-fatal if empty
    try {
      const v2Result = await fetchJsonOrAuth('/api/admin/bookings-v2?limit=200', 'BookingsV2');
      bookingsV2List = (v2Result && v2Result.bookings) || [];
    } catch (e) {
      if (!String(e.message).startsWith('AUTH_REQUIRED:')) bookingsV2List = [];
    }
    try {
      const cleanersResult = await fetchJsonOrAuth('/api/admin/users/cleaners', 'Cleaners');
      cleanersList = (cleanersResult && cleanersResult.cleaners) || [];
    } catch (e) {
      if (!String(e.message).startsWith('AUTH_REQUIRED:')) cleanersList = [];
    }
    try {
      const prResult = await fetchJsonOrAuth('/api/admin/payments?status=PAYMENT_PENDING_REVIEW&limit=100', 'PaymentReview');
      paymentReviewList = (prResult && prResult.payments) || [];
    } catch (e) {
      if (!String(e.message).startsWith('AUTH_REQUIRED:')) paymentReviewList = [];
    }

    // 3. Fetch calendar (legacy)
    calendarEvents = await fetchJsonOrAuth('/api/calendar', 'Calendar');
    
    // 4. Fetch chats
    chatSessions = await fetchJsonOrAuth('/api/chats', 'Chats');
    
    // 5. Fetch socials
    await fetchSocialsData();
    
    // 6. Fetch integration/credential status
    integrationsStatus = await fetchJsonOrAuth('/api/integrations/status', 'Integrations');
    
    // 7. Fetch agents
    const agentsList = await fetchJsonOrAuth('/api/agents', 'Agents');
    renderAgentsControlCenter(agentsList);
    hideDashboardAuthGate();
    
    // Update Dashboard Elements
    updateKPIs();
    renderOverviewPendingList();
    renderApprovalsQueue();
    renderChatSidebar();
    renderCalendar();
    renderBookingsV2();
    renderIntegrationStatus();
    renderPaymentReview();
    
    if (activeChatId) {
      const selectedSession = chatSessions.find(c => c.id === activeChatId);
      if (selectedSession) {
        updateParserChecklist(getChatDetails(selectedSession), selectedSession.lastAskedField);
      }
    }
    
  } catch (err) {
    if (String(err.message).startsWith('AUTH_REQUIRED:')) {
      addLog('Dashboard data is locked until admin login succeeds.', 'system');
      return;
    }
    addLog(`Dashboard API error: ${err.message}`, 'system');
    console.error('Error fetching data from server:', err);
  }
}

async function fetchJsonOrAuth(url, label) {
  const res = await fetch(url);
  const data = await parseJsonSafe(res);
  if (isAuthErrorResponse(res)) {
    // Bad / expired token — clear it automatically so the next reload
    // doesn't keep retrying with a stale token. This is the most common
    // cause of "dashboard stops loading after I deployed".
    if (authToken) {
      authToken = '';
      localStorage.removeItem('carshine_admin_token');
      setAuthStatus('Token rejected (401). Cleared from localStorage. Please log in again.', 'warn');
    }
    showDashboardAuthGate(`${label} requires admin login. Login to load live dashboard data.`);
    throw new Error(`AUTH_REQUIRED:${label}`);
  }
  if (!res.ok) {
    throw new Error(`${label} failed: ${data.error || res.status}`);
  }
  return data;
}

// --- SETTINGS & AUTOPILOT ---
function setupSettings() {
  const handleToggle = async (e) => {
    const isChecked = e.target.checked;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autopilot: isChecked })
      });
      const data = await res.json();
      
      updateAutopilotUI(data.autopilot);
      addLog(`Autopilot changed: ${data.autopilot ? 'ONLINE (Autonomy Mode)' : 'HUMAN TAKEOVER (Manual Mode)'}`, 'action');
    } catch (err) {
      console.error('Error setting autopilot:', err);
    }
  };
  
  headerAutopilotToggle.addEventListener('change', handleToggle);
  settingsAutopilotToggle.addEventListener('change', handleToggle);
  
  // Chat Autopilot toggle behaves differently: it affects the active session or updates global status
  chatAutopilotToggle.addEventListener('change', async (e) => {
    headerAutopilotToggle.checked = e.target.checked;
    await handleToggle(e);
    toggleChatInputState();
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-send-daily-summary]');
    if (!button) return;
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    try {
      const res = await fetch('/api/notifications/send-daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        addLog(`Daily summary not sent: ${data.error || res.status}`, 'system');
        alert(`Daily summary not sent: ${data.error || res.status}`);
      } else {
        addLog('Daily summary sent to owner WhatsApp.', 'action');
        alert('Daily summary sent to owner WhatsApp.');
      }
    } catch (err) {
      addLog(`Daily summary send failed: ${err.message}`, 'system');
      alert(`Daily summary send failed: ${err.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

function updateAutopilotUI(active) {
  autopilotActive = active;
  
  // Update checkbox checks
  headerAutopilotToggle.checked = active;
  settingsAutopilotToggle.checked = active;
  chatAutopilotToggle.checked = active;
  
  // Update text label and style
  if (active) {
    headerAutopilotStatus.textContent = 'Active';
    headerAutopilotStatus.className = 'status-indicator active';
    autopilotModeKPI.textContent = 'Autopilot ON';
    autopilotModeKPI.className = 'kpi-trend info';
  } else {
    headerAutopilotStatus.textContent = 'Takeover';
    headerAutopilotStatus.className = 'status-indicator takeover';
    autopilotModeKPI.textContent = 'Human Takeover';
    autopilotModeKPI.className = 'kpi-trend warning';
  }
  
  toggleChatInputState();
}

function toggleChatInputState() {
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatInputNote = document.getElementById('chat-input-note');
  
  if (!activeChatId) return;
  
  const currentChat = chatSessions.find(c => c.id === activeChatId);
  const isFinished = currentChat && (currentChat.status === 'confirmed' || currentChat.status === 'rejected');
  
  if (isFinished) {
    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    chatInputNote.textContent = `This booking is already completed/reviewed. No more replies needed.`;
  } else if (autopilotActive) {
    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    chatInputNote.textContent = `Autopilot is active. Toggle autopilot off to take over manually.`;
  } else {
    chatInput.disabled = false;
    chatSendBtn.disabled = false;
    chatInputNote.textContent = `Human Takeover Mode: You are speaking on behalf of CarShine Red Sea.`;
  }
}

function statusPill(ok, on = 'Connected', off = 'Missing setup') {
  return `<span class="integration-pill ${ok ? 'ok' : 'warn'}">${ok ? on : off}</span>`;
}

function renderMissingList(items = []) {
  if (!items.length) return '<span class="profile-note">All required values are present.</span>';
  return `<span class="profile-note">Missing: ${items.map(escapeHtml).join(', ')}</span>`;
}

function renderIntegrationStatus() {
  const container = document.getElementById('integration-status-grid');
  if (!container || !integrationsStatus) return;
  const s = integrationsStatus;
  container.innerHTML = `
    <div class="integration-status-card">
      <div class="integration-card-head"><i class="fa-solid fa-server"></i><strong>API & Login</strong>${statusPill(true, 'Online')}</div>
      <p>Dashboard API base: <code>${escapeHtml(s.api.baseUrl)}</code></p>
      <p>Login endpoint: <code>${escapeHtml(s.api.loginEndpoint)}</code></p>
      <p>Daily summary: <code>${escapeHtml(s.api.baseUrl)}/api/notifications/daily-summary</code></p>
      <p>Mode: ${escapeHtml(s.api.authMode)}</p>
      <p>Admin email: <code>${escapeHtml(s.api.adminEmail)}</code></p>
    </div>
    <div class="integration-status-card">
      <div class="integration-card-head"><i class="fa-solid fa-brain"></i><strong>AI Brain</strong>${statusPill(s.ai.connected, 'AI key ready', 'Fallback mode')}</div>
      <p>Provider: ${escapeHtml(s.ai.provider)}</p>
      <p>${escapeHtml(s.ai.fallback)}</p>
      ${renderMissingList(s.ai.missing)}
    </div>
    <div class="integration-status-card">
      <div class="integration-card-head"><i class="fa-brands fa-whatsapp"></i><strong>WhatsApp Automation</strong>${statusPill(s.whatsapp.connected)}</div>
      <p>Inbound webhook: <code>${escapeHtml(s.whatsapp.inboundWebhook)}</code></p>
      <p>Owner notifications: ${s.whatsapp.ownerNotifications ? escapeHtml(s.whatsapp.adminPhone || '') : 'Not configured'}</p>
      ${renderMissingList(s.whatsapp.missing)}
      <button class="btn btn-secondary btn-send-summary" type="button" data-send-daily-summary><i class="fa-brands fa-whatsapp"></i> Send Daily Summary</button>
    </div>
    <div class="integration-status-card">
      <div class="integration-card-head"><i class="fa-brands fa-meta"></i><strong>Facebook & Instagram</strong>${statusPill(s.social.instagramConnected && s.social.facebookConnected)}</div>
      <p>Meta webhook: <code>${escapeHtml(s.social.webhook)}</code></p>
      <p>Instagram: ${s.social.instagramConnected ? 'ready for API connection' : 'credentials missing'}</p>
      <p>Facebook: ${s.social.facebookConnected ? 'ready for API connection' : 'credentials missing'}</p>
      ${renderMissingList(s.social.missing)}
    </div>
    <div class="integration-status-card">
      <div class="integration-card-head"><i class="fa-solid fa-receipt"></i><strong>InstaPay</strong>${statusPill(s.payments.connected, 'Link/QR ready', 'Manual proof')}</div>
      <p>Receiving number: <code>${escapeHtml(s.payments.instapayReceivingNumber)}</code></p>
      <p>Payment link: ${s.payments.instapayPaymentLink ? `<a href="${escapeHtml(s.payments.instapayPaymentLink)}" target="_blank" rel="noopener">Open link</a>` : 'Not configured'}</p>
      <p>${escapeHtml(s.payments.note)}</p>
    </div>
  `;
}

// --- KPI UPDATING ---
function updateKPIs() {
  const total = bookingsList.length;
  const confirmed = bookingsList.filter(b => b.status === 'confirmed').length;
  const pending = bookingsList.filter(b => b.status === 'pending').length;
  const chatsCount = chatSessions.length;
  
  document.getElementById('kpi-total').textContent = total;
  document.getElementById('kpi-confirmed').textContent = confirmed;
  document.getElementById('kpi-pending').textContent = pending;
  document.getElementById('kpi-chats').textContent = chatsCount;

  // V2 KPIs
  const v2Total = bookingsV2List.length;
  const v2Quoted = bookingsV2List.filter(b => b.status === 'QUOTED').length;
  const v2NeedsHuman = bookingsV2List.filter(b => b.status === 'NEEDS_HUMAN').length;
  const v2Collecting = bookingsV2List.filter(b => b.status === 'COLLECTING_INFO').length;
  document.getElementById('kpi-v2-total').textContent = v2Total;
  document.getElementById('kpi-v2-quoted').textContent = v2Quoted;
  document.getElementById('kpi-v2-needs-human').textContent = v2NeedsHuman;
  document.getElementById('kpi-v2-collecting').textContent = v2Collecting;

  // Analytics status breakdown bars
  const _analyticsMax = Math.max(total + v2Total, 1);
  const _updateAnalytics = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    const bar = el.closest('.cs2-status-row')?.querySelector('.cs2-bar');
    if (bar) bar.style.setProperty('--pct', Math.min(100, Math.round((val / _analyticsMax) * 100)) + '%');
  };
  _updateAnalytics('analytics-confirmed', confirmed);
  _updateAnalytics('analytics-pending', pending);
  _updateAnalytics('analytics-collecting', v2Collecting);
  _updateAnalytics('analytics-attention', v2NeedsHuman);
  const v2Badge = document.getElementById('badge-v2-needs-human');
  v2Badge.textContent = v2NeedsHuman;
  v2Badge.style.display = v2NeedsHuman > 0 ? 'inline' : 'none';

  // M1: hero live stats
  if (typeof updateHeroStats === 'function') updateHeroStats();

  // M1: cleaner operations
  if (typeof renderCleanerOps === 'function') renderCleanerOps();

  // Badges update
  const approvalsBadge = document.getElementById('badge-approval-count');
  approvalsBadge.textContent = pending;
  approvalsBadge.style.display = pending > 0 ? 'inline' : 'none';
  document.getElementById('approvals-count-badge').textContent = `${pending} pending`;
  
  const chatsWaitingCount = chatSessions.filter(c => c.status === 'waiting_approval').length;
  const chatBadge = document.getElementById('badge-chat-count');
  chatBadge.textContent = chatsWaitingCount;
  chatBadge.style.display = chatsWaitingCount > 0 ? 'inline' : 'none';
}

// --- OVERVIEW PENDING LIST ---
function renderOverviewPendingList() {
  const container = document.getElementById('overview-pending-list');

  // Legacy pending bookings
  const legacyPending = bookingsList.filter(b => b.status === 'pending').slice(0, 3).map(b => ({
    label: b.customerName,
    sub: `${(b.package || '').split(' - ')[0]} | ${b.area || ''}`,
    section: 'approvals',
    badge: 'Pending'
  }));

  // V2 NEEDS_HUMAN bookings
  const v2Pending = bookingsV2List.filter(b => b.status === 'NEEDS_HUMAN').slice(0, 3).map(b => ({
    label: b.customer ? b.customer.fullName : '—',
    sub: `${b.servicePackage ? b.servicePackage.nameEn : '—'} | ${b.area || '—'}`,
    section: 'bookings-v2',
    badge: 'Needs Review'
  }));

  const combined = [...legacyPending, ...v2Pending].slice(0, 5);

  if (combined.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-circle-check" style="color:var(--accent-green);"></i>
        <p>All bookings reviewed!</p>
      </div>`;
    return;
  }

  container.innerHTML = combined.map(item => `
    <div class="mini-booking-card">
      <div class="mini-booking-info">
        <h4>${escapeHtml(item.label)}</h4>
        <p>${escapeHtml(item.sub)} <span class="status-pill" style="background:var(--accent-red);color:#fff;font-size:0.7rem;padding:1px 6px;border-radius:4px;">${escapeHtml(item.badge)}</span></p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="switchSection('${escapeHtml(item.section)}')">Review</button>
    </div>
  `).join('');
}

// --- APPROVALS QUEUE ---
function renderApprovalsQueue() {
  const container = document.getElementById('approvals-list-container');
  const pending = bookingsList.filter(b => b.status === 'pending');
  
  if (pending.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-clipboard-check"></i>
        <p>No pending approvals. The AI chatbot is waiting for new bookings.</p>
      </div>`;
    return;
  }
  
  container.innerHTML = pending.map(b => {
    // Format timestamp
    const dateFormatted = new Date(b.createdAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const customerWhatsAppUrl = getCustomerWhatsAppUrl(b.phone);
    const paymentNote = usesInstaPay(b.paymentMethod)
      ? `<div class="payment-routing-note"><i class="fa-solid fa-receipt"></i> InstaPay to ${BUSINESS_CONTACT.localPhone}. Receipt screenshot required before final confirmation.</div>`
      : `<div class="payment-routing-note muted"><i class="fa-solid fa-circle-info"></i> Confirm payment method with the customer before approval.</div>`;

    return `
      <div class="approval-card card-glass" id="card-${escapeHtml(b.id)}">
        <div class="customer-card-meta">
          <h3>${escapeHtml(b.customerName || '—')}</h3>
          <span class="meta-phone">${escapeHtml(b.phone || '—')}</span>
          <div class="meta-detail-row">
            <span><i class="fa-solid fa-clock"></i> Received: ${escapeHtml(dateFormatted)}</span>
          </div>
          <div class="meta-detail-row">
            <span><i class="fa-solid fa-location-dot"></i> Address: ${escapeHtml(b.location || '—')}</span>
          </div>
        </div>

        <div class="booking-specs-col">
          <div class="specs-item">
            <i class="fa-solid fa-car"></i>
            <span>${escapeHtml(b.carType || '—')}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-cube"></i>
            <span class="badge-outline">${escapeHtml((b.package || '').split(' - ')[0] || '—')}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-calendar-check"></i>
            <span>${escapeHtml(b.preferredDate || '—')} at ${escapeHtml(b.preferredTime || '—')}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-credit-card"></i>
            <span>Payment: <strong>${escapeHtml(b.paymentMethod || '—')}</strong></span>
          </div>
          ${paymentNote}
        </div>

        <div class="approval-actions-col">
          <a class="btn btn-secondary btn-whatsapp" href="${escapeHtml(customerWhatsAppUrl)}" target="_blank" rel="noopener">
            <i class="fa-brands fa-whatsapp"></i> WhatsApp
          </a>
          <button class="btn btn-reject" onclick="rejectBooking('${escapeHtml(b.id)}')">
            <i class="fa-solid fa-xmark"></i> Reject
          </button>
          <button class="btn btn-approve" onclick="approveBooking('${escapeHtml(b.id)}')">
            <i class="fa-solid fa-check"></i> Approve
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Handle Approve
async function approveBooking(id) {
  addLog(`Approving booking ${id}...`, 'system');
  try {
    const res = await fetch(`/api/bookings/${id}/approve`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      addLog(`Booking for ${data.booking.customerName} APPROVED and scheduled.`, 'action');
      
      // Card fade-out animation
      const card = document.getElementById(`card-${id}`);
      if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateY(-20px)';
        setTimeout(() => fetchData(), 300);
      } else {
        fetchData();
      }
    }
  } catch (err) {
    console.error('Error approving booking:', err);
  }
}

// Handle Reject
async function rejectBooking(id) {
  addLog(`Rejecting booking ${id}...`, 'system');
  try {
    const res = await fetch(`/api/bookings/${id}/reject`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      addLog(`Booking for ${data.booking.customerName} REJECTED.`, 'action');
      
      const card = document.getElementById(`card-${id}`);
      if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => fetchData(), 300);
      } else {
        fetchData();
      }
    }
  } catch (err) {
    console.error('Error rejecting booking:', err);
  }
}

// --- CHAT SIMULATOR ENGINE ---
function setupChatSimulator() {
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  
  // Preset selection loader
  presetSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'preset-ar-trial') {
      simNameInput.value = 'Moustafa Kamel';
      simPhoneInput.value = '+20 100 999 8888';
      simLangSelect.value = 'ar';
      simTextInput.value = 'يا فندم كنت عايز أحجز غسيل لعربيتي';
    } else if (val === 'preset-en-premium') {
      simNameInput.value = 'John Smith';
      simPhoneInput.value = '+1 415 555 2671';
      simLangSelect.value = 'en';
      simTextInput.value = 'Hello, I want to book a mobile car wash Premium package.';
    } else if (val === 'preset-de-smart') {
      simNameInput.value = 'Sarah Keller';
      simPhoneInput.value = '+49 171 234 5678';
      simLangSelect.value = 'de';
      simTextInput.value = 'Guten Tag, ich möchte einen Smart Plan Termin für Autowäsche vereinbaren.';
    } else {
      simNameInput.value = '';
      simPhoneInput.value = '';
      simLangSelect.value = 'en';
      simTextInput.value = '';
    }
  });

  // Handle Simulate Send
  btnSimulateSend.addEventListener('click', simulateCustomerSend);
  
  // Handle Human Reply
  chatSendBtn.addEventListener('click', sendAgentReply);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendAgentReply();
  });
  
  // Search bar
  document.getElementById('chat-search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.session-item');
    items.forEach(item => {
      const name = item.querySelector('.session-name').textContent.toLowerCase();
      const phone = item.querySelector('.session-preview').textContent.toLowerCase();
      if (name.includes(query) || phone.includes(query)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
  });
}

// Render Chat Sessions List
function renderChatSidebar() {
  const container = document.getElementById('chat-sessions-list');
  if (chatSessions.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No chats active.</p></div>';
    return;
  }
  
  container.innerHTML = chatSessions.map(c => {
    const messages = Array.isArray(c.messages) ? c.messages : [];
    const lastMsg = messages[messages.length - 1];
    const previewText = lastMsg ? lastMsg.text : 'No messages yet';
    const initials = c.customerName ? c.customerName.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase() : 'CU';
    
    let badgeClass = 'status-active';
    let badgeLabel = 'Active';
    
    if (c.status === 'waiting_approval') {
      badgeClass = 'status-waiting';
      badgeLabel = 'Review';
    } else if (c.status === 'confirmed' || c.status === 'rejected') {
      badgeClass = 'status-booked';
      badgeLabel = c.status;
    }
    
    const isSelected = c.id === activeChatId ? 'active' : '';
    
    return `
      <div class="session-item ${isSelected}" onclick="selectChat('${c.id}')">
        <div class="avatar-circle">${initials}</div>
        <div class="session-details">
          <div class="session-header">
            <span class="session-name">${c.customerName}</span>
            <span class="session-time">${lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
          </div>
          <span class="session-preview">${previewText}</span>
          <div class="session-meta-row">
            <span class="badge-micro lang">${c.language || '??'}</span>
            <span class="badge-micro ${badgeClass}">${badgeLabel}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Select a Chat Session
async function selectChat(id) {
  activeChatId = id;
  renderChatSidebar();
  
  let currentChat = chatSessions.find(c => c.id === id);
  if (!currentChat) return;
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(id)}`);
    if (res.ok) {
      currentChat = await res.json();
      const idx = chatSessions.findIndex(c => c.id === id);
      if (idx >= 0) chatSessions[idx] = currentChat;
    }
  } catch (err) {
    console.warn('Could not load full chat; using cached session.', err);
  }
  
  // Show chat elements
  document.getElementById('chat-header-bar').style.display = 'flex';
  document.getElementById('chat-footer-bar').style.display = 'flex';
  
  // Update header details
  document.getElementById('chat-header-name').textContent = currentChat.customerName || 'Website Visitor';
  document.getElementById('chat-header-phone').textContent = currentChat.phone;
  document.getElementById('chat-header-avatar').textContent = (currentChat.customerName || 'Website Visitor').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  
  const langBadge = document.getElementById('chat-header-lang');
  langBadge.textContent = currentChat.language || '??';
  
  const statusBadge = document.getElementById('chat-header-status');
  statusBadge.textContent = currentChat.status === 'waiting_approval' ? 'Reviewing' : currentChat.status;
  statusBadge.className = `status-badge ${currentChat.status === 'waiting_approval' ? 'waiting' : currentChat.status}`;
  
  // Draw Messages
  renderMessages(currentChat.messages || []);
  updateParserChecklist(getChatDetails(currentChat), currentChat.lastAskedField);
  toggleChatInputState();
}

// Render message logs in chat window
function renderMessages(messages) {
  const container = document.getElementById('chat-messages-area');
  container.innerHTML = '';
  
  messages.forEach(m => {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${m.sender}`;
    
    const timeFormatted = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let senderName = 'Customer';
    if (m.sender === 'bot') senderName = 'AI Autopilot';
    else if (m.sender === 'agent') senderName = 'Human Agent';
    else if (m.sender === 'system') senderName = 'System';
    
    if (m.sender === 'system') {
      bubble.textContent = m.text;
    } else {
      bubble.innerHTML = `
        <span class="bubble-sender">${senderName}</span>
        <span>${escapeHtml(m.text).replace(/\n/g, '<br>')}</span>
        <span class="bubble-time">${timeFormatted}</span>
      `;
    }
    
    container.appendChild(bubble);
  });
  
  container.scrollTop = container.scrollHeight;
}

function getChatDetails(chat = {}) {
  const details = chat.bookingDetails || {};
  return {
    ...details,
    customerName: chat.customerName || details.customerName,
    area: chat.area || details.area,
    carType: chat.carType || details.carType,
    package: chat.package || details.package,
    preferredDate: chat.preferredDate || details.preferredDate || details.date,
    preferredTime: chat.preferredTime || details.preferredTime || details.time,
    location: chat.location || details.location,
    paymentMethod: chat.paymentMethod || details.paymentMethod
  };
}

// AI checklist update
function updateParserChecklist(details, lastAsked) {
  const checklist = {
    customerName: document.getElementById('chk-customerName'),
    area: document.getElementById('chk-area'),
    carType: document.getElementById('chk-carType'),
    package: document.getElementById('chk-package'),
    preferredDate: document.getElementById('chk-preferredDate'),
    preferredTime: document.getElementById('chk-preferredTime'),
    location: document.getElementById('chk-location'),
    paymentMethod: document.getElementById('chk-paymentMethod')
  };
  
  // Reset checklist classes
  Object.keys(checklist).forEach(key => {
    const el = checklist[key];
    const valEl = el.querySelector('.val');
    
    if (details && details[key]) {
      el.className = 'checked';
      el.querySelector('i').className = 'fa-solid fa-circle-check';
      valEl.textContent = details[key];
    } else {
      el.className = '';
      el.querySelector('i').className = 'fa-solid fa-circle';
      valEl.textContent = '—';
    }
  });
  
  // Set flow state text
  const stateBadge = document.getElementById('bot-flow-state');
  if (!details || Object.keys(details).length === 0) {
    stateBadge.textContent = 'State: Idle / Greeting';
    stateBadge.style.color = 'var(--text-muted)';
  } else if (lastAsked === 'finalConfirmation') {
    stateBadge.textContent = 'State: Awaiting Confirmation';
    stateBadge.style.color = 'var(--accent-orange)';
  } else if (lastAsked) {
    stateBadge.textContent = `State: Asking ${lastAsked}`;
    stateBadge.style.color = 'var(--accent-blue)';
  } else {
    stateBadge.textContent = 'State: Completed';
    stateBadge.style.color = 'var(--accent-green)';
  }
}

// Simulate Customer message action
async function simulateCustomerSend() {
  const name = simNameInput.value.trim() || 'Guest Customer';
  const phone = simPhoneInput.value.trim();
  const lang = simLangSelect.value;
  const text = simTextInput.value.trim();
  
  if (!phone || !text) {
    alert('Please fill out Phone and message text to simulate.');
    return;
  }
  
  addLog(`Simulating customer message from ${phone}...`, 'chat-in');
  
  // Disable button
  btnSimulateSend.disabled = true;
  
  try {
    const payload = {
      phone,
      name,
      text,
      language: lang
    };
    
    // Preset details parser help if we loaded presets
    if (presetSelect.value === 'preset-ar-trial') {
      payload.presetDetails = {
        customerName: 'Moustafa Kamel',
        area: 'El Gouna',
        carType: 'Kia Sportage',
        package: 'Trial Wash - 150 EGP'
      };
    }
    
    const res = await fetch('/api/chats/simulate-incoming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    
    if (data.success) {
      activeChatId = data.chat.id;
      addLog(`Customer (${name}): "${text}"`, 'chat-in');
      
      // Update data immediately
      await fetchData();
      selectChat(activeChatId);
      
      // Visual client-side typing simulator for chatbot!
      if (autopilotActive && data.messages.length > 1) {
        const botReply = data.messages[1];
        
        // Remove the bot reply from active rendering temporarily to simulate typing
        const chat = chatSessions.find(c => c.id === activeChatId);
        if (chat) {
          // Temporarily pop the last message
          const actualMessages = [...chat.messages];
          const botMsg = actualMessages.pop();
          
          renderMessages(actualMessages);
          
          // Show typing indicator bubble
          const container = document.getElementById('chat-messages-area');
          const typingBubble = document.createElement('div');
          typingBubble.className = 'message-bubble bot typing-indicator';
          typingBubble.id = 'temp-typing-indicator';
          typingBubble.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          `;
          container.appendChild(typingBubble);
          container.scrollTop = container.scrollHeight;
          
          // Wait typing delay setting
          const delay = parseInt(document.getElementById('typing-delay').value);
          setTimeout(() => {
            const temp = document.getElementById('temp-typing-indicator');
            if (temp) temp.remove();
            
            renderMessages(chat.messages);
            addLog(`AI Agent: "${botMsg.text.replace(/\n/g, ' ')}"`, 'bot-out');
            
            // Reload sidebar & metrics
            fetchData();
          }, delay);
        }
      }
    }
  } catch (err) {
    console.error('Error simulating customer incoming:', err);
  } finally {
    btnSimulateSend.disabled = false;
    // Clear message textbox to simulate next
    simTextInput.value = '';
  }
}

// Send human reply (Agent takeover)
async function sendAgentReply() {
  const chatInput = document.getElementById('chat-input');
  const text = chatInput.value.trim();
  
  if (!text || !activeChatId) return;
  
  chatInput.value = '';
  addLog(`Human Agent: "${text}"`, 'bot-out');
  
  try {
    const res = await fetch(`/api/chats/${activeChatId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'agent', text })
    });
    
    await fetchData();
    selectChat(activeChatId);
  } catch (err) {
    console.error('Error sending agent reply:', err);
  }
}

// --- CALENDAR SYSTEM ---
function setupCalendarControls() {
  document.getElementById('cal-prev-month').addEventListener('click', () => {
    currentCalDate.setMonth(currentCalDate.getMonth() - 1);
    renderCalendar();
  });
  
  document.getElementById('cal-next-month').addEventListener('click', () => {
    currentCalDate.setMonth(currentCalDate.getMonth() + 1);
    renderCalendar();
  });
  
  // Area Filter Checkboxes
  const filters = document.querySelectorAll('.area-filter-chk');
  filters.forEach(chk => {
    chk.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'all') {
        filters.forEach(c => c.checked = e.target.checked);
      } else {
        // Uncheck 'all' if any specific one is unchecked
        if (!e.target.checked) {
          document.querySelector('.area-filter-chk[value="all"]').checked = false;
        }
      }
      renderCalendar();
    });
  });
}

function renderCalendar() {
  const monthYearEl = document.getElementById('calendar-month-year');
  const daysContainer = document.getElementById('calendar-days-container');
  
  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  
  // Display Month Year title
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  monthYearEl.textContent = `${monthNames[month]} ${year}`;
  
  // Clear Grid
  daysContainer.innerHTML = '';
  
  // Fetch checked area filters
  const activeFilters = Array.from(document.querySelectorAll('.area-filter-chk:checked')).map(c => c.value);
  
  // Get first day of month and total days
  const firstDayIndex = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const prevLastDay = new Date(year, month, 0).getDate();
  
  // Calculate today
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  
  // Draw empty cells for previous month padding
  for (let x = firstDayIndex; x > 0; x--) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell inactive';
    cell.innerHTML = `<span class="day-number">${prevLastDay - x + 1}</span>`;
    daysContainer.appendChild(cell);
  }
  
  // Draw month day cells
  for (let i = 1; i <= lastDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell';
    
    // Check if cell corresponds to today
    if (isCurrentMonth && today.getDate() === i) {
      cell.classList.add('today');
    }
    
    cell.innerHTML = `<span class="day-number">${i}</span><div class="day-events"></div>`;
    
    // Check if cell has events scheduled
    const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    
    const allCalEvents = [...calendarEvents, ...adaptV2EventsForCalendar(bookingsV2List)];
    const dayEvents = allCalEvents.filter(e => {
      // Event date match
      const eventDateStr = e.start.split('T')[0];
      const isFiltered = activeFilters.includes('all') || activeFilters.includes(e.area);
      return eventDateStr === cellDateStr && isFiltered;
    });
    
    const eventsContainer = cell.querySelector('.day-events');
    dayEvents.forEach(evt => {
      const evtBadge = document.createElement('div');
      
      let areaClass = 'gouna';
      if (evt.area === 'Hurghada') areaClass = 'hurghada';
      else if (evt.area === 'Sahl Hasheesh') areaClass = 'sahl';
      
      evtBadge.className = `day-event-dot ${areaClass}`;
      
      const timeStr = evt.start.split('T')[1].substring(0, 5);
      evtBadge.textContent = `${timeStr} ${evt.customerName.split(' ')[0]}`;
      evtBadge.title = `${evt.customerName} - ${evt.carType} (${evt.area})`;
      
      // View event details on click
      evtBadge.addEventListener('click', (event) => {
        event.stopPropagation();
        openBookingModal(evt.bookingId);
      });
      
      eventsContainer.appendChild(evtBadge);
    });
    
    daysContainer.appendChild(cell);
  }
  
  // Render Sidebar timeline list
  renderCalendarSidebarTimeline(activeFilters);
}

function renderCalendarSidebarTimeline(activeFilters) {
  const container = document.getElementById('calendar-timeline-list');
  
  // Filter events based on active filters
  const allSidebarEvents = [...calendarEvents, ...adaptV2EventsForCalendar(bookingsV2List)];
  const filteredEvents = allSidebarEvents.filter(e => activeFilters.includes('all') || activeFilters.includes(e.area));

  // Sort events by date & time ascending
  filteredEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

  // Update sidebar counter values
  const gounaCount = allSidebarEvents.filter(e => e.area === 'El Gouna').length;
  const hurghadaCount = allSidebarEvents.filter(e => e.area === 'Hurghada').length;
  const sahlCount = allSidebarEvents.filter(e => e.area === 'Sahl Hasheesh').length;
  
  document.getElementById('summary-gouna-count').textContent = gounaCount;
  document.getElementById('summary-hurghada-count').textContent = hurghadaCount;
  document.getElementById('summary-sahl-count').textContent = sahlCount;
  
  if (filteredEvents.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:10px;"><p>No schedules matches.</p></div>';
    return;
  }
  
  container.innerHTML = filteredEvents.map(evt => {
    let areaClass = 'gouna';
    if (evt.area === 'Hurghada') areaClass = 'hurghada';
    else if (evt.area === 'Sahl Hasheesh') areaClass = 'sahl';
    
    const dateObj = new Date(evt.start);
    const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `
      <div class="timeline-event-card ${areaClass}" onclick="openBookingModal('${evt.bookingId}')">
        <h5>${evt.customerName}</h5>
        <p>${evt.carType} | ${evt.area}</p>
        <span class="timeline-event-time">${dateStr} @ ${timeStr}</span>
      </div>
    `;
  }).join('');
}

// --- DETAILED MODAL POPUP ---
function setupModal() {
  const modal = document.getElementById('booking-modal');
  const closeBtn = document.getElementById('modal-close-btn');
  
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  // Close on outer click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
}

function openBookingModal(bookingId) {
  const modal = document.getElementById('booking-modal');
  const body = document.getElementById('modal-body-content');
  const footer = document.getElementById('modal-footer-actions');
  
  // Check V2 bookings first (bookingV2Id), then fall back to legacy
  const bv2 = bookingsV2List.find(x => x.bookingV2Id === bookingId);
  if (bv2) { openBookingModalV2(bv2); return; }
  const b = bookingsList.find(x => x.id === bookingId);
  if (!b) return;
  
  body.innerHTML = `
    <div class="modal-row">
      <span class="modal-label">Customer Name:</span>
      <span class="modal-val">${b.customerName}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">WhatsApp Number:</span>
      <span class="modal-val">${b.phone}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Operating Area:</span>
      <span class="modal-val">${b.area}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Car Specifications:</span>
      <span class="modal-val">${b.carType}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Selected Package:</span>
      <span class="modal-val">${b.package}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Preferred Date:</span>
      <span class="modal-val">${b.preferredDate}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Preferred Time:</span>
      <span class="modal-val">${b.preferredTime}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Location / Map:</span>
      <span class="modal-val">${b.location}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Payment Method:</span>
      <span class="modal-val">${b.paymentMethod}${usesInstaPay(b.paymentMethod) ? `<br><small class="modal-hint">InstaPay receiving number: ${BUSINESS_CONTACT.localPhone}. Ask for receipt screenshot.</small>` : ''}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Customer WhatsApp:</span>
      <span class="modal-val"><a class="inline-action-link" href="${getCustomerWhatsAppUrl(b.phone)}" target="_blank" rel="noopener">Message ${b.phone}</a></span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Manager Notes:</span>
      <span class="modal-val">${b.notes}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Reservation Status:</span>
      <span class="modal-val"><strong style="text-transform:uppercase; color: ${b.status === 'confirmed' ? 'var(--accent-green)' : (b.status === 'rejected' ? 'var(--accent-red)' : 'var(--accent-orange)')}">${b.status}</strong></span>
    </div>
  `;
  
  // Render actions buttons
  if (b.status === 'pending') {
    footer.innerHTML = `
      <button class="btn btn-reject" onclick="closeModalAndReject('${b.id}')"><i class="fa-solid fa-xmark"></i> Reject</button>
      <button class="btn btn-approve" onclick="closeModalAndApprove('${b.id}')"><i class="fa-solid fa-check"></i> Approve</button>
    `;
  } else {
    footer.innerHTML = `
      <button class="btn btn-primary" onclick="document.getElementById('booking-modal').classList.remove('active')">Close</button>
    `;
  }
  
  modal.classList.add('active');
}

function closeModalAndApprove(id) {
  document.getElementById('booking-modal').classList.remove('active');
  approveBooking(id);
}

function closeModalAndReject(id) {
  document.getElementById('booking-modal').classList.remove('active');
  rejectBooking(id);
}

// --- V2 BOOKING MODAL ---
function openBookingModalV2(b) {
  const modal = document.getElementById('booking-modal');
  const body = document.getElementById('modal-body-content');
  const footer = document.getElementById('modal-footer-actions');

  const statusColor = {
    QUOTED: 'var(--accent-green)',
    CONFIRMED: '#0ea5e9',
    IN_PROGRESS: '#8b5cf6',
    COLLECTING_INFO: 'var(--accent-orange)',
    NEEDS_HUMAN: 'var(--accent-red)',
    COMPLETED: '#6b7280',
    CANCELLED: '#6b7280'
  }[b.status] || 'var(--text-secondary)';

  const fmtDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtPrice = p => p != null ? `EGP ${(p / 100).toFixed(2)}` : '—';
  const asgn = b.assignment;

  body.innerHTML = `
    <div class="modal-row">
      <span class="modal-label">Ref:</span>
      <span class="modal-val"><code>${escapeHtml(b.publicRef)}</code></span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Status:</span>
      <span class="modal-val"><strong style="text-transform:uppercase;color:${statusColor}">${escapeHtml(b.status)}</strong>${b.paymentStatus ? ` — <em>${escapeHtml(b.paymentStatus)}</em>` : ''}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Customer:</span>
      <span class="modal-val">${b.customer ? escapeHtml(b.customer.fullName) : '—'}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Phone:</span>
      <span class="modal-val">${b.customer ? escapeHtml(b.customer.phoneRaw || b.customer.phoneE164) : '—'}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Vehicle:</span>
      <span class="modal-val">${b.vehicle ? escapeHtml(`${b.vehicle.make || ''} ${b.vehicle.model || ''} (${b.vehicle.carType})`).trim() : '—'}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Service:</span>
      <span class="modal-val">${b.servicePackage ? escapeHtml(b.servicePackage.nameEn) : '—'} ${b.servicePackage ? `— ${fmtPrice(b.servicePackage.pricePiasters)}` : ''}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Scheduled:</span>
      <span class="modal-val">${fmtDate(b.scheduledStart)} → ${fmtDate(b.scheduledEnd)}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Area / Address:</span>
      <span class="modal-val">${escapeHtml(b.area || '—')}${b.address ? ` — ${escapeHtml(b.address)}` : ''}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Source:</span>
      <span class="modal-val">${escapeHtml(b.source || '—')} / ${escapeHtml(b.language || '—')}</span>
    </div>
    <div class="modal-row">
      <span class="modal-label">Assigned To:</span>
      <span class="modal-val">${asgn
        ? `<strong>${escapeHtml(asgn.cleaner.displayName)}</strong>${asgn.cleaner.phone ? ` · ${escapeHtml(asgn.cleaner.phone)}` : ''} <em style="color:var(--text-secondary)">since ${fmtDate(asgn.assignedAt)}</em>`
        : '<span style="color:var(--text-secondary)">— Unassigned</span>'
      }</span>
    </div>
    ${b.missingFields && b.missingFields.length ? `
    <div class="modal-row">
      <span class="modal-label">Missing Fields:</span>
      <span class="modal-val" style="color:var(--accent-orange)">${b.missingFields.map(escapeHtml).join(', ')}</span>
    </div>` : ''}
    ${b.notes ? `
    <div class="modal-row">
      <span class="modal-label">Notes:</span>
      <span class="modal-val">${escapeHtml(b.notes)}</span>
    </div>` : ''}
  `;

  const canAssign = ['QUOTED', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status);
  const closebtn = `<button class="btn btn-primary" onclick="document.getElementById('booking-modal').classList.remove('active')">Close</button>`;

  if (asgn) {
    footer.innerHTML = `
      <button class="btn btn-reject" onclick="doReleaseCleaner('${escapeHtml(b.bookingV2Id)}')">
        <i class="fa-solid fa-user-minus"></i> Release Cleaner
      </button>
      ${closebtn}`;
  } else if (canAssign && cleanersList.length) {
    const options = cleanersList.map(c =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`
    ).join('');
    footer.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="modal-cleaner-select" class="btn" style="min-width:160px;">${options}</select>
        <button class="btn btn-approve" onclick="doAssignCleaner('${escapeHtml(b.bookingV2Id)}')">
          <i class="fa-solid fa-user-plus"></i> Assign
        </button>
        ${closebtn}
      </div>`;
  } else {
    footer.innerHTML = closebtn;
  }

  modal.classList.add('active');
}

async function doAssignCleaner(bookingId) {
  const sel = document.getElementById('modal-cleaner-select');
  if (!sel) return;
  const cleanerId = sel.value;
  try {
    const res = await fetch(`/api/admin/bookings-v2/${encodeURIComponent(bookingId)}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleanerId })
    });
    const data = await res.json();
    if (data.success) {
      addLog(`Cleaner assigned to booking ${bookingId.slice(-8)}.`, 'action');
      document.getElementById('booking-modal').classList.remove('active');
      fetchData();
    } else {
      addLog(`Assign failed: ${data.error || data.code}`, 'system');
    }
  } catch (err) {
    addLog(`Assign error: ${err.message}`, 'system');
  }
}

async function doReleaseCleaner(bookingId) {
  try {
    const res = await fetch(`/api/admin/bookings-v2/${encodeURIComponent(bookingId)}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ releaseReason: 'MANUAL_RELEASE' })
    });
    const data = await res.json();
    if (data.success) {
      addLog(`Cleaner released from booking ${bookingId.slice(-8)}.`, 'action');
      document.getElementById('booking-modal').classList.remove('active');
      fetchData();
    } else {
      addLog(`Release failed: ${data.error || data.code}`, 'system');
    }
  } catch (err) {
    addLog(`Release error: ${err.message}`, 'system');
  }
}

// --- V2 CALENDAR ADAPTER ---
function adaptV2EventsForCalendar(bookings) {
  return bookings
    .filter(b => ['QUOTED', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status))
    .map(b => ({
      bookingId: b.bookingV2Id,
      isV2: true,
      start: b.scheduledStart,
      customerName: b.customer ? b.customer.fullName : b.publicRef,
      carType: b.vehicle
        ? (`${b.vehicle.make || ''} ${b.vehicle.model || ''}`.trim() || b.vehicle.carType)
        : '—',
      area: b.area || 'El Gouna'
    }));
}

// --- WEB BOOKINGS V2 LIST ---
const V2_STATUS_LABEL = {
  QUOTED: { label: 'Quoted', color: 'var(--accent-green)' },
  CONFIRMED: { label: 'Confirmed', color: '#0ea5e9' },
  IN_PROGRESS: { label: 'In Progress', color: '#8b5cf6' },
  COLLECTING_INFO: { label: 'Collecting Info', color: 'var(--accent-orange)' },
  NEEDS_HUMAN: { label: 'Needs Attention', color: 'var(--accent-red)' },
  COMPLETED: { label: 'Completed', color: '#6b7280' },
  CANCELLED: { label: 'Cancelled', color: '#6b7280' }
};

function renderBookingsV2() {
  const container = document.getElementById('v2-bookings-list-container');
  const badge = document.getElementById('v2-bookings-count-badge');
  if (!container) return;

  badge.textContent = `${bookingsV2List.length} booking${bookingsV2List.length !== 1 ? 's' : ''}`;

  if (bookingsV2List.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:48px 20px;">
        <i class="fa-solid fa-globe" style="font-size:32px;color:var(--accent-blue-light);opacity:0.5;"></i>
        <h3 style="color:var(--text-primary);font-size:15px;margin:8px 0 4px;">No web bookings yet</h3>
        <p style="font-size:12.5px;max-width:340px;text-align:center;">Bookings from the public website form, chatbot, and WhatsApp will land here. They are normalized, idempotent, and start as <code>QUOTED</code>, <code>COLLECTING_INFO</code>, or <code>NEEDS_HUMAN</code>.</p>
      </div>`;
    return;
  }

  const sorted = [...bookingsV2List].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Owner-only UI hint: if the JWT has admin role, show a small badge.
  let isOwner = true;
  try {
    if (authToken) {
      const payload = JSON.parse(atob(authToken.split('.')[1]));
      isOwner = payload.role === 'admin' || payload.role === 'OWNER';
    }
  } catch (_) { isOwner = true; }

  container.innerHTML = sorted.map(b => {
    const st = V2_STATUS_LABEL[b.status] || { label: b.status, color: 'var(--text-secondary)' };
    const statusCls = String(b.status || '').toLowerCase().replace(/_/g, '-');
    const fmtDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const customerName = b.customer ? escapeHtml(b.customer.fullName) : '—';
    const phone = b.customer ? escapeHtml(b.customer.phoneRaw || b.customer.phoneE164) : '';
    const vehicle = b.vehicle ? escapeHtml(`${b.vehicle.carType}`) : '—';
    const service = b.servicePackage ? escapeHtml(b.servicePackage.nameEn) : '—';
    const scheduled = fmtDate(b.scheduledStart);
    const missingHtml = b.missingFields && b.missingFields.length
      ? `<div class="payment-routing-note" style="color:var(--accent-orange)"><i class="fa-solid fa-circle-exclamation"></i> Missing: ${b.missingFields.map(escapeHtml).join(', ')}</div>`
      : '';
    // Source channel chip
    const source = String(b.source || '').toUpperCase();
    const sourceHtml = source ? `<span class="m1-status-pill" style="background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);color:var(--text-muted);">${escapeHtml(source)}</span>` : '';
    // Payment status chip (if present)
    const pStatus = String(b.paymentStatus || '').toUpperCase();
    let payHtml = '';
    if (pStatus === 'VERIFIED') {
      payHtml = `<span class="m1-status-pill verified"><i class="fa-solid fa-check"></i> Paid</span>`;
    } else if (pStatus === 'PAYMENT_PENDING_REVIEW' || pStatus === 'PENDING') {
      payHtml = `<span class="m1-status-pill pending"><i class="fa-solid fa-clock"></i> Awaiting proof</span>`;
    } else if (pStatus === 'REJECTED') {
      payHtml = `<span class="m1-status-pill rejected"><i class="fa-solid fa-xmark"></i> Proof rejected</span>`;
    } else if (pStatus === 'UNPAID') {
      payHtml = `<span class="m1-status-pill quoted"><i class="fa-solid fa-hourglass-half"></i> Unpaid</span>`;
    }
    const ownerHint = isOwner ? '' : `<span class="m1-status-pill" style="background:rgba(8,145,178,0.12);border:1px solid rgba(8,145,178,0.28);color:#67e8f9;" title="Dispatcher view: read-only"><i class="fa-solid fa-eye"></i> Read-only</span>`;

    return `
      <div class="approval-card card-glass" id="v2-card-${escapeHtml(b.bookingV2Id)}">
        <div class="customer-card-meta">
          <h3>${customerName}</h3>
          <span class="meta-phone">${phone}</span>
          <div class="meta-detail-row">
            <span><i class="fa-solid fa-tag"></i> <code>${escapeHtml(b.publicRef)}</code></span>
          </div>
          <div class="meta-detail-row">
            <span><i class="fa-solid fa-calendar-check"></i> ${scheduled}</span>
          </div>
          <div class="meta-detail-row" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
            <span class="m1-status-pill ${statusCls}">${escapeHtml(st.label)}</span>
            ${payHtml}
            ${sourceHtml}
            ${ownerHint}
          </div>
          ${missingHtml}
        </div>
        <div class="booking-specs-col">
          <div class="specs-item">
            <i class="fa-solid fa-car"></i>
            <span>${vehicle}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-cube"></i>
            <span class="badge-outline">${service}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-location-dot"></i>
            <span>${escapeHtml(b.area || '—')}</span>
          </div>
        </div>
        <div class="approval-actions-col">
          <button class="btn btn-primary btn-sm" onclick="openBookingModal('${escapeHtml(b.bookingV2Id)}')">
            <i class="fa-solid fa-eye"></i> Details
          </button>
        </div>
      </div>`;
  }).join('');
}

// --- COLOR THEME TOGGLER ---
function setupThemeToggle() {
  themeToggleBtn.addEventListener('click', () => {
    const body = document.body;
    if (body.classList.contains('dark-mode')) {
      body.classList.remove('dark-mode');
      body.classList.add('light-mode');
      themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i> <span>Dark Mode</span>';
      addLog('Theme switched: Light Mode active.', 'system');
    } else {
      body.classList.remove('light-mode');
      body.classList.add('dark-mode');
      themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i> <span>Light Mode</span>';
      addLog('Theme switched: Dark Mode active.', 'system');
    }
  });
}

// --- SOCIAL MEDIA SCHEDULER ---
function setupSocialMedia() {
  const form = document.getElementById('social-post-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const title = document.getElementById('post-title').value;
      const caption = document.getElementById('post-caption').value;
      const scheduledAt = document.getElementById('post-time').value;
      
      // Get selected platforms
      const platformCheckboxes = document.querySelectorAll('input[name="post-platform"]:checked');
      const platform = Array.from(platformCheckboxes).map(cb => cb.value);
      
      if (platform.length === 0) {
        alert("Please select at least one platform (TikTok, Instagram, or Facebook).");
        return;
      }
      
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scheduling...';
      
      try {
        const response = await fetch('/api/socials/posts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title,
            platform,
            caption,
            scheduledAt: new Date(scheduledAt).toISOString()
          })
        });
        
        const result = await response.json();
        if (result.success) {
          addLog(`Campaign post "${title}" scheduled successfully for ${new Date(scheduledAt).toLocaleString()}`, 'action');
          form.reset();
          // Reset check boxes to default checked
          document.querySelectorAll('input[name="post-platform"]').forEach(cb => cb.checked = true);
          // Refetch socials data to update the UI
          await fetchSocialsData();
        } else {
          alert("Failed to schedule post: " + (result.error || "Unknown error"));
        }
      } catch (err) {
        console.error("Error scheduling campaign post:", err);
        alert("Error connecting to server. Please try again.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Schedule Campaign Post';
      }
    });
  }
}

async function fetchSocialsData() {
  try {
    // 1. Fetch scheduled posts
    socialsPosts = await fetchJsonOrAuth('/api/socials/posts', 'Social posts');
    renderScheduledPosts();
    
    // 2. Fetch analytics
    const analytics = await fetchJsonOrAuth('/api/socials/analytics', 'Social analytics');
    updateSocialsAnalyticsUI(analytics);
  } catch (err) {
    if (String(err.message).startsWith('AUTH_REQUIRED:')) throw err;
    console.error("Error fetching social media data:", err);
  }
}

function updateSocialsAnalyticsUI(data) {
  if (!data || !data.platforms) return;
  
  const platforms = ['tiktok', 'instagram', 'facebook'];
  platforms.forEach(p => {
    const pData = data.platforms[p];
    const formatNum = (num) => typeof num === 'number'
      ? (num >= 1000 ? (num / 1000).toFixed(1) + 'k' : String(num))
      : '--';
    const viewsEl = document.getElementById(`stat-${p}-views`);
    const likesEl = document.getElementById(`stat-${p}-likes`);
    const commentsEl = document.getElementById(`stat-${p}-comments`);
    
    if (viewsEl) viewsEl.textContent = formatNum(pData?.views);
    if (likesEl) likesEl.textContent = formatNum(pData?.likes);
    if (commentsEl) commentsEl.textContent = formatNum(pData?.comments);
  });
}

function renderScheduledPosts() {
  const container = document.getElementById('scheduled-posts-list');
  if (!container) return;
  
  if (socialsPosts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-calendar-xmark"></i>
        <p>No campaign posts scheduled. Create one on the right to start!</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = socialsPosts.map(post => {
    const postPlatforms = Array.isArray(post.platforms)
      ? post.platforms
      : (Array.isArray(post.platform) ? post.platform : []);
    const postImages = Array.isArray(post.images)
      ? post.images
      : (Array.isArray(post.slides) ? post.slides : []);
    const platformsHTML = postPlatforms.map(plat => `
      <span class="platform-badge ${plat}">
        <i class="fa-brands fa-${plat === 'facebook' ? 'facebook-f' : plat}"></i> ${plat}
      </span>
    `).join('');
    
    const dateStr = post.scheduledAt ? new Date(post.scheduledAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) : 'Not scheduled';
    
    const slidesHTML = postImages.length > 0 ? `
      <div class="post-card-slides-preview">
        ${postImages.map(slide => `<img src="${escapeHTML(String(slide))}" class="post-slide-thumb" alt="Slide preview" loading="lazy" onerror="this.style.display='none'">`).join('')}
      </div>
    ` : '';
    
    return `
      <div class="scheduled-post-card" id="post-${post.id}">
        <div class="post-card-header">
          <div>
            <h3 class="post-card-title">${escapeHTML(post.title)}</h3>
            <div class="post-card-platform-badges">${platformsHTML}</div>
          </div>
          <span class="post-card-date"><i class="fa-solid fa-clock"></i> ${dateStr}</span>
        </div>
        <p class="post-card-caption">${escapeHTML(post.caption)}</p>
        ${slidesHTML}
        <div class="post-card-actions">
          <span class="post-status-badge ${post.status}">${post.status}</span>
          <button class="btn-cancel-post" onclick="cancelScheduledPost('${post.id}')">
            <i class="fa-solid fa-trash-can"></i> Cancel
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Global scope cancel handler
async function cancelScheduledPost(postId) {
  if (!confirm("Are you sure you want to cancel and delete this scheduled post?")) return;
  
  try {
    const res = await fetch(`/api/socials/posts/${postId}`, {
      method: 'DELETE'
    });
    const result = await res.json();
    if (result.success) {
      addLog(`Cancelled scheduled post ID: ${postId}`, 'action');
      await fetchSocialsData();
    } else {
      alert("Failed to cancel post: " + (result.error || "Unknown error"));
    }
  } catch (err) {
    console.error("Error cancelling post:", err);
  }
}

window.cancelScheduledPost = cancelScheduledPost;

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Render AI Agents Control Center
function renderAgentsControlCenter(agents) {
  const grid = document.getElementById('agents-cards-grid');
  if (!grid) return;

  const activeCount = agents.filter(a => a.status === 'active').length;
  const badge = document.getElementById('active-agents-badge');
  if (badge) {
    badge.textContent = `${activeCount} / ${agents.length} ACTIVE AGENTS`;
    badge.style.background = activeCount > 0 ? 'var(--glass-bg-hover)' : 'rgba(235, 87, 87, 0.12)';
    badge.style.color = activeCount > 0 ? 'var(--text-primary)' : 'var(--accent-red)';
    badge.style.borderColor = activeCount > 0 ? 'var(--glass-border)' : 'var(--accent-red-glow)';
  }

  grid.innerHTML = agents.map(agent => {
    const isActive = agent.status === 'active';
    const logsHTML = agent.logs.slice(0, 4).map(log => `<div>${escapeHTML(log)}</div>`).join('');
    
    return `
      <div class="agent-card card-glass ${isActive ? '' : 'inactive'}" style="padding: 20px; border-radius: 12px; display: flex; flex-direction: column; gap: 14px; position: relative; transition: all 0.3s ease;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 8px;">
              <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${isActive ? 'var(--accent-blue)' : 'var(--text-muted)'};"></span>
              ${agent.name}
            </h3>
            <span style="font-size: 0.75rem; color: var(--accent-blue); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">${agent.role}</span>
          </div>
          
          <label class="switch small">
            <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleAgentStatus('${agent.id}')">
            <span class="slider round"></span>
          </label>
        </div>
        
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); border-radius: 8px; padding: 12px;">
          <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Current Operation</div>
          <div style="font-size: 0.85rem; color: var(--text-primary); font-weight: 500;">${agent.task || 'Idle / Awaiting trigger'}</div>
        </div>

        <div style="flex-grow: 1;">
          <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; margin-bottom: 6px;">Live Activity Log</div>
          <div class="agent-log-console" style="background: var(--bg-tertiary); border-radius: 6px; padding: 8px 12px; font-family: monospace; font-size: 0.75rem; color: var(--text-primary); min-height: 80px; max-height: 100px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--glass-border);">
            ${logsHTML || '<div style="color: var(--text-muted);">No log activity yet.</div>'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleAgentStatus(id) {
  try {
    const res = await fetch(`/api/agents/${id}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      addLog(`Agent ${data.agent.name} status toggled to: ${data.agent.status.toUpperCase()}`, 'action');
      fetchData();
    }
  } catch (err) {
    console.error('Error toggling agent status:', err);
  }
}

window.toggleAgentStatus = toggleAgentStatus;

// --- TRACES SECTION ---
function setupTraces() {
  const refreshBtn = document.getElementById('btn-traces-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadTraces());
  }
  // Load once on init so the table isn't empty when the user navigates here.
  loadTraces();
}

async function loadTraces() {
  const tbody = document.getElementById('traces-tbody');
  const modeBadge = document.getElementById('traces-mode-badge');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="padding: 18px 14px; text-align: center; color: var(--text-secondary);">Loading traces…</td></tr>';

  try {
    const res = await fetch('/api/observability/recent?limit=50');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const traces = (data && data.traces) || [];

    // Update mode badge: "LIVE" if any trace was sent live, "DRY-RUN" otherwise.
    const anyLive = traces.some(t => t.mode === 'live');
    if (modeBadge) {
      modeBadge.textContent = anyLive ? 'LIVE' : 'DRY-RUN';
      modeBadge.style.color = anyLive ? '#10b981' : 'var(--text-primary)';
    }

    if (traces.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding: 18px 14px; text-align: center; color: var(--text-secondary);">No traces yet. Send a chat message to generate one.</td></tr>';
      return;
    }

    tbody.innerHTML = traces.map(renderTraceRow).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 18px 14px; text-align: center; color: #ef4444;">Failed to load traces: ' + err.message + '</td></tr>';
  }
}

function renderTraceRow(t) {
  const ts = t.timestamp ? new Date(t.timestamp).toLocaleString() : '-';
  const status = t.status || 'unknown';
  const statusColor = status === 'success' ? '#10b981' : (status === 'error' ? '#ef4444' : '#f59e0b');
  const dur = (typeof t.durationMs === 'number') ? (t.durationMs < 1000 ? t.durationMs.toFixed(1) + ' ms' : (t.durationMs / 1000).toFixed(2) + ' s') : '-';
  const sessionShort = t.sessionId ? String(t.sessionId).slice(0, 14) : '-';
  const outcome = (t.metadata && (t.metadata.finalOutcome || t.metadata.outcome)) || '-';

  return '<tr style="border-bottom: 1px solid var(--glass-border);">' +
    '<td style="padding: 10px 14px; color: var(--text-secondary); font-family: monospace; font-size: 0.78rem;">' + escapeHtml(ts) + '</td>' +
    '<td style="padding: 10px 14px; color: var(--text-primary); font-weight: 500;">' + escapeHtml(t.name || '-') + '</td>' +
    '<td style="padding: 10px 14px; color: var(--text-secondary); font-family: monospace; font-size: 0.78rem;">' + escapeHtml(sessionShort) + '</td>' +
    '<td style="padding: 10px 14px;"><span style="display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 0.72rem; font-weight: 600; color: white; background: ' + statusColor + ';">' + escapeHtml(status) + '</span></td>' +
    '<td style="padding: 10px 14px; color: var(--text-secondary); font-family: monospace;">' + escapeHtml(dur) + '</td>' +
    '<td style="padding: 10px 14px; color: var(--text-primary);">' + escapeHtml(outcome) + '</td>' +
    '</tr>';
}

// ============================================================================
// PAYMENT REVIEW (M0-006)
// ============================================================================

function paymentStatusPill(status) {
  const map = {
    PAYMENT_PENDING_REVIEW: ['#e59600', 'Pending Review'],
    VERIFIED: ['#27ae60', 'Verified'],
    REJECTED: ['#c0392b', 'Rejected'],
    UNPAID: ['#666', 'Unpaid'],
    PAYMENT_INSTRUCTIONS_SENT: ['#2980b9', 'Instructions Sent']
  };
  const [color, label] = map[status] || ['#888', escapeHtml(status || '—')];
  return `<span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:0.72rem;font-weight:600;color:#fff;background:${color};">${label}</span>`;
}

function renderPaymentReview(payments) {
  const list = payments || paymentReviewList;
  const container = document.getElementById('payments-review-list');
  if (!container) return;

  const badge = document.getElementById('badge-payments-pending');
  const pendingCount = list.filter(p => p.status === 'PAYMENT_PENDING_REVIEW').length;
  if (badge) {
    badge.textContent = pendingCount;
    badge.style.display = pendingCount > 0 ? '' : 'none';
  }

  // Detect current user role from JWT (best-effort parse; no crypto validation needed here)
  let currentRole = 'UNKNOWN';
  try {
    const payload = JSON.parse(atob(authToken.split('.')[1]));
    currentRole = (payload.role === 'admin' ? 'OWNER' : payload.role) || 'UNKNOWN';
  } catch (_e) { /* dev bypass has no token */ currentRole = 'OWNER'; }

  const isOwner = currentRole === 'OWNER';

  if (!list.length) {
    container.innerHTML = '<p style="color:var(--text-secondary);padding:20px 0;">No payments match this filter.</p>';
    return;
  }

  const rows = list.map(p => {
    const ageMs = p.submittedAt ? (Date.now() - new Date(p.submittedAt).getTime()) : null;
    const ageHrs = ageMs != null ? ageMs / 3_600_000 : null;
    const ageColor = ageHrs == null ? 'var(--text-secondary)'
      : ageHrs < 1 ? '#27ae60'
      : ageHrs < 6 ? '#e59600'
      : '#c0392b';
    const ageLabel = ageHrs == null ? '—'
      : ageHrs < 1 ? `${Math.round(ageHrs * 60)}m ago`
      : `${Math.round(ageHrs)}h ago`;

    // Payment IDs are server-generated (`pay_` + hex), so they are safe to embed
    // as a single-quoted JS string inside the double-quoted onclick attribute.
    // (JSON.stringify here would inject literal double-quotes and break the attribute.)
    const safeId = escapeHtml(p.id);
    const verifyBtn = isOwner && p.status === 'PAYMENT_PENDING_REVIEW'
      ? `<button class="btn btn-primary btn-sm" onclick="handlePaymentVerify('${safeId}')" style="margin-right:6px;">
           <i class="fa-solid fa-check"></i> Verify
         </button>`
      : '';

    const rejectBtn = isOwner && p.status === 'PAYMENT_PENDING_REVIEW'
      ? `<button class="btn btn-sm" style="background:var(--accent-red,#c0392b);color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;"
             onclick="handlePaymentReject('${safeId}')">
           <i class="fa-solid fa-xmark"></i> Reject
         </button>`
      : '';

    const screenshotUrl = p.screenshotUrl;
    const isSafeScreenshotUrl = screenshotUrl && /^https?:\/\//i.test(screenshotUrl);
    const screenshotLink = isSafeScreenshotUrl
      ? `<a href="${escapeHtml(screenshotUrl)}" target="_blank" rel="noopener" style="color:var(--accent-blue,#2980b9);font-size:0.78rem;">View screenshot</a>`
      : screenshotUrl
        ? '<span style="color:var(--text-secondary);font-size:0.78rem;">Screenshot (invalid URL)</span>'
        : '<span style="color:var(--text-secondary);font-size:0.78rem;">No screenshot</span>';

    return `<div class="m1-payment-card" data-status="${escapeHtml(p.status)}">
      <div class="m1-payment-proof">
        ${isSafeScreenshotUrl
          ? `<a href="${escapeHtml(screenshotUrl)}" target="_blank" rel="noopener" aria-label="View payment proof screenshot"><i class="fa-solid fa-image"></i></a>`
          : `<i class="fa-solid fa-image"></i>`}
      </div>
      <div class="m1-payment-body">
        <div class="m1-payment-head">
          <span class="m1-payment-customer">${escapeHtml(p.customer && p.customer.name || '—')}</span>
          ${paymentStatusPill(p.status)}
          <span style="color:${ageColor};font-size:0.78rem;font-weight:600;margin-left:auto;">${ageLabel}</span>
        </div>
        <div class="m1-payment-meta">
          <span><i class="fa-solid fa-receipt"></i> ${escapeHtml(p.publicRef || p.bookingId)}</span>
          <span><i class="fa-solid fa-phone"></i> ${escapeHtml(p.customer && p.customer.phone || '—')}</span>
          <span><i class="fa-solid fa-car"></i> ${escapeHtml(p.service && p.service.name || '—')}</span>
          <span class="m1-payment-amount"><i class="fa-solid fa-money-bill" style="margin-right:4px;color:var(--accent-blue-light);opacity:0.7;"></i>${((p.amountPiasters || 0) / 100).toFixed(2)} ${escapeHtml(p.currency || 'EGP')}</span>
        </div>
        ${p.reference ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px;"><strong>Ref:</strong> ${escapeHtml(p.reference)}</div>` : ''}
        ${p.rejectionReason ? `<div style="font-size:0.8rem;color:var(--accent-red);margin-top:4px;"><i class="fa-solid fa-circle-exclamation"></i> Rejected: ${escapeHtml(p.rejectionReason)}</div>` : ''}
        ${isSafeScreenshotUrl
          ? `<a class="m1-payment-link" href="${escapeHtml(screenshotUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> View proof screenshot</a>`
          : ''}
      </div>
      <div class="m1-payment-actions">
        ${verifyBtn}${rejectBtn}
      </div>
    </div>`;
  }).join('');

  container.innerHTML = rows;
}

async function handlePaymentVerify(paymentId) {
  if (!confirm('Verify this payment? This confirms the customer paid.')) return;
  try {
    const res = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Verify failed: ${data.error || res.status}`);
      return;
    }
    await refreshPaymentReview();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function handlePaymentReject(paymentId) {
  const reason = prompt('Rejection reason (required):');
  if (!reason || !reason.trim()) return;
  try {
    const res = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Reject failed: ${data.error || res.status}`);
      return;
    }
    await refreshPaymentReview();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function refreshPaymentReview() {
  const filter = document.getElementById('payments-status-filter');
  const status = filter ? filter.value : 'PAYMENT_PENDING_REVIEW';
  const url = status
    ? `/api/admin/payments?status=${encodeURIComponent(status)}&limit=100`
    : '/api/admin/payments?limit=100';
  try {
    const result = await fetchJsonOrAuth(url, 'PaymentReview');
    paymentReviewList = (result && result.payments) || [];
    renderPaymentReview(paymentReviewList);
  } catch (e) {
    if (!String(e.message).startsWith('AUTH_REQUIRED:')) {
      const container = document.getElementById('payments-review-list');
      if (container) container.innerHTML = `<p style="color:var(--accent-red,#c0392b);">Failed to load payments: ${escapeHtml(e.message)}</p>`;
    }
  }
}

function setupPaymentReview() {
  const refreshBtn = document.getElementById('btn-payments-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshPaymentReview);
  const filter = document.getElementById('payments-status-filter');
  if (filter) filter.addEventListener('change', refreshPaymentReview);
}

// ─────────────────────────────────────────────────────────────────────────────
// M1: Mobile menu toggle
// Hamburger button (visible ≤ 768px) opens the sidebar as a drawer with a
// backdrop. Auto-closes on section change or escape key.
// ─────────────────────────────────────────────────────────────────────────────
function setupMobileMenu() {
  const toggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!toggle || !sidebar || !backdrop) return;

  function open() {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function isOpen() { return sidebar.classList.contains('is-open'); }

  toggle.addEventListener('click', () => isOpen() ? close() : open());
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  // Auto-close on any nav item click (so we don't trap the user)
  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) close();
    });
  });

  // Auto-close on window resize to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && isOpen()) close();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// M1: Cleaner Operations section
// Renders one .m1-cleaner-card per active cleaner with their assigned jobs.
// Status filter chips let the owner drill into a lifecycle stage.
// ─────────────────────────────────────────────────────────────────────────────
let cleanerOpsFilter = 'all';

function statusPillHtml(status) {
  const cls = String(status || '').toLowerCase().replace(/_/g, '-');
  return `<span class="m1-status-pill ${cls}">${escapeHtml(status || '—')}</span>`;
}

function renderCleanerOps() {
  const container = document.getElementById('cleaners-ops-list');
  if (!container) return;

  // Build jobs-by-cleaner from bookingsV2List assignments.
  // Each booking has an `assignments` array (per M0-007) or we infer from
  // a `cleanerId`/`cleanerName` field if present.
  const jobsByCleaner = new Map();
  const uncategorized = [];

  const bookings = bookingsV2List || [];
  for (const b of bookings) {
    const assignments = Array.isArray(b.assignments) ? b.assignments : [];
    if (assignments.length) {
      for (const a of assignments) {
        const key = a.cleanerId || a.cleaner_id || a.id || 'unknown';
        if (!jobsByCleaner.has(key)) {
          jobsByCleaner.set(key, {
            cleaner: {
              id: key,
              displayName: a.displayName || a.display_name || a.cleanerName || 'Cleaner',
              phone: a.phone || a.cleanerPhone || '',
              language: a.language || 'ar'
            },
            jobs: []
          });
        }
        jobsByCleaner.get(key).jobs.push({ booking: b, assignment: a });
      }
    } else if (b.cleanerId || b.cleanerName) {
      // older shape: cleanerId/cleanerName directly on the booking
      const key = b.cleanerId || b.cleanerName;
      if (!jobsByCleaner.has(key)) {
        jobsByCleaner.set(key, {
          cleaner: {
            id: key,
            displayName: b.cleanerName || b.cleanerDisplayName || 'Cleaner',
            phone: b.cleanerPhone || '',
            language: 'ar'
          },
          jobs: []
        });
      }
      jobsByCleaner.get(key).jobs.push({ booking: b, assignment: null });
    } else {
      uncategorized.push(b);
    }
  }

  // Merge the /api/admin/users/cleaners list so unassigned cleaners still
  // appear (with an empty queue) when they should.
  for (const c of (cleanersList || [])) {
    const key = c.id;
    if (!jobsByCleaner.has(key)) {
      jobsByCleaner.set(key, {
        cleaner: {
          id: c.id,
          displayName: c.displayName || c.display_name || c.email || 'Cleaner',
          phone: c.phone || '',
          language: c.language || 'ar',
          shift: c.shift_start && c.shift_end ? `${c.shift_start}–${c.shift_end}` : ''
        },
        jobs: []
      });
    } else {
      // Backfill phone / shift if missing
      const entry = jobsByCleaner.get(key);
      if (!entry.cleaner.phone && c.phone) entry.cleaner.phone = c.phone;
      if (!entry.cleaner.shift && c.shift_start) entry.cleaner.shift = `${c.shift_start}–${c.shift_end}`;
    }
  }

  // Sort cleaners by active job count desc
  const entries = Array.from(jobsByCleaner.values())
    .sort((a, b) => b.jobs.length - a.jobs.length);

  // Filter chips
  const filterJobs = (jobs) => cleanerOpsFilter === 'all'
    ? jobs
    : jobs.filter(j => String(j.booking.status || '').toUpperCase() === cleanerOpsFilter);

  // Update chip counts (total job count + per-status)
  const totalAll = bookings.length;
  const counts = {
    all: totalAll,
    ASSIGNED: bookings.filter(b => b.status === 'ASSIGNED').length,
    ON_THE_WAY: bookings.filter(b => b.status === 'ON_THE_WAY').length,
    IN_PROGRESS: bookings.filter(b => b.status === 'IN_PROGRESS').length,
    COMPLETED: bookings.filter(b => b.status === 'COMPLETED').length
  };
  const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  setCount('cleaner-count-all', counts.all);

  // Empty DB
  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-spray-can-sparkles" style="color:var(--accent-blue-light);"></i>
        <p>No cleaners registered yet. Add one in Settings to start dispatching jobs.</p>
      </div>`;
    return;
  }

  // Render
  const html = entries.map(entry => {
    const visibleJobs = filterJobs(entry.jobs);
    const initials = (entry.cleaner.displayName || 'C').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const phoneHtml = entry.cleaner.phone
      ? `<span><i class="fa-solid fa-phone"></i> ${escapeHtml(entry.cleaner.phone)}</span>` : '';
    const shiftHtml = entry.cleaner.shift
      ? `<span><i class="fa-regular fa-clock"></i> ${escapeHtml(entry.cleaner.shift)}</span>` : '';
    const langHtml = entry.cleaner.language
      ? `<span><i class="fa-solid fa-language"></i> ${escapeHtml(String(entry.cleaner.language).toUpperCase())}</span>` : '';

    const jobsHtml = visibleJobs.length === 0
      ? `<div class="m1-cleaner-jobs"><div class="cleaner-job-row" style="opacity:0.6;"><span class="cleaner-job-customer">No jobs in this filter.</span></div></div>`
      : `<div class="m1-cleaner-jobs">${visibleJobs.map(j => {
          const b = j.booking || {};
          const customer = b.customer ? (b.customer.fullName || b.customer.name || '—') : (b.customerName || '—');
          const area = b.area || b.zone || '';
          const time = b.scheduledStart ? new Date(b.scheduledStart).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : (b.createdAt ? new Date(b.createdAt).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
          return `<div class="cleaner-job-row">
            <div>
              <span class="cleaner-job-time">${escapeHtml(time)}</span>
              <span class="cleaner-job-customer">${escapeHtml(customer)}</span>
              ${area ? `<span class="cleaner-job-area">· ${escapeHtml(area)}</span>` : ''}
            </div>
            <div>${statusPillHtml(b.status || 'ASSIGNED')}</div>
          </div>`;
        }).join('')}</div>`;

    return `<div class="m1-cleaner-card">
      <div class="m1-cleaner-avatar">${escapeHtml(initials)}</div>
      <div class="m1-cleaner-info">
        <div class="m1-cleaner-name">${escapeHtml(entry.cleaner.displayName)}</div>
        <div class="m1-cleaner-meta">${phoneHtml}${shiftHtml}${langHtml}</div>
        ${jobsHtml}
      </div>
      <div class="m1-cleaner-queue">
        <div class="m1-cleaner-queue-count">${entry.jobs.length}</div>
        <div class="m1-cleaner-queue-label">Active jobs</div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

function setupCleanerOps() {
  // Filter chips
  document.querySelectorAll('.cleaner-status-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.cleaner-status-chip').forEach(c => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      cleanerOpsFilter = chip.getAttribute('data-filter') || 'all';
      renderCleanerOps();
    });
  });
  // Refresh button
  const refresh = document.getElementById('btn-cleaners-refresh');
  if (refresh) refresh.addEventListener('click', () => { renderCleanerOps(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// M1: Hero car-image fallback
// If the generated asset fails to load (e.g. served from disk without
// the assets/ tree), show the car-wash icon fallback instead of a broken image.
// ─────────────────────────────────────────────────────────────────────────────
function setupHeroCarFallback() {
  const img = document.querySelector('.m1-hero-car-image img');
  if (!img) return;
  img.addEventListener('error', () => {
    const picture = img.closest('.m1-hero-car-image');
    if (picture) picture.style.display = 'none';
    const fb = document.querySelector('.m1-hero-car-fallback');
    if (fb) fb.style.display = 'flex';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// M1: Section transitions
// Restrained: when the user switches sections, we briefly clear the
// animation so the CSS keyframe restarts. Honors prefers-reduced-motion
// via the CSS itself.
// ─────────────────────────────────────────────────────────────────────────────
function setupSectionTransitions() {
  // One-time observation of dynamic content arrivals (e.g. payment cards
  // rendered into the list) gives a subtle staggered enter. The CSS
  // handles the animation; we just trigger it on each new child.
  const targets = ['payments-review-list', 'approvals-list-container', 'v2-bookings-list-container'];
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.classList && (node.classList.contains('m1-payment-card') || node.classList.contains('approval-card'))) {
          // restart animation
          node.style.animation = 'none';
          // force reflow
          // eslint-disable-next-line no-unused-expressions
          node.offsetHeight;
          node.style.animation = '';
        }
      });
    }
  });
  targets.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { childList: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// M1: Hero live stats
// Wire the three hero stat values from the same live data the KPI
// cards use. No new endpoints; same sources as the overview.
// ─────────────────────────────────────────────────────────────────────────────
function updateHeroStats() {
  const totalEl = document.getElementById('hero-stat-total');
  const pendingEl = document.getElementById('hero-stat-pending');
  const completedEl = document.getElementById('hero-stat-completed');
  if (!totalEl) return;

  // Total bookings = legacy + v2
  const total = (bookingsList.length || 0) + (bookingsV2List.length || 0);
  totalEl.textContent = total;

  // Pending review = legacy pending + v2 NEEDS_HUMAN + payment review queue
  const pending =
    bookingsList.filter(b => b.status === 'pending').length +
    bookingsV2List.filter(b => b.status === 'NEEDS_HUMAN').length +
    paymentReviewList.filter(p => p.status === 'PAYMENT_PENDING_REVIEW').length;
  pendingEl.textContent = pending;

  // Completed today = legacy confirmed (we don't have a per-day breakdown
  // pre-M1; surface a sensible real read from bookingsList) + v2 COMPLETED.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const completedToday =
    bookingsList.filter(b => b.status === 'confirmed' && b.createdAt && new Date(b.createdAt) >= startOfDay).length +
    bookingsV2List.filter(b => b.status === 'COMPLETED' && b.scheduledStart && new Date(b.scheduledStart) >= startOfDay).length;
  completedEl.textContent = completedToday;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
