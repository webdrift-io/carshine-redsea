// State management
let currentSection = 'overview';
let activeChatId = null;
let autopilotActive = true;
let bookingsList = [];
let calendarEvents = [];
let bookingsV2List = [];
let cleanersList = [];
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

function showDashboardAuthGate(message = 'Login required to load live dashboard data.') {
  let gate = document.getElementById('dashboard-auth-gate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'dashboard-auth-gate';
    gate.className = 'dashboard-auth-gate';
    gate.innerHTML = `
      <form class="dashboard-auth-card" id="dashboard-auth-gate-form">
        <div>
          <h2>Admin Login Required</h2>
          <p id="dashboard-auth-gate-message"></p>
        </div>
        <label>Email
          <input type="email" id="dashboard-auth-gate-email" value="admin@carshineredsea.com" autocomplete="username">
        </label>
        <label>Password
          <input type="password" id="dashboard-auth-gate-password" autocomplete="current-password">
        </label>
        <button type="submit">Login and Load Dashboard</button>
      </form>
    `;
    document.body.appendChild(gate);
    gate.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = document.getElementById('dashboard-auth-gate-email').value.trim();
      const password = document.getElementById('dashboard-auth-gate-password').value;
      const msg = document.getElementById('dashboard-auth-gate-message');
      msg.textContent = 'Logging in...';
      try {
        const res = await nativeFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await parseJsonSafe(res);
        if (!res.ok || !data.token) {
          msg.textContent = `Login failed: ${data.error || res.status}`;
          return;
        }
        authToken = data.token;
        localStorage.setItem('carshine_admin_token', authToken);
        gate.remove();
        setupAuthPanel();
        fetchData();
      } catch (err) {
        msg.textContent = `Login error: ${err.message}`;
      }
    });
  }
  const msg = document.getElementById('dashboard-auth-gate-message');
  if (msg) msg.textContent = message;
}

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
  
  // Start system clock
  updateClock();
  setInterval(updateClock, 60000);
  
  // Initial data fetch
  fetchData();
  
  // Poll data every 4 seconds for real-time changes
  setInterval(fetchData, 40000);
});

function setAuthStatus(message, type = 'info') {
  const box = document.getElementById('auth-status-box');
  if (!box) return;
  box.textContent = message;
  box.className = `auth-status-box ${type}`;
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
    setAuthStatus('Token cleared. Local development can still read APIs from 127.0.0.1.', 'info');
  });
}

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
  
  // Make clicking dashboard elements redirect to approvals
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('view-all-link')) {
      e.preventDefault();
      const target = e.target.getAttribute('data-target');
      switchSection(target);
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
  const v2Badge = document.getElementById('badge-v2-needs-human');
  v2Badge.textContent = v2NeedsHuman;
  v2Badge.style.display = v2NeedsHuman > 0 ? 'inline' : 'none';

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
      <div class="approval-card card-glass" id="card-${b.id}">
        <div class="customer-card-meta">
          <h3>${b.customerName}</h3>
          <span class="meta-phone">${b.phone}</span>
          <div class="meta-detail-row">
            <span><i class="fa-solid fa-clock"></i> Received: ${dateFormatted}</span>
          </div>
          <div class="meta-detail-row">
            <span><i class="fa-solid fa-location-dot"></i> Address: ${b.location}</span>
          </div>
        </div>
        
        <div class="booking-specs-col">
          <div class="specs-item">
            <i class="fa-solid fa-car"></i>
            <span>${b.carType}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-cube"></i>
            <span class="badge-outline">${b.package.split(' - ')[0]}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-calendar-check"></i>
            <span>${b.preferredDate} at ${b.preferredTime}</span>
          </div>
          <div class="specs-item">
            <i class="fa-solid fa-credit-card"></i>
            <span>Payment: <strong>${b.paymentMethod}</strong></span>
          </div>
          ${paymentNote}
        </div>
        
        <div class="approval-actions-col">
          <a class="btn btn-secondary btn-whatsapp" href="${customerWhatsAppUrl}" target="_blank" rel="noopener">
            <i class="fa-brands fa-whatsapp"></i> WhatsApp
          </a>
          <button class="btn btn-reject" onclick="rejectBooking('${b.id}')">
            <i class="fa-solid fa-xmark"></i> Reject
          </button>
          <button class="btn btn-approve" onclick="approveBooking('${b.id}')">
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
      <div class="empty-state">
        <i class="fa-solid fa-globe"></i>
        <p>No V2 bookings yet. Web form, chatbot, and WhatsApp bookings will appear here.</p>
      </div>`;
    return;
  }

  const sorted = [...bookingsV2List].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  container.innerHTML = sorted.map(b => {
    const st = V2_STATUS_LABEL[b.status] || { label: b.status, color: 'var(--text-secondary)' };
    const fmtDate = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const customerName = b.customer ? escapeHtml(b.customer.fullName) : '—';
    const phone = b.customer ? escapeHtml(b.customer.phoneRaw || b.customer.phoneE164) : '';
    const vehicle = b.vehicle ? escapeHtml(`${b.vehicle.carType}`) : '—';
    const service = b.servicePackage ? escapeHtml(b.servicePackage.nameEn) : '—';
    const scheduled = fmtDate(b.scheduledStart);
    const missingHtml = b.missingFields && b.missingFields.length
      ? `<div class="payment-routing-note" style="color:var(--accent-orange)"><i class="fa-solid fa-circle-exclamation"></i> Missing: ${b.missingFields.map(escapeHtml).join(', ')}</div>`
      : '';

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
          <div class="specs-item">
            <i class="fa-solid fa-circle-half-stroke"></i>
            <span style="color:${st.color};font-weight:600">${st.label}</span>
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
        ${postImages.map(slide => `<img src="${slide}" class="post-slide-thumb" alt="Slide preview">`).join('')}
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
