require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const compression = require('compression');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const http = require('http');

// Import modules
const db = require('./database');

// Feature flag: USE_MASTRA_AGENT (default: true). When false, the legacy
// monolith in ./minimax-agent.js is used. The legacy file is kept around as a
// safety net — see README and deliverable.md for the migration notes.
const USE_MASTRA_AGENT = process.env.USE_MASTRA_AGENT !== 'false';

let handleIncomingMessage;
let ACTIVE_PROVIDER;
if (USE_MASTRA_AGENT) {
  const mastra = require('./agents/orchestrator');
  handleIncomingMessage = mastra.handleIncomingMessage;
  ACTIVE_PROVIDER = mastra.ACTIVE_PROVIDER;
} else {
  const legacy = require('./minimax-agent');
  handleIncomingMessage = legacy.handleIncomingMessage;
  ACTIVE_PROVIDER = legacy.ACTIVE_PROVIDER;
}

const { logger, httpLogger } = require('./logger');

console.log(`[Server] AI Agent provider: ${ACTIVE_PROVIDER} (USE_MASTRA_AGENT=${USE_MASTRA_AGENT})`);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DASHBOARD_PUBLIC_DIR = path.join(__dirname, 'public');

// Socket.io setup for real-time updates
const io = new Server(server, {
  cors: {
    origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','),
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Socket authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

// Track connected clients
const connectedClients = new Map();

io.on('connection', (socket) => {
  connectedClients.set(socket.id, socket);
  console.log(`[Socket.io] Client connected: ${socket.id} (${connectedClients.size} total)`);
  
  // Send initial state
  socket.emit('init', {
    bookings: db.getAllBookings(),
    chats: db.getAllChats(),
    calendar: db.getAllCalendar(),
    agents,
    autopilot,
    timestamp: new Date().toISOString()
  });
  
  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    console.log(`[Socket.io] Client disconnected: ${socket.id} (${connectedClients.size} total)`);
  });
});

