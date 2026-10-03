# Duo — Two-Person Accountability & Reminder PWA

A mobile-first **Progressive Web App (PWA)** for exactly **two people** to share daily reminders and stay accountable with real-time response sync and Web Push notifications.

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
              │  Polling / SSE / Batch Sync      │
              ▼                                  ▼
┌──────────────────────────────────────────────────────────────┐
│                  Vercel Serverless Backend                   │
│   /api/sync        /api/push          /api/cron (every min)  │
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

### 1. Run with Node.js
```bash
# Start local server (Static files + API + JSON file persistence)
npm start
# or
node server.js
```

### 2. Run with PowerShell (Windows native, zero external runtimes)
```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```

* Open `http://localhost:3000` in your browser.
* To test real two-device synchronization on the same Wi-Fi, open `http://<your-computer-ip>:3000` on both phones.
* A **DEV MODE** banner is available at the top for single-screen developer simulation.

---

## 🔑 Production Environment Variables

Add these in **Vercel Project Settings → Environment Variables**:

| Variable | Required | Description | Example |
|---|---|---|---|
| `KV_REST_API_URL` | Yes (Prod) | Upstash Redis / Vercel KV REST API URL | `https://prompt-duck-123.upstash.io` |
| `KV_REST_API_TOKEN` | Yes (Prod) | Upstash Redis / Vercel KV REST Token | `AXe...=` |
| `VAPID_PUBLIC_KEY` | Yes (Push) | VAPID Application Server Public Key | `BNc...` |
| `VAPID_PRIVATE_KEY`| Yes (Push) | VAPID Application Server Private Key | `4_u...` |
| `VAPID_SUBJECT`    | Yes (Push) | Contact email for Web Push identification | `mailto:admin@duoremind.app` |
| `CRON_SECRET`      | Optional | Secret token to secure `/api/cron` endpoint | `your-secure-random-token` |

---

## 🗄️ Database Setup (Upstash Redis / Vercel KV)

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard) → **Storage** tab.
2. Click **Create Database** → Select **KV (Serverless Redis by Upstash)**.
3. Click **Connect to Project** and select your Duo project.
4. Vercel will automatically populate `KV_REST_API_URL` and `KV_REST_API_TOKEN` into your project environment variables.

---

## 🔔 VAPID Key Generation

To generate your VAPID public and private key pair for Web Push:

```bash
# Run the built-in generator script
npm run generate-vapid
```
*or:*
```bash
npx web-push generate-vapid-keys
```

Copy the generated `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` into your Vercel Project Environment Variables.

---

## ⏰ Scheduled Reminder Delivery (Vercel Cron)

The repository includes a configured cron trigger in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "* * * * *"
    }
  ]
}
```

* **What it does**: Every minute, Vercel Cron hits `/api/cron`.
* **Execution**:
  1. Inspects active reminders for each pair.
  2. Evaluates base scheduled time (`06:00 AM`) and active snoozes (`snoozeUntil`).
  3. Checks delivery log (`duo_deliv_<deliveryKey>`) to prevent duplicate sends.
  4. Dispatches Web Push payloads to all registered devices of each user.
  5. Automatically prunes expired subscriptions (`410 Gone` / `404 Not Found`).

---

## ☁️ Deploying to Vercel

```bash
# 1. Login & Link Project
npx vercel

# 2. Deploy to Production
npx vercel --prod
```

After deployment, your HTTPS production URL will automatically serve the PWA, handle pairing sync, and execute scheduled push reminders.

---

## 📱 Push Notification Limitations & Realities

* **Android (Chrome / Samsung Internet)**: Full background Web Push support even when PWA is closed.
* **iOS (Apple Safari / iOS 16.4+)**: Web Push is supported **only after the user adds the PWA to their Home Screen** (`Share → Add to Home Screen`) and grants notification permission.
* **Battery Optimization**: Aggressive OS battery saving modes can occasionally delay background notifications until device wakeup. Duo uses foreground alarms + in-app chimes as an instant zero-latency layer when the app is open.
