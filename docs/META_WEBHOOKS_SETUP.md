# Meta Webhooks Infrastructure & Verification Setup Guide

This guide details how to expose your local Infragen backend and configure Webhooks in the **Meta App Dashboard** for both **WhatsApp Cloud API** and **Instagram Graph API**.

---

## 1. Environment Variables Configuration

Add the following variables to your `.env` in `real-estate-backend`:

```env
# Shared or Platform-Specific Meta App Secrets (used for HMAC-SHA256 signature verification)
META_APP_SECRET="your_meta_app_secret_here"
WHATSAPP_APP_SECRET="your_whatsapp_app_secret_here"     # Optional override
INSTAGRAM_APP_SECRET="your_instagram_app_secret_here"   # Optional override

# Webhook Verification Handshake Tokens (must match the token entered in Meta Dashboard)
META_VERIFY_TOKEN="infragen_meta_verify_token_2026"
WHATSAPP_VERIFY_TOKEN="infragen_whatsapp_token_2026"    # Optional override
INSTAGRAM_VERIFY_TOKEN="infragen_instagram_token_2026"  # Optional override
```

---

## 2. Exposing Local Backend via ngrok

To receive live webhook events from Meta on your local development machine:

1. Start the NestJS backend server:
   ```bash
   npm start
   ```
   *(Backend runs on port `3001` with global prefix `/api/v1`)*

2. In a separate terminal, start `ngrok`:
   ```bash
   ngrok http 3001
   ```

3. Copy your HTTPS forwarding URL from ngrok (e.g., `https://a1b2-c3d4.ngrok-free.app`).

Your Webhook Endpoints will be:
- **WhatsApp**: `https://<YOUR-NGROK-DOMAIN>/api/v1/webhooks/whatsapp`
- **Instagram**: `https://<YOUR-NGROK-DOMAIN>/api/v1/webhooks/instagram`

---

## 3. Configuring WhatsApp Webhooks in Meta App Dashboard

1. Navigate to the [Meta for Developers Dashboard](https://developers.facebook.com/apps/).
2. Select your App (or create a **Business** type App).
3. In the left sidebar, click on **WhatsApp** -> **Configuration**.
4. Locate the **Webhook** section and click **Edit**.
5. Fill in the fields:
   - **Callback URL**: `https://<YOUR-NGROK-DOMAIN>/api/v1/webhooks/whatsapp`
   - **Verify Token**: `infragen_whatsapp_token_2026` (or the value set in `META_VERIFY_TOKEN` / `WHATSAPP_VERIFY_TOKEN`)
6. Click **Verify and Save**.
   *(Meta will send a `GET` handshake request to the endpoint. The server verifies the token and immediately returns the challenge string)*.
7. Click **Manage Webhook Fields** and subscribe to:
   - `messages` *(Captures text messages, media, voice notes, buttons, and location)*.

---

## 4. Configuring Instagram Webhooks in Meta App Dashboard

> [!IMPORTANT]
> To capture both customer Direct Messages and prospect inquiries on listings/reels, you must subscribe to **BOTH** the `messages` and `comments` webhook fields.

1. In your Meta App Dashboard, navigate to **Instagram** / **Messenger API for Instagram** -> **Settings** (or **Webhooks** in the sidebar).
2. Select **Instagram** from the dropdown object list.
3. Click **Subscribe to this object** (or **Edit Webhook URL**):
   - **Callback URL**: `https://<YOUR-NGROK-DOMAIN>/api/v1/webhooks/instagram`
   - **Verify Token**: `infragen_instagram_token_2026` (or the value set in `META_VERIFY_TOKEN` / `INSTAGRAM_VERIFY_TOKEN`)
4. Click **Verify and Save**.
5. Under **Subscription Fields**, enable and subscribe to BOTH:
   - `messages` *(Direct Messages, replies, story mentions)*
   - `comments` *(Comments on Instagram Feed Posts, Reels, Ads)*
   - `mentions` *(Optional: Account tag mentions)*

---

## 5. Security & Verification Architecture

```
[Meta Platform] 
       │  (POST Webhook Event + X-Hub-Signature-256 header)
       ▼
[WebhooksController]
       │
       ├── 1. Cryptographic HMAC-SHA256 Signature Verification (`req.rawBody` + App Secret)
       │      └── Rejects invalid signatures with HTTP 401
       │
       ├── 2. Raw Ingestion Logging (`webhook_logs` table)
       │      └── Persists raw payload with status RECEIVED for zero data loss
       │
       ├── 3. Immediate HTTP 200 Acknowledgment (`EVENT_RECEIVED`)
       │      └── Prevents Meta from triggering retry timeouts & duplicates
       │
       ▼
[WebhooksQueueService] (Async background job execution)
       ├── WhatsApp: Messages & Delivery Statuses
       └── Instagram: DMs (`entry.messaging`) & Comments (`entry.changes` where field='comments')
```

---

## 6. Audit & Monitoring Endpoints

- **`GET /api/v1/webhooks/logs`** *(Admin JWT required)*:
  Lists recent webhook payloads, delivery headers, platform, event type, and processing status (`RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`).
