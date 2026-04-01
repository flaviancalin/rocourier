# RoCourier — Complete Setup & Deployment Guide

## ─── PART 1: GET YOUR API CREDENTIALS ────────────────────────────────────────

### FAN Courier
1. Go to **selfawb.ro** and create an account
2. Contact sales.bucuresti@fancourier.ro to sign a transport contract
3. Once approved, log in to selfAWB → **Profil → Generare Token API**
4. Note your **Client ID** (numeric), **Username**, and **Password**
5. For testing only: clientId=`7032158`, username=`clienttest`, password=`testing`

### Sameday Courier
1. Sign a contract with Sameday (sameday.ro → Business → Contact)
2. Email **software@sameday.ro** with subject: "Acces API eAWB"
3. Mention: your company name, CIF, and that you need eAWB API + locker list access
4. You'll receive credentials for eawb.sameday.ro
5. Sandbox base URL: `https://sameday-api.demo.zitec.com`

### xConnector
- No API credentials needed! RoCourier integrates via Shopify fulfillments natively.
- If you want direct xConnector partner integration, email: office@infoquest.ro

---

## ─── PART 2: SHOPIFY PARTNER ACCOUNT ────────────────────────────────────────

1. Go to **partners.shopify.com** and create a free Partner account
2. Click **Apps → Create app → Create app manually**
3. App name: **RoCourier**
4. After creation, note your **Client ID** and **Client Secret**

---

## ─── PART 3: LOCAL DEVELOPMENT SETUP ───────────────────────────────────────

```bash
# 1. Clone / extract the rocourier project folder

# 2. Install dependencies
npm install

# 3. Copy env file
cp .env.example .env
# Edit .env and fill in SHOPIFY_API_KEY, SHOPIFY_API_SECRET

# 4. Set up database (PostgreSQL must be running locally or use Railway)
npx prisma migrate dev --name init

# 5. Start development server (Shopify CLI handles the tunnel automatically)
shopify app dev
```

