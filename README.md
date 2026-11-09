# V-Stream Bot

A Telegram video-library bot built on **Cloudflare Workers + D1 + Telegram Bot API + manual UPI verification**.

## Features

- Welcome greeting with Help, five-video Trial, Subscription and Random Video buttons.
- Persistent reply keyboard with Random Video and My Subscription.
- Five free trial deliveries per Telegram account.
- Videos indexed automatically from new posts in your Telegram channel.
- Random video delivery requires an active subscription.
- Multiple owner-defined subscription plans.
- Manual UPI payment instructions and UTR submission by the buyer.
- Owner verifies the actual bank credit before approving a payment; the bot never activates from a UTR or screenshot alone.
- Owner commands for statistics, plans, user messages, broadcasts, moderation, video catalogue and complimentary access.
- Pending payment review, approval and rejection commands.
- Cloudflare D1 database and GitHub Actions deployment workflow.

## Quick start

1. Create a Telegram bot with BotFather.
2. Create a Telegram channel and add the bot as an administrator with permission to post.
3. Create a Cloudflare D1 database: `npx wrangler d1 create vstream-db --update-config`.
4. Apply schema: `npm run db:remote`.
5. Configure Worker secrets and variables (see [Setup guide](docs/SETUP.md)).
6. Deploy: `npm install && npm run deploy`.
7. Set Telegram webhook to `https://YOUR_WORKER_URL/webhook/telegram`.
8. Add videos to the channel. New channel posts are indexed automatically.
9. Add plans using `/addplan Monthly 99 30` (example price only).

## Payment review commands

- `/pendingpayments` – list submitted UTRs.
- `/approvepayment REQUEST_ID` – activate only after verifying the matching credit in the receiving bank account.
- `/rejectpayment REQUEST_ID [REASON]` – reject an unverified request.

Only collect payments through an account managed by an eligible parent/guardian. Do not ask users for UPI PINs, OTPs, passwords or banking credentials. A UTR is a reference for manual checking, not proof of payment.

Only distribute videos you own or are authorized to share. Do not use the bot for age-restricted or unlawful content.
