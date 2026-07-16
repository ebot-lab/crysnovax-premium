# Premium Command System Deployment Guide

## Overview

The premium ecosystem consists of:
- **Cloudflare Worker** at `https://premium.crysnova.qzz.io` — API and admin dashboard
- **D1 Database** — Durable storage for users, plans, payments, usage, restrictions, audit logs
- **Bot Integration** — `/premium`, `/plans`, `/donate` commands with Stars checkout and quota enforcement
- **Owner Controls** — `/premiumgift`, `/premiumrestrict`, `/premiumlookup`, `/premiumreset` commands

## Step 1: Create Cloudflare D1 Database

### Prerequisites
- Cloudflare account with admin access
- `wrangler` CLI installed: `pnpm install -g wrangler`

### Create Database

```bash
cd premium-worker
export CLOUDFLARE_ACCOUNT_ID="282b269d2530a8f05d715d715c81ba69"
export CLOUDFLARE_API_TOKEN="YOUR_API_TOKEN_HERE"

wrangler d1 create crysnovax-premium --config wrangler.toml

# The command will output your database ID. Save it.
# Output example:
# Database ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Apply Migrations

```bash
wrangler d1 migrations apply crysnovax-premium --config wrangler.toml
```

## Step 2: Update wrangler.toml

Add your database ID to `premium-worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "crysnovax-premium"
database_id = "YOUR_DATABASE_ID_HERE"
```

## Step 3: Deploy Worker

```bash
wrangler deploy --config premium-worker/wrangler.toml
```

The Worker will be deployed to `premium.crysnova.qzz.io` automatically via the route in `wrangler.toml`.

## Step 4: Configure Bot Integration

Set these environment variables in your bot deployment:

```
PREMIUM_API_URL=https://premium.crysnova.qzz.io
CLOUDFLARE_ACCOUNT_ID=282b269d2530a8f05d715d715c81ba69
ADMIN_TELEGRAM_IDS=YOUR_TELEGRAM_ID (comma-separated for multiple admins)
```

The bot will automatically call the premium API at startup to verify connectivity.

## Step 5: Configure Admin Access

### Create Owner API Token

Owner commands (`/premiumgift`, `/premiumrestrict`, etc.) require the owner's Telegram ID to be in the `ADMIN_TELEGRAM_IDS` list.

In the dashboard, only admins in this list can view statistics and modify plans/quotas/restrictions.

### Access Dashboard

Navigate to `https://premium.crysnova.qzz.io/dashboard` and sign in with Telegram (your ID must be in `ADMIN_TELEGRAM_IDS`).

**Dashboard Features:**
- Revenue and active user counts
- Usage statistics by command and user
- Plan management (edit prices, toggle commands, set quotas)
- Payment history
- Restrictions and bans
- Gift management
- Audit logs

## Step 6: Enable Telegram Stars Checkout

In your Telegram bot settings, ensure **Telegram Stars payments are enabled**:

1. BotFather: `/mybots` → Select your bot → **Payments**
2. Confirm **Telegram Stars** is active

The bot will automatically handle:
- Checkout flows with inline keyboards
- Payment validation
- Usage quota enforcement
- Subscription renewals (30-day recurring)

## Telegram Bot Commands

### User Commands

- `/premium` — View status, available plans, current expiry
- `/plans` — Show all available plans with purchase buttons
- `/donate [stars]` — Send a voluntary donation (1–10,000 Stars)

### Owner Commands (Owner Only)

- `/premiumgift user|group <id> <plan_id>` — Grant free premium to user or group
- `/premiumrestrict user|group <id> ban|restrict [reason]` — Ban or restrict a user/group
- `/premiumlookup <user_id> [chat_id]` — Check premium status
- `/premiumreset user|group <id>` — Clear usage quotas

### Plan IDs

- `personal_daily` — 10 Stars, 24-hour pass
- `personal_weekly` — 50 Stars, 7-day pass
- `personal_monthly` — 140 Stars, recurring 30 days
- `group_daily` — 20 Stars, 24-hour group pass
- `group_weekly` — 100 Stars, 7-day group pass
- `group_monthly` — 280 Stars, recurring 30 days

## Metered Commands

**Free users** can use these commands with daily limits. **Premium users** have higher or unlimited access:

### Free Limits
- `/ask` — 10 per day
- `/search` — 10 per day
- `/short` — 10 per day
- `/wallpaper` — 10 per day
- `/generate` — 2 per day
- `/aiedit` — 2 per day
- `/play` — 5 per day
- `/tt` / `/ttsearch` — 5 per day

### Premium Users
All limits are removed or significantly increased per their plan tier.

## Troubleshooting

### "Invalid API Token"

Ensure:
1. Token is a **Custom API Token** or **Global API Key** from Cloudflare
2. Token has **D1 Edit**, **Workers Scripts Write**, and **DNS Edit** permissions
3. Account ID matches your Cloudflare account
4. Environment variables are set correctly

### Worker Deploy Fails

- Check `wrangler.toml` has correct `account_id`
- Verify `CLOUDFLARE_API_TOKEN` has **Workers Scripts Write** permission
- Check route `https://premium.crysnova.qzz.io` is configured in DNS or Workers routes

### Bot Can't Connect to Premium API

- Verify `PREMIUM_API_URL` is set to `https://premium.crysnova.qzz.io`
- Test API health: `curl https://premium.crysnova.qzz.io/health`
- Check bot logs for connection errors

### Dashboard Won't Load

- Verify `ADMIN_TELEGRAM_IDS` includes your Telegram ID (no quotes, comma-separated)
- Sign out and back in
- Check browser console for JavaScript errors

## API Reference

### Core Endpoints

**Get Plans**
```
GET /api/v1/plans
Response: { plans: [...] }
```

**Check Status**
```
GET /api/v1/status?userId=<id>&chatId=<id>
Response: { premium: bool, source: string, personal: {...}, group: {...} }
```

**Consume Usage**
```
POST /api/v1/usage/consume
Body: { command, userId, chatId, owner, requestId }
Response: { allowed: bool, limit: number, remaining: number }
```

**Record Payment**
```
POST /api/v1/payments
Body: { nonce, buyerId, stars, telegramChargeId, providerChargeId, idempotencyKey }
Response: { entitlement: {...} }
```

**Admin Actions**
```
POST /api/v1/admin/<action>
Body: { actorId, ...<action-specific-fields> }
Actions: gift, restrict, reset
```

## Support

For issues:
1. Check this guide's Troubleshooting section
2. Review bot logs: `pm2 logs bot`
3. Check Cloudflare dashboard: https://dash.cloudflare.com
4. Test endpoints manually with `curl` or Postman
