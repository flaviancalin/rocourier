# RoCourier — Complete Deployment & Launch Guide
# From zero to Shopify App Store in 10 steps

---

## PREREQUISITES

Before you start, make sure you have:
- Node.js 20+ installed  (check: `node --version`)
- Git installed          (check: `git --version`)
- A Shopify Partner account → partners.shopify.com (free)
- A development store for testing → Partner Dashboard → Stores → Add store

---

## STEP 1 — Install Shopify CLI

```bash
npm install -g @shopify/cli@latest
shopify version   # should print 3.x
```

---

## STEP 2 — Clone and install dependencies

```bash
cd rocourier
npm install
```

---

## STEP 3 — Create your Shopify Partner App

1. Go to partners.shopify.com → Log in
2. Click **Apps** in the left nav
3. Click **Create app** → **Create app manually**
4. Name it: **RoCourier**
5. After creating, go to **App setup** → copy your **Client ID** and **Client Secret**

---

## STEP 4 — Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
SHOPIFY_API_KEY=<Client ID from step 3>
SHOPIFY_API_SECRET=<Client Secret from step 3>
DATABASE_URL=<your PostgreSQL URL — see Step 5>
HOST=https://your-app.railway.app   # fill after Step 6
```

Also update `shopify.app.toml`:
- Replace `YOUR_CLIENT_ID_FROM_PARTNER_DASHBOARD` with your Client ID
- Replace `YOUR-APP-URL.railway.app` with your Railway URL (after Step 6)

---

## STEP 5 — Set up the database

### Option A: Railway (recommended — free tier available)

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Create new project
railway new
# → Select "Empty project"

# Add PostgreSQL
railway add --plugin postgresql
# → Copy the DATABASE_URL from Railway dashboard → Variables
```

### Option B: Local PostgreSQL (dev only)

```bash
# macOS
brew install postgresql@16
brew services start postgresql@16
createdb rocourier

# Set DATABASE_URL in .env:
DATABASE_URL=postgresql://localhost/rocourier
```

### Run migrations

```bash
npx prisma migrate dev --name init
# This creates all tables in your database
```

---

## STEP 6 — Deploy to Railway

```bash
# Link to your Railway project
railway link

# Set environment variables on Railway
railway variables set SHOPIFY_API_KEY=xxx
railway variables set SHOPIFY_API_SECRET=xxx
railway variables set DATABASE_URL=xxx   # auto-set if using Railway PG
railway variables set NODE_ENV=production

# Deploy
railway up

# Get your URL
railway domain
# → copy e.g. "rocourier-production.up.railway.app"
```

Now update your `.env` and `shopify.app.toml` with this URL.

---

## STEP 7 — Connect app to Shopify Partner Dashboard

1. In Partner Dashboard → Your App → **App setup**
2. Set **App URL**: `https://rocourier-production.up.railway.app`
3. Set **Allowed redirection URL(s)**:
   `https://rocourier-production.up.railway.app/auth/callback`
4. Under **Webhooks**, set API version to `2025-01`
5. Save

---

## STEP 8 — Install on your dev store

```bash
# Start local dev server with tunnel (for testing)
shopify app dev

# OR install production version on dev store:
# Partner Dashboard → Apps → Your App → Test on development store
```

After installation, the app will appear at:
`https://your-dev-store.myshopify.com/admin/apps/rocourier`

---

## STEP 9 — Install the cart widget

This is done by the **merchant** after installing the app:

1. Shopify Admin → **Online Store** → **Themes**
2. Click **Customize** on the active theme
3. In the left panel, navigate to **Cart** page
4. Click **Add block** → find **RoCourier Shipping**
5. In block settings, set **App URL** to your Railway URL
6. Enable FAN Courier and/or Sameday
7. Click **Save**

That's it — the widget now shows on the cart page!

---

## STEP 10 — Configure API credentials inside the app

1. Go to your Shopify Admin → Apps → RoCourier → **Setări**
2. Fill in the **Expeditor** tab (your company name, address, phone)
3. Fill in the **FAN Courier** tab with your selfAWB credentials
4. Fill in the **Sameday** tab with your eAWB credentials
5. Go to **Widget coș** → click **Reîmprospătează puncte ridicare**
6. Wait ~30 seconds for pickup points to load

---

## HOW TO GET API CREDENTIALS

### FAN Courier
1. Go to **selfawb.ro** → Create account
2. Upload your signed contract with FAN Courier
3. Once approved: **Profil → Generare Token API**
4. You get: Client ID (numeric), Username, Password
5. **For testing**: Client ID=`7032158`, User=`clienttest`, Pass=`testing`

### Sameday
1. Sign a courier contract with Sameday
2. Email **software@sameday.ro**:
   ```
   Subject: Solicit acces API eAWB
   Body: Bună ziua, doresc activarea accesului la API-ul eAWB pentru
   integrarea cu platforma mea Shopify. Numele firmei: [FIRMA].
   CUI: [CUI]. Vă mulțumesc.
   ```
3. They reply with: Username + Password for eawb.sameday.ro
4. **Sandbox URL**: sameday-api.demo.zitec.com (mention you need sandbox too)

### xConnector
- No API key needed! Your app writes AWB data to Shopify's native
  fulfillment fields, which xConnector reads automatically.
- If you want direct integration, contact: **office@infoquest.ro**

---

## SUBMITTING TO SHOPIFY APP STORE

### Requirements before submission:
- [ ] App works on real orders end-to-end
- [ ] Privacy Policy URL (create on your website)
- [ ] Support email / website
- [ ] At least 3 screenshots of the app
- [ ] App listing description in English (and Romanian)

### Submission steps:
1. Partner Dashboard → Your App → **Distribution**
2. Select **Public distribution (App Store)**
3. Fill in:
   - **App name**: RoCourier — FAN & Sameday Integration
   - **Tagline**: Integrare curier FAN & Sameday cu puncte ridicare FANbox/easybox
   - **Description**: (see template below)
   - **Category**: Shipping & Delivery
   - **Pricing**: Free / Freemium (your choice)
4. Upload screenshots (1280×800 recommended)
5. Submit for review

### App Store description template (English):
```
RoCourier connects your Shopify store with FAN Courier and Sameday — 
Romania's leading courier services. Let customers choose between home 
delivery or pickup from 1,000+ FANbox and Sameday easybox locations 
across Romania, with an interactive map.

Features:
• Cart widget with delivery method selector
• Interactive map for FANbox and Sameday easybox pickup points
• One-click AWB generation from the order dashboard
• Real-time parcel tracking with status updates
• Automatic Shopify fulfillment sync (xConnector compatible)
• Supports Cash on Delivery (ramburs)
• Bulk AWB generation
• Auto AWB on order placement (optional)
```

---

## COMMON ISSUES

### "No AWB generated" error
- Check API credentials in Settings → test connection buttons
- FAN: make sure Client ID is the numeric ID, not the username
- Sameday: ensure you have a sender pickup point configured at eawb.sameday.ro

### Cart widget not showing
- Make sure you added the block in Theme Editor → Cart page
- Check the App URL setting in the block matches your Railway URL exactly

### Pickup points not loading
- Go to Settings → Widget coș → Reîmprospătează
- Check Railway logs for errors: `railway logs`

### Orders not appearing in dashboard
- Check webhook registration: Partner Dashboard → App → Webhooks
- Or re-install the app on the dev store

---

## RAILWAY COMMANDS REFERENCE

```bash
railway logs          # View live logs
railway variables     # List env vars
railway shell         # Open shell in container
railway run npm run prisma:deploy   # Run pending migrations
```
