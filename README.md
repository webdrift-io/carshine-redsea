# CarShine Red Sea

Premium mobile car wash service platform serving El Gouna, Hurghada, and Sahl Hasheesh in Egypt.

## Architecture

| Component | Stack | Purpose |
|-----------|-------|---------|
| **Landing pages** | Vite + Three.js + GSAP | Multi-language (EN/AR/DE) marketing site |
| **Service agent** | Node.js + Express + SQLite | Admin dashboard backend + AI chatbot |
| **Marketing** | Postiz + MiniMax/Gemini | Multi-platform social media orchestrator |
| **AI Agent** | MiniMax M3 (primary) / Gemini (fallback) | Multilingual booking assistant |

## Project Structure

```
car whased in Egypt redsea/
├── service-agent/           # Backend API + admin dashboard
│   ├── server.js            # Main Express server (JWT, Socket.io, security)
│   ├── minimax-agent.js     # AI agent brain (PRIMARY: MiniMax M3)
│   ├── gemini-chatbot.js     # Legacy Gemini integration (fallback)
│   ├── database.js          # SQLite schema, prepared statements, transactions
│   ├── parsers.js            # Message parsing utilities (multilingual)
│   ├── logger.js             # Structured logging (Pino)
│   ├── openapi.yaml          # Full OpenAPI 3.0.3 spec
│   ├── public/
│   │   ├── chatbot-widget.js # Embeddable chat widget for any website
│   │   ├── chatbot-demo.html # Live demo page
│   │   └── app.js, style.css # Admin dashboard
│   ├── routes/api-docs.js    # Swagger UI routes
│   ├── tests/                # 78 Vitest unit tests
│   ├── package.json
│   └── .env                  # Secrets (gitignored)
├── landing-page/            # Vite-built static site
│   ├── src/
│   │   ├── shared/           # Shared styles, utils, constants
│   │   ├── features/         # Booking form, location, offer popup
│   │   ├── ui/               # Core, animations, modals, hero (Three.js)
│   │   ├── i18n/             # EN/AR/DE translations
│   │   └── main.js           # Entry point
│   ├── vite-plugins/         # i18n, SRI, cache-bust plugins
│   ├── dist/                 # Built output (.html, .gz, .br)
│   ├── package.json
│   └── vite.config.js
├── tiktok-marketing/         # Multi-platform orchestrator
│   ├── orchestrator.js       # Main: validate, pipeline, analytics, schedule
│   ├── config.template.json  # Template (real config is gitignored)
│   ├── scripts/              # generate-slides, add-text-overlay, etc.
│   └── logs/                 # Pipeline runs, alerts
├── scripts/
│   ├── pre-deploy-check.cjs  # Pre-flight validation
│   └── deploy.cjs            # Build + package + sign deployment
├── build-landing.cjs         # Landing page build orchestrator
├── .github/workflows/ci.yml  # CI/CD pipeline
├── .gitignore
├── .env.example              # Template for secrets
└── package.json
```

## Quick Start

### 1. Setup

```bash
# Install backend deps
cd service-agent
npm install

# Install landing page deps
cd ../landing-page
npm install
```

### 2. Configure environment

```bash
# Copy and fill in secrets
cp .env.example .env

# Required:
MiniMax_API_KEY=your_key_here
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

# Optional but recommended:
META_APP_SECRET=...  # for WhatsApp webhook verification
POSTIZ_API_KEY=...    # for TikTok/IG/FB posting
```

### 3. Build

```bash
# Build landing page (creates .html, .gz, .br variants)
node build-landing.cjs

# Or per language:
cd landing-page && npm run build:en
```

### 4. Run

```bash
# Start the service agent
cd service-agent
npm start

# Open http://localhost:5000
# Admin dashboard: login at /login (default: admin@carshineredsea.com / ChangeMe123!)
# API docs: http://localhost:5000/api-docs/
# Chatbot demo: http://localhost:5000/chatbot-demo.html
```

### 5. Embed chatbot on your website

```html
<script src="https://your-domain.com/chatbot-widget.js"></script>
<script>
  CarShineChat.init({
    apiUrl: 'https://your-domain.com',
    position: 'bottom-left',
    title: 'CarShine Assistant',
    welcomeMessage: 'Hi! 👋 How can I help you book a car wash today?'
  });
</script>
```

## Features

### Backend (`service-agent/`)
- ✅ JWT authentication (HS256, 8h expiry)
- ✅ Helmet, CORS allowlist, rate limiting, compression
- ✅ Webhook signature verification (Meta + Twilio)
- ✅ SQLite (better-sqlite3) with prepared statements, transactions, indexes
- ✅ Socket.io for real-time dashboard updates
- ✅ Public chatbot endpoint (no auth, rate-limited)
- ✅ OpenAPI 3.0.3 spec + Swagger UI
- ✅ Structured logging (Pino, auto-redacts secrets)
- ✅ 78 unit tests, 80%+ coverage on parsers

