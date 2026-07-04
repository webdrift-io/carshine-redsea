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
const { createPublicBooking } = require('./services/public-bookings');
const adminRead = require('./services/admin-bookings-read');
const { findOverlappingBookings } = require('./services/slot-overlap');
const { requireRole } = require('./middleware/require-role');
const usersService = require('./services/users');
const { assignCleaner, releaseAssignment } = require('./services/assignments');
const paymentsReview = require('./services/payments-review');
const cleanerLifecycle = require('./services/cleaner-lifecycle');
const imageGen = require('./services/image-generation');
const notifications = require('./services/notifications');
const { startNotificationScheduler } = require('./jobs/scheduler');
const publicBookingStatus = require('./services/public-booking-status');
const revenueOps = require('./services/revenue-ops');
const { createAudioRouter } = require('./routes/audio');
const businessOps = require('./services/business-ops');

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
const HOST = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');

if (isProduction && !process.env.JWT_SECRET) {
  console.error('[Server] FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}
if (isProduction && !process.env.ADMIN_PASSWORD_HASH && !process.env.ADMIN_INITIAL_PASSWORD) {
  console.error('[Server] FATAL: ADMIN_PASSWORD_HASH or ADMIN_INITIAL_PASSWORD must be set in production');
  process.exit(1);
}
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

const warnedDeprecatedEnvAliases = new Set();
const WHATSAPP_ENV_ALIASES = {
  WHATSAPP_ACCESS_TOKEN: ['WHATSAPP_TOKEN', 'META_ACCESS_TOKEN'],
  WHATSAPP_PHONE_NUMBER_ID: ['META_PHONE_NUMBER_ID'],
  WHATSAPP_VERIFY_TOKEN: ['META_VERIFY_TOKEN', 'META_WEBHOOK_VERIFY_TOKEN'],
  WHATSAPP_BUSINESS_ACCOUNT_ID: ['META_WABA_ID'],
  WHATSAPP_APP_SECRET: ['META_APP_SECRET']
};

function warnDeprecatedEnvAlias(alias, canonical) {
  const key = `${alias}->${canonical}`;
  if (warnedDeprecatedEnvAliases.has(key)) return;
  warnedDeprecatedEnvAliases.add(key);
  console.warn(`[Config] ${alias} is deprecated. Do not use it for new setup. Use ${canonical}.`);
}

function getEnvValue(name, aliases = []) {
  const canonical = process.env[name];
  if (canonical && String(canonical).trim()) return canonical;

  for (const alias of aliases) {
    const value = process.env[alias];
    if (value && String(value).trim()) {
      warnDeprecatedEnvAlias(alias, name);
      return value;
    }
  }

  return '';
}

function warnDeprecatedWhatsappEnvAliases() {
  for (const [canonical, aliases] of Object.entries(WHATSAPP_ENV_ALIASES)) {
    getEnvValue(canonical, aliases);
  }
}

warnDeprecatedWhatsappEnvAliases();

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
  // Allow an explicit Bearer token to bypass the dev shortcut so M0 users can be
  // tested on localhost with their real JWTs (e.g. Playwright E2E).
  const hasExplicitBearer = req.headers.authorization && req.headers.authorization.startsWith('Bearer ');
  if (!isProduction && isLocalRequest && !hasExplicitBearer) {
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
  const appSecret = getEnvValue('WHATSAPP_APP_SECRET', WHATSAPP_ENV_ALIASES.WHATSAPP_APP_SECRET);
  
  if (!appSecret) {
    if (isProduction) {
      console.error('[Webhook] WHATSAPP_APP_SECRET missing in production; rejecting webhook');
      return res.status(503).json({ error: 'Webhook signature verification is not configured' });
    }
    console.warn('[Webhook] WHATSAPP_APP_SECRET not configured, skipping signature verification');
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

// ---------------------------------------------------------------------------
// CORS allowlist
// ---------------------------------------------------------------------------
// Explicit, safe origins. NEVER use `*` here — this service sets
// `credentials: true`, and `Access-Control-Allow-Origin: *` is forbidden
// by the spec when credentials are involved (browsers will block the
// response).
//
// Override the entire list with the ALLOWED_ORIGINS env var (comma-
// separated). When unset, the following defaults apply:
//
//   - Dev landing on the project preview server:        4173
//   - Dev landing on the Vite dev server:               5173
//   - Dashboard served from the same Express host:      5000
//   - Common ad-hoc dev ports:                          3000, 4567, 8000
//   - Production CarShine domain (site + api):          carshineredsea.com
//
// To add a new dev port, add it here. To add a new production origin,
// add it here AND to the CORS section of docs/rebuild/SECURITY_PLAN.md
// so the choice is reviewable in the security plan.
// ---------------------------------------------------------------------------
const DEFAULT_ALLOWED_ORIGINS = [
  // Local dev — explicit ports only
  'http://localhost:5000',     // service-agent (admin dashboard + API)
  'http://127.0.0.1:5000',
  'http://localhost:4173',     // preview-server.cjs (default landing)
  'http://127.0.0.1:4173',
  'http://localhost:5173',     // Vite dev server
  'http://127.0.0.1:5173',
  'http://localhost:3000',     // common ad-hoc (create-react-app, next dev)
  'http://127.0.0.1:3000',
  'http://localhost:4567',     // python -m http.server / ad-hoc
  'http://127.0.0.1:4567',
  'http://localhost:8000',     // django / ad-hoc
  'http://127.0.0.1:8000',
  // Production
  'https://carshineredsea.com',
  'https://www.carshineredsea.com',
  'https://api.carshineredsea.com',
  // Hostinger temp domain (live marketing site + backend during launch)
  'https://slategrey-pig-358843.hostingersite.com',
  'http://slategrey-pig-358843.hostingersite.com'
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
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

// Single source of truth: the new operations console is the only dashboard.
// Old paths redirect to /dashboard-v2.
app.get('/dashboard', (req, res) => res.redirect(302, '/dashboard-v2'));
app.get('/dashboard/', (req, res) => res.redirect(302, '/dashboard-v2'));
app.get('/dashboard-v2/', (req, res, next) => {
  if (req.originalUrl.startsWith('/dashboard-v2/')) return res.redirect(302, '/dashboard-v2');
  return next();
});

const publicFormLimiter = rateLimit({
  windowMs: parseInt(process.env.PUBLIC_FORM_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.PUBLIC_FORM_RATE_LIMIT_MAX, 10) || 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many form submissions, please try again later.' },
  keyGenerator: ipKeyGenerator
});
app.get('/login', (req, res) => res.redirect(302, '/dashboard-v2?login=1'));
app.get('/login/', (req, res) => res.redirect(302, '/dashboard-v2?login=1'));

// Serve the new dashboard assets. Keep the HTML route explicit so relative
// browser resolution never hides missing JS/CSS assets again.
app.get('/dashboard-v2.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(DASHBOARD_PUBLIC_DIR, 'dashboard-v2.js'));
});
app.get('/shadcn-bridge.css', (req, res) => {
  res.type('text/css').sendFile(path.join(DASHBOARD_PUBLIC_DIR, 'shadcn-bridge.css'));
});
app.use('/ar', express.static(path.join(PROJECT_ROOT, 'ar')));
app.use('/de', express.static(path.join(PROJECT_ROOT, 'de')));
// Brand assets (logos) used by the landing pages — read-only static.
app.use('/assets', express.static(path.join(PROJECT_ROOT, 'assets'), { maxAge: '7d', index: false }));
// SEO files served at site root (also present in public_html on static hosting).
app.get('/robots.txt', (req, res) => res.type('text/plain').sendFile(path.join(PROJECT_ROOT, 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').sendFile(path.join(PROJECT_ROOT, 'sitemap.xml')));
// Generated marketing/website images (MiniMax). Read-only static; the API key
// that produced them never touches the client — only the resulting PNGs do.
app.use('/media', express.static(path.join(__dirname, 'generated-media'), {
  maxAge: '7d',
  index: false
}));

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

function hasUsableEnv(name, placeholders = [], aliases = []) {
  const value = getEnvValue(name, aliases);
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
        : hasUsableEnv('WHATSAPP_ACCESS_TOKEN', [], WHATSAPP_ENV_ALIASES.WHATSAPP_ACCESS_TOKEN) &&
          hasUsableEnv('WHATSAPP_PHONE_NUMBER_ID', [], WHATSAPP_ENV_ALIASES.WHATSAPP_PHONE_NUMBER_ID) &&
          hasUsableEnv('WHATSAPP_VERIFY_TOKEN', [], WHATSAPP_ENV_ALIASES.WHATSAPP_VERIFY_TOKEN),
      signatureVerification: hasUsableEnv('WHATSAPP_APP_SECRET', [], WHATSAPP_ENV_ALIASES.WHATSAPP_APP_SECRET),
      ownerNotifications: hasUsableEnv('ADMIN_WHATSAPP_PHONE'),
      adminPhone: process.env.ADMIN_WHATSAPP_PHONE || null,
      missing: [
        ...((process.env.WHATSAPP_PROVIDER || 'meta') === 'twilio'
          ? ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM']
          : ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET']),
        'ADMIN_WHATSAPP_PHONE'
      ]
        .filter(name => !hasUsableEnv(name, [], WHATSAPP_ENV_ALIASES[name] || []))
    },
    social: {
      webhook: `${webhookBase}/api/webhook/meta`,
      instagramConnected: hasUsableEnv('META_PAGE_ACCESS_TOKEN') && hasUsableEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID'),
      facebookConnected: hasUsableEnv('META_PAGE_ACCESS_TOKEN') && hasUsableEnv('FACEBOOK_PAGE_ID'),
      missing: ['META_APP_ID', 'WHATSAPP_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID', 'INSTAGRAM_BUSINESS_ACCOUNT_ID']
        .filter(name => !hasUsableEnv(name))
    },
    payments: {
      instapayReceivingNumber: process.env.INSTAPAY_RECEIVING_NUMBER || '01555567205',
      instapayPaymentLink: process.env.INSTAPAY_PAYMENT_LINK || '',
      instapayQrImageUrl: process.env.INSTAPAY_QR_IMAGE_URL || '',
      automaticChargeSupported: false,
      connected: hasUsableEnv('INSTAPAY_PAYMENT_LINK') || hasUsableEnv('INSTAPAY_QR_IMAGE_URL'),
      note: 'InstaPay Egypt can use mobile/IPA, QR, or payment links. Automatic in-site charging needs an approved payment gateway or merchant API.'
    },
    mem0: {
      connected: hasUsableEnv('MEM0_API_KEY'),
      mode: hasUsableEnv('MEM0_API_KEY') ? 'live' : 'dry-run',
      missing: hasUsableEnv('MEM0_API_KEY') ? [] : ['MEM0_API_KEY']
    },
    langfuse: {
      connected: hasUsableEnv('LANGFUSE_PUBLIC_KEY') && hasUsableEnv('LANGFUSE_SECRET_KEY'),
      mode: hasUsableEnv('LANGFUSE_PUBLIC_KEY') ? 'cloud' : 'jsonl',
      missing: ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'].filter((n) => !hasUsableEnv(n))
    },
    marketing: {
      draftQueue: true,
      autoPublish: false,
      endpoint: '/api/admin/marketing/drafts'
    },
    notifications: {
      jobsEnabled: process.env.ENABLE_NOTIFICATION_JOBS !== 'false',
      schedulerIntervalMs: Number(process.env.NOTIFICATION_JOB_INTERVAL_MS || 300000)
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

  const whatsappAccessToken = getEnvValue('WHATSAPP_ACCESS_TOKEN', WHATSAPP_ENV_ALIASES.WHATSAPP_ACCESS_TOKEN);
  const whatsappPhoneNumberId = getEnvValue('WHATSAPP_PHONE_NUMBER_ID', WHATSAPP_ENV_ALIASES.WHATSAPP_PHONE_NUMBER_ID);
  if (!whatsappAccessToken || !whatsappPhoneNumberId) {
    return { sent: false, provider: 'meta', error: 'missing_meta_whatsapp_config' };
  }
  const toPhone = normalizePhoneForMeta(to);
  const res = await fetch(`https://graph.facebook.com/v20.0/${whatsappPhoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${whatsappAccessToken}`,
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

  // M0-006: check normalized users table first (OWNER/DISPATCHER/CLEANER)
  const m0User = usersService.getUserByEmail(email);
  if (m0User) {
    const valid = await verifyPassword(password, m0User.password_hash);
    if (!valid) {
      await new Promise(r => setTimeout(r, 100));
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    usersService.updateLastLogin(m0User.id);
    const token = generateToken({
      sub: m0User.id,
      email: m0User.email,
      role: m0User.role,
      displayName: m0User.display_name,
      iat: Math.floor(Date.now() / 1000)
    });
    return res.json({
      success: true,
      token,
      expiresIn: JWT_EXPIRES_IN,
      user: { id: m0User.id, email: m0User.email, role: m0User.role, displayName: m0User.display_name }
    });
  }

  // Legacy fallback: single admin_credentials record
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
    await new Promise(r => setTimeout(r, 100));
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

  // M0-006: M0 users (OWNER/DISPATCHER/CLEANER) use the users table
  const userRole = req.user && req.user.role;
  const isM0User = userRole && userRole !== 'admin';
  if (isM0User) {
    const m0User = usersService.getActiveUserById(req.user.sub);
    if (!m0User) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }
    const fullUser = usersService.getUserByEmail(m0User.email);
    const valid = await verifyPassword(currentPassword, fullUser.password_hash);
    if (!valid) {
      await new Promise(r => setTimeout(r, 100));
      return res.status(401).json({ error: 'Current password incorrect' });
    }
    const newHash = await hashPassword(newPassword);
    usersService.updatePassword(m0User.id, newHash);
    return res.json({ success: true, message: 'Password changed.' });
  }

  // Legacy: single admin_credentials record
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
      bookingId: result.bookingId || null,
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

// Separate rate limiter for widget polling (GET only — much more frequent than POST)
const publicChatPollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { messages: [], found: false, sessionId: null }
});

/**
 * Get chat history for a public session (polled by widget for agent replies)
 */
app.get('/api/public/chat/:sessionId', publicChatPollLimiter, (req, res) => {
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

app.post('/api/public/bookings', publicChatLimiter, async (req, res) => {
  try {
    const result = createPublicBooking(req.body || {});
    if (result.success && result.status === 'QUOTED' && result.bookingV2Id) {
      const row = db.db.prepare('SELECT b.*, c.phone_raw, c.phone_e164, c.language FROM bookings_v2 b JOIN customers c ON c.id = b.customer_id WHERE b.id = ?').get(result.bookingV2Id);
      if (row) await notifications.notifyBookingConfirmation(row, row).catch(() => {});
    }
    broadcast('booking:created', {
      booking: result.booking,
      bookingV2Id: result.bookingV2Id,
      publicRef: result.bookingId,
      status: result.status,
      paymentStatus: result.paymentStatus,
      source: 'public-booking-api-v2'
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    console.error('[Public Booking] Error:', error);
    res.status(500).json({
      success: false,
      error: 'BOOKING_CREATE_FAILED',
      message: 'Sorry, we could not save this booking request. Please try again or contact us on WhatsApp.'
    });
  }
});

app.get('/api/public/bookings/:publicRef/status', publicChatLimiter, (req, res) => {
  const phoneLast4 = req.query.phoneLast4 || req.query.last4;
  const status = publicBookingStatus.getPublicBookingStatus(req.params.publicRef, phoneLast4);
  if (!status.found) {
    return res.status(404).json({ success: false, error: status.error || 'NOT_FOUND' });
  }
  res.json({ success: true, ...status });
});

// ============================================================================
// FIRST-PARTY WEBSITE ANALYTICS (privacy-safe, no external scripts)
// ============================================================================

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false }
});

/** POST /api/public/analytics/event — called by landing page tracking snippet */
app.post('/api/public/analytics/event', analyticsLimiter, (req, res) => {
  const VALID = ['page_view','chatbot_open','booking_started','booking_submitted','cta_click','page_section'];
  const { event_type, page_path, referrer, session_id } = req.body || {};
  if (!event_type || !VALID.includes(event_type)) return res.status(400).json({ success: false });

  const ua = req.headers['user-agent'] || '';
  const rawIp = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const isMobile = /Mobile|Android|iPhone|iPod/.test(ua);
  const isTablet = /iPad|Tablet/.test(ua);
  const device_type = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';
  // Truncate to 3 octets (IPv4) or 18 chars (IPv6) — no individual tracking
  const ip_prefix = rawIp.includes(':')
    ? rawIp.substring(0, 18)
    : rawIp.split('.').slice(0, 3).join('.');
  // Country from Cloudflare header (free, no API call)
  const country = req.headers['cf-ipcountry'] || req.headers['x-country-code'] || null;

  try {
    db.db.prepare(`
      INSERT INTO website_events (event_type, page_path, referrer, ip_prefix, country, device_type, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event_type,
      (page_path || '/').toString().substring(0, 200),
      (referrer || '').toString().substring(0, 500),
      ip_prefix,
      country,
      device_type,
      (session_id || '').toString().substring(0, 64)
    );
    res.json({ success: true });
  } catch (e) {
    logger.error({ err: e }, 'Analytics insert failed');
    res.status(500).json({ success: false });
  }
});

/** GET /api/admin/analytics/summary */
app.get('/api/admin/analytics/summary', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const pageViews    = db.db.prepare(`SELECT COUNT(*) n FROM website_events WHERE event_type='page_view' AND created_at>?`).get(since).n;
    const todayViews   = db.db.prepare(`SELECT COUNT(*) n FROM website_events WHERE event_type='page_view' AND date(created_at)=date('now')`).get().n;
    const uniqueSess   = db.db.prepare(`SELECT COUNT(DISTINCT session_id) n FROM website_events WHERE created_at>?`).get(since).n;
    const conversions  = db.db.prepare(`SELECT COUNT(*) n FROM website_events WHERE event_type='booking_submitted' AND created_at>?`).get(since).n;
    const topPages     = db.db.prepare(`SELECT page_path,COUNT(*) views FROM website_events WHERE event_type='page_view' AND created_at>? GROUP BY page_path ORDER BY views DESC LIMIT 10`).all(since);
    const topRefs      = db.db.prepare(`SELECT referrer,COUNT(*) count FROM website_events WHERE referrer!='' AND referrer IS NOT NULL AND created_at>? GROUP BY referrer ORDER BY count DESC LIMIT 8`).all(since);
    const deviceBreak  = db.db.prepare(`SELECT device_type,COUNT(*) count FROM website_events WHERE created_at>? GROUP BY device_type`).all(since);
    const dailyViews   = db.db.prepare(`SELECT date(created_at) day,COUNT(*) views FROM website_events WHERE event_type='page_view' AND created_at>? GROUP BY day ORDER BY day`).all(since);
    const countries    = db.db.prepare(`SELECT country,COUNT(*) count FROM website_events WHERE country IS NOT NULL AND created_at>? GROUP BY country ORDER BY count DESC LIMIT 8`).all(since);
    res.json({ period_days:days, page_views:pageViews, views_today:todayViews, unique_sessions:uniqueSess, booking_conversions:conversions, top_pages:topPages, top_referrers:topRefs, device_breakdown:deviceBreak, daily_views:dailyViews, country_breakdown:countries });
  } catch (e) {
    logger.error({ err: e }, 'Analytics summary failed');
    res.status(500).json({ error: 'Analytics unavailable' });
  }
});

/** GET /api/admin/analytics/recent */
app.get('/api/admin/analytics/recent', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  try {
    const events = db.db.prepare(`SELECT id,event_type,page_path,referrer,country,device_type,created_at FROM website_events ORDER BY created_at DESC LIMIT 100`).all();
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: 'Analytics unavailable' });
  }
});

// Settings
app.get('/api/settings', (req, res) => {
  res.json({ autopilot });
});

app.get('/dashboard-v2', (req, res) => {
  res.sendFile(path.join(DASHBOARD_PUBLIC_DIR, 'dashboard-v2.html'));
});

// ============================================================================
// ADMIN: customers / staff / reports / booking status
// ============================================================================

app.get('/api/admin/customers', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    rows = db.db.prepare(`
      SELECT c.id, c.full_name, c.phone_e164, c.phone_raw, c.email, c.area, c.tags, c.language,
        (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS vehicle_count
      FROM customers c
      WHERE c.deleted_at IS NULL
        AND (c.full_name LIKE ? OR c.phone_e164 LIKE ? OR c.phone_raw LIKE ? OR c.email LIKE ?)
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(like, like, like, like, limit);
  } else {
    rows = db.db.prepare(`
      SELECT c.id, c.full_name, c.phone_e164, c.phone_raw, c.email, c.area, c.tags, c.language,
        (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS vehicle_count
      FROM customers c
      WHERE c.deleted_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(limit);
  }
  res.json({ success: true, customers: rows, count: rows.length });
});

app.get('/api/admin/staff', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const rows = db.db.prepare(`
    SELECT id, email, phone, role, display_name, language, active,
           shift_start, shift_end, last_login_at, created_at
    FROM users
    WHERE deleted_at IS NULL AND role IN ('OWNER','DISPATCHER','CLEANER')
    ORDER BY role ASC, display_name ASC
  `).all();
  res.json({ success: true, staff: rows, count: rows.length });
});

app.post('/api/admin/staff', requireAuth, requireRole(['OWNER']), async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const displayName = String(body.displayName || body.display_name || '').trim();
  const role = String(body.role || 'CLEANER').trim().toUpperCase();
  const validRoles = ['OWNER', 'DISPATCHER', 'CLEANER'];
  if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'VALID_EMAIL_REQUIRED' });
  if (!displayName) return res.status(400).json({ success: false, error: 'DISPLAY_NAME_REQUIRED' });
  if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'INVALID_ROLE' });
  const exists = db.db.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').get(email);
  if (exists) return res.status(409).json({ success: false, error: 'EMAIL_ALREADY_EXISTS' });
  const password = String(body.password || crypto.randomBytes(8).toString('base64url'));
  const hash = await bcrypt.hash(password, 12);
  const id = `usr_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  db.db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, role, display_name, language, active, shift_start, shift_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, email, body.phone || null, hash, role, displayName, body.language || 'en', body.shiftStart || body.shift_start || null, body.shiftEnd || body.shift_end || null, now, now);
  res.status(201).json({ success: true, staff: { id, email, phone: body.phone || null, role, display_name: displayName, active: 1 }, temporaryPassword: body.password ? undefined : password });
});

app.patch('/api/admin/staff/:id', requireAuth, requireRole(['OWNER']), (req, res) => {
  const existing = db.db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'STAFF_NOT_FOUND' });
  const body = req.body || {};
  const role = body.role ? String(body.role).toUpperCase() : existing.role;
  if (!['OWNER', 'DISPATCHER', 'CLEANER'].includes(role)) return res.status(400).json({ success: false, error: 'INVALID_ROLE' });
  db.db.prepare(`
    UPDATE users SET phone = ?, role = ?, display_name = ?, language = ?, active = ?, shift_start = ?, shift_end = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.phone ?? existing.phone,
    role,
    body.displayName ?? body.display_name ?? existing.display_name,
    body.language ?? existing.language,
    body.active == null ? existing.active : (body.active ? 1 : 0),
    body.shiftStart ?? body.shift_start ?? existing.shift_start,
    body.shiftEnd ?? body.shift_end ?? existing.shift_end,
    new Date().toISOString(),
    req.params.id
  );
  res.json({ success: true, staff: db.db.prepare('SELECT id, email, phone, role, display_name, language, active, shift_start, shift_end, last_login_at, created_at FROM users WHERE id = ?').get(req.params.id) });
});

app.delete('/api/admin/staff/:id', requireAuth, requireRole(['OWNER']), (req, res) => {
  const existing = db.db.prepare('SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'STAFF_NOT_FOUND' });
  const activeOwners = db.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'OWNER' AND active = 1 AND deleted_at IS NULL").get().n;
  if (existing.role === 'OWNER' && activeOwners <= 1) return res.status(409).json({ success: false, error: 'CANNOT_DELETE_LAST_OWNER' });
  const now = new Date().toISOString();
  db.db.prepare('UPDATE users SET active = 0, deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/reports/summary', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const summary = { revenue7d: 0, bookings7d: 0, avgTicket7d: 0, pendingPayments: 0, byService: [], byArea: [] };
  try {
    const rev = db.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE status = 'VERIFIED' AND verified_at >= ?
    `).get(sevenDaysAgo);
    summary.revenue7d = Number(rev?.total || 0);

    const bk = db.db.prepare(`
      SELECT COUNT(*) AS n FROM bookings_v2
      WHERE created_at >= ? AND status NOT IN ('CANCELLED')
    `).get(sevenDaysAgo);
    summary.bookings7d = Number(bk?.n || 0);
    summary.avgTicket7d = summary.bookings7d > 0 ? Math.round(summary.revenue7d / summary.bookings7d) : 0;

    const pending = db.db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE status = 'SUBMITTED'`).get();
    summary.pendingPayments = Number(pending?.n || 0);

    const byService = db.db.prepare(`
      SELECT sp.name_en AS name, COUNT(b.id) AS count, COALESCE(SUM(p.amount), 0) AS revenue
      FROM service_packages sp
      LEFT JOIN bookings_v2 b ON b.service_package_id = sp.id AND b.created_at >= ? AND b.status = 'COMPLETED'
      LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'VERIFIED'
      GROUP BY sp.id
      ORDER BY count DESC
      LIMIT 10
    `).all(sevenDaysAgo);
    summary.byService = byService.map(r => ({ name: r.name, count: Number(r.count || 0), revenue: Number(r.revenue || 0) }));

    const byArea = db.db.prepare(`
      SELECT area, COUNT(*) AS count FROM bookings_v2
      WHERE area IS NOT NULL AND area <> '' AND created_at >= ? AND status NOT IN ('CANCELLED')
      GROUP BY area ORDER BY count DESC LIMIT 10
    `).all(sevenDaysAgo);
    summary.byArea = byArea.map(r => ({ area: r.area, count: Number(r.count || 0) }));
  } catch (e) {
    console.error('[Reports]', e);
  }
  res.json({ success: true, ...summary });
});

// ============================================================================
// BUSINESS OPS: leads, website forms, recruiting, follow-ups, media library
// ============================================================================

function sendBusinessError(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error('[BusinessOps]', error);
  res.status(status).json({ success: false, error: error.message || 'BUSINESS_OPS_ERROR' });
}

app.post('/api/public/contact', publicFormLimiter, (req, res) => {
  try {
    const contact = businessOps.createContactSubmission(req.body || {});
    res.status(201).json({ success: true, contact });
  } catch (error) {
    sendBusinessError(res, error);
  }
});

app.post('/api/public/join', publicFormLimiter, (req, res) => {
  try {
    const request = businessOps.createJoinRequest(req.body || {});
    res.status(201).json({ success: true, request });
  } catch (error) {
    sendBusinessError(res, error);
  }
});

app.get('/api/admin/business/summary', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (_req, res) => {
  res.json({ success: true, summary: businessOps.getSummary() });
});

app.get('/api/admin/leads', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  res.json({ success: true, leads: businessOps.listLeads(req.query), count: businessOps.listLeads(req.query).length });
});

app.post('/api/admin/leads', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  try {
    res.status(201).json({ success: true, lead: businessOps.createLead(req.body || {}) });
  } catch (error) {
    sendBusinessError(res, error);
  }
});

app.patch('/api/admin/leads/:id', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const lead = businessOps.updateLead(req.params.id, req.body || {});
  if (!lead) return res.status(404).json({ success: false, error: 'LEAD_NOT_FOUND' });
  res.json({ success: true, lead });
});

app.delete('/api/admin/leads/:id', requireAuth, requireRole(['OWNER']), (req, res) => {
  res.json({ success: businessOps.deleteLead(req.params.id) });
});

app.get('/api/admin/contact-submissions', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const contacts = businessOps.listContacts(req.query);
  res.json({ success: true, contacts, count: contacts.length });
});

app.patch('/api/admin/contact-submissions/:id', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const contact = businessOps.updateContact(req.params.id, req.body || {});
  if (!contact) return res.status(404).json({ success: false, error: 'CONTACT_NOT_FOUND' });
  res.json({ success: true, contact });
});

app.get('/api/admin/join-requests', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const requests = businessOps.listJoinRequests(req.query);
  res.json({ success: true, requests, count: requests.length });
});

app.patch('/api/admin/join-requests/:id', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const request = businessOps.updateJoinRequest(req.params.id, req.body || {});
  if (!request) return res.status(404).json({ success: false, error: 'JOIN_REQUEST_NOT_FOUND' });
  res.json({ success: true, request });
});

app.get('/api/admin/follow-ups', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const followUps = businessOps.listFollowUps(req.query);
  res.json({ success: true, followUps, count: followUps.length });
});

app.post('/api/admin/follow-ups', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  try {
    res.status(201).json({ success: true, followUp: businessOps.createFollowUp(req.body || {}) });
  } catch (error) {
    sendBusinessError(res, error);
  }
});

app.patch('/api/admin/follow-ups/:id', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const followUp = businessOps.updateFollowUp(req.params.id, req.body || {});
  if (!followUp) return res.status(404).json({ success: false, error: 'FOLLOW_UP_NOT_FOUND' });
  res.json({ success: true, followUp });
});

app.get('/api/admin/media-library', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const media = businessOps.listMedia(req.query);
  res.json({ success: true, media, count: media.length });
});

function platformImageSpec(platform = 'instagram') {
  const p = String(platform || 'instagram').toLowerCase();
  if (p === 'tiktok') return { aspectRatio: '9:16', width: 1080, height: 1920 };
  if (p === 'facebook') return { aspectRatio: '16:9', width: 1200, height: 630 };
  return { aspectRatio: '1:1', width: 1080, height: 1080 };
}

app.post('/api/admin/media-library', requireAuth, requireRole(['OWNER']), async (req, res) => {
  try {
    const input = req.body || {};
    const mediaInput = { ...input };
    const wantsGeneration = input.generateImage === true || input.provider === 'minimax';
    if (wantsGeneration && imageGen.isConfigured()) {
      const spec = platformImageSpec(input.platform);
      const generated = await imageGen.generateAndSave({
        prompt: input.prompt || input.topic || input.title || 'premium mobile car wash social media post',
        category: `social-${input.platform || 'instagram'}`,
        aspectRatio: spec.aspectRatio,
        width: spec.width,
        height: spec.height,
        n: 1
      });
      mediaInput.assetUrl = generated.images[0]?.url || null;
      mediaInput.provider = 'minimax';
      mediaInput.meta = {
        ...(input.meta || {}),
        model: generated.model,
        prompt: generated.prompt,
        platformSpec: spec,
        generatedAt: new Date().toISOString()
      };
    } else if (wantsGeneration && !imageGen.isConfigured()) {
      mediaInput.provider = 'manual';
      mediaInput.meta = {
        ...(input.meta || {}),
        generationBlocked: 'MINIMAX_API_KEY missing',
        platformSpec: platformImageSpec(input.platform)
      };
    }
    res.status(201).json({ success: true, media: businessOps.createMedia(mediaInput) });
  } catch (error) {
    sendBusinessError(res, error);
  }
});

app.patch('/api/admin/media-library/:id', requireAuth, requireRole(['OWNER']), (req, res) => {
  const media = businessOps.updateMedia(req.params.id, req.body || {});
  if (!media) return res.status(404).json({ success: false, error: 'MEDIA_NOT_FOUND' });
  res.json({ success: true, media });
});

app.delete('/api/admin/media-library/:id', requireAuth, requireRole(['OWNER']), (req, res) => {
  res.json({ success: businessOps.deleteMedia(req.params.id) });
});

app.post('/api/admin/media-library/:id/regenerate', requireAuth, requireRole(['OWNER']), async (req, res) => {
  const media = businessOps.listMedia({ limit: 500 }).find((item) => item.id === req.params.id);
  if (!media) return res.status(404).json({ success: false, error: 'MEDIA_NOT_FOUND' });
  if (!imageGen.isConfigured()) {
    return res.status(503).json({ success: false, error: 'MINIMAX_API_KEY_REQUIRED' });
  }
  try {
    const spec = platformImageSpec(media.platform);
    const generated = await imageGen.generateAndSave({
      prompt: req.body?.prompt || media.topic || media.title,
      category: `social-${media.platform || 'instagram'}`,
      aspectRatio: spec.aspectRatio,
      width: spec.width,
      height: spec.height,
      n: 1
    });
    const updated = businessOps.updateMedia(media.id, {
      assetUrl: generated.images[0]?.url || media.assetUrl,
      provider: 'minimax',
      status: 'draft',
      meta: {
        ...(media.meta || {}),
        model: generated.model,
        prompt: generated.prompt,
        platformSpec: spec,
        regeneratedAt: new Date().toISOString()
      }
    });
    res.json({ success: true, media: updated });
  } catch (error) {
    sendBusinessError(res, error);
  }
});

app.post('/api/bookings/:id/status', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const { status, reason } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: 'STATUS_REQUIRED' });
  const VALID = ['NEW','COLLECTING_INFO','QUOTED','BOOKED','ASSIGNED','ON_THE_WAY','IN_PROGRESS','COMPLETED','CANCELLED','NEEDS_HUMAN'];
  if (!VALID.includes(status)) return res.status(400).json({ success: false, error: 'INVALID_STATUS' });
  // Accept either legacy `bookings.id` (b_…) OR v2 `bookings_v2.id` (book_…).
  // If only the legacy record exists, create a v2 mirror row on demand so
  // status changes are durable and visible everywhere.
  let v2 = db.db.prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(req.params.id);
  if (!v2) v2 = db.db.prepare('SELECT * FROM bookings_v2 WHERE legacy_booking_id = ?').get(req.params.id);
  if (!v2) {
    const legacy = db.db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (legacy) {
      // Find or create a customer row to satisfy the FK.
      let customerId = null;
      if (legacy.phone) {
        const existing = db.db.prepare('SELECT id FROM customers WHERE phone_e164 = ? OR phone_raw = ?').get(legacy.phone, legacy.phone);
        if (existing) customerId = existing.id;
      }
      if (!customerId) {
        customerId = 'cust_' + Math.random().toString(36).slice(2, 14);
        const ts = new Date().toISOString();
        db.db.prepare(`
          INSERT INTO customers (id, full_name, phone_e164, phone_raw, language, area, tags, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)
        `).run(customerId, legacy.customerName || 'Unknown', legacy.phone, legacy.phone, 'en', legacy.area || '', ts, ts);
      }
      const v2Id = 'book_' + Math.random().toString(36).slice(2, 14);
      const ts = new Date().toISOString();
      db.db.prepare(`
        INSERT INTO bookings_v2 (id, legacy_booking_id, public_ref, customer_id, scheduled_start, scheduled_end, timezone, status, payment_status, source, language, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Africa/Cairo', ?, 'UNPAID', 'legacy_migration', 'en', ?, ?, ?)
      `).run(v2Id, legacy.id, legacy.id, customerId, legacy.preferredDate ? `${legacy.preferredDate}T${legacy.preferredTime || '10:00'}:00` : ts, ts, legacy.status || 'pending', legacy.notes || '', ts, ts);
      v2 = db.db.prepare('SELECT * FROM bookings_v2 WHERE id = ?').get(v2Id);
    }
  }
  if (!v2) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  const ts = new Date().toISOString();
  const txn = db.db.transaction(() => {
    db.db.prepare('UPDATE bookings_v2 SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, v2.id);
    // Also update the legacy row so older surfaces (v1 dashboard, calendars) stay in sync.
    db.db.prepare('UPDATE bookings SET status = ?, updatedAt = ? WHERE id = (SELECT legacy_booking_id FROM bookings_v2 WHERE id = ?)')
      .run(status, ts, v2.id);
    db.db.prepare(`
      INSERT INTO booking_status_history (id, booking_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at)
      VALUES (?, ?, ?, ?, 'OWNER', ?, ?, '{}', ?)
    `).run('h_' + Math.random().toString(36).slice(2, 12), v2.id, v2.status, status, req.user.sub || 'local-dev', reason || null, ts);
  });
  txn();
  broadcast('bookings', db.getAllBookings());
  res.json({ success: true, bookingId: v2.id, status });
});

// Unified dispatch board: merges legacy bookings + v2 bookings, ensuring
// every booking the operator sees is actionable. Used by the dashboard Kanban.
app.get('/api/admin/dispatch/board', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const rows = db.db.prepare(`
    SELECT
      COALESCE(v2.id, b.id) as id,
      b.id as legacy_id,
      COALESCE(v2.status, b.status, 'pending') as status,
      COALESCE(c.full_name, b.customerName, 'Unknown') as customerName,
      COALESCE(c.phone_e164, c.phone_raw, b.phone, '') as phone,
      COALESCE(b.area, '') as area,
      COALESCE(sp.name_en, b.package, '—') as service,
      COALESCE(v2.scheduled_start, b.preferredDate) as scheduled_start,
      b.preferredTime,
      b.preferredDate as legacyDate,
      COALESCE(v2.payment_status, 'UNPAID') as paymentStatus,
      COALESCE(v2.customer_id, '') as customer_id
    FROM bookings b
    LEFT JOIN bookings_v2 v2 ON v2.legacy_booking_id = b.id
    LEFT JOIN customers c ON c.id = v2.customer_id
    LEFT JOIN service_packages sp ON sp.id = v2.service_package_id
    UNION ALL
    SELECT
      v2.id as id,
      NULL as legacy_id,
      v2.status,
      COALESCE(c.full_name, 'Unknown') as customerName,
      COALESCE(c.phone_e164, c.phone_raw, '') as phone,
      '' as area,
      COALESCE(sp.name_en, '—') as service,
      v2.scheduled_start,
      NULL as preferredTime,
      NULL as legacyDate,
      v2.payment_status,
      v2.customer_id
    FROM bookings_v2 v2
    LEFT JOIN customers c ON c.id = v2.customer_id
    LEFT JOIN service_packages sp ON sp.id = v2.service_package_id
    WHERE v2.legacy_booking_id IS NULL
    ORDER BY scheduled_start DESC
    LIMIT 200
  `).all();
  res.json({ success: true, bookings: rows, count: rows.length });
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

function findOrCreateChatByPhone(phone, name = 'WhatsApp Customer') {
  const normalized = String(phone || '').trim();
  const existing = db.getAllChats().find((chat) => String(chat.phone || '').trim() === normalized);
  if (existing) return existing;
  const session = {
    id: `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    customerName: name,
    phone: normalized,
    area: '',
    carType: '',
    package: '',
    preferredDate: '',
    preferredTime: '',
    location: '',
    paymentMethod: '',
    status: 'active',
    language: 'en',
    lastAskedField: 'customerName',
    bookingDetails: {}
  };
  db.createChat(session, { text: 'Conversation created by admin outbound WhatsApp message', timestamp: new Date().toISOString() });
  return session;
}

app.post('/api/admin/whatsapp/send', requireAuth, requireRole(['OWNER', 'DISPATCHER']), async (req, res) => {
  const { phone, message, name } = req.body || {};
  if (!phone || !message) return res.status(400).json({ success: false, error: 'phone and message are required' });
  const result = await sendWhatsAppText(phone, String(message).slice(0, 4000));
  const chat = findOrCreateChatByPhone(phone, name || 'WhatsApp Customer');
  db.addMessage(chat.id, 'admin', String(message).slice(0, 4000), new Date().toISOString());
  const updatedChat = db.getChat(chat.id);
  broadcast('chat:updated', updatedChat);
  res.status(result.sent ? 200 : 503).json({ success: result.sent, result, chat: updatedChat });
});

// ============================================================================
// CUSTOMER PORTAL (token-authenticated self-service)
// ============================================================================
const customerPortal = require('./services/customer-portal');

// Public — uses ?token= or Authorization: Bearer
app.get('/api/portal/me', customerPortal.portalAuthMiddleware, customerPortal.getMe);
app.get('/api/portal/bookings', customerPortal.portalAuthMiddleware, customerPortal.getBookingsList);
app.post('/api/portal/bookings/:id/reschedule', customerPortal.portalAuthMiddleware, customerPortal.rescheduleBooking);
app.post('/api/portal/bookings/:id/cancel', customerPortal.portalAuthMiddleware, customerPortal.cancelBooking);
app.post('/api/portal/bookings/:id/rate', customerPortal.portalAuthMiddleware, customerPortal.rateBooking);

// Public — customer submits InstaPay/Vodafone Cash proof using their portal token
app.post('/api/portal/payments', (req, res) => {
  // Accept token in body, query, header, or Authorization: Bearer
  const body = req.body || {};
  const tokenFromBody = body.token;
  const portalPayments = require('./services/public-payments');
  // Try with the supplied token first; if missing/invalid, the middleware will reject.
  if (tokenFromBody) {
    req.headers['x-portal-token'] = tokenFromBody;
    req.query = { ...(req.query || {}), token: tokenFromBody };
  }
  customerPortal.portalAuthMiddleware(req, res, () => {
    const { bookingId, method, amount, reference, screenshotDataUrl } = body;
    const result = portalPayments.submitPayment({
      bookingId, customerId: req.portal.customerId, method, amount, reference, screenshotDataUrl
    });
    res.status(result.success ? 201 : 400).json(result);
  });
});

// Admin — issue a portal token for a customer (e.g. on demand, or after booking)
app.post('/api/admin/portal/issue-token', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const { customerId, scope, bookingId, issuedVia, issuedTo, ttlDays } = req.body || {};
  if (!customerId) return res.status(400).json({ success: false, error: 'customerId required' });
  let result;
  try {
    result = customerPortal.issuePortalToken(customerId, { scope, bookingId, issuedVia, issuedTo, ttlDays });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message || 'TOKEN_ISSUE_FAILED' });
  }
  // Build the full magic link the admin can paste into WhatsApp/email
  const base = process.env.PUBLIC_PORTAL_URL || 'https://carshineredsea.com/portal';
  const link = `${base}?token=${encodeURIComponent(result.rawToken)}`;
  res.status(201).json({ success: true, ...result, link });
});

// ============================================================================
// MARKETING AUTOPILOT (stateful, in-process)
// ============================================================================
const marketingAutopilot = require('./services/marketing-autopilot');

app.get('/api/admin/marketing/autopilot/status', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  res.json({ success: true, ...marketingAutopilot.getStatus() });
});

app.post('/api/admin/marketing/autopilot/enable', requireAuth, requireRole(['OWNER']), (req, res) => {
  const { mode } = req.body || {};
  res.json({ success: true, ...marketingAutopilot.setEnabled(true, mode) });
});

app.post('/api/admin/marketing/autopilot/disable', requireAuth, requireRole(['OWNER']), (req, res) => {
  res.json({ success: true, ...marketingAutopilot.setEnabled(false) });
});

app.post('/api/admin/marketing/autopilot/test-publish', requireAuth, requireRole(['OWNER']), async (req, res) => {
  const { language, topic } = req.body || {};
  const run = await marketingAutopilot.testPublish({ language, topic });
  res.json({ success: run.success, run });
});

app.post('/api/admin/marketing/autopilot/scheduler/start', requireAuth, requireRole(['OWNER']), (req, res) => {
  const { scheduleTimes, language, topic } = req.body || {};
  const result = marketingAutopilot.startScheduler({ scheduleTimes, language, topic });
  res.json({ success: true, ...result });
});

app.post('/api/admin/marketing/autopilot/scheduler/stop', requireAuth, requireRole(['OWNER']), (req, res) => {
  res.json({ success: true, ...marketingAutopilot.stopScheduler() });
});

app.use('/api/admin/audio', createAudioRouter({ requireAuth, requireRole }));

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

// Bookings — DEPRECATED (M0-005c): use /api/admin/bookings-v2 for normalized data
app.get('/api/bookings', (req, res) => {
  res.set('X-Deprecated', 'true; use /api/admin/bookings-v2');
  res.json(db.getAllBookings());
});

app.post('/api/bookings', (req, res) => {
  res.set('X-Deprecated', 'true; use POST /api/public/bookings or agent createBooking → bookings_v2');
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

// Calendar — DEPRECATED (M0-005c): use /api/admin/calendar-v2 for normalized data
app.get('/api/calendar', (req, res) => {
  res.set('X-Deprecated', 'true; use /api/admin/calendar-v2');
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

// ============================================================================
// MARKETING — MiniMax image generation (admin only; key stays server-side)
// ============================================================================

// Whether image generation is configured (does NOT expose the key).
app.get('/api/admin/marketing/image-status', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  res.json({ configured: imageGen.isConfigured(), model: imageGen.IMAGE_MODEL });
});

// Generate one or more realistic brand images from a prompt.
// Body: { prompt, category?, aspectRatio?, n?, rawPrompt?, seed? }
app.post('/api/admin/marketing/images', requireAuth, requireRole(['OWNER', 'DISPATCHER']), async (req, res) => {
  const { prompt, category, aspectRatio, n, rawPrompt, seed, width, height } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
    return res.status(400).json({ error: 'A non-empty "prompt" is required.' });
  }
  if (!imageGen.isConfigured()) {
    return res.status(503).json({
      error: 'Image generation is not configured. Set MINIMAX_API_KEY in service-agent/.env (server-side only).'
    });
  }
  try {
    const result = await imageGen.generateAndSave({
      prompt,
      category,
      aspectRatio,
      width,
      height,
      n: Math.min(parseInt(n, 10) || 1, 4), // cap per-request to control cost
      rawPrompt: Boolean(rawPrompt),
      seed: Number.isInteger(seed) ? seed : undefined
    });
    // Never echo the key or upstream auth; only the saved local URLs.
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Marketing] image generation failed:', err.message);
    res.status(502).json({ error: 'Image generation failed.', detail: err.message });
  }
});

app.get('/api/admin/revenue/summary', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const days = parseInt(req.query.days, 10) || 7;
  res.json(revenueOps.getRevenueSummary({ days }));
});

app.get('/api/admin/dispatch/suggest/:bookingId', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  res.json(revenueOps.suggestCleaner(req.params.bookingId));
});

app.get('/api/admin/marketing/drafts', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  res.json({ drafts: revenueOps.listMarketingDrafts() });
});

app.post('/api/admin/marketing/drafts', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const { title, caption, imagePath } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const draft = revenueOps.queueMarketingDraft({
    title,
    caption,
    imagePath,
    createdBy: req.user?.email
  });
  res.status(201).json({ success: true, draft });
});

app.post('/api/admin/marketing/drafts/:id/approve', requireAuth, requireRole(['OWNER']), (req, res) => {
  res.json({ success: true, ...revenueOps.approveMarketingDraft(req.params.id) });
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

// Simulate an incoming WhatsApp message (no Meta required). Used by the
// dashboard "Test WhatsApp" button and during development.
app.post('/api/admin/test/whatsapp', requireAuth, requireRole(['OWNER']), async (req, res) => {
  const { phone, message, name } = req.body || {};
  if (!phone || !message) return res.status(400).json({ success: false, error: 'phone and message required' });
  try {
    const result = await handleIncomingMessage(phone, message, name || 'WhatsApp Test');
    broadcast('chat:updated', db.getChat(phone));
    res.json({ success: true, reply: result.reply, bookingCreated: result.bookingCreated, bookingId: result.bookingId, humanNeeded: result.humanNeeded });
  } catch (e) {
    console.error('[WhatsApp test]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

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
  const expected = getEnvValue('WHATSAPP_VERIFY_TOKEN', WHATSAPP_ENV_ALIASES.WHATSAPP_VERIFY_TOKEN);
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
        for (const waMsg of value.messages || []) {
          const sender = waMsg.from;
          if (!sender) continue;
          const phone = sender.startsWith('+') ? sender : `+${sender}`;
          if (waMsg.type === 'image' && waMsg.image?.id) {
            const proof = paymentsReview.submitCustomerWhatsAppProof(phone, {
              mediaId: waMsg.image.id,
              notes: 'WhatsApp image upload'
            });
            if (proof.success) {
              await sendWhatsAppText(phone, 'Thanks! We received your payment screenshot and will review it shortly.');
              continue;
            }
          }
          const text = waMsg.text?.body || waMsg.button?.text;
          if (text) {
            events.push({
              source: 'whatsapp_cloud',
              phone,
              profileName: value.contacts?.[0]?.profile?.name || 'Customer',
              text,
              replyTarget: { type: 'whatsapp', phone }
            });
          }
        }
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
// ADMIN BOOKINGS V2 — M0-005a
// Read model endpoints for the normalized bookings_v2 table.
// OWNER + DISPATCHER may read; only OWNER may reschedule.
// Legacy /api/bookings and /api/calendar are preserved untouched.
// ============================================================================

app.get('/api/admin/bookings-v2', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const result = adminRead.listBookingsForAdmin({
    dateFrom: req.query.dateFrom || null,
    dateTo: req.query.dateTo || null,
    status: req.query.status || null,
    paymentStatus: req.query.paymentStatus || null,
    source: req.query.source || null,
    language: req.query.language || null,
    limit: req.query.limit,
    offset: req.query.offset
  });
  res.json(result);
});

app.get('/api/admin/bookings-v2/:id', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const result = adminRead.getBookingDetailForAdmin(req.params.id);
  if (!result.success) {
    if (result.code === 'NOT_FOUND') return res.status(404).json(result);
    return res.status(400).json(result);
  }
  res.json(result);
});

app.patch('/api/admin/bookings-v2/:id/ops', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const body = req.body || {};
  const booking = db.db.prepare('SELECT id FROM bookings_v2 WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!booking) return res.status(404).json({ success: false, error: 'BOOKING_NOT_FOUND' });
  const intOrZero = (value) => Math.max(0, parseInt(value, 10) || 0);
  const washesNeeded = Math.max(1, parseInt(body.washesNeeded ?? body.washes_needed, 10) || 1);
  const washesCompleted = Math.min(washesNeeded, intOrZero(body.washesCompleted ?? body.washes_completed));
  const operationalCost = intOrZero(body.operationalCost ?? body.operational_cost);
  const ownerNotes = body.ownerNotes || body.owner_notes ? String(body.ownerNotes || body.owner_notes).slice(0, 2000) : null;
  const lastWashAt = body.lastWashAt || body.last_wash_at ? String(body.lastWashAt || body.last_wash_at).slice(0, 80) : null;
  const nextWashAt = body.nextWashAt || body.next_wash_at ? String(body.nextWashAt || body.next_wash_at).slice(0, 80) : null;
  db.db.prepare(`
    UPDATE bookings_v2
    SET washes_needed = ?, washes_completed = ?, operational_cost = ?, owner_notes = ?,
        last_wash_at = ?, next_wash_at = ?, updated_at = ?
    WHERE id = ?
  `).run(washesNeeded, washesCompleted, operationalCost, ownerNotes, lastWashAt, nextWashAt, new Date().toISOString(), req.params.id);
  res.json(adminRead.getBookingDetailForAdmin(req.params.id));
});

app.get('/api/admin/calendar-v2', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const result = adminRead.getCalendarForAdmin({
    dateFrom: req.query.dateFrom || null,
    dateTo: req.query.dateTo || null
  });
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// M0-007: cleaner list, assign, release
app.get('/api/admin/users/cleaners', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  res.json({ success: true, cleaners: usersService.listActiveCleaners() });
});

app.post('/api/admin/bookings-v2/:id/assign', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const { cleanerId } = req.body;
  if (!cleanerId) {
    return res.status(400).json({ success: false, code: 'MISSING_CLEANER_ID', error: 'cleanerId is required' });
  }
  const assignedById = req.user && req.user.sub !== 'admin' ? req.user.sub : null;
  const result = assignCleaner({ bookingId: req.params.id, cleanerId, assignedById });
  if (!result.success) {
    const statusMap = { BOOKING_NOT_FOUND: 404, CLEANER_NOT_FOUND: 404, WRONG_STATUS: 409, NOT_A_CLEANER: 400, CLEANER_INACTIVE: 400 };
    return res.status(statusMap[result.code] || 400).json(result);
  }
  res.json(result);
});

app.post('/api/admin/bookings-v2/:id/release', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const { releaseReason } = req.body || {};
  const result = releaseAssignment({ bookingId: req.params.id, releaseReason: releaseReason || 'RELEASED' });
  if (!result.success) {
    return res.status(result.code === 'NO_ACTIVE_ASSIGNMENT' ? 404 : 400).json(result);
  }
  res.json(result);
});

app.post('/api/admin/bookings-v2/:id/reschedule', requireAuth, requireRole(['OWNER']), (req, res) => {
  const bookingId = req.params.id;
  const { newStart } = req.body;

  if (!newStart || typeof newStart !== 'string') {
    return res.status(400).json({ success: false, code: 'MISSING_NEW_START', error: 'newStart (ISO timestamp) is required' });
  }

  const startDate = new Date(newStart);
  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ success: false, code: 'INVALID_NEW_START', error: 'newStart must be a valid ISO timestamp' });
  }

  if (startDate.getTime() <= Date.now()) {
    return res.status(409).json({ success: false, code: 'SLOT_IN_PAST', error: 'newStart must be in the future' });
  }

  const bookingRow = db.db.prepare('SELECT * FROM bookings_v2 WHERE id = ? AND deleted_at IS NULL').get(bookingId);
  if (!bookingRow) {
    return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Booking not found' });
  }

  if (!['QUOTED', 'CONFIRMED'].includes(bookingRow.status)) {
    return res.status(409).json({ success: false, code: 'WRONG_STATUS', error: `Cannot reschedule a booking with status ${bookingRow.status}` });
  }

  const pkg = db.db.prepare('SELECT duration_minutes FROM service_packages WHERE id = ?').get(bookingRow.service_package_id);
  const durationMinutes = (pkg && pkg.duration_minutes) || 60;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const overlaps = findOverlappingBookings({
    scheduledStart: startDate.toISOString(),
    scheduledEnd: endDate.toISOString(),
    excludeBookingId: bookingId
  });

  if (overlaps.length > 0) {
    return res.status(409).json({
      success: false,
      code: 'SLOT_UNAVAILABLE',
      error: 'The requested time slot overlaps with an existing booking',
      conflictingBookings: overlaps.map(o => ({
        id: o.id,
        publicRef: o.public_ref,
        scheduledStart: o.scheduled_start,
        scheduledEnd: o.scheduled_end
      }))
    });
  }

  const updatedAt = new Date().toISOString();
  const histId = 'hist_' + Math.random().toString(36).slice(2, 12);
  const actorId = (req.user && (req.user.sub || req.user.email)) || null;

  db.db.transaction(() => {
    db.db.prepare(
      'UPDATE bookings_v2 SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ?'
    ).run(startDate.toISOString(), endDate.toISOString(), updatedAt, bookingId);
    db.db.prepare(
      `INSERT INTO booking_status_history
         (id, booking_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at)
       VALUES (?, ?, ?, ?, 'OWNER', ?, 'RESCHEDULED', '{}', ?)`
    ).run(histId, bookingId, bookingRow.status, bookingRow.status, actorId, updatedAt);
  })();

  const updatedRow = db.db.prepare(`
    SELECT
      b.id, b.public_ref, b.status, b.payment_status, b.scheduled_start, b.scheduled_end,
      b.timezone, b.source, b.language, b.notes, b.created_at, b.updated_at,
      c.id AS customer_id, c.full_name, c.phone_e164, c.phone_raw, c.email,
      c.address AS customer_address, c.area AS customer_area,
      v.id AS vehicle_id, v.car_type, v.make AS v_make, v.model AS v_model, v.plate AS v_plate,
      sp.id AS sp_id, sp.code AS sp_code, sp.name_en, sp.name_ar, sp.name_de,
      sp.duration_minutes, sp.price_amount, sp.price_currency,
      p.id AS payment_id, p.status AS payment_row_status, p.method AS payment_method,
      p.amount AS payment_amount, p.currency AS payment_currency,
      p.submitted_at AS payment_submitted_at, p.verified_at AS payment_verified_at
    FROM bookings_v2 b
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    JOIN service_packages sp ON sp.id = b.service_package_id
    LEFT JOIN payments p ON p.booking_id = b.id
    WHERE b.id = ? AND b.deleted_at IS NULL
  `).get(bookingId);

  res.json({ success: true, booking: adminRead.formatBookingForAdmin(updatedRow) });
});

// ============================================================================
// ADMIN PAYMENTS — M0-006
// Manual InstaPay payment review workflow.
// OWNER + DISPATCHER may list/detail/submit.
// Only OWNER may verify or reject.
// CLEANER gets 403 from requireRole.
// ============================================================================

function buildActor(req) {
  return {
    role: req.user && req.user.role,
    userId: req.user && req.user.sub
  };
}

app.get('/api/admin/payments', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const result = paymentsReview.listPendingPaymentReviews({
    status: req.query.status || null,
    limit: req.query.limit,
    offset: req.query.offset
  });
  res.json(result);
});

app.get('/api/admin/payments/:id', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const result = paymentsReview.getPaymentReviewDetail(req.params.id);
  if (!result.success) {
    return res.status(result.code === 'NOT_FOUND' ? 404 : 400).json(result);
  }
  res.json(result);
});

app.post('/api/admin/payments/:id/submit', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const result = paymentsReview.submitPaymentProof(
    req.params.id,
    req.body || {},
    buildActor(req)
  );
  if (!result.success) {
    const statusMap = { NOT_FOUND: 404, WRONG_STATUS: 409, AI_FORBIDDEN: 403 };
    return res.status(statusMap[result.code] || 400).json(result);
  }
  res.json(result);
});