// Broadcast function for real-time updates
function broadcast(event, data) {
  io.emit(event, data);
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES_IN = '8h';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@carshineredsea.com';

// ============================================================================
// JWT & AUTH HELPERS
// ============================================================================

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Auth middleware - protects /api/* routes
function requireAuth(req, res, next) {
  // Skip auth for public endpoints
  const publicPaths = ['/health', '/api/auth/login', '/api/webhook/whatsapp', '/api/webhook/meta'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }
  
  // Skip auth for OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  const remoteAddress = req.ip || req.socket?.remoteAddress || '';
  const isLocalRequest = ['127.0.0.1', '::1'].includes(remoteAddress) || remoteAddress.endsWith('127.0.0.1');
  if (!isProduction && isLocalRequest) {
    req.user = {
      sub: 'local-dev',
      email: ADMIN_EMAIL,
      role: 'admin'
    };
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'MISSING_TOKEN' });
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
  
  req.user = decoded;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required', code: 'ADMIN_REQUIRED' });
  }
  next();
}

// ============================================================================
// WHATSAPP WEBHOOK SIGNATURE VERIFICATION
// ============================================================================

function verifyMetaSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.META_APP_SECRET;
  
  if (!appSecret) {
    if (isProduction) {
      console.error('[Webhook] META_APP_SECRET missing in production; rejecting webhook');
      return res.status(503).json({ error: 'Webhook signature verification is not configured' });
    }
    console.warn('[Webhook] META_APP_SECRET not configured, skipping signature verification');
    return next();
  }
  
  if (!signature) {
    console.warn('[Webhook] Missing X-Hub-Signature-256 header');
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    console.warn('[Webhook] Invalid Meta signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  next();
}

function verifyTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature'];
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  
  if (!authToken) {
    if (isProduction) {
      console.error('[Webhook] TWILIO_AUTH_TOKEN missing in production; rejecting webhook');
      return res.status(503).json({ error: 'Webhook signature verification is not configured' });
    }
    console.warn('[Webhook] TWILIO_AUTH_TOKEN not configured, skipping signature verification');
    return next();
  }
  
  if (!signature) {
    console.warn('[Webhook] Missing X-Twilio-Signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  const params = Object.keys(req.body).sort().reduce((acc, key) => {
    acc += key + req.body[key];
    return acc;
  }, url);
  
  const expectedSignature = crypto
    .createHmac('sha1', authToken)
    .update(params)
    .digest('base64');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    console.warn('[Webhook] Invalid Twilio signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  next();
}

function verifyWebhookSignature(req, res, next) {
  const provider = process.env.WHATSAPP_PROVIDER || 'meta';
  
  if (provider === 'twilio') {
    return verifyTwilioSignature(req, res, next);
  }
  
  return verifyMetaSignature(req, res, next);
}

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 15552000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(compression());

app.set('trust proxy', 1);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5000,http://localhost:4173,http://127.0.0.1:5000,http://127.0.0.1:4173,http://localhost:5173,http://127.0.0.1:5173,https://carshineredsea.com,https://www.carshineredsea.com,https://api.carshineredsea.com')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: ipKeyGenerator
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again later.' },
  keyGenerator: ipKeyGenerator
});

const whatsappLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_WHATSAPP_MAX) || 30,
  keyGenerator: (req) => {
    const phoneKey = req.body?.From || req.body?.phone;
    return phoneKey ? `phone:${phoneKey}` : ipKeyGenerator(req);
  },
  message: { error: 'Too many messages from this number, please wait.' },
  skip: (req) => req.path !== '/api/webhook/whatsapp'
});

app.use('/api/webhook/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api/webhook/whatsapp', (req, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    try {
      req.rawBody = req.body.toString('utf8');
      req.body = JSON.parse(req.rawBody);
    } catch (e) {
      req.rawBody = req.body.toString('utf8');
      req.body = {};
    }
  }
  next();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'index.html'));
});

app.get('/chatbot-widget.js', (req, res) => {
  res.sendFile(path.join(DASHBOARD_PUBLIC_DIR, 'chatbot-widget.js'));
});

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'favicon.ico'));
});

app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'favicon.png'));
});

app.get('/dashboard', (req, res) => {
  if (req.originalUrl === '/dashboard') {
    return res.redirect(301, '/dashboard/');
  }
  res.sendFile(path.join(DASHBOARD_PUBLIC_DIR, 'index.html'));
});

app.use('/dashboard', express.static(DASHBOARD_PUBLIC_DIR));
app.use('/ar', express.static(path.join(PROJECT_ROOT, 'ar')));
app.use('/de', express.static(path.join(PROJECT_ROOT, 'de')));

// API documentation routes
app.use('/api-docs', require('./routes/api-docs'));

// HTTP request logging
app.use(httpLogger);

// ============================================================================
// AGENT CONTROL STATE
// ============================================================================

let autopilot = true;
let agents = [
  { id: "brian", name: "Brian", role: "Lead Coordinator", status: "active", task: "Orchestrating agent workflows", logs: ["System initialized. Monitoring incoming requests."] },
  { id: "hassan", name: "Hassan", role: "WhatsApp Communicator", status: "active", task: "Listening for WhatsApp events", logs: ["Webhook connection active."] },
  { id: "layla", name: "Layla", role: "AI Chatbot Solver", status: "active", task: "Processing WhatsApp messages via Gemini", logs: ["Gemini 2.5 Flash model loaded."] },
  { id: "tarek", name: "Tarek", role: "Notification Dispatcher", status: "active", task: "Monitoring new bookings", logs: ["Admin alerts system armed."] },
  { id: "monika", name: "Monika", role: "Email Confirmation", status: "active", task: "Idle", logs: ["Nodemailer SMTP transport verified."] },
  { id: "nour", name: "Nour", role: "Calendar Scheduler", status: "active", task: "Idle", logs: ["Slot availability cache refreshed."] },
  { id: "larry", name: "Larry", role: "TikTok Marketer", status: "active", task: "Analyzing niches", logs: ["Scraped trending tags #CarDetailing #ElGouna."] },
  { id: "sarah", name: "Sarah", role: "Social Cross-Poster", status: "active", task: "Idle", logs: ["Postiz API authenticated."] },
  { id: "scraper", name: "Scraper", role: "Competitor Researcher", status: "active", task: "Idle", logs: ["Instagram/TikTok competitor scrape queued."] },
  { id: "fares", name: "Fares", role: "Scale & Franchise Planner", status: "active", task: "Analyzing expansion metrics", logs: ["Cairo market research draft compiled."] }
];

function hasUsableEnv(name, placeholders = []) {
  const value = process.env[name];
  if (!value || !String(value).trim()) return false;
  const lower = String(value).toLowerCase();
  return ![
    'replace-me',
    'your_',
    'changeme',
    'sk-replace-me',
    ...placeholders
  ].some(marker => lower.includes(marker));
}

function integrationStatus() {
  const webhookBase = process.env.PUBLIC_BASE_URL || process.env.WEBHOOK_BASE_URL || 'http://localhost:5000';
  return {
    api: {
      baseUrl: webhookBase,
      websiteUrl: `${webhookBase}/`,
      dashboardUrl: `${webhookBase}/dashboard/`,
      healthUrl: `${webhookBase}/health`,
      loginEndpoint: `${webhookBase}/api/auth/login`,
      authMode: isProduction ? 'JWT required' : 'Local development bypass for 127.0.0.1',
      adminEmail: ADMIN_EMAIL
    },
    ai: {
      provider: ACTIVE_PROVIDER,
      connected: hasUsableEnv('OPENAI_API_KEY'),
      fallback: 'Deterministic router/intake/booking layer stays online without an AI key',
      missing: hasUsableEnv('OPENAI_API_KEY') ? [] : ['OPENAI_API_KEY']
    },
    whatsapp: {
      provider: process.env.WHATSAPP_PROVIDER || 'meta',
      inboundWebhook: `${webhookBase}/api/webhook/whatsapp`,
      connected: (process.env.WHATSAPP_PROVIDER || 'meta') === 'twilio'
        ? hasUsableEnv('TWILIO_ACCOUNT_SID') && hasUsableEnv('TWILIO_AUTH_TOKEN') && hasUsableEnv('TWILIO_WHATSAPP_FROM')
        : hasUsableEnv('WHATSAPP_TOKEN') && hasUsableEnv('WHATSAPP_PHONE_NUMBER_ID') && hasUsableEnv('WHATSAPP_VERIFY_TOKEN'),
      signatureVerification: hasUsableEnv('META_APP_SECRET'),
      ownerNotifications: hasUsableEnv('ADMIN_WHATSAPP_PHONE'),
      adminPhone: process.env.ADMIN_WHATSAPP_PHONE || null,
      missing: [
        ...((process.env.WHATSAPP_PROVIDER || 'meta') === 'twilio'
          ? ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM']
          : ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET']),
        'ADMIN_WHATSAPP_PHONE'
      ]
        .filter(name => !hasUsableEnv(name))
    },
    social: {
      webhook: `${webhookBase}/api/webhook/meta`,
      instagramConnected: hasUsableEnv('META_PAGE_ACCESS_TOKEN') && hasUsableEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID'),
      facebookConnected: hasUsableEnv('META_PAGE_ACCESS_TOKEN') && hasUsableEnv('FACEBOOK_PAGE_ID'),
      missing: ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID', 'INSTAGRAM_BUSINESS_ACCOUNT_ID']
        .filter(name => !hasUsableEnv(name))
    },
    payments: {
      instapayReceivingNumber: process.env.INSTAPAY_RECEIVING_NUMBER || '01555567205',
      instapayPaymentLink: process.env.INSTAPAY_PAYMENT_LINK || '',
      instapayQrImageUrl: process.env.INSTAPAY_QR_IMAGE_URL || '',
      automaticChargeSupported: false,
      connected: hasUsableEnv('INSTAPAY_PAYMENT_LINK') || hasUsableEnv('INSTAPAY_QR_IMAGE_URL'),
      note: 'InstaPay Egypt can use mobile/IPA, QR, or payment links. Automatic in-site charging needs an approved payment gateway or merchant API.'
    }
  };
}

function buildDailySummary(date = new Date().toISOString().slice(0, 10)) {
  const bookings = db.getAllBookings().filter((booking) =>
    String(booking.preferredDate || booking.createdAt || '').startsWith(date)
  );
  const byStatus = bookings.reduce((acc, booking) => {
    acc[booking.status] = (acc[booking.status] || 0) + 1;
    return acc;
  }, {});
  const payment = bookings.reduce((acc, booking) => {
    const method = booking.paymentMethod || 'Unknown';
    acc[method] = (acc[method] || 0) + 1;
    return acc;
  }, {});
  const lines = [
    `CarShine daily summary for ${date}`,
    `Bookings: ${bookings.length}`,
    `Pending: ${byStatus.pending || 0}, confirmed: ${byStatus.confirmed || 0}, rejected: ${byStatus.rejected || 0}`,
    `Payments: ${Object.entries(payment).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`
  ];
  for (const booking of bookings.slice(0, 10)) {
    lines.push(`- ${booking.customerName} ${booking.phone}: ${booking.package}, ${booking.area}, ${booking.preferredTime}, ${booking.paymentMethod}, ${booking.status}`);
  }
  return {
    date,
    sendReady: integrationStatus().whatsapp.connected && integrationStatus().whatsapp.ownerNotifications,
    adminPhone: process.env.ADMIN_WHATSAPP_PHONE || null,
    summaryText: lines.join('\n'),
    totals: {
      bookings: bookings.length,
      byStatus,
      payment
    },
    bookings
  };
}

function normalizePhoneForMeta(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) return `20${digits.slice(1)}`;
  return digits;
}

function normalizeTwilioWhatsAppTo(to = '') {
  const value = String(to || '').trim();
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
}

async function sendWhatsAppText(to, text) {
  const provider = process.env.WHATSAPP_PROVIDER || 'meta';
  if (provider === 'twilio') {
    if (!hasUsableEnv('TWILIO_ACCOUNT_SID') || !hasUsableEnv('TWILIO_AUTH_TOKEN') || !hasUsableEnv('TWILIO_WHATSAPP_FROM')) {
      return { sent: false, provider, error: 'missing_twilio_config' };
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({
      From: process.env.TWILIO_WHATSAPP_FROM,
      To: normalizeTwilioWhatsAppTo(to),
      Body: text
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    const data = await res.json().catch(() => ({}));
    return { sent: res.ok, provider, status: res.status, response: data };
  }

  if (!hasUsableEnv('WHATSAPP_TOKEN') || !hasUsableEnv('WHATSAPP_PHONE_NUMBER_ID')) {
    return { sent: false, provider: 'meta', error: 'missing_meta_whatsapp_config' };
  }
  const toPhone = normalizePhoneForMeta(to);
  const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'text',
      text: { preview_url: false, body: text }
    })
  });
  const data = await res.json().catch(() => ({}));
  return { sent: res.ok, provider: 'meta', status: res.status, response: data };
}

async function sendMetaSocialReply(target, text) {
  if (!target || !text) {
    return { sent: false, provider: 'meta_social', error: 'missing_reply_target' };
  }
  if (!hasUsableEnv('META_PAGE_ACCESS_TOKEN')) {
    return { sent: false, provider: 'meta_social', error: 'missing_meta_page_access_token' };
  }

  if (target.type === 'comment' && target.commentId) {
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(target.commentId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        access_token: process.env.META_PAGE_ACCESS_TOKEN
      })
    });
    const data = await res.json().catch(() => ({}));
    return { sent: res.ok, provider: 'meta_social', target: target.type, status: res.status, response: data };
  }

  if (target.type === 'message' && target.recipientId) {
    const res = await fetch('https://graph.facebook.com/v20.0/me/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_PAGE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        recipient: { id: target.recipientId },
        message: { text }
      })
    });
    const data = await res.json().catch(() => ({}));
    return { sent: res.ok, provider: 'meta_social', target: target.type, status: res.status, response: data };
  }

  return { sent: false, provider: 'meta_social', error: 'unsupported_reply_target' };
}

let agentSimulationInterval;
function startAgentSimulation() {
  if (isProduction) {
    agents.forEach(agent => {
      agent.logs.unshift(`[${new Date().toLocaleTimeString()}] Production mode: synthetic activity disabled.`);
      agent.task = agent.status === 'active' ? 'Waiting for real events' : agent.task;
    });
    return;
  }
  agentSimulationInterval = setInterval(() => {
    const bgAgents = ["larry", "scraper", "fares", "nour"];
    const randomId = bgAgents[Math.floor(Math.random() * bgAgents.length)];
    const agent = agents.find(a => a.id === randomId);
    if (agent && agent.status === "active") {
      const larryLogs = ["Rendering slide overlays...", "Optimizing campaign tags...", "Analyzing Postiz scheduling options..."];
      const scraperLogs = ["Scraped competitor video from Hurghada.", "Analyzed virality coefficient of post: Clean SUV.", "Updated trending hashtag registry."];
      const faresLogs = ["Drafting franchise model prospectus.", "Analyzing customer density in Sahl Hasheesh.", "Comparing waterless cost metrics Cairo vs Hurghada."];
      const nourLogs = ["Double-checked afternoon slot capacity.", "Verified booking details alignment with calendar.", "Synced calendar data cache."];
      
      let newLog = "";
      if (randomId === "larry") newLog = larryLogs[Math.floor(Math.random() * larryLogs.length)];
      if (randomId === "scraper") newLog = scraperLogs[Math.floor(Math.random() * scraperLogs.length)];
      if (randomId === "fares") newLog = faresLogs[Math.floor(Math.random() * faresLogs.length)];
      if (randomId === "nour") newLog = nourLogs[Math.floor(Math.random() * nourLogs.length)];
      
      agent.logs.unshift(`[${new Date().toLocaleTimeString()}] ${newLog}`);
      if (agent.logs.length > 8) agent.logs.pop();
      agent.task = newLog;
    }
  }, 8000);
}

function stopAgentSimulation() {
  if (agentSimulationInterval) {
    clearInterval(agentSimulationInterval);
  }
}

startAgentSimulation();

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopAgentSimulation();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  stopAgentSimulation();
  process.exit(0);
});

// ============================================================================
// AUTH ROUTES (Public - no auth required)
// ============================================================================

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  if (email !== ADMIN_EMAIL) {
    await new Promise(r => setTimeout(r, 100));
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  let admin = db.getAdmin(email);
  if (!admin) {
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMe123!';
    const passwordHash = await hashPassword(initialPassword);
    db.setAdminPassword(email, passwordHash);
    admin = db.getAdmin(email);
    console.warn('[Auth] No admin found, created initial admin. Set ADMIN_PASSWORD_HASH in .env!');
  }
  
  const valid = await verifyPassword(password, admin.passwordHash);
  
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = generateToken({ 
    sub: 'admin', 
    email, 
    role: 'admin',
    iat: Math.floor(Date.now() / 1000)
  });
  
  res.json({ 
    success: true, 
    token, 
    expiresIn: JWT_EXPIRES_IN,
    user: { email, role: 'admin' }
  });
});

app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  
  if (newPassword.length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' });
  }
  
  const admin = db.getAdmin(ADMIN_EMAIL);
  if (!admin) {
    return res.status(500).json({ error: 'Admin not found' });
  }
  
  const valid = await verifyPassword(currentPassword, admin.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  
  const newHash = await hashPassword(newPassword);
  db.setAdminPassword(ADMIN_EMAIL, newHash);
  console.log('[Auth] Admin password changed');
  
  res.json({ success: true, message: 'Password changed. Update ADMIN_PASSWORD_HASH in .env!' });
});

// ============================================================================
// PROTECTED API ROUTES (requireAuth middleware applied)
// ============================================================================

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || 
      req.path === '/webhook/whatsapp' ||
      req.path.startsWith('/public')) {
    return next();
  }
  requireAuth(req, res, next);
});

// Health check (public)
app.get('/health', (req, res) => {
  // Try to verify database is responsive
  let dbStatus = 'ok';
  try {
    db.getAllBookings();
  } catch (e) {
    dbStatus = 'error: ' + e.message;
  }
  
  const health = {
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: dbStatus,
      aiProvider: ACTIVE_PROVIDER,
      agents: agents.length
    }
  };
  
  // Add liveness indicators
  health.liveness = {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    cpuUsage: process.cpuUsage()
  };
  
  const statusCode = dbStatus === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Readiness check (Kubernetes-style)
app.get('/health/ready', (req, res) => {
  try {
    db.getAllBookings();
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'not ready', error: e.message });
  }
});

// Liveness check (Kubernetes-style)
app.get('/health/live', (req, res) => {
  res.json({ status: 'alive', uptime: process.uptime() });
});

// ============================================================================
// PUBLIC WEBSITE CHATBOT (no auth required - for website widget)
// ============================================================================

// Rate limit for public chat (prevent abuse)
const publicChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  message: {
    error: 'Too many messages from this network. Please wait a few minutes or contact us on WhatsApp.',
    reply: 'Too many messages from this network. Please wait a few minutes or contact us on WhatsApp.'
  },
  keyGenerator: ipKeyGenerator
});

/**
 * Public chatbot endpoint for the website widget
 * No auth required, but rate-limited
 * Creates a session with a generated phone number
 */
app.post('/api/public/chat', publicChatLimiter, async (req, res) => {
  const { sessionId, message, name, phone } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  
  // Sanitize inputs
  const cleanMessage = message.trim().substring(0, 2000);
  const existingPublicChat = sessionId ? db.getChat(sessionId) : null;
  const cleanName = ((existingPublicChat?.customerName && existingPublicChat.customerName !== 'Website Visitor')
    ? existingPublicChat.customerName
    : (name || 'Website Visitor')).trim().substring(0, 100);
  
  if (cleanMessage.length === 0) {
    return res.status(400).json({ error: 'message cannot be empty' });
  }
  
  // Reuse the existing website chat when sessionId is present; otherwise create one.
  const suppliedPhone = typeof phone === 'string' && phone.trim()
    ? phone.trim().substring(0, 40)
    : null;
  const sessionPhone = existingPublicChat?.phone || suppliedPhone || `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const result = await handleIncomingMessage(sessionPhone, cleanMessage, cleanName);
    
    // Get the chat session
    const chatsForPhone = db.getAllChats().filter(c => c.phone === sessionPhone);
    const latestForPhone = chatsForPhone[0] ? db.getChat(chatsForPhone[0].id) : null;
    const chat = existingPublicChat ? db.getChat(existingPublicChat.id) : latestForPhone;
    const sessionIdToReturn = chat ? chat.id : sessionPhone;
    
    // Broadcast to admin dashboard
    broadcast('chat:updated', chat);
    broadcast('chats', db.getAllChats());
    if (result.bookingCreated) {
      broadcast('booking:created', { bookingId: result.bookingId, source: 'website' });
      broadcast('bookings', db.getAllBookings());
    }
    
    res.json({
      success: true,
      sessionId: sessionIdToReturn,
      reply: result.reply,
      bookingCreated: result.bookingCreated,
      humanNeeded: result.humanNeeded,
      aiProvider: ACTIVE_PROVIDER
    });
  } catch (error) {
    console.error('[Public Chat] Error:', error);
    res.status(500).json({ 
      error: 'Sorry, I had a problem processing your message. Please try again or contact us on WhatsApp.',
      reply: 'Sorry, I had a problem processing your message. Please try again or contact us on WhatsApp.',
      bookingCreated: false,
      humanNeeded: true  // Hand off to human
    });
  }
});

/**
 * Get chat history for a public session
 */
app.get('/api/public/chat/:sessionId', publicChatLimiter, (req, res) => {
  const { sessionId } = req.params;
  const chat = db.getChat(sessionId);
  if (!chat) {
    return res.json({ sessionId, messages: [], found: false });
  }
  res.json({
    sessionId,
    found: true,
    customerName: chat.customerName,
    status: chat.status,
    messages: chat.messages || []
  });
});

app.post('/api/public/bookings', publicChatLimiter, (req, res) => {
  const source = req.body || {};
  const booking = {
    customerName: source.customerName || source.name,
    phone: source.phone,
    area: source.area,
    carType: source.carType || source.car,
    package: source.package,
    preferredDate: source.preferredDate || source.date,
    preferredTime: source.preferredTime || source.time,
    location: source.location || source.address,
    paymentMethod: source.paymentMethod || source.payment,
    notes: [
      source.locationType ? `Location type: ${source.locationType}` : '',
      source.condition ? `Car condition: ${source.condition}` : '',
      source.notes ? `Notes: ${source.notes}` : ''
    ].filter(Boolean).join('\n')
  };
  const required = ['customerName', 'phone', 'area', 'carType', 'package', 'preferredDate', 'preferredTime', 'location', 'paymentMethod'];
  const missing = required.filter((field) => !booking[field] || String(booking[field]).trim() === '');
  if (missing.length > 0) {
    return res.status(400).json({ success: false, error: 'Missing required fields', missing });
  }
  if (!db.isSlotAvailable(booking.preferredDate, booking.preferredTime)) {
    return res.status(409).json({ success: false, error: 'Time slot not available', code: 'SLOT_UNAVAILABLE' });
  }

  const now = new Date().toISOString();
  const newBooking = {
    id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...booking,
    status: 'pending',
    notes: booking.notes || 'Created from public website form.',
    createdAt: now,
    updatedAt: now
  };

  db.createBooking(newBooking, null);
  broadcast('booking:created', { booking: newBooking, source: 'website-form' });
  broadcast('bookings', db.getAllBookings());

  res.status(201).json({ success: true, booking: newBooking });
});

// Settings
app.get('/api/settings', (req, res) => {
  res.json({ autopilot });
});

app.post('/api/settings', (req, res) => {
  const { autopilot: newAutopilot } = req.body;
  if (typeof newAutopilot === 'boolean') {
    autopilot = newAutopilot;
    console.log(`Autopilot changed: ${autopilot ? 'ONLINE' : 'HUMAN TAKEOVER'}`);
    broadcast('autopilot', { autopilot });
  }
  res.json({ autopilot });
});

app.get('/api/integrations/status', (req, res) => {
  res.json(integrationStatus());
});

app.get('/api/notifications/daily-summary', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(buildDailySummary(date));
});

app.post('/api/notifications/send-daily-summary', async (req, res) => {
  const date = req.body?.date || new Date().toISOString().slice(0, 10);
  const summary = buildDailySummary(date);
  if (!summary.adminPhone) {
    return res.status(400).json({ success: false, error: 'ADMIN_WHATSAPP_PHONE is not configured', summary });
  }
  const result = await sendWhatsAppText(summary.adminPhone, summary.summaryText);
  if (!result.sent) {
    return res.status(503).json({ success: false, error: result.error || 'whatsapp_send_failed', result, summary });
  }
  res.json({ success: true, result, summary });
});

// Bookings
app.get('/api/bookings', (req, res) => {
  res.json(db.getAllBookings());
});

app.post('/api/bookings', (req, res) => {
  const required = ['customerName', 'phone', 'area', 'carType', 'package', 'preferredDate', 'preferredTime', 'location', 'paymentMethod'];
  const missing = required.filter(f => !req.body[f]);
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Missing required fields', missing });
  }
  
  if (!db.isSlotAvailable(req.body.preferredDate, req.body.preferredTime)) {
    return res.status(409).json({ error: 'Time slot not available (max 2 bookings per hour or outside 09:00-17:00)' });
  }
  
  const bookingId = "b_" + Date.now();
  const newBooking = {
    id: bookingId,
    ...req.body,
    status: "pending",
    notes: req.body.notes || "Created via API.",
    createdAt: new Date().toISOString()
  };
  
  db.createBooking(newBooking, null);
  
  broadcast('booking:created', { booking: newBooking });
  broadcast('bookings', db.getAllBookings());
  
  res.status(201).json({ success: true, booking: newBooking });
});

app.post('/api/bookings/:id/approve', (req, res) => {
  const { id } = req.params;
  const booking = db.getBooking(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  
  const result = db.approveBooking(id);
  
  broadcast('booking:approved', { booking: result.booking, calendarEvent: result.calendarEvent });
  broadcast('bookings', db.getAllBookings());
  broadcast('calendar', db.getAllCalendar());
  
  res.json({ success: true, ...result });
});

app.post('/api/bookings/:id/reject', (req, res) => {
  const { id } = req.params;
  const booking = db.getBooking(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  
  db.rejectBooking(id);
  
  broadcast('booking:rejected', { bookingId: id });
  broadcast('bookings', db.getAllBookings());
  
  res.json({ success: true, booking: { ...booking, status: 'rejected' } });
});

// Calendar
app.get('/api/calendar', (req, res) => {
  res.json(db.getAllCalendar());
});

app.post('/api/calendar', (req, res) => {
  const { bookingId, start, customerName, carType, area } = req.body;
  if (!bookingId || !start) {
    return res.status(400).json({ error: 'bookingId and start are required' });
  }
  const calEvent = {
    id: "cal_" + Date.now(),
    bookingId,
    start,
    customerName,
    carType,
    area,
    status: "confirmed",
    createdAt: new Date().toISOString()
  };
  db.insertCalendar(calEvent);
  
  broadcast('calendar', db.getAllCalendar());
  
  res.status(201).json(calEvent);
});

// Observability — recent agent traces (read from JSONL log)
app.get('/api/observability/recent', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 500));

  let raw;
  try {
    if (!fs.existsSync(LANGFUSE_LOG_FILE)) {
      return res.json({ traces: [], count: 0, limit, source: LANGFUSE_LOG_FILE });
    }
    raw = fs.readFileSync(LANGFUSE_LOG_FILE, 'utf8');
  } catch (e) {
    logger.error({ err: e.message }, '[observability] failed to read log');
    return res.json({ traces: [], count: 0, limit, error: e.message });
  }

  // Read the file backwards (newest line first) and stop after `limit`.
  const lines = raw.split('\n').filter(Boolean);
  const recent = [];
  for (let i = lines.length - 1; i >= 0 && recent.length < limit; i--) {
    try {
      recent.push(JSON.parse(lines[i]));
    } catch (e) {
      // Skip malformed lines; never let one bad line break the endpoint.
      void e;
    }
  }

  res.json({ traces: recent, count: recent.length, limit, source: LANGFUSE_LOG_FILE });
});

// Chats
app.get('/api/chats', (req, res) => {
  const chats = db.getAllChats().map((chat) => {
    const full = db.getChat(chat.id);
    const messages = full?.messages || [];
    const lastMessage = messages[messages.length - 1] || null;
    return {
      ...chat,
      messages,
      messageCount: messages.length,
      lastMessage,
      summary: lastMessage ? lastMessage.text : 'No messages yet'
    };
  });
  res.json(chats);
});

app.get('/api/chats/:id', (req, res) => {
  const chat = db.getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json(chat);
});

// Simulate incoming message (for dashboard testing)
app.post('/api/chats/simulate-incoming', async (req, res) => {
  const { phone, name, text, language, presetDetails } = req.body;
  if (!phone || !text) {
    return res.status(400).json({ error: 'phone and text are required' });
  }
  
  try {
    const result = await handleIncomingMessage(phone, text, name);
    
    // Get the session that was created/updated with full messages
    const chatsList = db.getAllChats();
    const session = chatsList.find(c => c.phone === phone && c.status === 'active') || 
                    chatsList.find(c => c.phone === phone && c.status === 'waiting_approval');
    
    const fullSession = session ? db.getChat(session.id) : null;
    
    broadcast('chat:updated', fullSession);
    broadcast('chats', db.getAllChats());
    if (result.bookingCreated) {
      broadcast('booking:created', { bookingId: result.bookingId });
      broadcast('bookings', db.getAllBookings());
    }
    
    res.json({ 
      success: true, 
      chat: fullSession, 
      messages: fullSession ? fullSession.messages : [],
      bookingCreated: result.bookingCreated,
      bookingId: result.bookingId,
      humanNeeded: result.humanNeeded
    });
  } catch (error) {
    console.error('[Simulate] Error:', error);
    res.status(500).json({ error: 'Simulation failed' });
  }
});

app.post('/api/chats/:id/message', async (req, res) => {
  const { id } = req.params;
  const { sender, text } = req.body;
  
  const chat = db.getChat(id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  
  const timestamp = new Date().toISOString();
  db.addMessage(id, sender, text, timestamp);
  
  // If autopilot and sender is agent (human takeover), just acknowledge
  // If autopilot and sender is customer, process via Gemini
  if (autopilot && sender === 'customer') {
    try {
      const result = await handleIncomingMessage(chat.phone, text, chat.customerName);
      // Response already added to chat by handleIncomingMessage
    } catch (error) {
      console.error('[Chat] Gemini error:', error);
    }
  }
  
  const updatedChat = db.getChat(id);
  broadcast('chat:updated', updatedChat);
  broadcast('chats', db.getAllChats());
  
  res.json({ success: true, message: { sender, text, timestamp } });
});

// Agents
app.get('/api/agents', (req, res) => {
  res.json(agents);
});

app.post('/api/agents/:id/toggle', requireAdmin, (req, res) => {
  const { id } = req.params;
  const agent = agents.find(a => a.id === id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  agent.status = agent.status === 'active' ? 'inactive' : 'active';
  agent.task = agent.status === 'active' ? 'Resumed operations' : 'Paused by admin';
  const actor = req.user?.email || 'admin';
  agent.logs.unshift(`[${new Date().toLocaleTimeString()}] Status changed to ${agent.status.toUpperCase()} by ${actor}`);
  if (agent.logs.length > 8) agent.logs.pop();
  logger.info({ agentId: id, status: agent.status, actor }, 'Agent status changed');
  
  res.json({ success: true, agent });
});

// Social Media (placeholder - full impl in Task 8)
app.get('/api/socials/posts', (req, res) => {
  res.json(db.getAllSocialPosts());
});

app.post('/api/socials/posts', (req, res) => {
  const post = db.createSocialPost({ id: "post_" + Date.now(), ...req.body });
  res.json({ success: true, post });
});

app.get('/api/socials/analytics', (req, res) => {
  res.json({
    connected: false,
    message: 'Social analytics are not connected yet. Configure Postiz platform analytics before showing live metrics.',
    platforms: {
      tiktok: null,
      instagram: null,
      facebook: null
    }
  });
});

app.delete('/api/socials/posts/:id', (req, res) => {
  db.deleteSocialPost(req.params.id);
  res.json({ success: true });
});

// ============================================================================
// WHATSAPP WEBHOOK (Rate limited + Signature verified + Gemini processing)
// ============================================================================

app.post('/api/webhook/whatsapp', whatsappLimiter, verifyWebhookSignature, async (req, res) => {
  const { From, Body, ProfileName, Body: text, From: phone } = req.body;
  const messageText = Body || text;
  const fromPhone = From || phone;
  const profileName = ProfileName || "Customer";
  
  console.log(`[WhatsApp Webhook] From: ${fromPhone}, Text: ${messageText}`);
  
  // Acknowledge immediately (200 OK)
  res.status(200).json({ success: true, message: 'Webhook received' });
  
  // Process asynchronously
  try {
    const result = await handleIncomingMessage(fromPhone, messageText, profileName);
    const outbound = await sendWhatsAppText(fromPhone, result.reply);
    logger.info({
      fromPhone,
      sent: outbound.sent,
      provider: outbound.provider,
      error: outbound.error || null
    }, 'WhatsApp outbound reply attempted');
  } catch (error) {
    console.error('[Webhook] Processing error:', error);
  }
});

app.get('/api/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  res.status(403).json({ error: 'Meta webhook verification failed' });
});

app.post('/api/webhook/meta', whatsappLimiter, verifyMetaSignature, async (req, res) => {
  res.status(200).json({ success: true, message: 'Meta webhook received' });
  try {
    const events = [];
    for (const entry of req.body?.entry || []) {
      for (const msg of entry.messaging || []) {
        const text = msg.message?.text || msg.postback?.title;
        const sender = msg.sender?.id;
        if (text && sender) {
          events.push({
            source: 'meta_message',
            phone: `meta_${sender}`,
            profileName: `Meta User ${sender}`,
            text,
            replyTarget: { type: 'message', recipientId: sender }
          });
        }
      }
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const text = value.message || value.text || value.comment?.message;
        const sender = value.from?.id || value.sender_id || value.comment?.from?.id || value.user_id;
        const commentId = value.comment_id || value.comment?.id || value.id;
        if (text && sender) {
          events.push({
            source: `meta_${change.field || 'change'}`,
            phone: `meta_${sender}`,
            profileName: value.from?.name || value.comment?.from?.name || `Meta User ${sender}`,
            text,
            replyTarget: commentId
              ? { type: 'comment', commentId }
              : { type: 'message', recipientId: sender }
          });
        }
      }
    }
    for (const event of events) {
      const result = await handleIncomingMessage(event.phone, event.text, event.profileName);
      const outbound = await sendMetaSocialReply(event.replyTarget, result.reply);
      logger.info({
        source: event.source,
        phone: event.phone,
        bookingCreated: result.bookingCreated,
        sent: outbound.sent,
        provider: outbound.provider,
        error: outbound.error || null
      }, 'Meta social event processed');
    }
  } catch (error) {
    console.error('[Meta Webhook] Processing error:', error);
  }
});

// ============================================================================
// ERROR HANDLING MIDDLEWARE (Must be last)
// ============================================================================

app.use((req, res, next) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy violation' });
  }
  if (err.name === 'RateLimitError') {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid token', code: err.name });
  }
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Unique constraint violation' });
  }
  if (err.code === 'SQLITE_CONSTRAINT_NOTNULL') {
    return res.status(400).json({ error: 'Required field missing' });
  }
  
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// START SERVER
// ============================================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Auth: JWT enabled (HS256, ${JWT_EXPIRES_IN} expiry)`);
  console.log(`Webhook: ${process.env.WHATSAPP_PROVIDER || 'meta'} signature verification ${process.env.META_APP_SECRET || process.env.TWILIO_AUTH_TOKEN ? 'ENABLED' : 'DISABLED (no secret)'}`);
  console.log(`Gemini: ${process.env.GEMINI_API_KEY ? 'ENABLED' : 'DISABLED (no API key - using fallback)'}`);
  console.log(`Database: SQLite at ${path.join(__dirname, 'database.sqlite')}`);
});