### AI Agent (`minimax-agent.js`)
- ✅ **Primary: MiniMax M3** (best structured output + tool use)
- ✅ Fallback: Gemini 2.5 Flash
- ✅ Last resort: Rule-based English
- ✅ Multilingual: Egyptian Arabic, English, German
- ✅ Structured JSON output (REPLY, PENDING_BOOKING, HUMAN_NEED)
- ✅ Slot validation before booking
- ✅ Auto-creates bookings from conversation

### Landing Page (`landing-page/`)
- ✅ Vite build with minification, code splitting
- ✅ Content-hash cache busting
- ✅ Gzip + Brotli pre-compression
- ✅ SRI hash generation
- ✅ i18n with EJS-style templating
- ✅ Three.js hero + GSAP animations
- ✅ 3 languages: EN, AR (RTL), DE

### Marketing (`tiktok-marketing/`)
- ✅ Multi-platform (TikTok, Instagram, Facebook)
- ✅ Config validation (fail-fast on placeholders)
- ✅ Dry-run mode for testing
- ✅ Structured logging + alerts
- ✅ Cross-platform analytics
- ✅ Cron scheduler
- ✅ Pipeline history

### DevOps
- ✅ CI/CD via GitHub Actions (test, build, security, deploy)
- ✅ Pre-deployment validation
- ✅ Deployment packaging with SHA-256 signing
- ✅ No hardcoded secrets (enforced by pre-deploy check)
- ✅ npm audit + coverage in CI

## API Endpoints

See `http://localhost:5000/api-docs/` for interactive documentation.

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | Public | Health check (K8s-compatible) |
| `GET /health/ready` | Public | Readiness probe |
| `GET /health/live` | Public | Liveness probe |
| `POST /api/auth/login` | Public | Admin login (rate-limited) |
| `POST /api/auth/change-password` | JWT | Change admin password |
| `GET /api/bookings` | JWT | List all bookings |
| `POST /api/bookings` | JWT | Create booking |
| `POST /api/bookings/:id/approve` | JWT | Approve + create calendar event |
| `POST /api/bookings/:id/reject` | JWT | Reject + remove calendar event |
| `GET /api/calendar` | JWT | List calendar events |
| `GET /api/chats` | JWT | List chat sessions |
| `GET /api/chats/:id` | JWT | Get chat with messages |
| `POST /api/chats/simulate-incoming` | JWT | Simulate WhatsApp message |
| `POST /api/chats/:id/message` | JWT | Send chat message |
| `GET /api/agents` | JWT | List AI agents |
| `POST /api/agents/:id/toggle` | JWT | Toggle agent state |
| `GET /api/settings` | JWT | Get settings |
| `POST /api/settings` | JWT | Update settings |
| `GET /api/socials/posts` | JWT | List social media posts |
| `POST /api/socials/posts` | JWT | Create social post |
| `GET /api/socials/analytics` | JWT | Get analytics |
| `POST /api/webhook/whatsapp` | Signature | WhatsApp incoming webhook |
| `POST /api/public/chat` | Public (rate-limited) | Website chatbot widget |
| `GET /api/public/chat/:sessionId` | Public (rate-limited) | Get chat history |
| `GET /api-docs/` | Public | Swagger UI |
| `GET /api-docs/openapi.json` | Public | OpenAPI JSON spec |
| `GET /api-docs/openapi.yaml` | Public | OpenAPI YAML spec |

## Real-time Events (Socket.io)

Connect with JWT in `auth.token`. Events emitted:

| Event | When | Payload |
|-------|------|---------|
| `init` | On connect | Full initial state |
| `booking:created` | New booking | `{ booking }` |
| `booking:approved` | Booking approved | `{ booking, calendarEvent }` |
| `booking:rejected` | Booking rejected | `{ bookingId }` |
| `bookings` | Bookings changed | Full array |
| `calendar` | Calendar changed | Full array |
| `chat:updated` | Chat changed | Full session with messages |
| `chats` | Chats list changed | Full array |
| `autopilot` | Autopilot toggled | `{ autopilot }` |

## Testing

```bash
cd service-agent
npm test                  # Run all 78 tests
npm run test:coverage     # With coverage report
npm run lint              # ESLint
npm run format:check      # Prettier
npm run typecheck         # TypeScript
```

## Deployment

```bash
# Pre-flight check
node scripts/pre-deploy-check.cjs

# Build + package
node scripts/deploy.cjs

# Output: deploy-{timestamp}.tar.gz
```

## License

UNLICENSED - private project

---

**Last audit:** 78 unit tests pass, 7 integration tests pass, 0 hardcoded secrets, 0 vulnerabilities.
**AI provider:** MiniMax M3 (primary), Gemini (fallback), rule-based (last resort).
**Service uptime target:** 99.9% (with health/ready/live endpoints for K8s orchestration).