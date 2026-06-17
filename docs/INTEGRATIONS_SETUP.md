# CarShine Red Sea — Integrations Setup & Credentials Checklist

This is the single source of truth for what each automation phase needs to go
live. **All secrets go in `service-agent/.env` (gitignored) — never in the
frontend, never in chat, never committed.** The frontend always talks to our
own authenticated backend endpoints; the backend holds the keys.

---

## Phase 1 — MiniMax image generation ✅ (built)

**Status:** Backend built and verified. Just needs a valid key.

What to do:
1. Rotate your MiniMax key (the one shared in chat is compromised — delete it
   in the MiniMax console and create a new one).
2. In `service-agent/.env` set:
   ```
   MINIMAX_API_KEY=<your_new_key>
   MINIMAX_IMAGE_MODEL=image-01
   MINIMAX_API_BASE=https://api.minimax.io      # or https://api.minimaxi.com for some accounts
   ```
3. Restart the server. Generate from the dashboard or:
   ```
   POST /api/admin/marketing/images   (OWNER/DISPATCHER auth)
   { "prompt": "mobile car wash team cleaning a white SUV at a Red Sea villa", "category": "gallery", "aspectRatio": "16:9", "n": 1 }
   ```
   Images are saved to `service-agent/generated-media/<category>/` and served at `/media/...`.

> If you see `MiniMax error 1004: token is unusable`, the key is wrong/expired.

---

## Phase 2 — Replace website photos (no new credentials)

After Phase 1 produces images you approve, the Unsplash URLs in `index.html`,
`ar/index.html`, and `de/index.html` get swapped for `/media/...` paths.
Iterative — you pick which generated shots to ship.

---

## Phase 3 — WhatsApp auto-reply (Meta WhatsApp Cloud API)

The bot brain (Layla) already exists; this connects it to WhatsApp.

You must provide (Meta for Developers → your App → WhatsApp):
- `WHATSAPP_ACCESS_TOKEN` — permanent system-user token (not the 24h test token)
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID` (WABA ID)
- `WHATSAPP_APP_SECRET` (for webhook signature verification)
- `WHATSAPP_VERIFY_TOKEN` (any random string you choose; you enter the same one in Meta)

Also required (you do these in Meta, I can't):
- A **Meta Business** account + **business verification**
- A WhatsApp **Business phone number** added to the WABA
- A **public HTTPS webhook URL** (we have `cloudflared.exe` for local testing)
- For sending outside the 24h window: **approved message templates**

What I build: the webhook verify (GET) + inbound handler (POST) → `handleIncomingMessage`
→ reply via Graph API. Conversations appear in the dashboard tagged `source=whatsapp`.

---

## Phase 4 — Social auto-post (Facebook / Instagram / TikTok)

Two options:

**A) Postiz (simplest — one integration covers FB/IG/TikTok)**
- `POSTIZ_API_KEY`, `POSTIZ_TIKTOK_INTEGRATION_ID`,
  `POSTIZ_INSTAGRAM_INTEGRATION_ID`, `POSTIZ_FACEBOOK_INTEGRATION_ID`
- You connect each social account inside Postiz once.

**B) Direct APIs (more control, more setup)**
- Facebook/Instagram: Meta Graph API — FB Page + IG **Business** account linked,
  Page access token, `pages_manage_posts`, `instagram_content_publish`.
- TikTok: TikTok for Developers **Content Posting API** — app + **audit/approval**,
  `client_key`, `client_secret`, OAuth user token.

What I build: generate image (Phase 1) + caption → create a **draft post in the
dashboard** → you approve → publish/schedule. No silent posting without your config.

---

## Phase 5 — Instagram comments + DMs → dashboard as customers

Needs (Meta, with **App Review**):
- IG **Business/Creator** account linked to a FB Page
- Permissions: `instagram_manage_messages`, `instagram_manage_comments`,
  `pages_manage_metadata`
- Webhook subscriptions for `messages` and `comments`
- Meta **App Review** approval for those permissions (Meta requirement — can't be bypassed)

What I build: webhook receivers → Layla auto-reply → stored as chat sessions
tagged `source=instagram`, visible in the dashboard inbox like any customer.

---

## Cross-cutting security (enforced)

- **Keys only in `.env`** (server-side). Frontend calls authenticated endpoints; never sees keys.
- **Production must set `NODE_ENV=production`** — this disables the localhost
  dev-auth shortcut so all `/api/admin/*` and `/api/socials/*` routes require a
  real OWNER/DISPATCHER JWT. (In dev on 127.0.0.1 the shortcut auto-auths for convenience.)
- **Webhook signature verification** (Meta app secret) on all inbound webhooks.
- **Rate limiting** on public + webhook endpoints.
- Generated media served **read-only**.
- AI never marks a payment VERIFIED; bookings from any channel land as `pending`.
