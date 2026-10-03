# Duo — Two-Person Accountability & Reminder PWA

A mobile-first **Progressive Web App (PWA)** for exactly **two people** to share daily reminders and stay accountable with real-time response synchronization and Web Push notifications.

---

## 🎯 Core Value Principle

Duo answers three questions immediately:
1. **What do I need to do?** → `🚶 Walking — 6:00 AM`
2. **What did I choose?** → `✅ Going — 6:03 AM`
3. **What did my partner choose?** → `❌ Skipped — 6:05 AM`

---

## 🛠️ Architecture Overview

```text
┌───────────────────────────┐      ┌───────────────────────────┐
│     Device A (Viswa)      │      │    Device B (Partner)     │
│   Installed PWA / Chrome  │      │   Installed PWA / Chrome  │
└─────────────┬─────────────┘      └─────────────┬─────────────┘
              │                                  │
              │  Polling / State Sync            │
              ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│                  Vercel Serverless Backend                   │
│   /api/sync        /api/push          /api/cron (1-min HTTP) │
└──────────────────────────────┬───────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│   Production Database (KV)   │ │    Web Push Provider (FCM)   │
│   Pairs, Reminders, Responses│ │    VAPID Payload Dispatch    │
│   Push Subscriptions & Logs  │ │    Lock Screen Notifications │
└──────────────────────────────┘ └──────────────────────────────┘
```

---

## 💻 Local Development

### Option 1: Run with Node.js
```bash
# Start local server (Static files + API + JSON file persistence)
npm start
# or
node server.js
```

### Option 2: Run with PowerShell (Windows native, zero external runtimes)
```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```

* Open `http://localhost:3000` in your browser.
* To test real two-device synchronization on the same Wi-Fi, open `http://<your-computer-ip>:3000` on both phones.
* A **DEV MODE** banner is available at the top for single-screen developer simulation.

---

## 🔑 Production Environment Variables (Vercel)

Add these in **Vercel Project Settings → Environment Variables**:

| Variable | Required | Description | Example |
|---|---|---|---|
| `KV_REST_API_URL` | Yes (Prod) | Upstash Redis / Vercel KV REST API URL | `https://prompt-duck-123.upstash.io` |
| `KV_REST_API_TOKEN` | Yes (Prod) | Upstash Redis / Vercel KV REST Token | `AXe...=` |
| `VAPID_PUBLIC_KEY` | Yes (Push) | VAPID Application Server Public Key | `BNc...` |
| `VAPID_PRIVATE_KEY`| Yes (Push) | VAPID Application Server Private Key | `4_u...` |
| `VAPID_SUBJECT`    | Yes (Push) | Contact email for Web Push identification | `mailto:admin@duoremind.app` |
| `CRON_SECRET`      | Yes (Cron) | Secret token securing `/api/cron` | `duo_secret_token_123` |

---

## 🗄️ Database Setup (Upstash Redis / Vercel KV)

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard) → **Storage** tab.
2. Click **Create Database** → Select **KV (Serverless Redis by Upstash)**.
3. Click **Connect to Project** and select your Duo project.
4. Vercel will automatically populate `KV_REST_API_URL` and `KV_REST_API_TOKEN` into your environment variables.

---

## 🔔 VAPID Key Generation

Generate your VAPID public and private key pair for Web Push:

```bash
# Run the built-in generator script
npm run generate-vapid
```
*(or run `npx web-push generate-vapid-keys`)*

Copy the generated `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` into your Vercel Project Environment Variables.

---

## ⏰ Minute-Level Scheduled Reminders (Vercel Hobby + Free External Cron)

Vercel Hobby accounts do not permit minute-by-minute internal Vercel Crons. To achieve minute-level precision for scheduled reminders without upgrading to Pro, use a free external HTTP cron service such as **[cron-job.org](https://cron-job.org)** (or EasyCron / GitHub Actions):

### Step-by-Step Cron Setup on cron-job.org:
1. Create a free account on [cron-job.org](https://cron-job.org).
2. Click **Create Cronjob**.
3. **URL**: `https://<your-vercel-domain>.vercel.app/api/cron?secret=YOUR_CRON_SECRET`
   *(or set Header `x-cron-secret: YOUR_CRON_SECRET`)*
4. **Execution Schedule**: Set to **Every 1 minute** (`* * * * *`).
5. **Method**: `GET` or `POST`.
6. Click **Save**.

### How `/api/cron` Works:
1. Validates the `CRON_SECRET`.
2. Inspects active reminders for all paired spaces.
3. Evaluates base reminder times (`06:00 AM`) and active 10-minute snoozes (`snoozeUntil`).
4. Uses duplicate protection locks (`duo_deliv_<deliveryKey>`) to ensure each user receives only 1 notification per occurrence.
5. Delivers rich Web Push notifications with action buttons directly to both phones.
6. Automatically prunes expired subscriptions (`410 Gone` / `404 Not Found`).

---

## ☁️ Deploying to Vercel (Hobby Plan Compatible)

```bash
# 1. Login & Link Project
npx vercel

# 2. Deploy to Production
npx vercel --prod
```

---

## 📱 Physical Device Push Testing Protocol

> **Note on Testing**: Production Web Push requires HTTPS and physical device verification.

Once deployed to your production HTTPS domain:
1. **Device A (Viswa)**: Open production URL in Chrome (Android) or Safari (iOS 16.4+ *Add to Home Screen*). Create space `Viswa` + `Partner` and tap **Enable Notifications**.
2. **Device B (Partner)**: Open production URL on separate phone. Tap **Join with Code** → Enter pair code and tap **Enable Notifications**.
3. **Trigger Test**: Create a reminder scheduled 2 minutes in the future (e.g. `Walking`).
4. Lock both devices. When the minute arrives, verify that the external cron executes `/api/cron` and both devices receive the push notification on their lock screens.
