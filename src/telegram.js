import { sendMessage, sendVideo, answerCallbackQuery } from "./telegram-api.js";
import { upsertUser, getUser, getActiveSubscription, listPlans, getRandomVideo } from "./db.js";
import { createPaymentLink } from "./payments.js";
import { handleAdminCommand } from "./admin.js";

const HELP_TEXT =
  "🎬 V-Stream Help\n\n" +
  "🎁 Trial – receive up to five free videos.\n" +
  "🎲 Random Video – available with an active subscription.\n" +
  "💳 Subscription – view available plans.\n" +
  "👑 My Subscription – check your expiry date.\n\n" +
  "Use the buttons below to continue.";

function trialLimit(env) {
  const n = Number(env.TRIAL_VIDEO_LIMIT || 5);
  return Number.isInteger(n) && n > 0 && n <= 20 ? n : 5;
}

function welcomeMarkup() {
  return {
    inline_keyboard: [
      [{ text: "❓ Help", callback_data: "help" }, { text: "🎁 Trial – 5 Videos", callback_data: "trial" }],
      [{ text: "💳 Subscription", callback_data: "plans" }, { text: "🎲 Random Video", callback_data: "random" }]
    ]
  };
}

function replyKeyboard() {
  return {
    keyboard: [
      [{ text: "🎲 Random Video" }, { text: "👑 My Subscription" }],
      [{ text: "🎁 Trial Videos" }, { text: "💳 Subscription" }],
      [{ text: "❓ Help" }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

async function sendWelcome(env, chatId) {
  const developer = env.DEVELOPER_USERNAME || "Not configured";
  await sendMessage(env, chatId,
    "👋 Welcome to V-Stream! 🎬\n\nBrowse our video collection with a five-video trial or choose a subscription.\n\nDeveloper: " + developer,
    { reply_markup: welcomeMarkup() });
  await sendMessage(env, chatId, "Choose an option from the menu below.", { reply_markup: replyKeyboard() });
}

export async function handleMessage(message, env) {
  if (!message.from || !message.chat || message.chat.type !== "private") return;
  const chatId = message.chat.id;
  const userId = String(message.from.id);
  await upsertUser(env.DB, message.from, trialLimit(env));

  const blocked = await env.DB.prepare("SELECT is_blocked FROM users WHERE telegram_id=?").bind(userId).first();
  if (blocked && blocked.is_blocked) return;

  const text = (message.text || "").trim();
  if (text.startsWith("/")) {
    const parts = text.split(/\s+/);
    const command = parts[0].split("@")[0].toLowerCase();
    const args = parts.slice(1);
    if (command === "/start") return sendWelcome(env, chatId);
    if (command === "/help") return sendMessage(env, chatId, HELP_TEXT, { reply_markup: replyKeyboard() });
    if (await handleAdminCommand(message, env, command, args, text)) return;
    return sendMessage(env, chatId, "Unknown command. Send /help for available options.");
  }

  if (text === "🎲 Random Video") return deliverRandom(env, chatId, userId);
  if (text === "👑 My Subscription") return showSubscription(env, chatId, userId);
  if (text === "🎁 Trial Videos") return deliverTrial(env, chatId, userId);
  if (text === "💳 Subscription") return showPlans(env, chatId);
  if (text === "❓ Help") return sendMessage(env, chatId, HELP_TEXT);
}

export async function handleCallback(query, env) {
  const chatId = query.message && query.message.chat && query.message.chat.id;
  const userId = query.from && String(query.from.id);
  if (!chatId || !userId) return;
  await upsertUser(env.DB, query.from, trialLimit(env));
  await answerCallbackQuery(env, query.id);

  const user = await getUser(env.DB, userId);
  if (user && user.is_blocked) return sendMessage(env, chatId, "Your access to this bot is disabled.");

  if (query.data === "help") return sendMessage(env, chatId, HELP_TEXT);
  if (query.data === "trial") return deliverTrial(env, chatId, userId);
  if (query.data === "random") return deliverRandom(env, chatId, userId);
  if (query.data === "plans") return showPlans(env, chatId);
  if (query.data && query.data.startsWith("buy:")) {
    const planId = Number(query.data.slice(4));
    if (!Number.isInteger(planId) || planId < 1) return sendMessage(env, chatId, "Invalid plan.");
    return startPurchase(env, chatId, userId, planId);
  }
}

export async function handleChannelPost(message, env) {
  if (!env.CHANNEL_ID || String(message.chat.id) !== String(env.CHANNEL_ID)) return;
  const media = message.video ||
    (message.document && String(message.document.mime_type || "").startsWith("video/") ? message.document : null);
  if (!media || !media.file_id) return;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO videos(file_id, file_unique_id, caption, channel_message_id) VALUES (?, ?, ?, ?)"
  ).bind(media.file_id, media.file_unique_id || null, message.caption || "", message.message_id).run();
}

async function deliverTrial(env, chatId, userId) {
  const video = await getRandomVideo(env.DB);
  if (!video) return sendMessage(env, chatId, "No videos are available yet. Please try again later.");
  const reserved = await env.DB.prepare(
    "UPDATE users SET trial_remaining=trial_remaining-1 WHERE telegram_id=? AND trial_remaining>0 AND is_blocked=0 RETURNING trial_remaining"
  ).bind(userId).first();
  if (!reserved) return sendMessage(env, chatId, "Your five-video trial has been used. Choose a subscription to continue.");
  try {
    await sendVideo(env, chatId, video.file_id, video.caption || "");
    await sendMessage(env, chatId, "🎁 Trial video sent. " + reserved.trial_remaining + " trial video(s) remaining.");
  } catch (error) {
    await env.DB.prepare("UPDATE users SET trial_remaining=trial_remaining+1 WHERE telegram_id=?")
      .bind(userId).run();
    throw error;
  }
}

async function deliverRandom(env, chatId, userId) {
  const sub = await getActiveSubscription(env.DB, userId);
  if (!sub) {
    return sendMessage(env, chatId,
      "🔒 Random videos require an active subscription. You can still use any remaining trial videos.",
      { reply_markup: replyKeyboard() });
  }
  const video = await getRandomVideo(env.DB);
  if (!video) return sendMessage(env, chatId, "No videos are available yet. Please try again later.");
  return sendVideo(env, chatId, video.file_id, video.caption || "");
}

async function showSubscription(env, chatId, userId) {
  const sub = await getActiveSubscription(env.DB, userId);
  if (!sub) return sendMessage(env, chatId, "You don't have an active subscription. Choose Subscription to view plans.");
  return sendMessage(env, chatId, "👑 Active plan: " + sub.plan_name + "\nExpires: " + sub.expires_at + " UTC");
}

async function showPlans(env, chatId) {
  const plans = await listPlans(env.DB);
  if (!plans.length) return sendMessage(env, chatId, "No plans are available yet. Please check back later.");
  const keyboard = plans.map(function (plan) {
    return [{
      text: plan.name + " – ₹" + (plan.amount_paise / 100).toFixed(2) + " / " + plan.duration_days + " days",
      callback_data: "buy:" + plan.id
    }];
  });
  return sendMessage(env, chatId, "💳 Choose a subscription plan:", {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function startPurchase(env, chatId, userId, planId) {
  try {
    const link = await createPaymentLink(env, userId, planId);
    return sendMessage(env, chatId,
      "Your secure payment link is ready:\n" + link.short_url +
      "\n\nYour subscription activates after the payment provider verifies the payment.");
  } catch (error) {
    console.error("Could not create payment link:", error);
    return sendMessage(env, chatId, "Payments are temporarily unavailable. Please contact the administrator.");
  }
}
