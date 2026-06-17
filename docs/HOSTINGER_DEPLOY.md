# Deploying the CarShine backend on Hostinger (Node.js)

The static marketing site is already live in `public_html` (`/`, `/ar/`, `/de/`).
This guide brings the **backend** online — dashboard, login, Layla chatbot
replies, booking API, MiniMax image generation, and the auto-poster — so all
three links work.

The Express app serves the landing page, the dashboard, **and** the API from a
single origin, so once it runs, the chat widget and booking form on the live
site start working automatically (same origin).

---

## What you provide (the only steps I can't do over FTP)

1. **MiniMax API key** (rotated) — set as an env var below.
2. **Node.js enabled** in hPanel **OR** SSH access (then I do all of the below for you).

---

## Option A — SSH (fastest; I do everything)

Send me: host/IP, SSH username, port, and how you authenticate. I will:
upload code, `npm ci`, set env vars, run migrations, start under the process
manager, and verify all three links. You do nothing else.

---

## Option B — hPanel Node.js screen (you click; I prepared every value)

**1. Upload the code**
`carshine-backend.zip` is already uploaded to `public_html` via FTP.
In hPanel → **File Manager**, extract it. You'll get `service-agent/`,
`index.html`, `ar/`, `de/`, etc.

**2. hPanel → Advanced → Node.js → Create application**

| Field | Value |
|-------|-------|
| Node.js version | 20.x (or the latest 18+ offered) |
| Application mode | Production |
| Application root | the folder that contains `service-agent/` (e.g. `public_html`) |
| Application URL | your domain (`slategrey-pig-358843.hostingersite.com`) |
| Application startup file | `service-agent/server.js` |

**3. Environment variables** (add these in the same screen):

```
NODE_ENV=production
PORT=                      # leave blank — Hostinger/Passenger sets it
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
ADMIN_EMAIL=owner@carshineredsea.com
ADMIN_INITIAL_PASSWORD=<a strong password you choose>
ALLOWED_ORIGINS=https://slategrey-pig-358843.hostingersite.com
DATABASE_PATH=./database.sqlite
MINIMAX_API_KEY=<your rotated MiniMax key>
MINIMAX_IMAGE_MODEL=image-01
MINIMAX_API_BASE=https://api.minimax.io
```
(WhatsApp / social keys get added later when we wire those phases.)

**4. Install dependencies**
In the Node.js screen, set **NPM run path** to `service-agent` (so it installs
where `package.json` is) and click **Run NPM Install**. This compiles
`better-sqlite3` for the host — if it errors, tell me the log and I'll switch to
a prebuilt-binary or a Postgres adapter.

**5. Start / Restart the app**, then open:
- Website: `https://slategrey-pig-358843.hostingersite.com/`
- Dashboard: `https://slategrey-pig-358843.hostingersite.com/dashboard/`
- Login: same URL → log in with `ADMIN_EMAIL` + `ADMIN_INITIAL_PASSWORD`

Tell me when it's started and I'll run the live tests (health, login, a real
booking through Layla, and a MiniMax image) and confirm everything.

---

## Notes / safety

- `NODE_ENV=production` is required — it disables the localhost dev-auth
  shortcut so every admin route demands a real JWT.
- No secrets are in the uploaded code or in git; they live only in the hPanel
  env screen.
- SQLite is fine for launch; if Hostinger's Node sandbox blocks native modules
  we move the DB to Postgres (Hostinger offers it) — small, isolated change.
- After launch, change the FTP password (it was shared in chat).