app.post('/api/admin/payments/:id/verify', requireAuth, requireRole(['OWNER']), (req, res) => {
  const result = paymentsReview.verifyPayment(
    req.params.id,
    req.body || {},
    buildActor(req)
  );
  if (!result.success) {
    const statusMap = { NOT_FOUND: 404, WRONG_STATUS: 409, OWNER_REQUIRED: 403, ACTOR_USER_REQUIRED: 400 };
    return res.status(statusMap[result.code] || 400).json(result);
  }
  res.json(result);
});

app.post('/api/admin/payments/:id/reject', requireAuth, requireRole(['OWNER']), (req, res) => {
  const result = paymentsReview.rejectPayment(
    req.params.id,
    req.body || {},
    buildActor(req)
  );
  if (!result.success) {
    const statusMap = { NOT_FOUND: 404, WRONG_STATUS: 409, REASON_REQUIRED: 400, OWNER_REQUIRED: 403 };
    return res.status(statusMap[result.code] || 400).json(result);
  }
  res.json(result);
});

// Serve stored payment screenshots (admin-only)
app.get('/api/admin/payments/screenshot/:filename', requireAuth, requireRole(['OWNER', 'DISPATCHER']), (req, res) => {
  const filename = path.basename(req.params.filename);
  const full = path.join(__dirname, 'data', 'payment-screenshots', filename);
  if (!fs.existsSync(full)) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  res.sendFile(full);
});