When you run `shopify app dev`, it:
- Creates a cloudflare tunnel URL (e.g. https://abc123.trycloudflare.com)
- Opens the Partner Dashboard to install on your dev store
- Hot reloads on file changes

> **Important**: After `shopify app dev` gives you the tunnel URL, update
> `APP_URL` in your `.env` and the `app_url` setting in the widget block.

---

## ─── PART 4: DEPLOY TO RAILWAY ──────────────────────────────────────────────

Railway is the easiest Node.js host with free PostgreSQL.

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Create new project
railway new

# 4. Add PostgreSQL database
# In Railway dashboard: your project → New → Database → PostgreSQL
# Copy the DATABASE_URL from the Variables tab

# 5. Set environment variables in Railway dashboard:
#    SHOPIFY_API_KEY=...
#    SHOPIFY_API_SECRET=...
#    DATABASE_URL=postgresql://...
#    HOST=https://your-project.up.railway.app
#    NODE_ENV=production
#    AES_SECRET_KEY=...  (32-char random hex)

# 6. Add start command in Railway:
#    npm run prisma:deploy && npm run start

# 7. Deploy
railway up

# 8. Get your live URL from Railway dashboard
```

---

## ─── PART 5: CONFIGURE shopify.app.toml ─────────────────────────────────────

Replace `YOUR_CLIENT_ID_FROM_PARTNER_DASHBOARD` and `YOUR-APP-URL.railway.app`:

```toml
client_id = "abc123def456"
application_url = "https://rocourier.up.railway.app"

[auth]
redirect_urls = [
  "https://rocourier.up.railway.app/auth/callback"
]
```

Then push the updated config:
```bash
shopify app deploy
```

---

## ─── PART 6: INSTALL ON A TEST STORE ────────────────────────────────────────

1. In Partner Dashboard → Apps → RoCourier → **Test on development store**
2. Select your dev store
3. The app installs and you're redirected to the RoCourier dashboard
4. Go to **Setări** and fill in your FAN/Sameday credentials
5. Save and click **Testează conexiunea**

---

## ─── PART 7: ADD CART WIDGET TO THEME ───────────────────────────────────────

1. In Shopify admin → **Online Store → Themes → Customize**
2. Navigate to **Cart page** (or Cart drawer, depending on theme)
3. Click **Add block** (look in the left sidebar)
4. Find **RoCourier Shipping** and click it
5. In the block settings, enter your **App URL** (Railway URL)
6. Enable/disable FAN and Sameday as needed
7. Click **Save**

> Note: If your theme uses a cart drawer (not a cart page), you may need to
> add the block to the drawer template instead. Contact your theme developer
> if the block doesn't appear.

---

## ─── PART 8: SUBMIT TO SHOPIFY APP STORE ────────────────────────────────────

Requirements before submission:
- [ ] App works end-to-end on a real store
- [ ] Privacy policy URL (create one at app.termsofservicegenerator.net)
- [ ] App icon (1200x1200px PNG)
- [ ] 3+ screenshots of dashboard, settings, and cart widget
- [ ] App description (EN + RO recommended)
- [ ] Pricing plan (Free or paid — set in Partner Dashboard)

Steps:
1. Partner Dashboard → Apps → RoCourier → **Listing**
2. Fill in all required fields
3. Submit for review (takes 5–10 business days)
4. Shopify may request changes — respond within 5 days

---

## ─── FILE STRUCTURE REFERENCE ────────────────────────────────────────────────

```
rocourier/
├── app/
│   ├── routes/
│   │   ├── app.jsx                    ← Admin layout + nav
│   │   ├── app._index.jsx             ← Dashboard
│   │   ├── app.orders.jsx             ← Orders list
│   │   ├── app.orders.$id.jsx         ← Order detail + AWB
│   │   ├── app.settings.jsx           ← Settings (all tabs)
│   │   ├── auth.$.jsx                 ← OAuth handler
│   │   ├── api.pickup-points.js       ← Public API for cart widget
│   │   ├── api.generate-awb.js        ← AWB generation endpoint
│   │   ├── api.track-awb.js           ← Tracking endpoint
│   │   └── webhooks.orders-create.jsx ← Shopify order webhook
│   ├── services/
│   │   ├── fan-courier.server.js      ← FAN Courier API v2
│   │   ├── sameday.server.js          ← Sameday eAWB API
│   │   └── xconnector.server.js       ← Shopify fulfillment sync
│   ├── models/
│   │   ├── order.server.js            ← Order DB operations
│   │   └── pickup-points.server.js    ← Pickup points cache
│   ├── db.server.js                   ← Prisma singleton
│   ├── shopify.server.js              ← Shopify SDK config
│   └── root.jsx                       ← Remix root
├── extensions/
│   └── rocourier-cart/
│       ├── blocks/
│       │   └── shipping-selector.liquid  ← Cart widget Liquid
│       └── assets/
│           ├── rocourier.js              ← Widget JS (Leaflet + logic)
│           └── rocourier.css             ← Widget styles
├── prisma/
│   └── schema.prisma                  ← DB schema
├── shopify.app.toml                   ← App config
├── package.json
└── .env.example                       ← All required env vars
```

---

## ─── TROUBLESHOOTING ─────────────────────────────────────────────────────────

| Problem | Solution |
|---|---|
| Widget not showing in cart | Check theme supports App Blocks; try cart page not cart drawer |
| FAN auth fails | Verify clientId is numeric; use sandbox credentials for testing |
| Sameday auth fails | Check email to software@sameday.ro was answered; sandbox base URL must match |
| Orders not appearing | Check webhook registered: `shopify app deploy` re-registers webhooks |
| Pickup points not loading | Open browser console; check CORS headers; verify app URL in widget block settings |
| AWB generation fails | Check settings saved; test connection first; verify sender zip/city match courier's system |
