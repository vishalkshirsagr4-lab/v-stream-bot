# V-Stream Bot – setup and deployment

This repository contains a Telegram channel video bot using Cloudflare Workers + D1. It supports five trial videos, subscription-only random delivery, Razorpay payment links, automatic webhook activation, owner commands and queued broadcasts.

Only publish videos you own or have permission to distribute. Keep the channel's content lawful and suitable for the intended audience. Do not use the bot to distribute age-restricted material.

## 1. Telegram setup

1. Create a bot with Telegram's official BotFather and keep its token private.
2. Create a Telegram channel for your authorized video library.
3. Add the bot as a channel administrator. It must receive channel posts.
4. Get the channel's numeric ID (usually begins with -100).
5. Send /myid to your bot to obtain your numeric Telegram user ID.
6. Add the bot owner ID to the Worker secret ADMIN_IDS.

The bot indexes new video posts after the webhook is connected. To import older videos, repost them to the channel after setup. Telegram bots do not automatically receive the channel's old history.

## 2. Cloudflare D1

Install Node.js 22+ and run:

```bash
npm install
npx wrangler login
npx wrangler d1 create vstream-db --update-config
```

Wrangler will create the D1 database and update the database_id in wrangler.toml. Check that the binding is named DB and the database is vstream-db.

Apply the migration:

```bash
npm run db:remote
```

## 3. Configure Worker secrets

Run these commands from the repository root. Enter each value when prompted:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BOT_WEBHOOK_SECRET
npx wrangler secret put ADMIN_IDS
npx wrangler secret put CHANNEL_ID
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
```

ADMIN_IDS accepts comma-separated numeric Telegram user IDs. The bot fails closed for admin commands if this secret is missing.

Set DEVELOPER_USERNAME and BOT_USERNAME in wrangler.toml [vars]. Set CHANNEL_URL there too if you want to add it to the welcome message later. Never place API tokens or payment secrets in [vars], GitHub files, screenshots or public messages.

Generate BOT_WEBHOOK_SECRET as a long random string using only A-Z, a-z, 0-9, underscore and hyphen.

## 4. Deploy

```bash
npm install
npm run deploy
```

Your Worker URL will look like:

`https://v-stream-bot.YOUR_SUBDOMAIN.workers.dev`

Check:

`https://v-stream-bot.YOUR_SUBDOMAIN.workers.dev/health`

## 5. Connect Telegram webhook

Use the exact Worker URL, bot token and the same BOT_WEBHOOK_SECRET value:

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_WORKER_URL/webhook/telegram" \
  -d "secret_token=YOUR_BOT_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","callback_query","channel_post"]'
```

Check the result with Telegram getWebhookInfo. Do not share your bot token or the full getWebhookInfo URL publicly.

## 6. Razorpay test configuration

Payment processing requires a Razorpay merchant account and onboarding. Because the project owner is under 18, an eligible parent or guardian must own and complete merchant onboarding and authorize use of the account. Do not try to bypass age or identity requirements.

Start with test-mode credentials. Configure a Razorpay webhook:

- URL: `https://YOUR_WORKER_URL/webhook/razorpay`
- Event: `payment_link.paid`
- Also enable `payment_link.expired` and `payment_link.cancelled`
- Webhook secret: same value stored in RAZORPAY_WEBHOOK_SECRET

The webhook verifies the HMAC-SHA256 signature against the raw request body. The payment link ID, INR currency and amount are checked against the pending D1 payment. Payment activation is idempotent: the payment row is conditionally updated and each payment can create at most one subscription.

Do not accept real payments until the merchant account, refunds, customer support, taxes and applicable rules have been reviewed by the responsible adult.

## 7. Configure plans

After the owner ID is set in ADMIN_IDS, use the bot:

```text
/addplan Monthly 99 30
/addplan Quarterly 249 90
/addplan Yearly 799 365
/plansadmin
/deactivateplan PLAN_ID
/activateplan PLAN_ID
```

The example prices are only examples. Choose and confirm actual prices before showing plans to users. Amounts are stored in paise.

## 8. Owner commands

- `/myid` – show your Telegram numeric user ID.
- `/stats` – users, videos, active subscriptions and paid payments.
- `/broadcast MESSAGE` – queue an announcement to users.
- `/send USER_ID MESSAGE` – message one user.
- `/ban USER_ID` and `/unban USER_ID`.
- `/addplan NAME RUPEES DAYS`.
- `/plansadmin`, `/activateplan ID`, `/deactivateplan ID`.

Broadcasts are processed in batches of 20 by the Worker's one-minute scheduled trigger to avoid a single long-running webhook request.

## 9. GitHub Actions deployment (optional)

Add these GitHub repository Actions secrets:

- CLOUDFLARE_API_TOKEN – token with Workers Scripts edit and D1 edit permissions for the intended account.
- CLOUDFLARE_ACCOUNT_ID – your Cloudflare account ID.

The workflow applies D1 migrations and deploys the Worker on pushes to main. Create the D1 database once first and commit the updated wrangler.toml database_id. Worker runtime secrets still need to be configured with wrangler secret put or the Cloudflare dashboard.

## 10. Operational checklist

- Confirm /health returns ok.
- Confirm Telegram getWebhookInfo shows the correct webhook URL.
- Confirm the bot is a channel admin and a newly posted video appears in the D1 videos table.
- Confirm each test user receives at most five trial videos.
- Confirm Random Video is denied without an active subscription.
- Test successful, failed, expired and duplicate payment webhooks in Razorpay test mode.
- Test subscription extension when a user buys before the current expiry.
- Test /broadcast with a small test group.
- Keep secrets private and rotate any token that is accidentally exposed.

This is a working starter implementation, not a substitute for production payment/legal review. Refund and chargeback workflows, subscription cancellation UX, detailed admin audit logs and customer support tooling should be added before a public paid launch.
