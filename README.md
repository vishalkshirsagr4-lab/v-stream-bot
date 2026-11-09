# V-Stream Bot

A Telegram video-library bot built on **Cloudflare Workers + D1 + Telegram Bot API + Razorpay Payment Links**.

## Features

- Welcome greeting with **Help**, **5-video Trial**, **Subscription**, and **Random Video** buttons.
- Persistent reply keyboard with Random Video and My Subscription.
- Five free trial deliveries per Telegram account.
- Videos indexed automatically from new posts in your Telegram channel.
- Random video delivery requires an active subscription.
- Multiple owner-defined plans (for example monthly and yearly).
- Razorpay payment links; subscription activation only after a signed payment webhook.
- Owner commands for statistics, plans, user messages, broadcasts, moderation, video catalogue and complimentary access.
- One-minute scheduled broadcast batches.
- Cloudflare D1 database and GitHub Actions deployment workflow.

## Quick start

1. Create a Telegram bot with BotFather.
2. Create a private Telegram channel and add the bot as an administrator with permission to post.
3. Create a Cloudflare D1 database: `npx wrangler d1 create vstream-db --update-config`.
4. Apply schema: `npm run db:remote`.
5. Configure Worker secrets (see [Setup guide](docs/SETUP.md)).
6. Deploy: `npm install && npm run deploy`.
7. Set Telegram webhook to `https://YOUR_WORKER_URL/webhook/telegram` with the configured webhook secret.
8. Add videos to the channel. New channel posts are indexed automatically.
9. Add plans in the bot using `/addplan Monthly 99 30` and `/addplan Yearly 799 365` (example amounts only).

## Important

- The repository contains no bot token, channel ID, owner ID, Razorpay keys, or Cloudflare account credentials. Configure them as Worker secrets; never commit them.
- The channel has not been created/configured yet. The bot cannot index videos until a channel exists, the bot is an administrator, and CHANNEL_ID is set.
- Razorpay requires a properly onboarded merchant account. Since the project owner is under 18, an eligible parent/guardian must own and supervise payment onboarding and account use.
- Start with Razorpay test mode. Do not accept real payments until payment, refund, support and compliance processes have been reviewed.
- Only distribute videos you own or are authorized to share. Do not use this bot for age-restricted or unlawful content.

See [docs/SETUP.md](docs/SETUP.md) for complete deployment and configuration instructions.
