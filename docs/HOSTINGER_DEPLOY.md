# Deploying CarShine on Hostinger Node.js Web App

This project should run as one Hostinger Node.js Web App.
The same Express server serves the website, dashboard, login, APIs, chatbot widget, media routes, and future webhook routes.

## What This App Serves

- Website: `/`, `/ar/`, `/de/`
- Dashboard: `/dashboard/` and `/dashboard-v2`
- Login: `/login`
- API: `/api/*`
- Chatbot widget: `/chatbot-widget.js`
- Static assets: `/assets/*`
- Uploaded/generated media: `/media/*`

## Current Connector Limitation

The Hostinger connector available in Codex can create/edit Hostinger Horizons sites.
It does not expose hPanel controls for Node.js Web Apps, subdomains, environment variables, file upload, or process restart.

That means Codex can prepare the repo and verify the local production path, but the final hPanel deploy click must be done manually unless SSH/SFTP/hPanel automation is provided.

## Recommended Temporary Launch

Use one temporary Node.js app first:

- Temporary app URL: `https://app.carshineredsea.com` or a Hostinger temporary domain.
- Dashboard URL: `https://app.carshineredsea.com/dashboard/`
- Login URL: `https://app.carshineredsea.com/login`

After testing, either point the main domain to the same Node app or keep the dashboard on a private subdomain such as `admin.carshineredsea.com`.

## hPanel Node.js Settings

Use the full repository folder, not only `service-agent`, because the backend serves the landing page from the repository root.

In Hostinger hPanel, open `Websites -> Dashboard -> Advanced -> Node.js` and create an app.

| Field | Value |
|---|---|
| Node.js version | 22.x LTS if available, otherwise 20.x |
| Application mode | Production |
| Application root | Folder containing `hostinger-app.cjs`, `index.html`, and `service-agent/` |
| Application URL | Temporary subdomain or Hostinger temporary domain |
| Application startup file | `hostinger-app.cjs` |
| Install command | `npm install && npm run hostinger:install` |
| Start command | `npm start` |

If hPanel only offers an npm install button and startup file field, set the startup file to `hostinger-app.cjs`, run npm install at the root, then run `npm run hostinger:install` if custom commands are available.

## Required Environment Variables Now

Set these in hPanel.
Do not put real secrets into git or frontend JavaScript.

```bash
NODE_ENV=production
HOST=0.0.0.0
JWT_SECRET=<generate-a-64-byte-random-secret>
ADMIN_EMAIL=admin@carshineredsea.com
ADMIN_INITIAL_PASSWORD=<temporary-strong-password-change-after-login>
PUBLIC_BASE_URL=https://app.carshineredsea.com
WEBHOOK_BASE_URL=https://app.carshineredsea.com
PUBLIC_PORTAL_URL=https://app.carshineredsea.com/portal
ALLOWED_ORIGINS=https://app.carshineredsea.com,https://carshineredsea.com,https://www.carshineredsea.com
DATABASE_PATH=./service-agent/database.sqlite
USE_MASTRA_AGENT=false
MiniMax_API_KEY=<server-side-minimax-chat-key-optional>
MINIMAX_API_KEY=<server-side-minimax-media-key-optional>
MINIMAX_IMAGE_MODEL=image-01
MINIMAX_API_BASE=https://api.minimax.io
```

If Hostinger provides `PORT`, leave it alone.
The app reads `process.env.PORT` automatically.

Generate `JWT_SECRET` locally with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Optional Integration Variables Later

WhatsApp Meta Cloud API:

```bash
WHATSAPP_PROVIDER=meta
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_APP_SECRET=
ADMIN_WHATSAPP_PHONE=
```

Twilio alternative:

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

Facebook and Instagram:

```bash
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_PAGE_ACCESS_TOKEN=
FACEBOOK_PAGE_ID=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
```

TikTok and Postiz future publishing:

```bash
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_ACCESS_TOKEN=
TIKTOK_OPEN_ID=
POSTIZ_API_KEY=
POSTIZ_BASE_URL=
```

## URLs To Verify After Start

- `https://app.carshineredsea.com/`
- `https://app.carshineredsea.com/ar/`
- `https://app.carshineredsea.com/de/`
- `https://app.carshineredsea.com/login`
- `https://app.carshineredsea.com/dashboard/`
- `https://app.carshineredsea.com/health`
- `https://app.carshineredsea.com/api-docs/`

Expected dashboard login:

- Email: `ADMIN_EMAIL`
- Password: `ADMIN_INITIAL_PASSWORD`

After first login, change the admin password and replace `ADMIN_INITIAL_PASSWORD` with `ADMIN_PASSWORD_HASH` when available.

## Safety Notes

- `NODE_ENV=production` is required because it disables the localhost dev-auth shortcut.
- Admin routes require JWT in production.
- No API keys belong in git or frontend JavaScript.
- SQLite is acceptable for launch, but back up `service-agent/database.sqlite` daily.
- If Hostinger blocks the native `better-sqlite3` module, move the database to managed MySQL/Postgres.
- Auto-publishing remains approval-based. Do not enable social auto-posting without explicit human approval.