// ============================================================================
// M0-007: Cleaner job status lifecycle
// CLEANER can list their own assigned bookings and transition job status.
// OWNER can override on any assigned booking.
// DISPATCHER gets 403 from requireRole.
// ============================================================================

app.get('/api/cleaner/bookings', requireAuth, requireRole(['CLEANER', 'OWNER']), (req, res) => {
  const role = req.user.role === 'admin' ? 'OWNER' : req.user.role;
  let cleanerId;
  if (role === 'OWNER') {
    cleanerId = req.query.cleanerId || null;
    if (!cleanerId) return res.json({ success: true, count: 0, bookings: [] });
  } else {
    cleanerId = req.user.sub;
  }
  const result = cleanerLifecycle.getCleanerAssignedBookings(cleanerId);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.post('/api/cleaner/bookings/:id/status', requireAuth, requireRole(['CLEANER', 'OWNER']), (req, res) => {
  const { status } = req.body || {};
  if (!status) {
    return res.status(400).json({ success: false, code: 'MISSING_STATUS', error: 'body.status is required' });
  }
  const result = cleanerLifecycle.transitionCleanerBookingStatus(
    req.params.id,
    status,
    buildActor(req)
  );
  if (!result.success) {
    const statusMap = {
      NOT_FOUND: 404,
      INVALID_TRANSITION: 409,
      INVALID_FROM_STATUS: 409,
      ALREADY_COMPLETED: 409,
      PAYMENT_NOT_VERIFIED: 409,
      NOT_ASSIGNED: 409,
      NOT_YOUR_BOOKING: 403,
      ROLE_NOT_ALLOWED: 403,
    };
    return res.status(statusMap[result.code] || 400).json(result);
  }
  res.json(result);
});

// ============================================================================
// ERROR HANDLING MIDDLEWARE (Must be last)
// ============================================================================

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.accepts('html') !== 'html') {
    return res.status(404).json({ error: 'Not found', path: req.path });
  }
  const notFoundPage = path.join(PROJECT_ROOT, '404.html');
  if (fs.existsSync(notFoundPage)) {
    return res.status(404).sendFile(notFoundPage);
  }
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

server.listen(PORT, HOST, () => {
  startNotificationScheduler();
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Auth: JWT enabled (HS256, ${JWT_EXPIRES_IN} expiry)`);
  console.log(`Webhook: ${process.env.WHATSAPP_PROVIDER || 'meta'} signature verification ${getEnvValue('WHATSAPP_APP_SECRET', WHATSAPP_ENV_ALIASES.WHATSAPP_APP_SECRET) || process.env.TWILIO_AUTH_TOKEN ? 'ENABLED' : 'DISABLED (no secret)'}`);
  console.log(`Gemini: ${process.env.GEMINI_API_KEY ? 'ENABLED' : 'DISABLED (no API key - using fallback)'}`);
  console.log(`Database: SQLite at ${process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite')}`);
});
